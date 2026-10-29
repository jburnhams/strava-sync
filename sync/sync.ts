#!/usr/bin/env bun
// Local sync job: pulls activities from the Garmin Connect Personal API and
// writes them to the D1 database behind the public read-only Worker. Runs on
// omarchy from a systemd timer; see sync/README.md.
//
//   bun sync/sync.ts           incremental sync (default)
//   bun sync/sync.ts --full    re-fetch every activity
//
// Settings: $STRAVA_SYNC_DIR (default ~/.config/strava-sync)/config.json.
// The Garmin key comes from GARMIN_PERSONAL_API_KEY or the file Garmin's own
// client uses (~/.config/garmin/connect-personal-api-key); Cloudflare values
// fall back to CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runSync, validateConfig } from "./lib";

const dir = process.env.STRAVA_SYNC_DIR || join(homedir(), ".config", "strava-sync");
const configPath = join(dir, "config.json");
const garminKeyPath = join(homedir(), ".config", "garmin", "connect-personal-api-key");

function loadConfig() {
  if (!existsSync(configPath)) throw new Error(`${configPath} not found (see sync/README.md)`);
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  raw.garmin_api_key ||= process.env.GARMIN_PERSONAL_API_KEY
    || (existsSync(garminKeyPath) ? readFileSync(garminKeyPath, "utf-8").trim() : undefined);
  raw.cf_api_token ||= process.env.CLOUDFLARE_API_TOKEN;
  raw.cf_account_id ||= process.env.CLOUDFLARE_ACCOUNT_ID;
  return validateConfig(raw);
}

try {
  const result = await runSync(loadConfig(), { full: process.argv.includes("--full") });
  console.log(`fetched ${result.fetched} activities, wrote ${result.written} (after=${result.after})`);
} catch (e: any) {
  console.error(`strava-sync: ${e.message ?? e}`);
  process.exit(1);
}
