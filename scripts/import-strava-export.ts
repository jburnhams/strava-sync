// Turns activities.csv from a Strava bulk export (Settings > My Account >
// Download or delete your account) into SQL for D1. Strava's API needs a paid
// subscription since 2026-06-30, so the export is how new activities get in.
//
//   bun scripts/import-strava-export.ts <export>/activities.csv [<export dir>] > import.sql
//   npx wrangler d1 execute strava-sync --remote --file import.sql
//
// Like the old API sync it takes every activity, keyed on the Strava activity id.
// data_json uses the API's field names. For rows already in D1 the export values
// are merged over the stored API record (json_patch), so API-only fields such as
// workout_type (the race tag) and map survive. workout_type also comes from the
// export's Tag column, so new activities get the race tag too.
//
// Rows without a map (only those: Strava's own maps have privacy zones applied)
// get one built from the export's activity file (FIT/GPX/TCX), marked
// map.generated = true, sized like Strava's summary polylines. The same guarded
// updates fill start_date_local (FIT only, from its UTC offset) and average_speed
// when missing, since the website shows dates and pace from those.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readTrack, summaryPolyline } from "./gps-track";

export const ATHLETE_ID = 7828229;

// RFC 4180: quoted fields may hold commas, quotes ("") and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ""));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Oct 16, 2025, 6:01:50 AM" (UTC) -> "2025-10-16T06:01:50Z", the API's format.
export function exportDateToIso(s: string): string {
  const m = s.trim().match(/^(\w{3}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)$/i);
  if (!m) throw new Error(`unrecognised Activity Date: ${s}`);
  const month = MONTHS.indexOf(m[1]);
  let hour = Number(m[4]) % 12;
  if (m[7].toUpperCase() === "PM") hour += 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m[3]}-${pad(month + 1)}-${pad(Number(m[2]))}T${pad(hour)}:${m[5]}:${m[6]}Z`;
}

// The export repeats some headers (Distance in km, then in metres; Elapsed Time
// twice). The later column is the precise one, so the last match wins.
function columnIndex(header: string[]): (name: string) => number {
  return (name) => header.lastIndexOf(name);
}

// The export has no workout_type, but its Tag column carries the same choice
// ("running|race", "offroad|running|race", "long_run|running", "riding|race").
// Mapped to the API's codes: runs 0 default, 1 race, 2 long run, 3 workout;
// rides 10 default, 11 race, 12 workout. Untagged (e.g. swims) -> null.
export function workoutTypeFromTag(tag: string | undefined): number | null {
  const t = new Set((tag ?? "").split("|").map((s) => s.trim()).filter(Boolean));
  const base = t.has("running") ? 0 : t.has("riding") ? 10 : null;
  if (base === null) return null;
  if (t.has("race")) return base + 1;
  if (base === 0 && t.has("long_run")) return 2;
  if (t.has("workout")) return base === 0 ? 3 : 12;
  return base;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface ExportActivity {
  id: number;
  name: string;
  type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  data_json: Record<string, unknown>;
  fill?: Record<string, unknown>; // set only where the stored record lacks the key (see toSql)
}

// Values derived from the activity file and the CSV that must never replace what the API stored.
export function fillsFor(a: ExportActivity, exportDir?: string): Record<string, unknown> {
  const fill: Record<string, unknown> = {};
  const d = a.data_json as Record<string, any>;
  if (a.distance && a.moving_time) fill.average_speed = Math.round((a.distance / a.moving_time) * 1000) / 1000;
  const file = exportDir && d.export_filename ? join(exportDir, d.export_filename) : undefined;
  if (file && existsSync(file)) {
    const track = readTrack(file);
    const poly = summaryPolyline(track.points);
    if (poly) fill.map = { summary_polyline: poly, generated: true };
    if (track.utcOffsetSeconds !== undefined) {
      fill.start_date_local = new Date(Date.parse(a.start_date) + track.utcOffsetSeconds * 1000).toISOString().replace(/\.000Z$/, "Z");
    }
  }
  return fill;
}

export function activitiesFromCsv(text: string): ExportActivity[] {
  const [header, ...rows] = parseCsv(text);
  const col = columnIndex(header);
  const get = (row: string[], name: string) => (col(name) >= 0 ? row[col(name)] : undefined);

  return rows.map((row) => {
    const start = exportDateToIso(get(row, "Activity Date")!);
    const details: Record<string, any> = {
      name: get(row, "Activity Name"),
      type: get(row, "Activity Type"),
      start_date: start,
      description: get(row, "Activity Description") || null,
      distance: num(get(row, "Distance")),
      moving_time: num(get(row, "Moving Time")),
      elapsed_time: num(get(row, "Elapsed Time")),
      total_elevation_gain: num(get(row, "Elevation Gain")),
      elev_high: num(get(row, "Elevation High")),
      elev_low: num(get(row, "Elevation Low")),
      average_speed: num(get(row, "Average Speed")),
      max_speed: num(get(row, "Max Speed")),
      average_heartrate: num(get(row, "Average Heart Rate")),
      max_heartrate: num(get(row, "Max Heart Rate")),
      average_cadence: num(get(row, "Average Cadence")),
      average_watts: num(get(row, "Average Watts")),
      max_watts: num(get(row, "Max Watts")),
      weighted_average_watts: num(get(row, "Weighted Average Power")),
      calories: num(get(row, "Calories")),
      average_temp: num(get(row, "Average Temperature")),
      workout_type: workoutTypeFromTag(get(row, "Tag")),
      gear: get(row, "Activity Gear") || null,
      export_filename: get(row, "Filename") || null,
    };
    // Drop empty values: json_patch would delete those keys from the stored record.
    for (const k of Object.keys(details)) {
      if (details[k] === null || details[k] === undefined) delete details[k];
    }
    return {
      id: Number(get(row, "Activity ID")),
      name: details.name ?? "",
      type: details.type ?? "",
      start_date: start,
      distance: details.distance ?? 0,
      moving_time: Math.round(details.moving_time ?? details.elapsed_time ?? 0),
      elapsed_time: Math.round(details.elapsed_time ?? 0),
      total_elevation_gain: details.total_elevation_gain ?? 0,
      data_json: details,
    };
  });
}

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function toSql(activities: ExportActivity[], athleteId = ATHLETE_ID): string {
  const lines = [
    // OR IGNORE, not ON CONFLICT: before migrations/0001 the users table still has NOT NULL token columns.
    `INSERT OR IGNORE INTO users (strava_id) VALUES (${athleteId});`,
  ];
  for (const a of activities) {
    const values = [
      a.id, athleteId, a.name, a.type, a.start_date, a.distance, a.moving_time,
      a.elapsed_time, a.total_elevation_gain, JSON.stringify(a.data_json),
    ].map(sqlValue).join(", ");
    lines.push(
      `INSERT INTO activities (id, strava_id, name, type, start_date, distance, moving_time, elapsed_time, total_elevation_gain, data_json) VALUES (${values}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, start_date = excluded.start_date, distance = excluded.distance, moving_time = excluded.moving_time, elapsed_time = excluded.elapsed_time, total_elevation_gain = excluded.total_elevation_gain, data_json = json_patch(coalesce(activities.data_json, '{}'), excluded.data_json);`
    );
  }
  for (const a of activities) {
    const f = a.fill ?? {};
    if (f.map) lines.push(`UPDATE activities SET data_json = json_set(coalesce(data_json, '{}'), '$.map', json(${sqlValue(JSON.stringify(f.map))})) WHERE id = ${a.id} AND json_extract(data_json, '$.map.summary_polyline') IS NULL;`);
    for (const k of ["start_date_local", "average_speed"]) {
      if (f[k] !== undefined) lines.push(`UPDATE activities SET data_json = json_set(data_json, '$.${k}', ${sqlValue(f[k])}) WHERE id = ${a.id} AND json_extract(data_json, '$.${k}') IS NULL;`);
    }
  }
  lines.push(`UPDATE users SET last_synced_at = unixepoch() WHERE strava_id = ${athleteId};`);
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun scripts/import-strava-export.ts <export>/activities.csv [<export dir>] > import.sql");
    process.exit(1);
  }
  const exportDir = process.argv[3] ?? dirname(path);
  const activities = activitiesFromCsv(readFileSync(path, "utf-8"));
  for (const a of activities) a.fill = fillsFor(a, exportDir);
  process.stdout.write(toSql(activities));
  const maps = activities.filter((a) => a.fill?.map).length;
  console.error(`${activities.length} activities, ${maps} with a map from their activity file (applied only where none is stored)`);
}
