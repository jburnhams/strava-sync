-- Moves Strava credentials out of D1 (they now live with the local sync job,
-- see sync/README.md). Copy client id/secret and the refresh token out first:
--   npx wrangler d1 execute strava-sync --remote --command "SELECT * FROM app_config"
--   npx wrangler d1 execute strava-sync --remote --command "SELECT strava_id, refresh_token FROM users"
-- Then apply:
--   npx wrangler d1 execute strava-sync --remote --file migrations/0001_read_only.sql
DROP TABLE IF EXISTS app_config;
ALTER TABLE users DROP COLUMN access_token;
ALTER TABLE users DROP COLUMN refresh_token;
ALTER TABLE users DROP COLUMN expires_at;
