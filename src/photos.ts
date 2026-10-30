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

const PUBLIC_URL = "https://stravasync.jonathanburnhams.com";
const MAX_LIMIT = 100;

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}

// sfc32, seeded from a SHA-256 of the caller's seed so any string works.
async function seededRandom(seed: string): Promise<() => number> {
  const digest = new Uint32Array((await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed))).slice(0, 16));
  let [a, b, c, d] = digest;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}

// Fisher-Yates over the id list; the same seed always gives the same order.
export async function shuffled<T>(items: T[], seed: string): Promise<T[]> {
  const rand = await seededRandom(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// GET /api/photos?seed=<any string>&offset=0&limit=20
// A page of photos from one seeded random order of all of them, so a slideshow
// can fetch consecutive pages without repeats until every photo has been shown
// (offset past the total returns an empty page; X-Total-Count says where).
export async function handleListPhotos(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const seed = q.get("seed");
  if (!seed || seed.length > 200) return jsonResponse({ error: "seed is required (1 to 200 characters)" }, 400);
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = q.get(name);
    const n = raw === null ? fallback : Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const limit = int("limit", 20, 1, MAX_LIMIT);
  const offset = int("offset", 0, 0, 1_000_000);
  if (limit === null || offset === null) {
    return jsonResponse({ error: `limit must be 1 to ${MAX_LIMIT} and offset a non-negative integer` }, 400);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, activity_id, caption, width, height FROM photos ORDER BY id"
  ).all<{ id: string; activity_id: number; caption: string | null; width: number; height: number }>();
  const page = (await shuffled(results, seed)).slice(offset, offset + limit).map((r) => ({
    id: r.id,
    activity_id: r.activity_id,
    width: r.width,
    height: r.height,
    ...(r.caption ? { caption: r.caption } : {}),
    url: `${PUBLIC_URL}/api/photos/${r.id}`,
    thumb_url: `${PUBLIC_URL}/api/photos/${r.id}?size=thumb`,
  }));
  return jsonResponse(page, 200, {
    "Cache-Control": "public, max-age=300",
    "X-Total-Count": String(results.length),
  });
}
