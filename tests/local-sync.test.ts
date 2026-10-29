import { describe, expect, it, vi } from "vitest";
import {
  activityUpserts, afterFromNewest, ensureAccessToken, runSync, validateConfig, OVERLAP_SECONDS,
  type Config,
} from "../sync/lib";
import { setupTestDb } from "./setup-test-db";

const config: Config = validateConfig({
  client_id: "cid",
  client_secret: "secret",
  athlete_id: 7828229,
  cf_account_id: "acct",
  cf_d1_database_id: "db",
  cf_zone_id: "zone",
  cf_api_token: "cf-token",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function activity(id: number, start: string) {
  return {
    id, name: `Run ${id}`, type: "Run", start_date: start, distance: 1000,
    moving_time: 300, elapsed_time: 310, total_elevation_gain: 5,
  };
}

describe("validateConfig", () => {
  it("lists missing keys and defaults public_url", () => {
    expect(() => validateConfig({ client_id: "x" })).toThrow(/client_secret.*cf_api_token/);
    expect(config.public_url).toBe("https://stravasync.jonathanburnhams.com");
  });
});

describe("ensureAccessToken", () => {
  it("keeps a token that is still valid", async () => {
    const fetchFn = vi.fn();
    const state = { refresh_token: "r", access_token: "a", expires_at: 2000 };
    expect(await ensureAccessToken(config, state, 1000, fetchFn)).toBe(state);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and returns the rotated refresh token", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "a2", refresh_token: "r2", expires_at: 9000 }));
    const result = await ensureAccessToken(config, { refresh_token: "r", access_token: "a", expires_at: 1030 }, 1000, fetchFn);
    expect(result).toEqual({ access_token: "a2", refresh_token: "r2", expires_at: 9000 });
    expect(JSON.parse((fetchFn.mock.calls[0] as any)[1].body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "r" });
  });

  it("throws when Strava refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(ensureAccessToken(config, { refresh_token: "r" }, 1000, fetchFn)).rejects.toThrow(/400/);
  });
});

describe("afterFromNewest", () => {
  it("starts from zero with no data and overlaps otherwise", () => {
    expect(afterFromNewest(null)).toBe(0);
    expect(afterFromNewest("2024-01-31T00:00:00Z")).toBe(Date.parse("2024-01-31T00:00:00Z") / 1000 - OVERLAP_SECONDS);
  });
});

describe("activityUpserts", () => {
  it("stays under D1's 100 parameter limit and upserts into the real schema", async () => {
    const acts = Array.from({ length: 25 }, (_, i) => activity(i + 1, "2024-01-01T00:00:00Z"));
    const stmts = activityUpserts(7828229, acts);
    expect(stmts.length).toBe(3);
    for (const s of stmts) expect(s.params.length).toBeLessThanOrEqual(100);

    const db = setupTestDb();
    await db.prepare("INSERT INTO users (strava_id) VALUES (7828229)").run();
    for (const s of stmts) await db.prepare(s.sql).bind(...s.params).run();
    // Running again (an edit on Strava) updates instead of duplicating
    acts[0].name = "Renamed";
    for (const s of activityUpserts(7828229, acts)) await db.prepare(s.sql).bind(...s.params).run();

    const count = await db.prepare("SELECT count(*) AS n FROM activities").first<any>();
    expect(count.n).toBe(25);
    const first = await db.prepare("SELECT name, data_json FROM activities WHERE id = 1").first<any>();
    expect(first.name).toBe("Renamed");
    expect(JSON.parse(first.data_json).name).toBe("Renamed");
  });
});

describe("runSync", () => {
  it("refreshes, saves tokens first, fetches since the newest activity, writes to D1 and purges", async () => {
    const db = setupTestDb();
    const d1Calls: any[] = [];
    const urls: string[] = [];

    const fetchFn = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/oauth/token")) return json({ access_token: "a2", refresh_token: "r2", expires_at: 99999 });
      if (url.endsWith("/api/v3/athlete")) return json({ id: 7828229, firstname: "J", lastname: "B", profile: "pic" });
      if (url.includes("/athlete/activities")) return json([activity(5, "2024-02-01T00:00:00Z")]);
      if (url.endsWith("/query")) {
        const stmt = JSON.parse(init.body);
        d1Calls.push(stmt);
        const prepared = db.prepare(stmt.sql).bind(...stmt.params);
        const results = stmt.sql.startsWith("SELECT") ? (await prepared.all()).results : (await prepared.run(), []);
        return json({ success: true, result: [{ results }] });
      }
      if (url.endsWith("/purge_cache")) return json({ success: true });
      return new Response("unexpected", { status: 500 });
    });

    await db.prepare("INSERT INTO users (strava_id) VALUES (7828229)").run();
    await db.prepare("INSERT INTO activities (id, strava_id, start_date) VALUES (1, 7828229, '2024-01-31T00:00:00Z')").run();

    const onTokens = vi.fn();
    const result = await runSync(config, { refresh_token: "r" }, { now: 1000, onTokens }, fetchFn);

    expect(onTokens).toHaveBeenCalledWith({ access_token: "a2", refresh_token: "r2", expires_at: 99999 });
    expect(result.fetched).toBe(1);
    expect(result.after).toBe(Date.parse("2024-01-31T00:00:00Z") / 1000 - OVERLAP_SECONDS);
    expect(urls.find((u) => u.includes("/athlete/activities"))).toContain(`after=${result.after}`);

    const user = await db.prepare("SELECT firstname, last_synced_at FROM users").first<any>();
    expect(user).toEqual({ firstname: "J", last_synced_at: 1000 });
    expect(await db.prepare("SELECT name FROM activities WHERE id = 5").first<any>()).toEqual({ name: "Run 5" });

    const purge = fetchFn.mock.calls.find((c: any) => String(c[0]).endsWith("/purge_cache")) as any;
    expect(JSON.parse(purge[1].body).files).toContain("https://stravasync.jonathanburnhams.com/api/users/7828229/activities");
  });

  it("refuses a token for a different athlete", async () => {
    const fetchFn = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.endsWith("/query")) return json({ success: true, result: [{ results: [{ newest: null }] }] });
      if (url.endsWith("/api/v3/athlete")) return json({ id: 1 });
      return new Response("unexpected", { status: 500 });
    });
    const state = { refresh_token: "r", access_token: "a", expires_at: 99999 };
    await expect(runSync(config, state, { now: 1000 }, fetchFn)).rejects.toThrow(/athlete 1/);
  });
});
