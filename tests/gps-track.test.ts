import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { encodePolyline, parseFit, parseGpx, parseTcx, readTrack, simplify, summaryPolyline, type LatLng } from "../scripts/gps-track";
import { activitiesFromCsv, fillsFor, toSql } from "../scripts/import-strava-export";
import { setupTestDb } from "./setup-test-db";

const GPX = `<?xml version="1.0"?><gpx><trk><trkseg>
<trkpt lat="51.5000000" lon="-0.1000000"><ele>10</ele></trkpt>
<trkpt lat="51.5010000" lon="-0.1010000"></trkpt>
<trkpt lat="51.5020000" lon="-0.1020000"></trkpt>
</trkseg></trk></gpx>`;

// A FIT file with one definition (record: lat, long as sint32) and two records,
// then an activity message with timestamp and local_timestamp one hour apart.
function fitFixture(): Buffer {
  const sc = (deg: number) => Math.round((deg * 2 ** 31) / 180);
  const parts: Buffer[] = [];
  const def = (local: number, global: number, fields: [number, number, number][]) => {
    const b = Buffer.alloc(6 + fields.length * 3);
    b[0] = 0x40 | local; b[1] = 0; b[2] = 0; b.writeUInt16LE(global, 3); b[5] = fields.length;
    fields.forEach(([n, s, t], i) => { b[6 + i * 3] = n; b[7 + i * 3] = s; b[8 + i * 3] = t; });
    parts.push(b);
  };
  const rec = (local: number, ints: number[]) => {
    const b = Buffer.alloc(1 + ints.length * 4); b[0] = local;
    ints.forEach((v, i) => b.writeInt32LE(v | 0, 1 + i * 4)); parts.push(b);
  };
  def(0, 20, [[0, 4, 0x85], [1, 4, 0x85]]);
  rec(0, [sc(45.79), sc(6.97)]);
  rec(0, [0x7fffffff, 0x7fffffff]); // no fix: skipped
  rec(0, [sc(45.8), sc(6.98)]);
  def(1, 34, [[253, 4, 0x86], [5, 4, 0x86]]);
  rec(1, [1000000000, 1000003600]);
  const data = Buffer.concat(parts);
  const head = Buffer.alloc(12); head[0] = 12; head[1] = 0x10; head.writeUInt32LE(data.length, 4); head.write(".FIT", 8, "ascii");
  return Buffer.concat([head, data, Buffer.alloc(2)]);
}

describe("gps-track", () => {
  it("encodes polylines like Google's reference example", () => {
    expect(encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("reads GPX, TCX and FIT tracks", () => {
    expect(parseGpx(GPX)).toEqual([[51.5, -0.1], [51.501, -0.101], [51.502, -0.102]]);
    expect(parseTcx("<Position><LatitudeDegrees>51.5</LatitudeDegrees><LongitudeDegrees>-0.1</LongitudeDegrees></Position>")).toEqual([[51.5, -0.1]]);
    const fit = parseFit(fitFixture());
    expect(fit.points.length).toBe(2);
    expect(fit.points[0][0]).toBeCloseTo(45.79, 6);
    expect(fit.points[1][1]).toBeCloseTo(6.98, 6);
    expect(fit.utcOffsetSeconds).toBe(3600);
  });

  it("reads gzipped files by extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "gps-"));
    writeFileSync(join(dir, "a.gpx.gz"), gzipSync(GPX));
    writeFileSync(join(dir, "b.fit.gz"), gzipSync(fitFixture()));
    expect(readTrack(join(dir, "a.gpx.gz")).points.length).toBe(3);
    expect(readTrack(join(dir, "b.fit.gz")).points.length).toBe(2);
  });

  it("simplifies long tracks to Strava's summary size", () => {
    const pts: LatLng[] = [];
    for (let i = 0; i < 20000; i++) pts.push([51.5 + Math.sin(i / 300) * 0.05, -0.1 + i * 0.00002]);
    expect(simplify([[0, 0], [0, 1], [0, 2]], 0.001)).toEqual([[0, 0], [0, 2]]); // collinear middle point dropped
    const s = summaryPolyline(pts);
    expect(s.length).toBeLessThanOrEqual(1300);
    expect(s.length).toBeGreaterThan(1000);
    expect(summaryPolyline(pts.slice(0, 5))).toBe(encodePolyline(pts.slice(0, 5))); // short tracks kept whole
  });
});

describe("import-strava-export maps", () => {
  it("adds a generated map only where none is stored", async () => {
    const dir = mkdtempSync(join(tmpdir(), "export-"));
    writeFileSync(join(dir, "1.gpx"), GPX);
    writeFileSync(join(dir, "2.gpx"), GPX);
    const csv = 'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Moving Time,Distance,Filename\n' +
      '1,"Jan 1, 2026, 9:00:00 AM",Has map,Run,1000,900,3000,1.gpx\n2,"Jan 2, 2026, 9:00:00 AM",New,Run,1000,800,4000,2.gpx';
    const acts = activitiesFromCsv(csv);
    for (const a of acts) a.fill = fillsFor(a, dir);
    expect(acts[1].fill).toMatchObject({ map: { generated: true }, average_speed: 5 });

    const db = setupTestDb();
    await db.prepare("INSERT INTO users (strava_id) VALUES (7828229)").run();
    await db.prepare("INSERT INTO activities (id, strava_id, data_json) VALUES (1, 7828229, ?)")
      .bind(JSON.stringify({ map: { summary_polyline: "strava" }, average_speed: 3.1 })).run();
    const sql = toSql(acts);
    for (const pass of [1, 2]) for (const stmt of sql.trim().split("\n")) await db.prepare(stmt).run();

    const kept = JSON.parse((await db.prepare("SELECT data_json FROM activities WHERE id = 1").first<any>()).data_json);
    expect(kept.map).toEqual({ summary_polyline: "strava" });
    expect(kept.average_speed).toBe(3.1);
    const made = JSON.parse((await db.prepare("SELECT data_json FROM activities WHERE id = 2").first<any>()).data_json);
    expect(made.map).toEqual({ summary_polyline: encodePolyline(parseGpx(GPX)), generated: true });
    expect(made.average_speed).toBe(5);
  });
});
