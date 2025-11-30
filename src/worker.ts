import type { ErrorResponse } from "./types";
import { handleConfig, handleLogin, handleCallback } from "./auth";
import { handleGetUsers, handleGetUser, handleSync, handleGetActivities } from "./sync";
import { handleOptions, wrapCors } from "./cors";

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  DB: D1Database;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?: () => void;
}

function createErrorResponse(error: string, message: string, status: number): Response {
  const errorBody: ErrorResponse = { error, message };
  return new Response(JSON.stringify(errorBody), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

// Router
async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  if (method === "OPTIONS") {
    return handleOptions(request);
  }

  // Auth
  if (path === "/api/config") return handleConfig(request, env);
  if (path === "/api/auth/login") return handleLogin(request, env);
  if (path === "/api/auth/callback") return handleCallback(request, env);

  // Users
  if (path === "/api/users" && method === "GET") return handleGetUsers(request, env);

  // User Details & Sync (Regex might be cleaner but manual parsing is fine for now)
  // /api/users/:id
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === "GET") return handleGetUser(request, env);

  // /api/users/:id/sync
  const syncMatch = path.match(/^\/api\/users\/(\d+)\/sync$/);
  if (syncMatch && method === "POST") return handleSync(request, env, ctx);

  // /api/users/:id/activities
  const actMatch = path.match(/^\/api\/users\/(\d+)\/activities$/);
  if (actMatch && method === "GET") return handleGetActivities(request, env);

  if (path === "/api/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  return createErrorResponse("NOT_FOUND", "API endpoint not found", 404);
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);

  // API Requests
  if (url.pathname.startsWith("/api/")) {
    const response = await handleApiRequest(request, env, ctx);
    return wrapCors(response, request);
  }

  // Static Assets & SPA Fallback
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && !url.pathname.startsWith("/api/")) {
    response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  }

  return response;
}

export default { fetch: handleRequest };
