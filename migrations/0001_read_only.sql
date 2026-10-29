-- Removes the Strava credentials from D1: the Worker is read-only now and no
-- longer talks to Strava (its API needs a paid subscription since 2026-06-30).
--   npx wrangler d1 execute strava-sync --remote --file migrations/0001_read_only.sql
-- D1 Time Travel can restore the database to before this if needed.
DROP TABLE IF EXISTS app_config;
ALTER TABLE users DROP COLUMN access_token;
ALTER TABLE users DROP COLUMN refresh_token;
ALTER TABLE users DROP COLUMN expires_at;
