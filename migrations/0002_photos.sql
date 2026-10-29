-- Activity photos (see schema.sql and scripts/import-strava-photos.ts).
--   npx wrangler d1 execute strava-sync --remote --file migrations/0002_photos.sql
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  activity_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  caption TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  thumb TEXT NOT NULL,
  full TEXT NOT NULL,
  source TEXT,
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);
