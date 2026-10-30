import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleRequest, Env } from "../src/worker";
import { setupTestDb } from "./setup-test-db";

describe("Worker API", () => {
  let env: Env;

  beforeEach(() => {
    env = {
      DB: setupTestDb(),
      ASSETS: {
        fetch: vi.fn(async (_req) => new Response("Asset Not Found", { status: 404 })),
      },
    };
  });

  it("should return healthy status", async () => {
    const req = new Request("http://localhost/api/health");
    const res = await handleRequest(req, env, { waitUntil: () => {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("should serve index.html for unknown routes (SPA support)", async () => {
    // Mock ASSETS to return 404 for original request, but return index.html for /index.html
    const fetchMock = vi.fn().mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === "/dashboard") {
            return new Response("Not Found", { status: 404 });
        }
        if (url.pathname === "/index.html") {
            return new Response("<html>Index</html>", { status: 200 });
        }
        return new Response("Not Found", { status: 404 });
    });
    env.ASSETS.fetch = fetchMock;

    const req = new Request("http://localhost/dashboard");
    const res = await handleRequest(req, env, { waitUntil: () => {} });

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1. /dashboard -> 404, 2. /index.html -> 200
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>Index</html>");
  });

  it("should reject writes: the API is read-only", async () => {
    for (const path of ["/api/config", "/api/users/1/sync", "/api/users"]) {
      const res = await handleRequest(new Request(`http://localhost${path}`, { method: "POST" }), env, { waitUntil: () => {} });
      expect(res.status).toBe(405);
    }
  });

  it("should 404 the removed OAuth endpoints", async () => {
    const res = await handleRequest(new Request("http://localhost/api/auth/login"), env, { waitUntil: () => {} });
    expect(res.status).toBe(404);
  });

  it("serves photos as cached JPEGs and 404s unknown ones", async () => {
    await env.DB.prepare("INSERT INTO users (strava_id) VALUES (1)").run();
    await env.DB.prepare("INSERT INTO activities (id, strava_id) VALUES (5, 1)").run();
    await env.DB.prepare(`INSERT INTO photos (id, activity_id, position, width, height, thumb, full)
      VALUES ('5_0', 5, 0, 2, 1, ?, ?)`).bind(btoa("thumb-bytes"), btoa("full-bytes")).run();

    const full = await handleRequest(new Request("http://localhost/api/photos/5_0"), env, { waitUntil: () => {} });
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("image/jpeg");
    expect(full.headers.get("Cache-Control")).toContain("immutable");
    expect(full.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await full.text()).toBe("full-bytes");

    const thumb = await handleRequest(new Request("http://localhost/api/photos/5_0?size=thumb"), env, { waitUntil: () => {} });
    expect(await thumb.text()).toBe("thumb-bytes");

    const missing = await handleRequest(new Request("http://localhost/api/photos/5_9"), env, { waitUntil: () => {} });
    expect(missing.status).toBe(404);
  });
});
