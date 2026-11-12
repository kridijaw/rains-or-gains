import type { Profile } from "./fitx";

export const NOW_MAX_SPAN = 36 * 3600;
export const HOURLY_MAX_SPAN = 400 * 86400;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface StudioOut {
  branchId: number;
  name: string;
  alias: string;
  lat: number | null;
  lon: number | null;
}

export interface LatestSample {
  ts: number;
  percentage: number | null;
  term: string | null;
  hidden: boolean;
  status: number | null;
  error: string | null;
}

export interface NowBody {
  latest: LatestSample | null;
  samples: [number, number | null][];
  profile: { fetchedAt: number; data: Profile } | null;
}

export type HourlyTuple = [number, number | null, number | null, number];

interface StudioRow {
  branch_id: number;
  name: string;
  alias: string;
  lat: number | null;
  lon: number | null;
}

interface SampleRow {
  ts: number;
  percentage: number | null;
  term: string | null;
  hidden: number;
  status: number | null;
  error: string | null;
}

interface HourlyRow {
  hour_ts: number;
  avg_pct: number | null;
  max_pct: number | null;
  n: number;
}

const hourFloor = (ts: number): number => ts - (ts % 3600);
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

export function parseInteger(raw: string | null): number | null {
  if (raw === null || !/^-?\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}

export function parseBranch(params: URLSearchParams, studios: readonly number[]): Parsed<number> {
  const branch = parseInteger(params.get("branch"));
  if (branch === null) return fail("branch must be an integer");
  if (!studios.includes(branch)) return fail(`unknown branch ${branch}`);
  return ok(branch);
}

export function parseNowQuery(
  params: URLSearchParams,
  studios: readonly number[],
  now: number,
): Parsed<{ branch: number; since: number }> {
  const branch = parseBranch(params, studios);
  if (!branch.ok) return fail(branch.error);
  const raw = params.get("since");
  const since = raw === null ? hourFloor(now - 86400) : parseInteger(raw);
  if (since === null || since < 0) return fail("since must be a non-negative integer (unix seconds)");
  if (since % 3600 !== 0) return fail("since must be hour-aligned");
  return ok({ branch: branch.value, since: Math.max(since, hourFloor(now - NOW_MAX_SPAN)) });
}

export function parseHourlyQuery(
  params: URLSearchParams,
  studios: readonly number[],
): Parsed<{ branch: number; from: number; to: number }> {
  const branch = parseBranch(params, studios);
  if (!branch.ok) return fail(branch.error);
  const from = parseInteger(params.get("from"));
  const to = parseInteger(params.get("to"));
  if (from === null || to === null || from < 0) return fail("from and to must be non-negative integers (unix seconds)");
  if (from % 3600 !== 0 || to % 3600 !== 0) return fail("from and to must be hour-aligned");
  if (to <= from) return fail("to must be after from");
  if (to - from > HOURLY_MAX_SPAN) return fail(`range must not exceed ${HOURLY_MAX_SPAN / 86400} days`);
  return ok({ branch: branch.value, from, to });
}

export function toStudios(rows: StudioRow[], studios: readonly number[]): StudioOut[] {
  return rows
    .filter((r) => studios.includes(r.branch_id))
    .map((r) => ({ branchId: r.branch_id, name: r.name, alias: r.alias, lat: r.lat, lon: r.lon }));
}

export function toLatest(row: SampleRow | null | undefined): LatestSample | null {
  if (!row) return null;
  return {
    ts: row.ts,
    percentage: row.percentage,
    term: row.term,
    hidden: row.hidden === 1,
    status: row.status,
    error: row.error,
  };
}

export function toProfile(row: { fetched_at: number; data: string } | null | undefined): NowBody["profile"] {
  return row ? { fetchedAt: row.fetched_at, data: JSON.parse(row.data) } : null;
}

export function toHourly(rows: HourlyRow[]): HourlyTuple[] {
  return rows.map((r) => [r.hour_ts, r.avg_pct === null ? null : Math.round(r.avg_pct * 10) / 10, r.max_pct, r.n]);
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: status === 200 ? headers : { "cache-control": "no-store", ...headers } });

const badRequest = (error: string) => json({ error }, 400);

async function studios(_q: Record<string, number>, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT branch_id, name, alias, lat, lon FROM studios ORDER BY branch_id",
  ).all<StudioRow>();
  const out = toStudios(results, env.STUDIOS);
  // Before the first cron run the list is empty; a day-long cache would hide the studio for a day.
  return json(out, 200, out.length ? {} : { "cache-control": "public, max-age=60" });
}

async function now({ branch, since }: { branch: number; since: number }, env: Env): Promise<Response> {
  const [latest, samples, profile] = await env.DB.batch([
    env.DB.prepare(
      "SELECT ts, percentage, term, hidden, status, error FROM samples WHERE branch_id = ? ORDER BY ts DESC LIMIT 1",
    ).bind(branch),
    env.DB.prepare(
      "SELECT ts, CASE WHEN hidden = 1 THEN NULL ELSE percentage END AS percentage FROM samples WHERE branch_id = ? AND ts >= ? ORDER BY ts",
    ).bind(branch, since),
    env.DB.prepare("SELECT fetched_at, data FROM profiles WHERE branch_id = ? ORDER BY fetched_at DESC LIMIT 1").bind(
      branch,
    ),
  ]);
  const body: NowBody = {
    latest: toLatest(latest.results[0] as SampleRow | undefined),
    samples: (samples.results as { ts: number; percentage: number | null }[]).map((r) => [r.ts, r.percentage]),
    profile: toProfile(profile.results[0] as { fetched_at: number; data: string } | undefined),
  };
  return json(body);
}

async function hourly({ branch, from, to }: { branch: number; from: number; to: number }, env: Env): Promise<Response> {
  const { results, meta } = await env.DB.prepare(
    "SELECT hour_ts, avg_pct, max_pct, n FROM hourly WHERE branch_id = ? AND hour_ts >= ? AND hour_ts < ? ORDER BY hour_ts",
  )
    .bind(branch, from, to)
    .all<HourlyRow>();
  if (meta.rows_read > 3000) console.warn(`/api/hourly branch=${branch} from=${from} to=${to} rows_read=${meta.rows_read}`);
  return json(toHourly(results));
}

interface Route<Q extends Record<string, number>> {
  ttl: number;
  parse: (params: URLSearchParams, env: Env) => Parsed<Q>;
  handler: (q: Q, env: Env) => Promise<Response>;
}

const route = <Q extends Record<string, number>>(r: Route<Q>) => r as unknown as Route<Record<string, number>>;

const ROUTES = new Map<string, Route<Record<string, number>>>([
  ["/api/studios", route({ ttl: 86400, parse: () => ok({}), handler: studios })],
  ["/api/now", route({ ttl: 60, parse: (p, env) => parseNowQuery(p, env.STUDIOS, Math.floor(Date.now() / 1000)), handler: now })],
  ["/api/hourly", route({ ttl: 300, parse: (p, env) => parseHourlyQuery(p, env.STUDIOS), handler: hourly })],
]);

export function cacheKeyUrl(origin: string, pathname: string, q: Record<string, number>): string {
  const params = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
  const search = params.toString();
  return `${origin}${pathname}${search ? `?${search}` : ""}`;
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const r = ROUTES.get(url.pathname);
  if (!r) return json({ error: "not found" }, 404);
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { allow: "GET" });

  const q = r.parse(url.searchParams, env);
  if (!q.ok) return badRequest(q.error);

  // The Cache API is a no-op on workers.dev; it only takes effect on a custom domain.
  // Keying on the parsed values means junk params cannot force D1 reads.
  const cache = caches.default;
  const key = new Request(cacheKeyUrl(url.origin, url.pathname, q.value), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return restoreCacheControl(hit, `public, max-age=${r.ttl}`);

  let res: Response;
  try {
    res = await r.handler(q.value, env);
  } catch (err) {
    console.error(`${url.pathname}: ${err}`);
    return json({ error: "internal error" }, 500);
  }
  if (res.status === 200) {
    if (!res.headers.has("cache-control")) res.headers.set("cache-control", `public, max-age=${r.ttl}`);
    const stored = res.clone();
    stored.headers.set(ORIGINAL_CACHE_CONTROL, res.headers.get("cache-control")!);
    ctx.waitUntil(cache.put(key, stored));
  }
  return res;
}

// Cache hits come back with the zone's Browser Cache TTL (4 h by default) in place of our max-age.
const ORIGINAL_CACHE_CONTROL = "x-origin-cache-control";

export function restoreCacheControl(hit: Response, fallback: string): Response {
  const res = new Response(hit.body, hit);
  res.headers.set("cache-control", res.headers.get(ORIGINAL_CACHE_CONTROL) ?? fallback);
  res.headers.delete(ORIGINAL_CACHE_CONTROL);
  return res;
}
