import type { HourlyTuple, LatestSample } from "./api";
import { dayKind, type Holiday, holidayCalendar } from "./holidays";
import { addDays, berlin, daysBetween, hourFloor, startOfDay } from "./time";
import { MIN_WEEKS, openHours, type OpenHours, type TypicalModel, type TypicalSource } from "./typical";
import type { WeatherHour } from "./weather";

export const STALE_AFTER = 15 * 60;

/** Own means and the scaled profile share the percentage axis; the raw profile does not. */
export const isComparable = (source: TypicalSource): boolean => source === "own" || source === "profile-scaled";

export const usualValue =
  (model: Pick<TypicalModel, "typical">) =>
  (weekday: number, hour: number): number | null => {
    const t = model.typical(weekday, hour);
    return isComparable(t.source) ? t.value : null;
  };

export const hourOfDay = (ts: number): number => berlin(ts).hour + (ts - hourFloor(ts)) / 3600;

const TERMS: Record<string, string> = {
  low: "Not busy",
  medium: "Moderately busy",
  high: "Busy",
  vhigh: "Very busy",
  full: "Full",
};

export const termLabel = (term: string | null): string | null => (term === null ? null : (TERMS[term] ?? term));

export type Freshness =
  | { state: "none" }
  | { state: "ok" | "stale" | "error" | "hidden"; age: number };

export function freshness(latest: LatestSample | null, now: number): Freshness {
  if (!latest) return { state: "none" };
  const age = Math.max(0, now - latest.ts);
  if (latest.error) return { state: "error", age };
  if (age > STALE_AFTER) return { state: "stale", age };
  if (latest.hidden || latest.percentage === null) return { state: "hidden", age };
  return { state: "ok", age };
}

export function lastGood(samples: readonly [number, number | null][]): { ts: number; percentage: number } | null {
  for (let i = samples.length - 1; i >= 0; i--) {
    const [ts, percentage] = samples[i];
    if (percentage !== null) return { ts, percentage };
  }
  return null;
}

export function dayTicks(from: number, to: number, maxTicks: number): number[] {
  const first = berlin(from).date;
  const days = daysBetween(first, berlin(to).date) + 1;
  const step = [1, 2, 7, 14, 28].find((s) => Math.ceil(days / s) <= Math.max(1, maxTicks)) ?? 28;
  const ticks: number[] = [];
  for (let i = 0; i <= days; i += step) {
    const t = startOfDay(addDays(first, i));
    if (t >= from && t <= to) ticks.push(t);
  }
  return ticks;
}

export interface HourPoint {
  ts: number;
  avg: number | null;
  max: number | null;
  n: number;
  typical: number | null;
}

// Hours without a row get avg null so lines break there.
export function hourSeries(
  hourly: readonly HourlyTuple[],
  from: number,
  to: number,
  usual: (weekday: number, hour: number) => number | null,
): HourPoint[] {
  const byTs = new Map(hourly.map((row) => [row[0], row]));
  const points: HourPoint[] = [];
  for (let ts = hourFloor(from); ts < to; ts += 3600) {
    const row = byTs.get(ts);
    const { weekday, hour } = berlin(ts);
    points.push({
      ts,
      avg: row?.[1] ?? null,
      max: row?.[2] ?? null,
      n: row?.[3] ?? 0,
      typical: usual(weekday, hour),
    });
  }
  return points;
}

export function dataDays(hourly: readonly HourlyTuple[], now: number): number {
  const first = hourly.find((r) => r[1] !== null);
  return first ? daysBetween(berlin(first[0]).date, berlin(now).date) + 1 : 0;
}

export interface DayTotal {
  date: string;
  start: number;
  end: number;
  precipitation: number | null;
}

/** Precipitation summed per Berlin day; Open-Meteo hour `ts` covers [ts - 1h, ts). */
export function dailyPrecipitation(weather: readonly WeatherHour[]): DayTotal[] {
  const days = new Map<string, DayTotal>();
  for (const h of weather) {
    if (h.precipitation === null) continue;
    const date = berlin(h.ts - 3600).date;
    let day = days.get(date);
    if (!day) {
      day = { date, start: startOfDay(date), end: startOfDay(addDays(date, 1)), precipitation: 0 };
      days.set(date, day);
    }
    day.precipitation = (day.precipitation ?? 0) + h.precipitation;
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}

export const RAIN_BUCKETS = ["Dry", "Under 1 mm", "1 mm or more"] as const;
export type RainBucket = (typeof RAIN_BUCKETS)[number];
export const rainBucket = (mm: number): RainBucket => (mm <= 0 ? "Dry" : mm < 1 ? "Under 1 mm" : "1 mm or more");

export const DAY_GROUPS = ["Normal day", "School holiday", "Public holiday"] as const;
export type DayGroup = (typeof DAY_GROUPS)[number];

export interface Residual {
  ts: number;
  avg: number;
  typical: number;
  /** Hourly mean relative to usual, in % of usual */
  residual: number;
  n: number;
  source: TypicalSource;
  temperature: number | null;
  precipitation: number | null;
  day: DayGroup;
}

// Below this the relative residual is mostly rounding noise: 1 point on a usual 3% reads as 33%.
export const MIN_USUAL_PCT = 10;

// Weather joins on ts + 3600: Open-Meteo's precipitation at hour h covers the hour before h.
export function residuals(
  hourly: readonly HourlyTuple[],
  model: Pick<TypicalModel, "typical">,
  weather: readonly WeatherHour[],
  holidays: readonly Holiday[],
): Residual[] {
  const weatherAt = new Map(weather.map((w) => [w.ts, w]));
  const calendar = holidayCalendar(holidays);
  const rows: Residual[] = [];
  for (const [ts, avg, , n] of hourly) {
    if (avg === null || n <= 0) continue;
    const { date, weekday, hour } = berlin(ts);
    const t = model.typical(weekday, hour);
    if (t.value === null || !isComparable(t.source) || t.value < MIN_USUAL_PCT) continue;
    const w = weatherAt.get(ts + 3600);
    const kind = dayKind(calendar, date);
    rows.push({
      ts,
      avg,
      typical: t.value,
      residual: ((avg - t.value) / t.value) * 100,
      n,
      source: t.source,
      temperature: w?.temperature ?? null,
      precipitation: w?.precipitation ?? null,
      day: kind === "public" ? "Public holiday" : kind === "school" ? "School holiday" : "Normal day",
    });
  }
  return rows;
}

export interface GroupStats<G extends string> {
  group: G;
  n: number;
  /** Distinct dates among the n rows; hours of one day are not independent. */
  days: number;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
}

/** Linear-interpolated quantile of an ascending array. */
const quantile = (sorted: number[], p: number): number | null => {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

export function groupStats<T, G extends string>(
  rows: readonly T[],
  groups: readonly G[],
  groupOf: (row: T) => G | null,
  value: (row: T) => number,
  dateOf: (row: T) => string,
): GroupStats<G>[] {
  const buckets = new Map<G, { values: number[]; dates: Set<string> }>(groups.map((g) => [g, { values: [], dates: new Set() }]));
  for (const row of rows) {
    const g = groupOf(row);
    const b = g === null ? undefined : buckets.get(g);
    if (!b) continue;
    b.values.push(value(row));
    b.dates.add(dateOf(row));
  }
  return groups.map((group) => {
    const { values, dates } = buckets.get(group) ?? { values: [], dates: new Set() };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      group,
      n: values.length,
      days: dates.size,
      mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      median: quantile(sorted, 0.5),
      q1: quantile(sorted, 0.25),
      q3: quantile(sorted, 0.75),
    };
  });
}

export interface Slot {
  hour: number;
  v: number;
}

export interface Outlook {
  state: "before" | "open" | "after";
  hours: OpenHours;
  /** Rest of today, from now to the last open hour; x is the Berlin hour of day. */
  expected: { x: number; v: number }[];
  /** Quietest hour left, only if clearly quieter than now. */
  best: Slot | null;
  /** First hour clearly quieter than now. */
  quieterFrom: Slot | null;
  peak: Slot | null;
}

/** Hours over which today's difference from usual fades back to the usual curve. */
export const OUTLOOK_DECAY_H = 1.5;
const QUIETER_BY = 10;
const BEST_BY = 5;

export function outlook(
  usual: readonly (number | null)[],
  hours: OpenHours | null,
  nowX: number,
  current: number | null,
): Outlook | null {
  if (usual.every((v) => v === null)) return null;
  const h = hours ?? { open: 0, close: 24 };
  const state = nowX < h.open ? "before" : nowX >= h.close ? "after" : "open";
  const here = usual[Math.floor(nowX)] ?? null;
  const shift = state === "open" && current !== null && here !== null ? current - here : 0;
  const at = (x: number): number | null => {
    const u = usual[Math.floor(x)] ?? null;
    return u === null ? null : Math.max(0, u + shift * Math.exp(-(x - nowX) / OUTLOOK_DECAY_H));
  };

  const slots: Slot[] = [];
  if (state !== "after")
    for (let hour = Math.max(h.open, Math.floor(nowX) + 1); hour < h.close; hour++) {
      const v = at(hour + 0.5);
      if (v !== null) slots.push({ hour, v });
    }
  const expected: { x: number; v: number }[] = [];
  if (state === "open") {
    const start = current ?? at(nowX);
    if (start !== null) expected.push({ x: nowX, v: start });
    if (Math.floor(nowX) + 0.5 > nowX && here !== null) expected.push({ x: Math.floor(nowX) + 0.5, v: at(Math.floor(nowX) + 0.5)! });
    expected.push(...slots.map((s) => ({ x: s.hour + 0.5, v: s.v })));
  }

  const ref = state === "open" ? current : null;
  const min = slots.reduce<Slot | null>((a, s) => (a === null || s.v < a.v ? s : a), null);
  const peak = slots.reduce<Slot | null>((a, s) => (a === null || s.v > a.v ? s : a), null);
  return {
    state,
    hours: h,
    expected,
    best: min && (ref === null || min.v <= ref - BEST_BY) ? min : null,
    quieterFrom: ref === null ? null : (slots.find((s) => s.v <= ref - QUIETER_BY) ?? null),
    peak,
  };
}

/** Days of own data before the weather comparison is worth reading. */
export const EFFECT_DAYS = 28;

export interface DataProgress {
  /** Berlin date of the first own sample */
  since: string | null;
  days: number;
  profile: boolean;
  fitHours: number;
  /** The usual value is on the percentage scale somewhere (scaled profile or own means). */
  onScale: boolean;
  /** Share of open weekday x hour cells whose usual value comes from own data. */
  ownShare: number;
  ownCompleteFrom: string | null;
  comparableHours: number;
  effectFrom: string | null;
}

export function dataProgress(hourly: readonly HourlyTuple[], model: TypicalModel, now: number): DataProgress {
  const first = hourly.find((r) => r[1] !== null);
  const since = first ? berlin(first[0]).date : null;
  let open = 0;
  let own = 0;
  for (let d = 0; d < 7; d++) {
    const h = openHours(model, d) ?? { open: 0, close: 24 };
    for (let hour = h.open; hour < h.close; hour++) {
      open++;
      if (model.own[d][hour].weeks >= MIN_WEEKS) own++;
    }
  }
  const usual = usualValue(model);
  const comparableHours = hourly.filter(([ts, avg, , n]) => {
    if (avg === null || n <= 0) return false;
    const { weekday, hour } = berlin(ts);
    return usual(weekday, hour) !== null;
  }).length;
  return {
    since,
    days: dataDays(hourly, now),
    profile: model.profile !== null,
    fitHours: model.fitHours,
    onScale: model.scale !== null || own > 0,
    ownShare: open ? own / open : 0,
    // The first day is partial, so the last weekday sees its third full day 3 weeks later.
    ownCompleteFrom: since && addDays(since, 7 * MIN_WEEKS),
    comparableHours,
    effectFrom: since && addDays(since, EFFECT_DAYS),
  };
}
