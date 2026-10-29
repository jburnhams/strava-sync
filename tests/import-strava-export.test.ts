import { describe, expect, it } from "vitest";
import { activitiesFromCsv, exportDateToIso, parseCsv, toSql } from "../scripts/import-strava-export";
import { setupTestDb } from "./setup-test-db";

// Shape of a real export: repeated "Elapsed Time" and "Distance" headers (km first, metres last),
// quoted fields with commas, quotes and newlines.
const CSV = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Max Heart Rate,Filename,Elapsed Time,Moving Time,Distance,Max Speed,Average Speed,Elevation Gain,Elevation Low,Elevation High,Average Heart Rate,Calories',
  '16186895116,"Oct 16, 2025, 6:01:50 AM",Lon Las Cymru,Run,"Cardiff to Holyhead, ""fast""\nday one",220685,416.72,171.0,activities/16186895116.fit.gz,220685.0,197962.0,416722.0,5.1,2.1,5708.0,0.0,620.0,128.5,21000',
  '99,"Feb 1, 2015, 12:05:00 PM",Afternoon Run,Run,,1800,5.0,,,1800.0,1750.0,5000.0,,,40.0,,,,',
].join("\n");

async function run(db: any, sql: string) {
  for (const stmt of sql.trim().split("\n")) await db.prepare(stmt).run();
}

describe("import-strava-export", () => {
  it("parses quoted CSV and export dates", () => {
    expect(parseCsv('a,"b,c","d ""e""\nf"\n')).toEqual([["a", "b,c", 'd "e"\nf']]);
    expect(exportDateToIso("Oct 16, 2025, 6:01:50 AM")).toBe("2025-10-16T06:01:50Z");
    expect(exportDateToIso("Feb 1, 2015, 12:05:00 PM")).toBe("2015-02-01T12:05:00Z");
    expect(exportDateToIso("Feb 1, 2015, 12:05:00 AM")).toBe("2015-02-01T00:05:00Z");
  });

  it("maps columns, taking metres from the later Distance column", () => {
    const [a, b] = activitiesFromCsv(CSV);
    expect(a).toMatchObject({
      id: 16186895116, name: "Lon Las Cymru", type: "Run", start_date: "2025-10-16T06:01:50Z",
      distance: 416722, moving_time: 197962, elapsed_time: 220685, total_elevation_gain: 5708,
    });
    expect(a.data_json).toMatchObject({ average_heartrate: 128.5, max_heartrate: 171, description: 'Cardiff to Holyhead, "fast"\nday one' });
    expect(b.data_json).not.toHaveProperty("average_heartrate"); // empty values are left out
  });

  it("inserts new activities and merges over stored API records", async () => {
    const db = setupTestDb();
    await db.prepare("INSERT INTO users (strava_id) VALUES (7828229)").run();
    await db.prepare(`INSERT INTO activities (id, strava_id, name, data_json) VALUES (16186895116, 7828229, 'Old name', ?)`)
      .bind(JSON.stringify({ workout_type: 1, map: { summary_polyline: "abc" }, average_heartrate: 120 })).run();

    const sql = toSql(activitiesFromCsv(CSV));
    await run(db, sql);
    await run(db, sql); // idempotent

    expect((await db.prepare("SELECT count(*) AS n FROM activities").first<any>()).n).toBe(2);
    const merged = await db.prepare("SELECT name, distance, data_json FROM activities WHERE id = 16186895116").first<any>();
    expect(merged.name).toBe("Lon Las Cymru");
    const details = JSON.parse(merged.data_json);
    expect(details.workout_type).toBe(1);               // kept from the API
    expect(details.map.summary_polyline).toBe("abc");   // kept from the API
    expect(details.average_heartrate).toBe(128.5);      // export wins
    expect((await db.prepare("SELECT last_synced_at FROM users").first<any>()).last_synced_at).toBeGreaterThan(0);
  });
});
