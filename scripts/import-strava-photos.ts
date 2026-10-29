// Loads activity photos from a Strava bulk export into D1, after
// import-strava-export.ts has loaded the activities.
//
//   set -a; . ~/.config/cloudflare/env; set +a
//   bun scripts/import-strava-photos.ts <export dir> [--force]
//
// Each image listed in activities.csv's Media column is auto-rotated, resized to
// a ~400 px thumbnail and a ~1200 px version, and re-encoded as JPEG with all
// metadata (EXIF, GPS) dropped. Rows go in one at a time through the D1 HTTP API
// with bound parameters, since a SQL statement is limited to 100 KB. Photos whose
// source file is already stored are skipped unless --force. Each activity then
// gets data_json.photos = [{id, width, height, caption?, url, thumb_url}] and the
// cached activities response is purged. Videos and unreadable files are skipped.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";
import { ATHLETE_ID, parseCsv } from "./import-strava-export";

export const THUMB_WIDTH = 400;
export const FULL_EDGE = 1200;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".heic"]);

const D1_DATABASE_ID = "518ae258-2243-49ba-921c-fa249c9a3fdd";
const ZONE_ID = "89f1fbd6a35c84ce871e06822bf800d8";
const PUBLIC_URL = "https://stravasync.jonathanburnhams.com";

export interface PhotoRef {
  activityId: number;
  position: number;
  file: string; // relative to the export dir, e.g. media/abc.jpg
  caption?: string;
}

// activities.csv lists an activity's media as "media/a.jpg|media/b.jpg".
// Captions, when the export has them, come from media.csv.
export function photoRefs(activitiesCsv: string, mediaCsv?: string): PhotoRef[] {
  const [header, ...rows] = parseCsv(activitiesCsv);
  const idCol = header.indexOf("Activity ID");
  const mediaCol = header.lastIndexOf("Media");
  if (idCol < 0 || mediaCol < 0) return [];

  const captions = new Map<string, string>();
  if (mediaCsv) {
    const [mh, ...mrows] = parseCsv(mediaCsv);
    const fileCol = mh.findIndex((h) => /file/i.test(h));
    const capCol = mh.findIndex((h) => /caption/i.test(h));
    if (fileCol >= 0 && capCol >= 0) {
      for (const r of mrows) if (r[capCol]) captions.set(r[fileCol], r[capCol]);
    }
  }

  const refs: PhotoRef[] = [];
  for (const row of rows) {
    const files = (row[mediaCol] ?? "").split("|").map((f) => f.trim())
      .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()));
    files.forEach((file, position) => {
      const caption = captions.get(file);
      refs.push({ activityId: Number(row[idCol]), position, file, ...(caption ? { caption } : {}) });
    });
  }
  return refs;
}

export async function resizePhoto(input: Buffer) {
  // rotate() applies the EXIF orientation; sharp writes no metadata unless asked.
  const full = await sharp(input).rotate()
    .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(input).rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

export function photoId(ref: PhotoRef): string {
  return `${ref.activityId}_${ref.position}`;
}

export function photoListJson(refs: (PhotoRef & { width: number; height: number })[], publicUrl = PUBLIC_URL) {
  return refs.map((r) => ({
    id: photoId(r),
    width: r.width,
    height: r.height,
    ...(r.caption ? { caption: r.caption } : {}),
    url: `${publicUrl}/api/photos/${photoId(r)}`,
    thumb_url: `${publicUrl}/api/photos/${photoId(r)}?size=thumb`,
  }));
}

async function d1(sql: string, params: unknown[] = []): Promise<any[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: JSON.stringify({ sql, params }),
    }
  );
  const body = await res.json().catch(() => null) as any;
  if (!res.ok || !body?.success) throw new Error(`D1 query failed: ${res.status} ${JSON.stringify(body?.errors ?? body)}`);
  return body.result?.[0]?.results ?? [];
}

async function main(exportDir: string, force: boolean) {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (source ~/.config/cloudflare/env)");
  }
  const mediaCsvPath = join(exportDir, "media.csv");
  const refs = photoRefs(
    readFileSync(join(exportDir, "activities.csv"), "utf-8"),
    existsSync(mediaCsvPath) ? readFileSync(mediaCsvPath, "utf-8") : undefined
  );
  const known = new Set((await d1("SELECT id FROM activities WHERE strava_id = ?", [ATHLETE_ID])).map((r) => r.id));
  const stored = new Map((await d1("SELECT id, source, width, height FROM photos")).map((r) => [r.id, r]));

  const byActivity = new Map<number, (PhotoRef & { width: number; height: number })[]>();
  let uploaded = 0, skipped = 0;
  for (const ref of refs) {
    if (!known.has(ref.activityId)) continue;
    const id = photoId(ref);
    const existing = stored.get(id);
    let dims: { width: number; height: number };
    if (existing && existing.source === ref.file && !force) {
      dims = { width: existing.width, height: existing.height };
      skipped++;
    } else {
      const path = join(exportDir, ref.file);
      if (!existsSync(path)) { console.error(`missing ${ref.file}`); continue; }
      let p;
      try { p = await resizePhoto(readFileSync(path)); }
      catch (e: any) { console.error(`skipping ${ref.file}: ${e.message}`); continue; }
      await d1(
        `INSERT INTO photos (id, activity_id, position, caption, width, height, thumb, full, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET caption = excluded.caption, width = excluded.width, height = excluded.height,
thumb = excluded.thumb, full = excluded.full, source = excluded.source`,
        [id, ref.activityId, ref.position, ref.caption ?? null, p.width, p.height,
          p.thumb.toString("base64"), p.full.toString("base64"), ref.file]
      );
      dims = { width: p.width, height: p.height };
      uploaded++;
      if (uploaded % 25 === 0) console.error(`${uploaded} uploaded`);
    }
    const list = byActivity.get(ref.activityId) ?? [];
    list.push({ ...ref, ...dims });
    byActivity.set(ref.activityId, list);
  }

  for (const [activityId, list] of byActivity) {
    await d1(`UPDATE activities SET data_json = json_set(coalesce(data_json, '{}'), '$.photos', json(?)) WHERE id = ?`,
      [JSON.stringify(photoListJson(list)), activityId]);
  }

  const purge = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    body: JSON.stringify({ files: [`${PUBLIC_URL}/api/users/${ATHLETE_ID}/activities`] }),
  });
  if (!purge.ok) console.error(`cache purge failed: ${purge.status} ${await purge.text()}`);

  console.error(`${uploaded} uploaded, ${skipped} already stored, ${byActivity.size} activities with photos`);
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun scripts/import-strava-photos.ts <export dir> [--force]");
    process.exit(1);
  }
  main(dir, process.argv.includes("--force")).catch((e) => {
    console.error(`import-strava-photos: ${e.message ?? e}`);
    process.exit(1);
  });
}
