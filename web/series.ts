import type { HourlyTuple, LatestSample } from "./api";
import { dayKind, type Holiday, holidayCalendar } from "./holidays";
import { addDays, berlin, daysBetween, hourFloor, startOfDay } from "./time";
import type { TypicalModel, TypicalSource } from "./typical";
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
  residual: number;
  n: number;
  source: TypicalSource;
  temperature: number | null;
  precipitation: number | null;
  day: DayGroup;
}

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
    if (t.value === null || !isComparable(t.source)) continue;
    const w = weatherAt.get(ts + 3600);
    const kind = dayKind(calendar, date);
    rows.push({
      ts,
      avg,
      typical: t.value,
      residual: avg - t.value,
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
  mean: number | null;
  median: number | null;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function groupStats<T, G extends string>(
  rows: readonly T[],
  groups: readonly G[],
  groupOf: (row: T) => G | null,
  value: (row: T) => number,
): GroupStats<G>[] {
  const buckets = new Map<G, number[]>(groups.map((g) => [g, []]));
  for (const row of rows) {
    const g = groupOf(row);
    if (g !== null) buckets.get(g)?.push(value(row));
  }
  return groups.map((group) => {
    const values = buckets.get(group) ?? [];
    return {
      group,
      n: values.length,
      mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      median: median(values),
    };
  });
}
