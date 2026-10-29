import type { Env } from "./worker";

// Public training data, published from the private Garmin sync on omarchy with
// identifying details removed: day only (no time), sport, distance, durations,
// elevation. No names, locations, routes, heart rate or device. Activities are
// published a week late, and short rides only count in the weekly totals.

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...extra },
  });
}

const MAX_PAGE = 200;

function intParam(value: string | null, name: string, min: number, max: number): number | Response | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return json({ error: `${name} must be an integer from ${min} to ${max}` }, 400);
  return n;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// sport=run or a comma-separated list (sport=run,trail_run,ultra_run), so one group can be one filter
function sportFilter(v: string | null): { sql: string; params: string[] } | Response | null {
  if (!v) return null;
  const sports = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!sports.length || sports.length > 20 || sports.some((s) => !/^[a-z_]+$/.test(s))) {
    return json({ error: "sport must be a sport or a comma-separated list of them" }, 400);
  }
  return { sql: `sport IN (${sports.map(() => "?").join(", ")})`, params: sports };
}

// GET /api/training/activities?sport=&race=1&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50&offset=0
// With limit (1 to 200) the result is one page, newest first, and the X-Total-Count
// header holds how many sessions match; without it everything is returned.
// race is 1 when the activity falls on the day(s) of a race tagged in Strava
// (matched by sport, date span and distance > 20 km; one Strava race can cover
// several Garmin activities). race_activity_id is that Strava activity's id, as
// listed by /api/users/:id/activities.
export async function handleTrainingActivities(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const sport = sportFilter(q.get("sport"));
  if (sport instanceof Response) return sport;
  if (sport) { where.push(sport.sql); params.push(...sport.params); }
  const race = q.get("race");
  if (race === "1" || race === "0") { where.push("race = ?"); params.push(Number(race)); }
  for (const [key, op] of [["from", ">="], ["to", "<="]] as const) {
    const v = q.get(key);
    if (v === null) continue;
    if (!DATE.test(v)) return json({ error: `${key} must be YYYY-MM-DD` }, 400);
    where.push(`date ${op} ?`);
    params.push(v);
  }
  const limit = intParam(q.get("limit"), "limit", 1, MAX_PAGE);
  if (limit instanceof Response) return limit;
  const offset = intParam(q.get("offset"), "offset", 0, 1_000_000);
  if (offset instanceof Response) return offset;

  const filter = where.length ? "WHERE " + where.join(" AND ") : "";
  const { results } = await env.DB.prepare(
    `SELECT date, sport, distance, moving_time, elapsed_time, elevation_gain, race, race_activity_id FROM training_activities
     ${filter} ORDER BY date DESC, id${limit ? " LIMIT ? OFFSET ?" : ""}`
  ).bind(...params, ...(limit ? [limit, offset ?? 0] : [])).all();
  if (!limit) return json(results);

  const total = await env.DB.prepare(`SELECT count(*) AS n FROM training_activities ${filter}`).bind(...params).first<{ n: number }>();
  return json(results, 200, { "X-Total-Count": String(total?.n ?? 0) });
}

// GET /api/training/summary?period=week|month|year&sport=&race=0|1&from=YYYY-MM-DD&to=YYYY-MM-DD
// Built from weekly totals; month and year group weeks by the month/year their Monday
// falls in. from/to limit which weeks (by Monday) are included, e.g. one year of weeks.
export async function handleTrainingSummary(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const period = q.get("period") ?? "week";
  const key = { week: "week", month: "substr(week, 1, 7)", year: "substr(week, 1, 4)" }[period];
  if (!key) return json({ error: "period must be week, month or year" }, 400);
  const where: string[] = [];
  const params: unknown[] = [];
  const sport = sportFilter(q.get("sport"));
  if (sport instanceof Response) return sport;
  if (sport) { where.push(sport.sql); params.push(...sport.params); }
  const race = q.get("race");
  if (race === "1" || race === "0") { where.push("race = ?"); params.push(Number(race)); }
  for (const [name, op] of [["from", ">="], ["to", "<="]] as const) {
    const v = q.get(name);
    if (v === null) continue;
    if (!DATE.test(v)) return json({ error: `${name} must be YYYY-MM-DD` }, 400);
    where.push(`week ${op} ?`);
    params.push(v);
  }
  const { results } = await env.DB.prepare(
    `SELECT ${key} AS period, sport, sum(count) AS count, sum(distance) AS distance,
            sum(moving_time) AS moving_time, sum(elevation_gain) AS elevation_gain
     FROM training_weekly ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY period, sport ORDER BY period DESC, sport`
  ).bind(...params).all();
  return json(results);
}
