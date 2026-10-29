-- Links race sessions to their Strava activity, so the site can show it, and
-- splits weekly totals into race and training so the chart can hide races.
-- training_weekly is rebuilt by garmin-publish, so it is recreated empty.
--   npx wrangler d1 execute strava-sync --remote --file migrations/0004_training_race_link.sql
ALTER TABLE training_activities ADD COLUMN race_activity_id INTEGER;
DROP TABLE IF EXISTS training_weekly;
CREATE TABLE training_weekly (
  week TEXT NOT NULL,
  sport TEXT NOT NULL,
  race INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL,
  distance REAL,
  moving_time INTEGER,
  elevation_gain REAL,
  PRIMARY KEY (week, sport, race)
);
