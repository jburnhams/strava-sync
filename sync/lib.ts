// Pure logic for the local sync job (sync/strava-sync.ts). No file or process
// access here, so it can be unit tested; network calls take an injected fetch.

export interface Config {
  client_id: string;
  client_secret: string;
  athlete_id: number;
  cf_account_id: string;
  cf_d1_database_id: string;
  cf_zone_id: string;
  cf_api_token: string;
  public_url: string;
}

export interface TokenState {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
}

export interface Statement {
  sql: string;
  params: unknown[];
}

type Fetch = typeof fetch;

const STRAVA = "https://www.strava.com";
const CF_API = "https://api.cloudflare.com/client/v4";

// D1 allows at most 100 bound parameters per query.
const D1_MAX_PARAMS = 100;
const ACTIVITY_COLUMNS = [
  "id", "strava_id", "name", "type", "start_date", "distance",
  "moving_time", "elapsed_time", "total_elevation_gain", "data_json",
] as const;

// Re-fetch this far back from the newest stored activity, to pick up late
// uploads and edits (renames, type changes) to recent activities.
export const OVERLAP_SECONDS = 30 * 24 * 3600;

export function validateConfig(raw: any): Config {
  const required = [
    "client_id", "client_secret", "athlete_id", "cf_account_id",
    "cf_d1_database_id", "cf_zone_id", "cf_api_token",
  ];
  const missing = required.filter((k) => raw?.[k] === undefined || raw?.[k] === "");
  if (missing.length) throw new Error(`config is missing: ${missing.join(", ")}`);
  return {
    ...raw,
    athlete_id: Number(raw.athlete_id),
    public_url: (raw.public_url || "https://stravasync.jonathanburnhams.com").replace(/\/$/, ""),
  };
}

// Returns a usable access token, refreshing it if it expires within a minute.
// The caller must persist the returned state: Strava may rotate the refresh token.
export async function ensureAccessToken(
  config: Config, state: TokenState, now: number, fetchFn: Fetch = fetch
): Promise<TokenState> {
  if (state.access_token && state.expires_at && state.expires_at > now + 60) return state;

  const res = await fetchFn(`${STRAVA}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      grant_type: "refresh_token",
      refresh_token: state.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return { refresh_token: data.refresh_token, access_token: data.access_token, expires_at: data.expires_at };
}

// Exchanges an authorization code (from the `auth` command) for tokens.
export async function exchangeCode(config: Config, code: string, fetchFn: Fetch = fetch): Promise<TokenState> {
  const res = await fetchFn(`${STRAVA}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava code exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  if (data.athlete?.id !== config.athlete_id) {
    throw new Error(`authorized athlete ${data.athlete?.id} is not the configured athlete_id ${config.athlete_id}`);
  }
  return { refresh_token: data.refresh_token, access_token: data.access_token, expires_at: data.expires_at };
}

export function authorizeUrl(config: Config): string {
  const params = new URLSearchParams({
    client_id: config.client_id,
    response_type: "code",
    redirect_uri: "http://localhost/exchange_token",
    approval_prompt: "force",
    scope: "read,activity:read_all,profile:read_all",
  });
  return `${STRAVA}/oauth/authorize?${params}`;
}

async function stravaGet(path: string, token: string, fetchFn: Fetch): Promise<any> {
  const res = await fetchFn(`${STRAVA}/api/v3${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Strava GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function getAthlete(token: string, fetchFn: Fetch = fetch): Promise<any> {
  return stravaGet("/athlete", token, fetchFn);
}

// All activities starting after `after` (epoch seconds; 0 = everything), oldest first.
export async function fetchActivitiesSince(token: string, after: number, fetchFn: Fetch = fetch): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const batch = await stravaGet(`/athlete/activities?after=${after}&per_page=200&page=${page}`, token, fetchFn);
    all.push(...batch);
    if (batch.length < 200) return all;
  }
}

export function afterFromNewest(newestStartDate: string | null): number {
  if (!newestStartDate) return 0;
  return Math.max(0, Math.floor(Date.parse(newestStartDate) / 1000) - OVERLAP_SECONDS);
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
        a.id, athleteId, a.name, a.type, a.start_date, a.distance,
        a.moving_time, a.elapsed_time, a.total_elevation_gain, JSON.stringify(a),
      ]),
    });
  }
  return statements;
}

export function userUpsert(athlete: any, syncedAt: number): Statement {
  return {
    sql: `INSERT INTO users (strava_id, firstname, lastname, profile_pic, last_synced_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(strava_id) DO UPDATE SET firstname = excluded.firstname, lastname = excluded.lastname,
profile_pic = excluded.profile_pic, last_synced_at = excluded.last_synced_at`,
    params: [athlete.id, athlete.firstname, athlete.lastname, athlete.profile, syncedAt],
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
  state: TokenState;
}

// One full run: refresh the token, fetch new activities, write them to D1,
// update the user row and purge the cached API responses.
export async function runSync(
  config: Config,
  state: TokenState,
  opts: { full?: boolean; now?: number; onTokens?: (s: TokenState) => void } = {},
  fetchFn: Fetch = fetch
): Promise<SyncResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const newState = await ensureAccessToken(config, state, now, fetchFn);
  // Persist straight away, so a later failure can't lose a rotated refresh token.
  if (newState !== state) opts.onTokens?.(newState);
  const token = newState.access_token!;

  let after = 0;
  if (!opts.full) {
    const rows = await d1Query(config, {
      sql: "SELECT max(start_date) AS newest FROM activities WHERE strava_id = ?",
      params: [config.athlete_id],
    }, fetchFn);
    after = afterFromNewest(rows[0]?.newest ?? null);
  }

  const athlete = await getAthlete(token, fetchFn);
  if (athlete.id !== config.athlete_id) {
    throw new Error(`token belongs to athlete ${athlete.id}, not the configured ${config.athlete_id}`);
  }
  const activities = await fetchActivitiesSince(token, after, fetchFn);

  // User row first: activities reference it, and D1 enforces foreign keys.
  await d1Query(config, userUpsert(athlete, now), fetchFn);
  for (const stmt of activityUpserts(config.athlete_id, activities)) await d1Query(config, stmt, fetchFn);
  await purgeCache(config, fetchFn);

  return { after, fetched: activities.length, state: newState };
}
