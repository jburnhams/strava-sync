import type { Env } from "./worker";

// GET /api/photos/:id?size=thumb|full
// Photos are loaded by scripts/import-strava-photos.ts as base64 JPEGs (metadata
// stripped). They never change once written, so they're cached for a year.
export async function handleGetPhoto(request: Request, env: Env, id: string): Promise<Response> {
  const size = new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
  const row = await env.DB.prepare(`SELECT ${size} AS data FROM photos WHERE id = ?`).bind(id).first<{ data: string }>();
  if (!row) {
    return new Response(JSON.stringify({ error: "Photo not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
