import type { HourlyTuple, Profile } from "./api";
import { berlin } from "./time";

/** Distinct weeks of own data a weekday x hour cell needs before its mean replaces the FitX profile. */
export const MIN_WEEKS = 3;
export const MIN_FIT_HOURS = 12;

/**
 * own: mean of own hourly data.
 * profile-scaled: FitX profile times a fitted factor, comparable to percentage.
 * profile-relative: raw FitX profile, shape only (unknown unit).
 */
export type TypicalSource = "own" | "profile-scaled" | "profile-relative" | "none";

export interface CellStats {
  mean: number | null;
  n: number;
  /** Distinct dates, i.e. distinct weeks for this weekday */
  weeks: number;
}

export interface Typical {
  value: number | null;
  source: TypicalSource;
  weeks: number;
}

export interface TypicalModel {
  typical(weekday: number, hour: number): Typical;
  own: CellStats[][];
  profile: Profile | null;
  /** percentage ≈ scale × profile, null until MIN_FIT_HOURS overlap */
  scale: number | null;
  fitHours: number;
}

const grid = <T>(init: () => T): T[][] => Array.from({ length: 7 }, () => Array.from({ length: 24 }, init));

export const isProfile = (p: unknown): p is Profile =>
  Array.isArray(p) &&
  p.length === 7 &&
  p.every((row) => Array.isArray(row) && row.length === 24 && row.every((v) => typeof v === "number"));

export function cellStats(hourly: readonly HourlyTuple[]): CellStats[][] {
  const sum = grid(() => 0);
  const n = grid(() => 0);
  const dates = grid(() => new Set<string>());
  for (const [ts, avg, , count] of hourly) {
    if (avg === null || count <= 0) continue;
    const { date, weekday, hour } = berlin(ts);
    sum[weekday][hour] += avg * count;
    n[weekday][hour] += count;
    dates[weekday][hour].add(date);
  }
  return sum.map((row, d) =>
    row.map((s, h) => ({ mean: n[d][h] ? s / n[d][h] : null, n: n[d][h], weeks: dates[d][h].size })),
  );
}

// Least squares, weighted by sample count, over hours where both exist.
export function fitScale(hourly: readonly HourlyTuple[], profile: Profile): { scale: number | null; hours: number } {
  let num = 0;
  let den = 0;
  let hours = 0;
  for (const [ts, avg, , n] of hourly) {
    if (avg === null || n <= 0) continue;
    const { weekday, hour } = berlin(ts);
    const p = profile[weekday][hour];
    if (!(p > 0)) continue;
    num += n * avg * p;
    den += n * p * p;
    hours++;
  }
  return { scale: hours >= MIN_FIT_HOURS && den > 0 ? num / den : null, hours };
}

export function buildTypical(hourly: readonly HourlyTuple[], profile: unknown): TypicalModel {
  const own = cellStats(hourly);
  const prof = isProfile(profile) ? profile : null;
  const { scale, hours } = prof ? fitScale(hourly, prof) : { scale: null, hours: 0 };

  return {
    own,
    profile: prof,
    scale,
    fitHours: hours,
    typical(weekday, hour) {
      const cell = own[weekday]?.[hour];
      if (!cell) return { value: null, source: "none", weeks: 0 };
      if (cell.mean !== null && cell.weeks >= MIN_WEEKS) return { value: cell.mean, source: "own", weeks: cell.weeks };
      const p = prof?.[weekday][hour];
      if (p === undefined) return { value: null, source: "none", weeks: cell.weeks };
      if (scale !== null) return { value: p * scale, source: "profile-scaled", weeks: cell.weeks };
      return { value: p, source: "profile-relative", weeks: cell.weeks };
    },
  };
}

export const typicalDay = (model: TypicalModel, weekday: number): Typical[] =>
  Array.from({ length: 24 }, (_, h) => model.typical(weekday, h));

/** Berlin hours [open, close) of a weekday. */
export interface OpenHours {
  open: number;
  close: number;
}

// Own data only counts once the weekday was observed nearly all day, else one evening would crop the chart to it.
const MIN_OBSERVED_HOURS = 20;

export function openHours(model: Pick<TypicalModel, "profile" | "own">, weekday: number): OpenHours | null {
  const span = (open: boolean[]): OpenHours | null => {
    const first = open.indexOf(true);
    return first < 0 ? null : { open: first, close: open.lastIndexOf(true) + 1 };
  };
  const profileRow = model.profile?.[weekday];
  if (profileRow) return span(profileRow.map((v) => v > 0));
  const own = model.own[weekday];
  if (!own || own.filter((s) => s.mean !== null).length < MIN_OBSERVED_HOURS) return null;
  return span(own.map((s) => (s.mean ?? 0) >= 1));
}
