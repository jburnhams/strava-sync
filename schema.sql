DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS app_config;
DROP TABLE IF EXISTS streams;

CREATE TABLE app_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE users (
  strava_id INTEGER PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  profile_pic TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  last_synced_at INTEGER,
  sync_since TEXT DEFAULT '2018-01-01'
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

CREATE TABLE streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strava_id INTEGER NOT NULL, -- User's Strava ID (for ownership/cleanup)
  activity_id INTEGER NOT NULL,
  data_json TEXT, -- JSON of streams
  FOREIGN KEY (strava_id) REFERENCES users(strava_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);
