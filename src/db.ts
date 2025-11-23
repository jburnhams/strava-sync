import type { Env } from "../worker";

// --- Models ---
export interface AppConfig {
  client_id: string;
  client_secret: string;
}

export interface User {
  strava_id: number;
  firstname: string | null;
  lastname: string | null;
  profile_pic: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  last_synced_at: number | null;
}

export interface Activity {
  id: number;
  strava_id: number;
  name: string;
  type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  data_json: string;
}

// --- DB Access ---

export async function saveAppConfig(db: D1Database, clientId: string, clientSecret: string) {
  await db
    .prepare(
      `INSERT INTO app_config (id, client_id, client_secret) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, client_secret = excluded.client_secret`
    )
    .bind(clientId, clientSecret)
    .run();
}

export async function getAppConfig(db: D1Database): Promise<AppConfig | null> {
  return await db.prepare("SELECT client_id, client_secret FROM app_config WHERE id = 1").first<AppConfig>();
}

export async function upsertUser(db: D1Database, user: User) {
  await db
    .prepare(
      `INSERT INTO users (strava_id, firstname, lastname, profile_pic, access_token, refresh_token, expires_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(strava_id) DO UPDATE SET
         firstname = excluded.firstname,
         lastname = excluded.lastname,
         profile_pic = excluded.profile_pic,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         last_synced_at = excluded.last_synced_at`
    )
    .bind(
      user.strava_id,
      user.firstname,
      user.lastname,
      user.profile_pic,
      user.access_token,
      user.refresh_token,
      user.expires_at,
      user.last_synced_at
    )
    .run();
}

export async function getUser(db: D1Database, stravaId: number): Promise<User | null> {
  return await db.prepare("SELECT * FROM users WHERE strava_id = ?").bind(stravaId).first<User>();
}

export async function getUsers(db: D1Database): Promise<Omit<User, 'access_token'|'refresh_token'>[]> {
  // Never return tokens in list view
  const result = await db.prepare("SELECT strava_id, firstname, lastname, profile_pic, expires_at, last_synced_at FROM users ORDER BY firstname").all<Omit<User, 'access_token'|'refresh_token'>>();
  return result.results;
}

export async function saveActivity(db: D1Database, activity: Activity) {
  await db
    .prepare(
      `INSERT INTO activities (id, strava_id, name, type, start_date, distance, moving_time, elapsed_time, total_elevation_gain, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         start_date = excluded.start_date,
         distance = excluded.distance,
         moving_time = excluded.moving_time,
         elapsed_time = excluded.elapsed_time,
         total_elevation_gain = excluded.total_elevation_gain,
         data_json = excluded.data_json`
    )
    .bind(
      activity.id,
      activity.strava_id,
      activity.name,
      activity.type,
      activity.start_date,
      activity.distance,
      activity.moving_time,
      activity.elapsed_time,
      activity.total_elevation_gain,
      activity.data_json
    )
    .run();
}
