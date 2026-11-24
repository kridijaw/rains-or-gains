import * as Plot from "@observablehq/plot";
import type { HourlyTuple } from "./api";
import {
  chartBlock,
  dataTable,
  fmtDate,
  fmtDateTime,
  fmtDayMonth,
  fmtPct,
  fmtSigned,
  fmtWeekdayDay,
  legend,
  MARGIN,
  MARGIN_X,
  LABELLED,
  labelledHeight,
  percentAxis,
  message,
  el,
  theme,
  tipColumns,
  weatherTipLine,
  type LegendItem,
} from "./chart";
import { dayKind, holidayCalendar, type Holiday } from "./holidays";
import { dayTicks, hourSeries, usualValue } from "./series";
import { addDays, berlin, lastDays, startOfDay } from "./time";
import { openHours, type TypicalModel } from "./typical";
import { fmtMm, fmtTemp, rangeWeather, weatherByDay, type WeatherScale } from "./view-weather";
import type { WeatherHour } from "./weather";

export const RANGES = [7, 30] as const;
export type RangeDays = (typeof RANGES)[number];

export interface WeekInput {
  /** End of the window: the current time, or the last second of a past day. */
  now: number;
  /** The window ends on a past day instead of now. */
  past?: boolean;
  days: RangeDays;
  hourly: HourlyTuple[];
  model: TypicalModel;
  holidays: Holiday[] | string | null;
  /** Hourly weather; a string is a load error. */
  weather: WeatherHour[] | string | null;
  weatherScale: WeatherScale;
  width: number;
  /** Top of the % axis, shared with the other ranges. */
  yMax: number;
}

type WeekData = Pick<WeekInput, "now" | "days" | "hourly" | "model">;

function weekPoints({ now, days, hourly, model }: WeekData) {
  const { from, to } = lastDays(days, now);
  const firstData = hourly.find((r) => r[1] !== null)?.[0] ?? Infinity;
  const pts = hourSeries(hourly, from, to, usualValue(model)).map((p) => ({
    ...p,
    mid: p.ts + 1800,
    typical: p.ts >= startOfDay(berlin(firstData === Infinity ? to : firstData).date) ? p.typical : null,
  }));
  return { pts, withData: pts.filter((p): p is typeof p & { avg: number } => p.avg !== null) };
}

/** Highest % the chart for this range shows. */
export function weekPeak(input: WeekData): number {
  const { pts, withData } = weekPoints(input);
  return Math.max(...withData.map((p) => p.avg), ...pts.map((p) => p.typical ?? 0));
}

// Night shading turns into noise at 30 days, so only the 7 day view gets it.
function closedSpans(model: TypicalModel, from: number, to: number): { x1: number; x2: number }[] {
  const spans: { x1: number; x2: number }[] = [];
  for (let date = berlin(from).date; startOfDay(date) < to; date = addDays(date, 1)) {
    const h = openHours(model, berlin(startOfDay(date) + 12 * 3600).weekday);
    if (!h) continue;
    const start = startOfDay(date);
    const end = startOfDay(addDays(date, 1));
    if (h.open > 0) spans.push({ x1: start, x2: start + h.open * 3600 });
    if (h.close < 24) spans.push({ x1: start + h.close * 3600, x2: end });
  }
  return spans.map((s) => ({ x1: Math.max(from, s.x1), x2: Math.min(to, s.x2) })).filter((s) => s.x2 > s.x1);
}

export function xAxis(from: number, to: number, days: RangeDays, width: number) {
  return {
    domain: [from, to],
    ticks: dayTicks(from, to, Math.floor((width - MARGIN.marginLeft) / 64)),
    tickFormat: days === 7 ? fmtWeekdayDay : fmtDayMonth,
    label: null,
  };
}

export function weekBlocks(input: WeekInput): HTMLElement[] {
  const { now, days, model, holidays, width, yMax } = input;
  const c = theme();
  const { from, to } = lastDays(days, now);
  const x = xAxis(from, to, days, width);
  const blocks: (HTMLElement | null)[] = [];

  const { pts, withData } = weekPoints(input);
  const hasBand = pts.some((p) => p.typical !== null);
  const holidayList = Array.isArray(holidays) ? holidays : [];
  const school = holidayList
    .filter((h) => h.kind === "school")
    .map((h) => ({ ...h, x1: Math.max(from, startOfDay(h.start)), x2: Math.min(to, startOfDay(addDays(h.end, 1))) }))
    .filter((h) => h.x2 > h.x1);
  const publicDays = holidayList
    .filter((h) => h.kind === "public")
    .map((h) => ({ ...h, x: startOfDay(h.start) + 12 * 3600 }))
    .filter((h) => h.x >= from && h.x <= to);
  const closed = days === 7 ? closedSpans(model, from, to) : [];
  const weather = Array.isArray(input.weather) ? input.weather : null;
  const weatherByTs = new Map((weather ?? []).map((w) => [w.ts, w]));
  const layer = weather && rangeWeather(weather, days, now, input.weatherScale, yMax);
  const tips = withData.map((p) => ({
    x: p.mid,
    y: p.avg,
    title:
      `${fmtDateTime(p.ts)}\nMean\t${fmtPct(p.avg)}\nMax\t${p.max}%` +
      (p.typical === null ? "" : `\nUsual\t${fmtPct(p.typical)} (${fmtSigned(Math.round(p.avg) - Math.round(p.typical), "", 0)})`) +
      weatherTipLine(weatherByTs.get(p.ts + 3600)) +
      (p.n < 12 ? `\n${p.n} of 12 samples` : ""),
  }));
  const covered = new Set(withData.map((p) => p.ts));
  for (const p of layer?.points ?? []) if (!covered.has(p.x - 3600)) tips.push(p);

  if (withData.length === 0) {
    blocks.push(message(input.past ? `No occupancy data in these ${days} days.` : `No occupancy data in the last ${days} days yet.`));
  }

  const occupancy = Plot.plot({
    width,
    height: labelledHeight(yMax / 20),
    ...MARGIN_X,
    ...LABELLED,
    x,
    y: { domain: [0, yMax] },
    marks: [
      ...percentAxis(yMax),
      Plot.rect(closed, { x1: "x1", x2: "x2", fill: c.neutral, fillOpacity: 0.1 }),
      Plot.rect(school, {
        x1: "x1",
        x2: "x2",
        y1: yMax * 0.965,
        y2: yMax,
        fill: c.neutral,
        fillOpacity: 0.6,
        title: (h) => `${h.name}\n${fmtDate(startOfDay(h.start))} to ${fmtDate(startOfDay(h.end))}`,
      }),
      Plot.ruleX(publicDays, { x: "x", stroke: c.faint, strokeWidth: 1 }),
      Plot.dot(publicDays, {
        x: "x",
        y: yMax,
        symbol: "triangle",
        rotate: 180,
        r: 4,
        fill: c.muted,
        title: (h) => `${h.name}, ${fmtDate(h.x)}`,
      }),
      Plot.ruleY([0], { stroke: c.baseline }),
      ...(layer?.marks ?? []),
      Plot.areaY(pts, { x: "mid", y: "typical", fill: c.occupancy, fillOpacity: 0.14, curve: "step", className: "fade" }),
      Plot.line(pts, { x: "mid", y: "avg", stroke: c.occupancy, strokeWidth: days === 7 ? 2 : 1.5, className: "reveal" }),
      Plot.ruleX(tips, Plot.pointerX({ x: "x", stroke: c.faint })),
      Plot.tip(tips, Plot.pointerX({ x: "x", y: "y", title: "title", render: tipColumns })),
    ],
  });

  const keys: LegendItem[] = [{ label: "Hourly mean", key: "line", color: c.occupancy }];
  if (hasBand) keys.push({ label: "Usual", key: "wash", color: c.occupancy });
  keys.push(...(layer?.keys ?? []));
  if (school.length) keys.push({ label: "School holidays", key: "ribbon", color: c.neutral });
  if (publicDays.length) keys.push({ label: "Public holiday", key: "triangle", color: c.muted });
  if (closed.length) keys.push({ label: "Closed", key: "wash", color: c.neutral });
  blocks.push(chartBlock(null, occupancy, el("div", { className: "chart-foot" }, legend(keys))));
  if (typeof holidays === "string") blocks.push(message(`Holidays unavailable: ${holidays}`, "error small"));
  if (typeof input.weather === "string") blocks.push(message(`Weather unavailable: ${input.weather}`, "error small"));

  blocks.push(dayTable(input, from, to));
  return blocks.filter((b): b is HTMLElement => b !== null);
}

function dayTable({ hourly, holidays, weather }: WeekInput, from: number, to: number): HTMLElement {
  const days = new Map<string, { sum: number; n: number; max: number }>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { sum: 0, n: 0, max: -Infinity }));
    return d;
  };
  for (const [ts, avg, max, n] of hourly) {
    if (ts < from || ts >= to || avg === null) continue;
    const d = day(berlin(ts).date);
    d.sum += avg * n;
    d.n += n;
    d.max = Math.max(d.max, max ?? -Infinity);
  }
  const calendar = holidayCalendar(Array.isArray(holidays) ? holidays : []);
  const weatherDays = weatherByDay(Array.isArray(weather) ? weather.filter((w) => w.ts > from && w.ts <= to) : []);
  const rows = [...new Set([...days.keys(), ...weatherDays.keys()])]
    .filter((date) => date >= berlin(from).date && date <= berlin(to - 1).date)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((date) => {
      const d = days.get(date);
      const w = weatherDays.get(date);
      const kind = dayKind(calendar, date);
      const names = (calendar.get(date) ?? []).map((h) => h.name).join(", ");
      return [
        fmtDate(startOfDay(date)),
        d?.n ? fmtPct(d.sum / d.n) : "n/a",
        d && Number.isFinite(d.max) ? `${d.max}%` : "n/a",
        fmtTemp(w?.temp),
        fmtMm(w?.mm),
        kind ? `${kind === "public" ? "Public" : "School"}: ${names}` : "",
      ];
    });
  return dataTable("Days as a table", ["Day", "Mean", "Max", "Temp.", "Precip.", "Holiday"], rows);
}
