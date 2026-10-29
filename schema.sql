DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS users;

-- Read-only from the Worker. Data is loaded from a Strava export (races only).
-- No credentials live here.
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
  data_json TEXT, -- Full JSON dump for caching
  FOREIGN KEY (strava_id) REFERENCES users(strava_id)
);
