import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleSync } from "../src/sync";
import { setupTestDb } from "./setup-test-db";
import { Env } from "../src/worker";

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Sync Logic", () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      DB: setupTestDb(),
      ASSETS: { fetch: vi.fn() },
    };
    fetchMock.mockReset();

    // Seed a user
    await env.DB.prepare(`
      INSERT INTO users (strava_id, firstname, access_token, refresh_token, expires_at)
      VALUES (100, 'Test', 'valid_token', 'refresh', 9999999999)
    `).run();
  });

  it("should fetch activities from Strava and save them", async () => {
    // Mock Strava Response
    const stravaActivities = [
      {
        id: 1,
        name: "Morning Run",
        type: "Run",
        start_date: "2023-01-01T00:00:00Z",
        distance: 1000,
        moving_time: 300,
        elapsed_time: 300,
        total_elevation_gain: 10
      }
    ];
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(stravaActivities), { status: 200 }));

    const req = new Request("http://localhost/api/users/100/sync?page=1", { method: "POST" });
    const res = await handleSync(req, env);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.synced).toBe(1);
    expect(body.complete).toBe(true); // < 30 items

    // Verify DB
    const act = await env.DB.prepare("SELECT * FROM activities WHERE id = 1").first<any>();
    expect(act.name).toBe("Morning Run");
  });

  it("should handle empty response (sync complete)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));

    const req = new Request("http://localhost/api/users/100/sync?page=2", { method: "POST" });
    const res = await handleSync(req, env);
    const body = await res.json() as any;

    expect(body.synced).toBe(0);
    expect(body.complete).toBe(true);

    // Verify user last_synced_at updated
    const user = await env.DB.prepare("SELECT last_synced_at FROM users WHERE strava_id = 100").first<any>();
    expect(user.last_synced_at).not.toBeNull();
  });
});
