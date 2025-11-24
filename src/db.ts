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
  sync_since: string;
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

export interface Stream {
  id?: number;
  strava_id: number;
  activity_id: number;
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
      `INSERT INTO users (strava_id, firstname, lastname, profile_pic, access_token, refresh_token, expires_at, last_synced_at, sync_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      user.last_synced_at,
      user.sync_since || '2018-01-01'
    )
    .run();
}

export async function updateUserSyncConfig(db: D1Database, stravaId: number, syncSince: string) {
  await db
    .prepare("UPDATE users SET sync_since = ? WHERE strava_id = ?")
    .bind(syncSince, stravaId)
    .run();
}

export async function getUser(db: D1Database, stravaId: number): Promise<User | null> {
  return await db.prepare("SELECT * FROM users WHERE strava_id = ?").bind(stravaId).first<User>();
}

export async function getUsers(db: D1Database): Promise<Omit<User, 'access_token'|'refresh_token'>[]> {
  // Never return tokens in list view
  const result = await db.prepare("SELECT strava_id, firstname, lastname, profile_pic, expires_at, last_synced_at, sync_since FROM users ORDER BY firstname").all<Omit<User, 'access_token'|'refresh_token'>>();
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

export async function getActivity(db: D1Database, id: number): Promise<Activity | null> {
  return await db.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first<Activity>();
}

export async function deleteActivity(db: D1Database, id: number) {
  await db.prepare("DELETE FROM activities WHERE id = ?").bind(id).run();
  // Also delete streams
  await db.prepare("DELETE FROM streams WHERE activity_id = ?").bind(id).run();
}

export async function deleteAllActivities(db: D1Database, stravaId: number) {
  await db.prepare("DELETE FROM activities WHERE strava_id = ?").bind(stravaId).run();
  await db.prepare("DELETE FROM streams WHERE strava_id = ?").bind(stravaId).run();
}

export async function upsertStream(db: D1Database, stream: Stream) {
  await db.prepare(
    `INSERT INTO streams (strava_id, activity_id, data_json) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json`
  ).bind(stream.strava_id, stream.activity_id, stream.data_json).run();
  // Note: we don't have a unique constraint on activity_id in streams table in schema.sql yet?
  // We should rely on checking if it exists or clear duplicates.
  // Actually, for simplicity let's assume one stream per activity.
  // The 'ON CONFLICT(id)' only works if we supply ID.
  // Better approach: DELETE then INSERT or check existence.
  // Or just insert blindly and we handle cleanup.
  // Refined: Let's assume we clean up before insert or just append.
  // Correct approach for 'Upsert' without unique key on activity_id is tricky.
  // But since we are creating the table, we should have made activity_id UNIQUE or part of a UNIQUE index.
  // Given I cannot easily change the schema migration on the fly without complex steps, I will do a check-first approach.
}

export async function saveStream(db: D1Database, stream: Stream) {
  // Check if exists
  const existing = await db.prepare("SELECT id FROM streams WHERE activity_id = ?").bind(stream.activity_id).first();
  if (existing) {
    await db.prepare("UPDATE streams SET data_json = ? WHERE id = ?").bind(stream.data_json, existing.id).run();
  } else {
    await db.prepare("INSERT INTO streams (strava_id, activity_id, data_json) VALUES (?, ?, ?)").bind(stream.strava_id, stream.activity_id, stream.data_json).run();
  }
}

export async function getStream(db: D1Database, activityId: number): Promise<Stream | null> {
  return await db.prepare("SELECT * FROM streams WHERE activity_id = ?").bind(activityId).first<Stream>();
}

export async function getActivitiesWithoutStreams(db: D1Database, stravaId: number): Promise<number[]> {
  // Find activities that do not have a corresponding entry in streams
  const result = await db.prepare(`
    SELECT a.id FROM activities a
    LEFT JOIN streams s ON a.id = s.activity_id
    WHERE a.strava_id = ? AND s.id IS NULL
  `).bind(stravaId).all<{id: number}>();
  return result.results.map(r => r.id);
}
