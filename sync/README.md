# Local sync job

`strava-sync.ts` pulls activities from Strava and writes them to the D1 database
through the [D1 HTTP API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
then purges the cached API responses. The Worker only serves reads. The Strava
client secret and refresh token stay on the machine that runs this (omarchy,
hourly systemd timer), not in Cloudflare.

Each run: refresh the access token if needed (saved straight away, since
Strava rotates refresh tokens), fetch activities starting after the newest
stored one minus 30 days (catches late uploads and recent edits), upsert the
athlete row and activities, purge `/api/users`, `/api/users/<id>` and
`/api/users/<id>/activities`. Deleted activities are not removed (`--full`
re-fetches everything but also only upserts). Exits non-zero on any error.

## Setup
Runs with [bun](https://bun.sh), no dependencies.

`~/.config/strava-sync/config.json` (mode 600; override the folder with `STRAVA_SYNC_DIR`):
```json
{
  "client_id": "12345",
  "client_secret": "…",
  "athlete_id": 7828229,
  "cf_d1_database_id": "518ae258-2243-49ba-921c-fa249c9a3fdd",
  "cf_zone_id": "…",
  "public_url": "https://stravasync.jonathanburnhams.com"
}
```
`cf_account_id` and `cf_api_token` may go in the file too; otherwise they come from
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` (the same variables wrangler
uses). The token needs Account > D1 > Edit and Zone > Cache Purge > Purge.

`~/.config/strava-sync/state.json` (written by the job, mode 600) holds the tokens.
Either seed it with the refresh token already in D1, before running the
migration below:
```sh
npx wrangler d1 execute strava-sync --remote --command "SELECT * FROM app_config"
npx wrangler d1 execute strava-sync --remote --command "SELECT strava_id, refresh_token FROM users"
echo '{"refresh_token": "…"}' > ~/.config/strava-sync/state.json && chmod 600 ~/.config/strava-sync/state.json
```
or authorize again with `bun sync/strava-sync.ts auth`: open the printed URL,
approve, and paste the `code` from the `localhost` page it lands on (the page
itself fails to load, which is fine; Strava always accepts `localhost` as a
callback).

## Run
```sh
bun sync/strava-sync.ts          # incremental
bun sync/strava-sync.ts --full   # everything
```
Timer: copy `systemd/strava-sync.{service,timer}` to `~/.config/systemd/user/`,
then `systemctl --user daemon-reload && systemctl --user enable --now strava-sync.timer`.
The service uses the `notify-failure@` alert unit and reads Cloudflare
variables from `~/.config/cloudflare/env`.

## Migrating the existing database
After the state file works (one successful manual run), drop the credential
columns and table from D1: `migrations/0001_read_only.sql` (commands inside),
then `npm run deploy` the read-only Worker. The Worker's old
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` secrets are no longer used:
`npx wrangler secret delete …`.
