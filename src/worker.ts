import type { ErrorResponse } from "./types";
import { handleGetUsers, handleGetUser, handleGetActivities } from "./sync";
import { handleOptions, wrapCors } from "./cors";
import { handleGetPhoto } from "./photos";
import { handleTrainingActivities, handleTrainingSummary } from "./training";

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
async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  if (method === "OPTIONS") {
    return handleOptions(request);
  }

  // Read-only API: data is loaded into D1 directly, never through the Worker
  if (method !== "GET" && method !== "HEAD") {
    return createErrorResponse("METHOD_NOT_ALLOWED", "This API is read-only", 405);
  }

  // Users
  if (path === "/api/users") return handleGetUsers(request, env);

  // User Details & Sync (Regex might be cleaner but manual parsing is fine for now)
  // /api/users/:id
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) return handleGetUser(request, env);

  // /api/users/:id/activities
  const actMatch = path.match(/^\/api\/users\/(\d+)\/activities$/);
  if (actMatch) return handleGetActivities(request, env);

  // /api/photos/:id
  const photoMatch = path.match(/^\/api\/photos\/(\d+_\d+)$/);
  if (photoMatch) return handleGetPhoto(request, env, photoMatch[1]);

  // Training (anonymised Garmin data)
  if (path === "/api/training/activities") return handleTrainingActivities(request, env);
  if (path === "/api/training/summary") return handleTrainingSummary(request, env);

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
