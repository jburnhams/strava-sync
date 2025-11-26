import type { Env } from "./worker";
import { getUser, getUsers, saveActivity, upsertUser, getAppConfig } from "./db";

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

  // Strip tokens
  const { access_token, refresh_token, ...safeUser } = user;
  return jsonResponse(safeUser);
}

// POST /api/users/:id/sync
export async function handleSync(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  const url = new URL(request.url);
  // Path is /api/users/:id/sync
  const parts = url.pathname.split("/");
  const id = parseInt(parts[3], 10);
  if (isNaN(id)) return errorResponse("Invalid ID");

  if (id !== 7828229) {
    return errorResponse("Sync is restricted to a specific user", 403);
  }

  const user = await getUser(env.DB, id);
  if (!user) return errorResponse("User not found", 404);

  // Check token expiry and refresh if needed
  let accessToken = user.access_token;
  const now = Math.floor(Date.now() / 1000);

  if (user.expires_at < now + 60) {
    const config = await getAppConfig(env.DB);
    if (!config) return errorResponse("App not configured, cannot refresh token", 500);

    const refreshRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.client_id,
        client_secret: config.client_secret,
        grant_type: "refresh_token",
        refresh_token: user.refresh_token,
      }),
    });

    if (!refreshRes.ok) {
       return errorResponse("Failed to refresh token", 500);
    }

    const refreshData = await refreshRes.json() as any;
    accessToken = refreshData.access_token;

    // Update user with new tokens
    const updatedUser = {
      ...user,
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: refreshData.expires_at
    };
    await upsertUser(env.DB, updatedUser);
  }

  // Parse page param
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const perPage = 30;

  // Fetch from Strava
  const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
     if (response.status === 401) return errorResponse("Unauthorized from Strava", 401);
     if (response.status === 429) return errorResponse("Rate limited by Strava", 429);
     return errorResponse(`Strava Error: ${response.status}`, 500);
  }

  const activities = await response.json() as any[];

  if (activities.length === 0) {
      // Done syncing
      // Update last_synced_at
      const updatedUser = { ...user, last_synced_at: now };
      await upsertUser(env.DB, updatedUser);
      return jsonResponse({ synced: 0, complete: true });
  }

  // Save activities
  for (const act of activities) {
    await saveActivity(env.DB, {
      id: act.id,
      strava_id: user.strava_id,
      name: act.name,
      type: act.type,
      start_date: act.start_date,
      distance: act.distance,
      moving_time: act.moving_time,
      elapsed_time: act.elapsed_time,
      total_elevation_gain: act.total_elevation_gain,
      data_json: JSON.stringify(act)
    });
  }

  return jsonResponse({ synced: activities.length, complete: activities.length < perPage, next_page: page + 1 });
}

// GET /api/users/:id/activities
export async function handleGetActivities(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const id = parseInt(parts[3], 10); // /api/users/123/activities
  if (isNaN(id)) return errorResponse("Invalid ID");

  const result = await env.DB.prepare("SELECT * FROM activities WHERE strava_id = ? ORDER BY start_date DESC").bind(id).all();
  return jsonResponse(result.results);
}
