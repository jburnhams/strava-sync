import type { ErrorResponse } from "./types";
import { handleConfig, handleLogin, handleCallback } from "./auth";
import { handleGetUsers, handleGetUser, handleSync, handleGetActivities, handleSyncStreams, handleGetActivityDetail, handleUpdateConfig } from "./sync";
import { deleteActivity, deleteAllActivities } from "./db";

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  DB: D1Database;
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
async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

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
  if (syncMatch && method === "POST") return handleSync(request, env);

  // /api/users/:id/activities
  const actMatch = path.match(/^\/api\/users\/(\d+)\/activities$/);
  if (actMatch && method === "GET") return handleGetActivities(request, env);

  // /api/users/:id/activities (DELETE ALL)
  if (actMatch && method === "DELETE") {
      const id = parseInt(actMatch[1], 10);
      await deleteAllActivities(env.DB, id);
      return new Response(JSON.stringify({ status: "deleted" }), { status: 200 });
  }

  // /api/users/:id/streams (POST)
  const streamMatch = path.match(/^\/api\/users\/(\d+)\/streams$/);
  if (streamMatch && method === "POST") return handleSyncStreams(request, env);

  // /api/users/:id/config (PATCH)
  const configMatch = path.match(/^\/api\/users\/(\d+)\/config$/);
  if (configMatch && method === "PATCH") return handleUpdateConfig(request, env);

  // /api/activities/:id
  const actDetailMatch = path.match(/^\/api\/activities\/(\d+)$/);
  if (actDetailMatch) {
      if (method === "GET") return handleGetActivityDetail(request, env);
      if (method === "DELETE") {
          const id = parseInt(actDetailMatch[1], 10);
          await deleteActivity(env.DB, id);
          return new Response(JSON.stringify({ status: "deleted" }), { status: 200 });
      }
  }

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
  _ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);

  // API Requests
  if (url.pathname.startsWith("/api/")) {
    return handleApiRequest(request, env);
  }

  // Static Assets & SPA Fallback
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && !url.pathname.startsWith("/api/")) {
    response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  }

  return response;
}

export default { fetch: handleRequest };
