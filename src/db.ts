// --- Models ---
export interface User {
  strava_id: number;
  firstname: string | null;
  lastname: string | null;
  profile_pic: string | null;
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

export async function getUser(db: D1Database, stravaId: number): Promise<User | null> {
  return await db.prepare("SELECT strava_id, firstname, lastname, profile_pic, last_synced_at FROM users WHERE strava_id = ?").bind(stravaId).first<User>();
}

export async function getUsers(db: D1Database): Promise<User[]> {
  const result = await db.prepare("SELECT strava_id, firstname, lastname, profile_pic, last_synced_at FROM users ORDER BY firstname").all<User>();
  return result.results;
}
