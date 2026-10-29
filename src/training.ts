import type { Env } from "./worker";

// Public training data, published from the private Garmin sync on omarchy with
// identifying details removed: day only (no time), sport, distance, durations,
// elevation. No names, locations, routes, heart rate or device. Activities are
// published a week late, and short rides only count in the weekly totals.

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/training/activities?sport=&race=1&from=YYYY-MM-DD&to=YYYY-MM-DD
// race is 1 when the activity falls on the day(s) of a race tagged in Strava
// (matched by sport, date span and distance > 20 km; one Strava race can cover
// several Garmin activities). race_activity_id is that Strava activity's id, as
// listed by /api/users/:id/activities.
export async function handleTrainingActivities(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const sport = q.get("sport");
  if (sport) { where.push("sport = ?"); params.push(sport); }
  const race = q.get("race");
  if (race === "1" || race === "0") { where.push("race = ?"); params.push(Number(race)); }
  for (const [key, op] of [["from", ">="], ["to", "<="]] as const) {
    const v = q.get(key);
    if (v === null) continue;
    if (!DATE.test(v)) return json({ error: `${key} must be YYYY-MM-DD` }, 400);
    where.push(`date ${op} ?`);
    params.push(v);
  }
  const { results } = await env.DB.prepare(
    `SELECT date, sport, distance, moving_time, elapsed_time, elevation_gain, race, race_activity_id FROM training_activities
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC`
  ).bind(...params).all();
  return json(results);
}

// GET /api/training/summary?period=week|month|year&sport=&race=0|1 (omit race for both)
// Built from weekly totals; month and year group weeks by the month/year their Monday falls in.
export async function handleTrainingSummary(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const period = q.get("period") ?? "week";
  const key = { week: "week", month: "substr(week, 1, 7)", year: "substr(week, 1, 4)" }[period];
  if (!key) return json({ error: "period must be week, month or year" }, 400);
  const where: string[] = [];
  const params: unknown[] = [];
  const sport = q.get("sport");
  if (sport) { where.push("sport = ?"); params.push(sport); }
  const race = q.get("race");
  if (race === "1" || race === "0") { where.push("race = ?"); params.push(Number(race)); }
  const { results } = await env.DB.prepare(
    `SELECT ${key} AS period, sport, sum(count) AS count, sum(distance) AS distance,
            sum(moving_time) AS moving_time, sum(elevation_gain) AS elevation_gain
     FROM training_weekly ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY period, sport ORDER BY period DESC, sport`
  ).bind(...params).all();
  return json(results);
}
