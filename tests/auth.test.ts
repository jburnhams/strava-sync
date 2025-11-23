import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleConfig, handleLogin, handleCallback } from "../src/auth";
import { setupTestDb } from "./setup-test-db";
import { Env } from "../src/worker";

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Auth Endpoints", () => {
  let env: Env;

  beforeEach(() => {
    env = {
      DB: setupTestDb(),
      ASSETS: { fetch: vi.fn() },
    };
    fetchMock.mockReset();
  });

  it("should store config", async () => {
    const req = new Request("http://localhost/api/config", {
      method: "POST",
      body: JSON.stringify({ client_id: "123", client_secret: "abc" }),
    });
    const res = await handleConfig(req, env);
    expect(res.status).toBe(200);

    // Verify DB
    const config = await env.DB.prepare("SELECT * FROM app_config").first();
    expect(config).toMatchObject({ client_id: "123", client_secret: "abc" });
  });

  it("should redirect to Strava for login", async () => {
    // Setup config first
    await env.DB.prepare("INSERT INTO app_config (id, client_id, client_secret) VALUES (1, '123', 'abc')").run();

    const req = new Request("http://localhost/api/auth/login");
    const res = await handleLogin(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("strava.com/oauth/authorize");
    expect(res.headers.get("Location")).toContain("client_id=123");
  });

  it("should handle callback and store user", async () => {
    // Setup config
    await env.DB.prepare("INSERT INTO app_config (id, client_id, client_secret) VALUES (1, '123', 'abc')").run();

    // Mock Strava Token Response
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: "at_123",
      refresh_token: "rt_123",
      expires_at: 9999999999,
      athlete: {
        id: 99,
        firstname: "John",
        lastname: "Doe",
        profile: "pic.jpg"
      }
    }), { status: 200 }));

    const req = new Request("http://localhost/api/auth/callback?code=some_code");
    const res = await handleCallback(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://localhost/user/99");

    // Verify User in DB
    const user = await env.DB.prepare("SELECT * FROM users WHERE strava_id = 99").first();
    expect(user).toMatchObject({
      firstname: "John",
      access_token: "at_123"
    });
  });
});
