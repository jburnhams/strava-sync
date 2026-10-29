#!/usr/bin/env bun
// Local sync job: pulls activities from Strava and writes them to the D1
// database behind the public read-only Worker. Runs on omarchy from a systemd
// timer; see sync/README.md.
//
//   bun sync/strava-sync.ts           incremental sync (default)
//   bun sync/strava-sync.ts --full    re-fetch every activity
//   bun sync/strava-sync.ts auth      authorize again and store a new refresh token
//
// Settings: $STRAVA_SYNC_DIR (default ~/.config/strava-sync)/config.json,
// token state in state.json next to it. Cloudflare values fall back to
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the environment.

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { authorizeUrl, exchangeCode, runSync, validateConfig, type TokenState } from "./lib";

const dir = process.env.STRAVA_SYNC_DIR || join(homedir(), ".config", "strava-sync");
const configPath = join(dir, "config.json");
const statePath = join(dir, "state.json");

function readJson(path: string): any {
  if (!existsSync(path)) throw new Error(`${path} not found (see sync/README.md)`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveState(state: TokenState) {
  const tmp = `${statePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, statePath);
}

function loadConfig() {
  const raw = readJson(configPath);
  raw.cf_api_token ||= process.env.CLOUDFLARE_API_TOKEN;
  raw.cf_account_id ||= process.env.CLOUDFLARE_ACCOUNT_ID;
  return validateConfig(raw);
}

async function auth() {
  const config = loadConfig();
  console.log("Open this URL, approve, then copy the `code` parameter from the localhost page it redirects to:\n");
  console.log(authorizeUrl(config) + "\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("code (or the whole redirect URL): ")).trim();
  rl.close();
  const code = answer.includes("code=") ? new URL(answer).searchParams.get("code")! : answer;
  saveState(await exchangeCode(config, code));
  console.log(`Saved new tokens to ${statePath}`);
}

async function sync(full: boolean) {
  const config = loadConfig();
  const state = readJson(statePath) as TokenState;
  const result = await runSync(config, state, { full, onTokens: saveState });
  console.log(`synced ${result.fetched} activities (after=${result.after})`);
}

const args = process.argv.slice(2);
try {
  if (args[0] === "auth") await auth();
  else await sync(args.includes("--full"));
} catch (e: any) {
  console.error(`strava-sync: ${e.message ?? e}`);
  process.exit(1);
}
