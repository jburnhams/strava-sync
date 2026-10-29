import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest, Env } from "../src/worker";
import { setupTestDb } from "./setup-test-db";

const ctx = { waitUntil: () => {} };

describe("training API", () => {
  let env: Env;

  beforeEach(async () => {
    env = { DB: setupTestDb(), ASSETS: { fetch: vi.fn() } };
    await env.DB.prepare(`INSERT INTO training_activities (id, date, sport, distance, moving_time, elapsed_time, elevation_gain, race) VALUES
      ('a', '2026-10-01', 'run', 10000, 3000, 3100, 50, 0),
      ('b', '2026-10-05', 'ride', 40000, 5000, 5200, 300, 0),
      ('c', '2026-09-28', 'run', 21000, 6000, 6100, 120, 1)`).run();
    await env.DB.prepare(`INSERT INTO training_weekly (week, sport, count, distance, moving_time, elevation_gain) VALUES
      ('2026-09-28', 'run', 2, 31000, 9000, 170),
      ('2026-09-28', 'ride', 5, 60000, 9000, 200),
      ('2026-10-05', 'ride', 3, 50000, 7000, 350),
      ('2025-12-29', 'run', 1, 5000, 1500, 10)`).run();
  });

  async function get(path: string) {
    const res = await handleRequest(new Request(`http://localhost${path}`), env, ctx);
    return { status: res.status, body: await res.json() as any, res };
  }

  it("lists activities newest first, without ids, filterable by sport and dates", async () => {
    const all = await get("/api/training/activities");
    expect(all.status).toBe(200);
    expect(all.body.map((a: any) => a.date)).toEqual(["2026-10-05", "2026-10-01", "2026-09-28"]);
    expect(all.body[0]).toEqual({ date: "2026-10-05", sport: "ride", distance: 40000, moving_time: 5000, elapsed_time: 5200, elevation_gain: 300, race: 0 });
    expect(all.res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    expect((await get("/api/training/activities?sport=run")).body).toHaveLength(2);
    expect((await get("/api/training/activities?race=1")).body.map((a: any) => a.date)).toEqual(["2026-09-28"]);
    expect((await get("/api/training/activities?from=2026-10-01&to=2026-10-04")).body).toHaveLength(1);
    expect((await get("/api/training/activities?from=yesterday")).status).toBe(400);
  });

  it("summarises by week, month and year", async () => {
    const week = await get("/api/training/summary");
    expect(week.body[0]).toMatchObject({ period: "2026-10-05", sport: "ride", count: 3 });

    const month = await get("/api/training/summary?period=month&sport=ride");
    expect(month.body).toEqual([
      { period: "2026-10", sport: "ride", count: 3, distance: 50000, moving_time: 7000, elevation_gain: 350 },
      { period: "2026-09", sport: "ride", count: 5, distance: 60000, moving_time: 9000, elevation_gain: 200 },
    ]);

    const year = await get("/api/training/summary?period=year&sport=run");
    expect(year.body.map((r: any) => [r.period, r.count])).toEqual([["2026", 2], ["2025", 1]]);

    expect((await get("/api/training/summary?period=day")).status).toBe(400);
  });
});
