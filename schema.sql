DROP TABLE IF EXISTS training_weekly;
DROP TABLE IF EXISTS training_activities;
DROP TABLE IF EXISTS photos;
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

-- Activity photos from the Strava export, resized and with all metadata (incl.
-- GPS) stripped; base64 JPEG. Served by GET /api/photos/:id; activities list them
-- in data_json.photos.
CREATE TABLE photos (
  id TEXT PRIMARY KEY, -- "<activity id>_<position>"
  activity_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  caption TEXT,
  width INTEGER NOT NULL, -- of the full size
  height INTEGER NOT NULL,
  thumb TEXT NOT NULL, -- ~400 px wide
  full TEXT NOT NULL, -- ~1200 px on the long edge
  source TEXT, -- file name in the export, to skip it on the next import
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);

-- Public training data, published by garmin-publish on omarchy from the private
-- Garmin sync with identifying details removed (see src/training.ts).
CREATE TABLE training_activities (
  id TEXT PRIMARY KEY, -- opaque (hash), not the Garmin activity id
  date TEXT NOT NULL, -- local day, YYYY-MM-DD; no time of day
  sport TEXT NOT NULL, -- run, trail_run, ride, swim, hike, walk, other...
  distance REAL, -- metres
  moving_time INTEGER, -- seconds
  elapsed_time INTEGER,
  elevation_gain REAL, -- metres
  race INTEGER NOT NULL DEFAULT 0, -- 1 when it falls within a race-tagged Strava activity (see garmin-publish)
  race_activity_id INTEGER -- that Strava activity's id (in activities), for race sessions
);
CREATE INDEX training_activities_date ON training_activities(date);

CREATE TABLE training_weekly (
  week TEXT NOT NULL, -- Monday, YYYY-MM-DD
  sport TEXT NOT NULL,
  race INTEGER NOT NULL DEFAULT 0, -- totals of race sessions (1) or training (0)
  count INTEGER NOT NULL,
  distance REAL,
  moving_time INTEGER,
  elevation_gain REAL,
  PRIMARY KEY (week, sport, race)
);
