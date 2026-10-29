-- npx wrangler d1 execute strava-sync --remote --file migrations/0003_training.sql
-- Public training data, published by garmin-publish on omarchy from the private
-- Garmin sync with identifying details removed (see src/training.ts).
CREATE TABLE IF NOT EXISTS training_activities (
  id TEXT PRIMARY KEY, -- opaque (hash), not the Garmin activity id
  date TEXT NOT NULL, -- local day, YYYY-MM-DD; no time of day
  sport TEXT NOT NULL, -- run, trail_run, ride, swim, hike, walk, other...
  distance REAL, -- metres
  moving_time INTEGER, -- seconds
  elapsed_time INTEGER,
  elevation_gain REAL -- metres
);
CREATE INDEX IF NOT EXISTS training_activities_date ON training_activities(date);

CREATE TABLE IF NOT EXISTS training_weekly (
  week TEXT NOT NULL, -- Monday, YYYY-MM-DD
  sport TEXT NOT NULL,
  count INTEGER NOT NULL,
  distance REAL,
  moving_time INTEGER,
  elevation_gain REAL,
  PRIMARY KEY (week, sport)
);
