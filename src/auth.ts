import type { Env } from "./worker";
import { saveAppConfig, getAppConfig, upsertUser, User } from "./db";

// Helper for responses
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// POST /api/config
export async function handleConfig(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const { client_id, client_secret } = await request.json() as any;
    if (!client_id || !client_secret) return errorResponse("Missing client_id or client_secret");

    await saveAppConfig(env.DB, client_id, client_secret);
    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse("Failed to save: "+e, 400);
  }
}

// GET /api/auth/login
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const config = await getAppConfig(env.DB);
  if (!config) return errorResponse("App not configured", 500);

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  const scope = "read,activity:read_all,profile:read_all"; // Permissions we need

  const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${config.client_id}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=force&scope=${scope}`;

  return Response.redirect(stravaUrl, 302);
}

// GET /api/auth/callback
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return errorResponse(`Strava auth error: ${error}`);
  if (!code) return errorResponse("No code provided");

  const config = await getAppConfig(env.DB);
  if (!config) return errorResponse("App not configured", 500);

  // Exchange code for token
  const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenResponse.json() as any;
  if (!tokenResponse.ok) {
    return errorResponse(`Token exchange failed: ${JSON.stringify(tokenData)}`, 500);
  }

  // Save User & Tokens
  // Strava returns `athlete` object in this response
  const athlete = tokenData.athlete;

  const user: User = {
    strava_id: athlete.id,
    firstname: athlete.firstname,
    lastname: athlete.lastname,
    profile_pic: athlete.profile,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: tokenData.expires_at,
    last_synced_at: null // Doesn't reset if already exists, but we can fix that logic if needed
  };

  await upsertUser(env.DB, user);

  // Redirect to frontend User Page (or Dashboard)
  // For now, redirect to user detail page
  return Response.redirect(`${url.origin}/user/${athlete.id}`, 302);
}
