import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleGetUsers, handleGetUser, handleGetActivities } from "../src/sync";
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

    // Seed users
    await env.DB.prepare(`
      INSERT INTO users (strava_id, firstname)
      VALUES (100, 'Test'),
             (7828229, 'Allowed User')
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
