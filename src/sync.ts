import type { Env } from "./worker";
import { getUser, getUsers, saveActivity, upsertUser, updateUserSyncConfig, saveStream, getActivitiesWithoutStreams, getActivity, getStream } from "./db";

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

  const user = await getUser(env.DB, id);
  if (!user) return errorResponse("User not found", 404);

  // Check token expiry and refresh if needed
  let accessToken = user.access_token;
  const now = Math.floor(Date.now() / 1000);

  if (user.expires_at < now + 60) {
     // Refresh token logic would go here
     // For this iteration, we assume valid tokens or manual re-auth
     // Ideally: call Strava refresh endpoint, update DB
  }

  // Parse page param
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const perPage = 30;

  // Determine "after" timestamp
  let after = 0;
  if (user.sync_since) {
      const date = new Date(user.sync_since);
      if (!isNaN(date.getTime())) {
          after = Math.floor(date.getTime() / 1000);
      }
  }
  // Default to 2018 if not set or invalid, but user.sync_since defaults to '2018-01-01' in DB.
  // If we want to strictly follow the config:
  if (after === 0) {
      after = Math.floor(new Date("2018-01-01").getTime() / 1000);
  }

  // Fetch from Strava
  const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}&after=${after}`, {
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

// POST /api/users/:id/streams
export async function handleSyncStreams(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const id = parseInt(parts[3], 10);

  const user = await getUser(env.DB, id);
  if (!user) return errorResponse("User not found", 404);

  // Get activities that need streams
  const activityIds = await getActivitiesWithoutStreams(env.DB, id);

  // We will process a batch (e.g., 5 at a time) to avoid hitting limits or timeout
  // For the UI progress, we might want params like `limit` or `offset`.
  // Let's grab `limit` from query, default 5.
  const limit = parseInt(url.searchParams.get("limit") || "5", 10);
  const batch = activityIds.slice(0, limit);

  let syncedCount = 0;

  for (const actId of batch) {
    // Fetch streams
    // keys=latlng,time,altitude
    // key_by_type=true
    const response = await fetch(`https://www.strava.com/api/v3/activities/${actId}/streams?keys=latlng,time,altitude&key_by_type=true`, {
       headers: { "Authorization": `Bearer ${user.access_token}` }
    });

    if (response.ok) {
       const streamData = await response.json();
       await saveStream(env.DB, {
           strava_id: user.strava_id,
           activity_id: actId,
           data_json: JSON.stringify(streamData)
       });
       syncedCount++;
    } else {
        // Log error or break?
        // If rate limited, we should stop.
        if (response.status === 429) {
             return jsonResponse({ synced: syncedCount, complete: false, error: "Rate Limited" }, 429);
        }
    }
  }

  return jsonResponse({
      synced: syncedCount,
      remaining: activityIds.length - syncedCount,
      complete: activityIds.length <= syncedCount // Roughly true if we finished all found
  });
}

// PATCH /api/users/:id/config
export async function handleUpdateConfig(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/");
    const id = parseInt(parts[3], 10);

    const body = await request.json() as any;
    const { sync_since } = body;

    if (!sync_since) return errorResponse("Missing sync_since");

    await updateUserSyncConfig(env.DB, id, sync_since);
    return jsonResponse({ status: "updated" });
}

// GET /api/activities/:id
export async function handleGetActivityDetail(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const id = parseInt(url.pathname.split("/").pop()!, 10);

    const activity = await getActivity(env.DB, id);
    if (!activity) return errorResponse("Activity not found", 404);

    const stream = await getStream(env.DB, id);

    // Merge
    const result = {
        ...activity,
        data_json: JSON.parse(activity.data_json),
        streams: stream ? JSON.parse(stream.data_json) : null
    };

    return jsonResponse(result);
}

// GET /api/users/:id/activities
export async function handleGetActivities(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const id = parseInt(parts[3], 10); // /api/users/123/activities

  const result = await env.DB.prepare("SELECT * FROM activities WHERE strava_id = ? ORDER BY start_date DESC").bind(id).all();
  return jsonResponse(result.results);
}
