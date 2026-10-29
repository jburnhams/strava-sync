import type { Env } from "./worker";
import type { Activity } from "./types";
import { getUser, getUsers } from "./db";

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// GET /api/users
export async function handleGetUsers(request: Request, env: Env): Promise<Response> {
  const users = await getUsers(env.DB);
  return jsonResponse(users);
}

// GET /api/users/:id
export async function handleGetUser(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const idStr = url.pathname.split("/").pop(); // /api/users/123 -> 123
  if (!idStr) return errorResponse("Invalid ID");
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return errorResponse("Invalid ID");

  const user = await getUser(env.DB, id);
  if (!user) return errorResponse("User not found", 404);

  return jsonResponse(user);
}

// GET /api/users/:id/activities
export async function handleGetActivities(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const id = parseInt(parts[3], 10); // /api/users/123/activities
  if (isNaN(id)) return errorResponse("Invalid ID");

  const { results } = await env.DB.prepare("SELECT * FROM activities WHERE strava_id = ? ORDER BY start_date DESC")
    .bind(id)
    .all<Activity>();

  const activities = results.map((act) => {
    let data;
    try {
      data = JSON.parse(act.data_json);
    } catch (e) {
      data = null; // Set to null if parsing fails
    }
    return { ...act, data_json: data };
  });

  return jsonResponse(activities);
}
