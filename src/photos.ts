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

// sfc32, seeded from a SHA-256 digest: a small, fast PRNG that is identical on every runtime
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

async function seededRandom(seed: string): Promise<() => number> {
  const digest = new DataView(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  const next = sfc32(digest.getUint32(0), digest.getUint32(4), digest.getUint32(8), digest.getUint32(12));
  for (let i = 0; i < 12; i++) next(); // let the state mix before use
  return next;
}

// Fisher-Yates with a seeded PRNG: the same seed always gives the same order
export async function shuffled<T>(items: T[], seed: string): Promise<T[]> {
  const out = items.slice();
  const random = await seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface PhotoRow {
  id: string; activity_id: number; position: number; width: number; height: number;
  caption: string | null; name: string | null; date: string | null;
}

// GET /api/photos/random?seed=<anything>&offset=0&limit=20
// Every photo in a random order fixed by the seed (hashed, so any string works):
// the same seed and offset always return the same photos, and offsets 0..total-1
// show each photo once. Offsets past the end carry on into a new shuffle
// (seed + pass number), so a slideshow can page forever without a photo repeating
// within a pass. X-Total-Count is the number of photos (one pass).
export async function handleRandomPhotos(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...extra },
    });
  const seed = q.get("seed");
  if (!seed) return json({ error: "seed is required (any string, e.g. a random number per page load)" }, 400);
  if (seed.length > 200) return json({ error: "seed must be at most 200 characters" }, 400);
  const offset = Number(q.get("offset") ?? 0), limit = Number(q.get("limit") ?? 20);
  if (!Number.isInteger(offset) || offset < 0) return json({ error: "offset must be 0 or more" }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return json({ error: `limit must be 1 to ${MAX_LIMIT}` }, 400);

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.activity_id, p.position, p.width, p.height, p.caption, a.name,
            substr(coalesce(json_extract(a.data_json, '$.start_date_local'), a.start_date), 1, 10) AS date
     FROM photos p JOIN activities a ON a.id = p.activity_id ORDER BY p.id`
  ).all<PhotoRow>();
  const total = results.length;
  if (!total) return json([], 200, { "X-Total-Count": "0" });

  const passes = new Map<number, PhotoRow[]>();
  const page = [];
  for (let i = offset; i < offset + limit; i++) {
    const pass = Math.floor(i / total);
    if (!passes.has(pass)) passes.set(pass, await shuffled(results, pass === 0 ? seed : `${seed}:${pass}`));
    const p = passes.get(pass)![i % total];
    page.push({
      id: p.id,
      width: p.width,
      height: p.height,
      ...(p.caption ? { caption: p.caption } : {}),
      url: `${PUBLIC_URL}/api/photos/${p.id}`,
      thumb_url: `${PUBLIC_URL}/api/photos/${p.id}?size=thumb`,
      activity: { id: p.activity_id, name: p.name, date: p.date },
    });
  }
  return json(page, 200, { "X-Total-Count": String(total) });
}
