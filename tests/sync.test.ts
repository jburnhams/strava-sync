import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleSync, handleGetUsers, handleGetUser, handleGetActivities } from "../src/sync";
import { setupTestDb } from "./setup-test-db";
import { Env, ExecutionContext } from "../src/worker";

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Sync Logic", () => {
  let env: Env;
  let ctx: ExecutionContext;

  beforeEach(async () => {
    env = {
      DB: setupTestDb(),
      ASSETS: { fetch: vi.fn() },
      CLOUDFLARE_ZONE_ID: "mock-zone",
      CLOUDFLARE_API_TOKEN: "mock-token",
    };
    ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    fetchMock.mockReset();

    // Seed users
    await env.DB.prepare(`
      INSERT INTO users (strava_id, firstname, access_token, refresh_token, expires_at)
      VALUES (100, 'Test', 'valid_token', 'refresh', 9999999999),
             (7828229, 'Allowed User', 'valid_token', 'refresh', 9999999999)
    `).run();
  });

  describe("handleGetUsers", () => {
    it("should return a list of users", async () => {
      const req = new Request("http://localhost/api/users");
      const res = await handleGetUsers(req, env);
      const body = await res.json() as any[];

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
    });
  });

  describe("handleGetUser", () => {
    it("should return a user by id", async () => {
      const req = new Request("http://localhost/api/users/100");
      const res = await handleGetUser(req, env);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.strava_id).toBe(100);
      expect(body.firstname).toBe("Test");
      expect(body.access_token).toBeUndefined(); // Should be stripped
      expect(body.refresh_token).toBeUndefined(); // Should be stripped
    });

    it("should return 404 for non-existent user", async () => {
      const req = new Request("http://localhost/api/users/999");
      const res = await handleGetUser(req, env);
      expect(res.status).toBe(404);
    });

     it("should return error for invalid ID", async () => {
      const req = new Request("http://localhost/api/users/");
      const res = await handleGetUser(req, env);
      expect(res.status).toBe(400); // Invalid ID because split pop empty
    });
  });

  describe("handleSync", () => {
    it("should fetch activities from Strava and save them", async () => {
      // Mock Strava Response and Cloudflare Response
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

      fetchMock.mockImplementation(async (url: string | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("strava.com")) {
             return new Response(JSON.stringify(stravaActivities), { status: 200 });
        }
        if (urlStr.includes("api.cloudflare.com")) {
             return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response("Not Found", { status: 404 });
      });


      const req = new Request("http://localhost/api/users/7828229/sync?page=1", { method: "POST" });
      const res = await handleSync(req, env, ctx);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.synced).toBe(1);
      expect(body.complete).toBe(true); // < 30 items

      // Verify DB
      const act = await env.DB.prepare("SELECT * FROM activities WHERE id = 1").first<any>();
      expect(act.name).toBe("Morning Run");
    });

    it("should allow sync for the allowed user", async () => {
      fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
      const req = new Request("http://localhost/api/users/7828229/sync", { method: "POST" });
      const res = await handleSync(req, env, ctx);
      expect(res.status).toBe(200);
    });

    it("should block sync for other users", async () => {
      const req = new Request("http://localhost/api/users/100/sync", { method: "POST" });
      const res = await handleSync(req, env, ctx);
      expect(res.status).toBe(403);
    });

    it("should handle empty response (sync complete)", async () => {
      fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));

      const req = new Request("http://localhost/api/users/7828229/sync?page=2", { method: "POST" });
      const res = await handleSync(req, env, ctx);
      const body = await res.json() as any;

      expect(body.synced).toBe(0);
      expect(body.complete).toBe(true);

      // Verify user last_synced_at updated
      const user = await env.DB.prepare("SELECT last_synced_at FROM users WHERE strava_id = 7828229").first<any>();
      expect(user.last_synced_at).not.toBeNull();
    });

    it("should return 405 if method is not POST", async () => {
      const req = new Request("http://localhost/api/users/7828229/sync", { method: "GET" });
      const res = await handleSync(req, env, ctx);
      expect(res.status).toBe(405);
    });

    it("should return 403 if user not found, due to restriction", async () => {
      const req = new Request("http://localhost/api/users/999/sync", { method: "POST" });
      const res = await handleSync(req, env, ctx);
      expect(res.status).toBe(403);
    });

    it("should handle Strava 401 Unauthorized", async () => {
       fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
       const req = new Request("http://localhost/api/users/7828229/sync", { method: "POST" });
       const res = await handleSync(req, env, ctx);
       expect(res.status).toBe(401);
    });

    it("should handle Strava 429 Rate Limit", async () => {
       fetchMock.mockResolvedValueOnce(new Response("Rate Limit", { status: 429 }));
       const req = new Request("http://localhost/api/users/7828229/sync", { method: "POST" });
       const res = await handleSync(req, env, ctx);
       expect(res.status).toBe(429);
    });

    it("should handle generic Strava error", async () => {
       fetchMock.mockResolvedValueOnce(new Response("Error", { status: 500 }));
       const req = new Request("http://localhost/api/users/7828229/sync", { method: "POST" });
       const res = await handleSync(req, env, ctx);
       expect(res.status).toBe(500);
    });
  });

  describe("handleGetActivities", () => {
      it("should return activities for a user", async () => {
          // Insert dummy activity
          await env.DB.prepare(`
              INSERT INTO activities (id, strava_id, name, type, start_date, distance, moving_time, elapsed_time, total_elevation_gain, data_json)
              VALUES (1, 100, 'Test Run', 'Run', '2023-01-01', 5000, 1000, 1000, 50, '{}')
          `).run();

          const req = new Request("http://localhost/api/users/100/activities");
          const res = await handleGetActivities(req, env);
          const body = await res.json() as any[];

          expect(res.status).toBe(200);
          expect(body).toHaveLength(1);
          expect(body[0].name).toBe("Test Run");
      });

      it("should return activities with data_json as an object", async () => {
        const jsonData = { detail: "some data" };
        await env.DB.prepare(`
          INSERT INTO activities (id, strava_id, name, data_json)
          VALUES (1, 100, 'Test Run', ?)
        `).bind(JSON.stringify(jsonData)).run();

        const req = new Request("http://localhost/api/users/100/activities");
        const res = await handleGetActivities(req, env);
        const body = await res.json() as any[];

        expect(res.status).toBe(200);
        expect(body).toHaveLength(1);
        expect(typeof body[0].data_json).toBe("object");
        expect(body[0].data_json).toEqual(jsonData);
      });

      it("should handle malformed json and return null", async () => {
        await env.DB.prepare(`
          INSERT INTO activities (id, strava_id, name, data_json)
          VALUES (1, 100, 'Test Run', ?)
        `).bind("not-json").run();

        const req = new Request("http://localhost/api/users/100/activities");
        const res = await handleGetActivities(req, env);
        const body = await res.json() as any[];

        expect(res.status).toBe(200);
        expect(body[0].data_json).toBeNull();
      });
  });
});
