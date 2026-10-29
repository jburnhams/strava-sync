DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS users;

-- Written only by the local sync job (sync/sync.ts) through the D1 HTTP API.
-- No credentials live here: they stay on the machine running it.
CREATE TABLE users (
  strava_id INTEGER PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  profile_pic TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  last_synced_at INTEGER
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY, -- Strava Activity ID
  strava_id INTEGER NOT NULL, -- User's Strava ID
  name TEXT,
  type TEXT,
  start_date TEXT,
  distance REAL,
  moving_time INTEGER,
  elapsed_time INTEGER,
  total_elevation_gain REAL,
  data_json TEXT, -- Strava-named detail fields; Garmin rows also hold the raw record under "garmin"
  source TEXT DEFAULT 'strava', -- 'garmin' (current sync) or 'strava' (imported before 2026-10)
  FOREIGN KEY (strava_id) REFERENCES users(strava_id)
);
