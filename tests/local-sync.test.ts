import { describe, expect, it, vi } from "vitest";
import {
  activityUpserts, afterFromNewest, dedupeStrava, fetchActivitiesSince, getAccessToken, gmtToIso,
  runSync, stravaType, validateConfig, OVERLAP_SECONDS, type Config,
} from "../sync/lib";
import { setupTestDb } from "./setup-test-db";

const config: Config = validateConfig({
  garmin_api_key: "key",
  athlete_id: 7828229,
  cf_account_id: "acct",
  cf_d1_database_id: "db",
  cf_zone_id: "zone",
  cf_api_token: "cf-token",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function garmin(id: number, startGmt: string, typeKey = "running") {
  return {
    activityId: id, activityName: `Run ${id}`, activityType: { typeKey }, startTimeGMT: startGmt,
    distance: 3395, duration: 1304.2, movingDuration: 1266.4, elapsedDuration: 1310, elevationGain: 23,
    averageHR: 150, maxHR: 170, averageSpeed: 2.6,
  };
}

async function seededDb() {
  const db = setupTestDb();
  await db.prepare("INSERT INTO users (strava_id) VALUES (7828229)").run();
  return db;
}

describe("validateConfig", () => {
  it("lists missing keys and defaults the rest", () => {
    expect(() => validateConfig({ athlete_id: 1 })).toThrow(/garmin_api_key.*cf_api_token/);
    expect(config.public_url).toBe("https://stravasync.jonathanburnhams.com");
    expect(config.include_types).toBeNull();
  });
});

describe("getAccessToken", () => {
  it("sends the key and returns the plain-text token", async () => {
    const fetchFn = vi.fn(async () => new Response("jwt-token\n"));
    expect(await getAccessToken(config, fetchFn)).toBe("jwt-token");
    expect((fetchFn.mock.calls[0] as any)[1].headers.Authorization).toBe("ApiKey key");
  });

  it("throws when Garmin refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("expired", { status: 401 }));
    await expect(getAccessToken(config, fetchFn)).rejects.toThrow(/401/);
  });
});

describe("mapping", () => {
  it("converts Garmin GMT times and type keys", () => {
    expect(gmtToIso("2026-10-24 08:31:18")).toBe("2026-10-24T08:31:18Z");
    expect(gmtToIso("2026-10-24 08:31:18.0")).toBe("2026-10-24T08:31:18Z");
    expect(stravaType("running")).toBe("Run");
    expect(stravaType("road_biking")).toBe("Ride");
    expect(stravaType("lap_swimming")).toBe("Swim");
    expect(stravaType("backcountry_skiing")).toBe("BackcountrySkiing");
  });

  it("overlaps from the newest stored activity", () => {
    expect(afterFromNewest(null)).toBe(0);
    expect(afterFromNewest("2024-01-31T00:00:00Z")).toBe(Date.parse("2024-01-31T00:00:00Z") / 1000 - OVERLAP_SECONDS);
  });
});

describe("fetchActivitiesSince", () => {
  it("pages newest-first and stops once activities are older than `after`", async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => garmin(1000 - i, "2026-10-20 08:00:00"));
    const page2 = [garmin(1, "2026-10-01 08:00:00"), garmin(2, "2026-01-01 08:00:00")];
    const fetchFn = vi.fn(async (url: any) => json(String(url).includes("start=0") ? page1 : page2));
    const result = await fetchActivitiesSince("t", Date.parse("2026-09-01T00:00:00Z") / 1000, fetchFn);
    expect(result).toHaveLength(201);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("activityUpserts", () => {
  it("stays under D1's 100 parameter limit and upserts into the real schema", async () => {
    const acts = Array.from({ length: 25 }, (_, i) => garmin(i + 1, "2024-01-01 08:00:00"));
    const stmts = activityUpserts(7828229, acts);
    for (const s of stmts) expect(s.params.length).toBeLessThanOrEqual(100);

    const db = await seededDb();
    for (const s of stmts) await db.prepare(s.sql).bind(...s.params).run();
    acts[0].activityName = "Renamed";
    for (const s of activityUpserts(7828229, acts)) await db.prepare(s.sql).bind(...s.params).run();

    expect((await db.prepare("SELECT count(*) AS n FROM activities").first<any>()).n).toBe(25);
    const first = await db.prepare("SELECT * FROM activities WHERE id = 1").first<any>();
    expect(first).toMatchObject({
      name: "Renamed", type: "Run", start_date: "2024-01-01T08:00:00Z", distance: 3395,
      moving_time: 1266, elapsed_time: 1310, total_elevation_gain: 23, source: "garmin",
    });
    const details = JSON.parse(first.data_json);
    expect(details.average_heartrate).toBe(150);
    expect(details.garmin.activityId).toBe(1);
  });
});

describe("dedupeStrava", () => {
  it("drops Strava rows that Garmin also has, keeps Strava-only ones", async () => {
    const db = await seededDb();
    await db.prepare(`INSERT INTO activities (id, strava_id, start_date, source) VALUES
      (11, 7828229, '2024-01-01T08:03:00Z', 'strava'),
      (12, 7828229, '2015-02-01T08:00:00Z', 'strava')`).run();
    for (const s of activityUpserts(7828229, [garmin(99, "2024-01-01 08:00:00")])) {
      await db.prepare(s.sql).bind(...s.params).run();
    }
    const stmt = dedupeStrava(7828229);
    await db.prepare(stmt.sql).bind(...stmt.params).run();
    const ids = (await db.prepare("SELECT id FROM activities ORDER BY id").all<any>()).results.map((r: any) => r.id);
    expect(ids).toEqual([12, 99]);
  });
});

describe("runSync", () => {
  function harness(db: any, activities: any[]) {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/personal-api-key/token")) return new Response("tok");
      if (url.includes("/activities/search/activities")) return json(activities);
      if (url.endsWith("/query")) {
        const stmt = JSON.parse(init.body);
        const prepared = db.prepare(stmt.sql).bind(...stmt.params);
        const results = stmt.sql.startsWith("SELECT") ? (await prepared.all()).results : (await prepared.run(), []);
        return json({ success: true, result: [{ results }] });
      }
      if (url.endsWith("/purge_cache")) return json({ success: true });
      return new Response("unexpected", { status: 500 });
    });
    return { fetchFn, urls };
  }

  it("fetches since the newest Garmin activity, writes, dedupes and purges", async () => {
    const db = await seededDb();
    for (const s of activityUpserts(7828229, [garmin(1, "2024-01-31 00:00:00")])) {
      await db.prepare(s.sql).bind(...s.params).run();
    }
    await db.prepare("INSERT INTO activities (id, strava_id, start_date, source) VALUES (5000, 7828229, '2024-02-01T00:00:00Z', 'strava')").run();

    const { fetchFn } = harness(db, [garmin(5, "2024-02-01 00:01:00"), garmin(1, "2024-01-31 00:00:00")]);
    const result = await runSync(config, { now: 1000 }, fetchFn);

    expect(result.after).toBe(Date.parse("2024-01-31T00:00:00Z") / 1000 - OVERLAP_SECONDS);
    expect(result.written).toBe(2);
    const ids = (await db.prepare("SELECT id FROM activities ORDER BY id").all<any>()).results.map((r: any) => r.id);
    expect(ids).toEqual([1, 5]); // Strava copy of activity 5 removed
    expect((await db.prepare("SELECT last_synced_at FROM users").first<any>()).last_synced_at).toBe(1000);
    const purge = fetchFn.mock.calls.find((c: any) => String(c[0]).endsWith("/purge_cache")) as any;
    expect(JSON.parse(purge[1].body).files).toContain("https://stravasync.jonathanburnhams.com/api/users/7828229/activities");
  });

  it("writes only include_types when set, and creates the user row on an empty database", async () => {
    const db = setupTestDb();
    const { fetchFn } = harness(db, [garmin(1, "2024-01-01 08:00:00"), garmin(2, "2024-01-02 08:00:00", "road_biking")]);
    const result = await runSync({ ...config, include_types: ["Run"] }, { now: 1000 }, fetchFn);
    expect(result).toMatchObject({ fetched: 2, written: 1, after: 0 });
    expect((await db.prepare("SELECT count(*) AS n FROM activities").first<any>()).n).toBe(1);
  });
});
