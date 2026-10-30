import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest, Env } from "../src/worker";
import { shuffled } from "../src/photos";
import { setupTestDb } from "./setup-test-db";

const ctx = { waitUntil: () => {} };
const N = 25;

describe("random photos API", () => {
  let env: Env;
  const get = async (query: string) => {
    const res = await handleRequest(new Request(`http://localhost/api/photos/random${query}`), env, ctx);
    return { res, body: res.status === 200 ? ((await res.json()) as any[]) : null };
  };

  beforeEach(async () => {
    env = { DB: setupTestDb(), ASSETS: { fetch: vi.fn() } };
    await env.DB.prepare("INSERT INTO users (strava_id) VALUES (7828229)").run();
    await env.DB.prepare(`INSERT INTO activities (id, strava_id, name, start_date, data_json) VALUES
      (1, 7828229, 'Tor Des Geants', '2026-09-13T08:01:00Z', '{"start_date_local":"2026-09-13T10:01:00Z"}'),
      (2, 7828229, 'Lon Las Cymru', '2025-10-16T06:01:50Z', NULL)`).run();
    for (let i = 0; i < N; i++) {
      await env.DB.prepare("INSERT INTO photos (id, activity_id, position, caption, width, height, thumb, full) VALUES (?, ?, ?, ?, 1200, 800, 'dA==', 'Zg==')")
        .bind(`${1 + (i % 2)}_${i}`, 1 + (i % 2), i, i === 0 ? "Start line" : null).run();
    }
  });

  it("returns a page of photos with urls and their activity, total in X-Total-Count", async () => {
    const { res, body } = await get("?seed=abc&limit=5");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe(String(N));
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("X-Total-Count");
    expect(body).toHaveLength(5);
    const p = body![0];
    expect(Object.keys(p).sort()).toEqual(expect.arrayContaining(["id", "width", "height", "url", "thumb_url", "activity"]));
    expect(p.url).toBe(`https://stravasync.jonathanburnhams.com/api/photos/${p.id}`);
    expect(p.thumb_url).toBe(`${p.url}?size=thumb`);
    expect(p).not.toHaveProperty("thumb"); // no image data in the list
    const tor = body!.concat((await get("?seed=abc&offset=5&limit=20")).body!).find((x) => x.activity.id === 1)!;
    expect(tor.activity).toEqual({ id: 1, name: "Tor Des Geants", date: "2026-09-13" });
  });

  it("is the same for the same seed, different for another, and any seed format works", async () => {
    const a = (await get("?seed=abc&limit=25")).body!.map((p) => p.id);
    const again = (await get("?seed=abc&limit=25")).body!.map((p) => p.id);
    const other = (await get("?seed=" + encodeURIComponent("2026-10-30T00:04 🙂") + "&limit=25")).body!.map((p) => p.id);
    expect(again).toEqual(a);
    expect(other).not.toEqual(a);
    expect(new Set(other)).toEqual(new Set(a));
  });

  it("shows every photo once per pass when paging, then carries on with a fresh order", async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < N; offset += 10) seen.push(...(await get(`?seed=s1&offset=${offset}&limit=${Math.min(10, N - offset)}`)).body!.map((p) => p.id));
    expect(seen).toHaveLength(N);
    expect(new Set(seen).size).toBe(N); // no repeats within the pass
    const pass2 = (await get(`?seed=s1&offset=${N}&limit=${N}`)).body!.map((p) => p.id);
    expect(new Set(pass2).size).toBe(N);
    expect(pass2).not.toEqual(seen); // the next pass is shuffled again
    const across = (await get(`?seed=s1&offset=${N - 2}&limit=4`)).body!.map((p) => p.id);
    expect(across).toEqual([...seen.slice(-2), ...pass2.slice(0, 2)]); // a page can span two passes
  });

  it("rejects a missing seed and bad paging", async () => {
    expect((await get("")).res.status).toBe(400);
    expect((await get("?seed=x&limit=0")).res.status).toBe(400);
    expect((await get("?seed=x&limit=101")).res.status).toBe(400);
    expect((await get("?seed=x&offset=-1")).res.status).toBe(400);
    expect((await get(`?seed=${"x".repeat(201)}`)).res.status).toBe(400);
  });

  it("still serves single photos by id", async () => {
    const res = await handleRequest(new Request("http://localhost/api/photos/1_0?size=thumb"), env, ctx);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("shuffles deterministically and without losing items", async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const a = await shuffled(items, "seed");
    expect(await shuffled(items, "seed")).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
  });
});
