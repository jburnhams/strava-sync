// Reads the GPS track from a Strava export activity file (FIT, GPX or TCX,
// optionally gzipped) and turns it into a summary polyline like the API's
// map.summary_polyline: Google encoded, precision 5, simplified to Strava's size.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export type LatLng = [number, number];

export interface Track {
  points: LatLng[];
  utcOffsetSeconds?: number; // FIT only: local_timestamp - timestamp of the activity message
}

export function readTrack(path: string): Track {
  let buf = readFileSync(path);
  const name = path.replace(/\.gz$/, "");
  if (path.endsWith(".gz")) buf = gunzipSync(buf);
  if (name.endsWith(".fit")) return parseFit(buf);
  const text = buf.toString("utf-8");
  if (name.endsWith(".gpx")) return { points: parseGpx(text) };
  if (name.endsWith(".tcx")) return { points: parseTcx(text) };
  throw new Error(`unsupported activity file: ${path}`);
}

export function parseGpx(text: string): LatLng[] {
  const pts: LatLng[] = [];
  for (const m of text.matchAll(/<trkpt\b([^>]*)>/g)) {
    const lat = m[1].match(/lat="([^"]+)"/), lon = m[1].match(/lon="([^"]+)"/);
    if (lat && lon) pts.push([Number(lat[1]), Number(lon[1])]);
  }
  return pts;
}

export function parseTcx(text: string): LatLng[] {
  const pts: LatLng[] = [];
  for (const m of text.matchAll(/<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>\s*<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/g)) {
    pts.push([Number(m[1]), Number(m[2])]);
  }
  return pts;
}

// Minimal FIT reader: only record (20) positions and the activity (34) timestamps.
// Spec: https://developer.garmin.com/fit/protocol/
export function parseFit(buf: Buffer): Track {
  const headerSize = buf[0];
  if (buf.toString("ascii", 8, 12) !== ".FIT") throw new Error("not a FIT file");
  const end = headerSize + buf.readUInt32LE(4);
  const defs = new Map<number, { global: number; little: boolean; fields: [number, number][]; devSize: number }>();
  const points: LatLng[] = [];
  let utcOffsetSeconds: number | undefined;
  let pos = headerSize;
  while (pos < end) {
    const h = buf[pos++];
    if (!(h & 0x80) && h & 0x40) {
      // Definition message
      const little = buf[pos + 1] === 0;
      const global = little ? buf.readUInt16LE(pos + 2) : buf.readUInt16BE(pos + 2);
      const n = buf[pos + 4];
      pos += 5;
      const fields: [number, number][] = [];
      for (let i = 0; i < n; i++, pos += 3) fields.push([buf[pos], buf[pos + 1]]);
      let devSize = 0;
      if (h & 0x20) {
        const nd = buf[pos++];
        for (let i = 0; i < nd; i++, pos += 3) devSize += buf[pos + 1];
      }
      defs.set(h & 0x0f, { global, little, fields, devSize });
      continue;
    }
    const def = defs.get(h & 0x80 ? (h >> 5) & 0x03 : h & 0x0f);
    if (!def) throw new Error(`FIT data message before its definition at byte ${pos - 1}`);
    const values = new Map<number, number>();
    for (const [num, size] of def.fields) {
      if (size === 4) values.set(num, def.little ? buf.readInt32LE(pos) : buf.readInt32BE(pos));
      pos += size;
    }
    pos += def.devSize;
    if (def.global === 20) {
      const lat = values.get(0), lng = values.get(1);
      if (lat !== undefined && lng !== undefined && lat !== 0x7fffffff && lng !== 0x7fffffff) {
        points.push([(lat * 180) / 2 ** 31, (lng * 180) / 2 ** 31]);
      }
    } else if (def.global === 34) {
      const ts = values.get(253), local = values.get(5);
      if (ts !== undefined && local !== undefined) utcOffsetSeconds = (local >>> 0) - (ts >>> 0);
    }
  }
  return { points, utcOffsetSeconds };
}

export function encodePolyline(points: LatLng[]): string {
  let out = "", pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    while (s >= 0x20) { out += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5; }
    out += String.fromCharCode(s + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
    enc(a - pLat); enc(b - pLng);
    pLat = a; pLng = b;
  }
  return out;
}

// Douglas-Peucker on an equirectangular projection (fine at route scale); tolerance in degrees of latitude.
export function simplify(points: LatLng[], tolerance: number): LatLng[] {
  if (points.length < 3) return points.slice();
  const k = Math.cos((points[0][0] * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ay, ax] = [points[a][0], points[a][1] * k], [by, bx] = [points[b][0], points[b][1] * k];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, worstD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const py = points[i][0], px = points[i][1] * k;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worstD) { worst = i; worstD = d; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// Strava's summary polylines in D1 run to ~1,350 characters (220-360 points),
// so simplify with the smallest tolerance that fits under maxChars.
export function summaryPolyline(points: LatLng[], maxChars = 1300): string {
  if (!points.length) return "";
  let full = encodePolyline(points);
  if (full.length <= maxChars) return full;
  let lo = 0, hi = 0.01, best = encodePolyline(simplify(points, hi));
  while (best.length > maxChars) { hi *= 2; best = encodePolyline(simplify(points, hi)); }
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2, s = encodePolyline(simplify(points, mid));
    if (s.length <= maxChars) { hi = mid; best = s; } else lo = mid;
  }
  return best;
}
