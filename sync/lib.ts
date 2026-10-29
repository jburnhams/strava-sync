// Pure logic for the local sync job (sync/garmin-sync.ts). No file or process
// access here, so it can be unit tested; network calls take an injected fetch.
//
// Source: Garmin Connect Personal API (read-only, personal API key; see
// https://developer.garmin.com/gc-developer-program/personal/personal-api).
// Strava's API needs a paid subscription since 2026-06-30, so it is no longer used;
// rows already imported from Strava stay, marked source = 'strava'.

export interface Config {
  garmin_api_key: string;
  athlete_id: number;
  include_types: string[] | null;
  cf_account_id: string;
  cf_d1_database_id: string;
  cf_zone_id: string;
  cf_api_token: string;
  public_url: string;
}

export interface Statement {
  sql: string;
  params: unknown[];
}

type Fetch = typeof fetch;

const GARMIN = "https://personal.connectapi.garmin.com";
const CF_API = "https://api.cloudflare.com/client/v4";

// Garmin refuses page sizes above about 200.
const PAGE_SIZE = 200;

// D1 allows at most 100 bound parameters per query.
const D1_MAX_PARAMS = 100;
const ACTIVITY_COLUMNS = [
  "id", "strava_id", "name", "type", "start_date", "distance",
  "moving_time", "elapsed_time", "total_elevation_gain", "data_json", "source",
] as const;

// Re-fetch this far back from the newest stored activity, to pick up late
// uploads and edits (renames, type changes) to recent activities.
export const OVERLAP_SECONDS = 30 * 24 * 3600;

// A Strava row is a copy of a Garmin activity when they start this close together.
export const DUPLICATE_WINDOW_SECONDS = 10 * 60;

export function validateConfig(raw: any): Config {
  const required = [
    "garmin_api_key", "athlete_id", "cf_account_id", "cf_d1_database_id", "cf_zone_id", "cf_api_token",
  ];
  const missing = required.filter((k) => raw?.[k] === undefined || raw?.[k] === "");
  if (missing.length) throw new Error(`config is missing: ${missing.join(", ")}`);
  return {
    ...raw,
    athlete_id: Number(raw.athlete_id),
    include_types: Array.isArray(raw.include_types) && raw.include_types.length ? raw.include_types : null,
    public_url: (raw.public_url || "https://stravasync.jonathanburnhams.com").replace(/\/$/, ""),
  };
}

// Trades the personal API key for a 24 h access token (plain text response).
export async function getAccessToken(config: Config, fetchFn: Fetch = fetch): Promise<string> {
  const res = await fetchFn(`${GARMIN}/personalapitoken-service/personal-api/personal-api-key/token`, {
    method: "POST",
    headers: { Authorization: `ApiKey ${config.garmin_api_key}` },
  });
  const body = (await res.text()).trim();
  if (!res.ok) throw new Error(`Garmin token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  // Accept a JSON body too, in case Garmin changes the format.
  if (body.startsWith("{")) {
    const json = JSON.parse(body);
    return json.access_token ?? json.accessToken;
  }
  return body;
}

// Activities that started at or after `after` (epoch seconds; 0 = everything).
// Garmin lists newest first and ignores date filters, so page until older ones appear.
export async function fetchActivitiesSince(token: string, after: number, fetchFn: Fetch = fetch): Promise<any[]> {
  const all: any[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const url = `${GARMIN}/activitylist-service/activities/search/activities?start=${start}&limit=${PAGE_SIZE}`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Garmin activity list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json() as any[];
    for (const a of page) {
      if (gmtToEpoch(a.startTimeGMT) >= after) all.push(a);
    }
    const oldest = page[page.length - 1];
    if (page.length < PAGE_SIZE || (after > 0 && gmtToEpoch(oldest.startTimeGMT) < after)) return all;
  }
}

// "2026-10-24 08:31:18" (GMT) -> "2026-10-24T08:31:18Z", the format the Strava rows use.
export function gmtToIso(gmt: string): string {
  return gmt.replace(" ", "T").replace(/(\.\d+)?$/, "") + "Z";
}

function gmtToEpoch(gmt: string): number {
  return Math.floor(Date.parse(gmtToIso(gmt)) / 1000);
}

export function afterFromNewest(newestStartDate: string | null): number {
  if (!newestStartDate) return 0;
  return Math.max(0, Math.floor(Date.parse(newestStartDate) / 1000) - OVERLAP_SECONDS);
}

// Garmin activity type keys -> Strava's type names, so the site and anything
// reading the API see the same values as before. Unknown keys become PascalCase.
const TYPE_MAP: Record<string, string> = {
  running: "Run", street_running: "Run", track_running: "Run", treadmill_running: "Run",
  indoor_running: "Run", ultra_run: "Run", trail_running: "TrailRun", virtual_run: "VirtualRun",
  cycling: "Ride", road_biking: "Ride", indoor_cycling: "Ride", gravel_cycling: "GravelRide",
  mountain_biking: "MountainBikeRide", virtual_ride: "VirtualRide", e_bike_fitness: "EBikeRide",
  e_bike_mountain: "EBikeRide", lap_swimming: "Swim", open_water_swimming: "Swim",
  walking: "Walk", hiking: "Hike", strength_training: "WeightTraining", yoga: "Yoga",
  rowing: "Rowing", indoor_rowing: "Rowing",
};

export function stravaType(typeKey: string | undefined): string {
  if (!typeKey) return "Workout";
  return TYPE_MAP[typeKey] ?? typeKey.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

// data_json keeps Strava's field names for what the detail view shows, plus the
// whole Garmin record under `garmin`.
export function detailsJson(a: any): string {
  return JSON.stringify({
    average_speed: a.averageSpeed,
    max_speed: a.maxSpeed,
    average_heartrate: a.averageHR,
    max_heartrate: a.maxHR,
    average_cadence: a.averageRunningCadenceInStepsPerMinute ?? a.averageBikingCadenceInRevPerMinute,
    average_watts: a.avgPower,
    max_watts: a.maxPower,
    weighted_average_watts: a.normPower,
    calories: a.calories,
    elev_high: a.maxElevation,
    elev_low: a.minElevation,
    garmin: a,
  });
}

export function activityUpserts(athleteId: number, activities: any[]): Statement[] {
  const perStatement = Math.floor(D1_MAX_PARAMS / ACTIVITY_COLUMNS.length);
  const updates = ACTIVITY_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  const rowPlaceholder = `(${ACTIVITY_COLUMNS.map(() => "?").join(", ")})`;
  const statements: Statement[] = [];

  for (let i = 0; i < activities.length; i += perStatement) {
    const chunk = activities.slice(i, i + perStatement);
    statements.push({
      sql: `INSERT INTO activities (${ACTIVITY_COLUMNS.join(", ")}) VALUES ${chunk.map(() => rowPlaceholder).join(", ")}
ON CONFLICT(id) DO UPDATE SET ${updates}`,
      params: chunk.flatMap((a) => [
        a.activityId, athleteId, a.activityName ?? null, stravaType(a.activityType?.typeKey),
        gmtToIso(a.startTimeGMT), a.distance ?? 0, Math.round(a.movingDuration ?? a.duration ?? 0),
        Math.round(a.elapsedDuration ?? a.duration ?? 0), a.elevationGain ?? 0, detailsJson(a), "garmin",
      ]),
    });
  }
  return statements;
}

// Removes Strava-imported rows that Garmin now also has (same athlete, same start
// within the window), so nothing shows twice. Strava-only rows (e.g. before the
// Garmin history starts) stay.
export function dedupeStrava(athleteId: number): Statement {
  return {
    sql: `DELETE FROM activities WHERE source = 'strava' AND strava_id = ? AND EXISTS (
  SELECT 1 FROM activities g WHERE g.source = 'garmin' AND g.strava_id = activities.strava_id
  AND abs(unixepoch(g.start_date) - unixepoch(activities.start_date)) <= ?)`,
    params: [athleteId, DUPLICATE_WINDOW_SECONDS],
  };
}

// Keeps the athlete row (names come from the Strava era) and records the sync time.
export function userTouch(athleteId: number, syncedAt: number): Statement {
  return {
    sql: `INSERT INTO users (strava_id, last_synced_at) VALUES (?, ?)
ON CONFLICT(strava_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
    params: [athleteId, syncedAt],
  };
}

// Runs one statement through the D1 HTTP API and returns its rows.
export async function d1Query(config: Config, stmt: Statement, fetchFn: Fetch = fetch): Promise<any[]> {
  const res = await fetchFn(
    `${CF_API}/accounts/${config.cf_account_id}/d1/database/${config.cf_d1_database_id}/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.cf_api_token}` },
      body: JSON.stringify(stmt),
    }
  );
  const body = await res.json().catch(() => null) as any;
  if (!res.ok || !body?.success) {
    throw new Error(`D1 query failed: ${res.status} ${JSON.stringify(body?.errors ?? body)}`);
  }
  return body.result?.[0]?.results ?? [];
}

export async function purgeCache(config: Config, fetchFn: Fetch = fetch): Promise<void> {
  const base = `${config.public_url}/api/users`;
  const res = await fetchFn(`${CF_API}/zones/${config.cf_zone_id}/purge_cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.cf_api_token}` },
    body: JSON.stringify({
      files: [base, `${base}/${config.athlete_id}`, `${base}/${config.athlete_id}/activities`],
    }),
  });
  if (!res.ok) throw new Error(`Cloudflare cache purge failed: ${res.status} ${await res.text()}`);
}

export interface SyncResult {
  after: number;
  fetched: number;
  written: number;
}

// One full run: get a token, fetch new activities, write them to D1, drop
// Strava duplicates, record the sync time and purge the cached API responses.
export async function runSync(
  config: Config, opts: { full?: boolean; now?: number } = {}, fetchFn: Fetch = fetch
): Promise<SyncResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const token = await getAccessToken(config, fetchFn);

  let after = 0;
  if (!opts.full) {
    const rows = await d1Query(config, {
      sql: "SELECT max(start_date) AS newest FROM activities WHERE strava_id = ? AND source = 'garmin'",
      params: [config.athlete_id],
    }, fetchFn);
    after = afterFromNewest(rows[0]?.newest ?? null);
  }

  const fetched = await fetchActivitiesSince(token, after, fetchFn);
  const keep = config.include_types
    ? fetched.filter((a) => config.include_types!.includes(stravaType(a.activityType?.typeKey)))
    : fetched;

  // User row first: activities reference it, and D1 enforces foreign keys.
  await d1Query(config, userTouch(config.athlete_id, now), fetchFn);
  for (const stmt of activityUpserts(config.athlete_id, keep)) await d1Query(config, stmt, fetchFn);
  await d1Query(config, dedupeStrava(config.athlete_id), fetchFn);
  await purgeCache(config, fetchFn);

  return { after, fetched: fetched.length, written: keep.length };
}
