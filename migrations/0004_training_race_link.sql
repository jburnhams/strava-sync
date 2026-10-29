-- Links race sessions to their Strava activity, so the site can show it.
--   npx wrangler d1 execute strava-sync --remote --file migrations/0004_training_race_link.sql
ALTER TABLE training_activities ADD COLUMN race_activity_id INTEGER;
