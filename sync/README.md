# Local sync job

`sync.ts` pulls activities from the [Garmin Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api)
and writes them to the D1 database through the
[D1 HTTP API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
then purges the cached API responses. The Worker only serves reads; every
credential stays on the machine that runs this (omarchy, hourly systemd timer).

Why Garmin: since 2026-06-30 Strava's API needs the app owner to have a paid
Strava subscription (otherwise every call returns 403 "Application inactive").
The 162 activities imported from Strava before that stay in D1 with
`source = 'strava'`; the ones Garmin also has are removed on each run.

Each run: trade the personal API key for a 24 h access token, page through
`activitylist-service` (newest first, 200 per page; Garmin ignores date
filters) back to 30 days before the newest stored Garmin activity, upsert them
(types mapped to Strava's names, e.g. `running` -> `Run`; `data_json` holds
Strava-named detail fields plus the raw record under `garmin`), delete Strava
rows with a Garmin activity starting within 10 minutes, record `last_synced_at`,
purge `/api/users`, `/api/users/<id>` and `/api/users/<id>/activities`. Deleted
activities are not removed. Exits non-zero on any error. Garmin returns no
routes in the summaries.

## Setup
Runs with [bun](https://bun.sh), no dependencies.

- **Garmin key:** create one at Garmin Connect, Settings, Personal API token
  (it expires on the date picked there; then make a new one). Put it in
  `~/.config/garmin/connect-personal-api-key` (mode 600; the path Garmin's
  [Python client](https://github.com/garmin/connect-personal-api-python) uses)
  or `GARMIN_PERSONAL_API_KEY`.
- **Cloudflare:** `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the
  environment (as for wrangler) or `cf_api_token` / `cf_account_id` in the
  config. The token needs Account > D1 > Edit and Zone > Cache Purge > Purge.
- `~/.config/strava-sync/config.json` (mode 600; folder overridable with `STRAVA_SYNC_DIR`):
```json
{
  "athlete_id": 7828229,
  "cf_d1_database_id": "518ae258-2243-49ba-921c-fa249c9a3fdd",
  "cf_zone_id": "…",
  "public_url": "https://stravasync.jonathanburnhams.com",
  "include_types": null
}
```
`athlete_id` is the id the public API is keyed on (the old Strava athlete id,
so existing URLs keep working). `include_types` (e.g. `["Run", "TrailRun"]`)
limits what is written; `null` writes everything.

## Run
```sh
bun sync/sync.ts          # incremental
bun sync/sync.ts --full   # everything (about 32 pages, 6,000+ activities)
```
Timer: copy `systemd/strava-sync.{service,timer}` to `~/.config/systemd/user/`,
then `systemctl --user daemon-reload && systemctl --user enable --now strava-sync.timer`.
The service uses the `notify-failure@` alert unit and reads Cloudflare
variables from `~/.config/cloudflare/env`.

## Migrating the existing database
Apply `migrations/0001_read_only.sql` (drops the old Strava credentials, adds
the `source` column) before the first run, then run `--full` once.
