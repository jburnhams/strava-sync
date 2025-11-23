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
});
