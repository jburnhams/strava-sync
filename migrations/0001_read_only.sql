-- Removes the Strava credentials from D1 (the Worker is read-only now and the
-- sync runs locally from Garmin, see sync/README.md) and tags each activity with
-- its source, so the sync can drop Strava rows that Garmin also has.
--   npx wrangler d1 execute strava-sync --remote --file migrations/0001_read_only.sql
-- D1 Time Travel can restore the database to before this if needed.
DROP TABLE IF EXISTS app_config;
ALTER TABLE users DROP COLUMN access_token;
ALTER TABLE users DROP COLUMN refresh_token;
ALTER TABLE users DROP COLUMN expires_at;
ALTER TABLE activities ADD COLUMN source TEXT DEFAULT 'strava';
