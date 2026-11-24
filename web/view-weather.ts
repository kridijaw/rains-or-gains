import * as Plot from "@observablehq/plot";
import { fmtDateTime, fmtTime, theme, type LegendItem } from "./chart";
import { dailyPrecipitation, hourOfDay } from "./series";
import { addDays, berlin, lastDays, startOfDay } from "./time";
import type { RangeDays } from "./view-week";
import type { WeatherHour } from "./weather";

/** Value extents shared by every range, so switching ranges keeps the axes. */
export interface WeatherScale {
  tempLo: number;
  tempHi: number;
  mmPerHour: number;
  mmPerDay: number;
}

/** Weather drawn into an occupancy chart: marks on the % scale, legend keys and tooltip points. */
export interface WeatherLayer {
  marks: Plot.Markish[];
  keys: LegendItem[];
  /** One per hourly temperature, in the chart's x, for tooltips where there is no occupancy. */
  points: { x: number; y: number; title: string }[];
}

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
const DOTTED = { strokeDasharray: "0.5,4", strokeLinecap: "round" } as const;
const round = (v: number) => Math.round(v * 10) / 10;

// °C and mm are mapped onto the % axis, one tick per 20% gridline, so all three axes share one grid.
function overlayScales({ tempLo: lo, tempHi: hi }: WeatherScale, maxMm: number, yMax: number) {
  const n = yMax / 20;
  const tStep = NICE.find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= n) ?? 100;
  const used = Math.max(1, Math.ceil(hi / tStep) - Math.floor(lo / tStep));
  const t0 = (Math.floor(lo / tStep) - Math.floor((n - used) / 2)) * tStep;
  // Rain keeps to the lower half, so its bars stay under the occupancy line instead of filling the frame.
  const mmN = Math.max(2, Math.floor(n / 2));
  const mmStep = NICE.find((s) => s * mmN >= maxMm) ?? 100;
  return {
    tempTicks: Array.from({ length: n + 1 }, (_, i) => round(t0 + i * tStep)),
    mmTicks: Array.from({ length: mmN + 1 }, (_, i) => round(i * mmStep)),
    tempY: (t: number) => ((t - t0) / tStep) * 20,
    mmY: (mm: number) => (mm / mmStep) * 20,
  };
}

function axes(o: ReturnType<typeof overlayScales>, unit: string, dry: boolean): Plot.Markish[] {
  const c = theme();
  return [
    Plot.axisY(o.tempTicks.map(o.tempY), {
      anchor: "right",
      label: "°C",
      labelArrow: "none",
      labelOffset: 30,
      color: c.temperature,
      tickFormat: (_: unknown, i: number) => String(o.tempTicks[i]),
    }),
    dry
      ? null
      : Plot.axisY(o.mmTicks.map(o.mmY), {
          anchor: "right",
          dx: 40,
          label: unit,
          labelArrow: "none",
          color: c.rain,
          tickFormat: (_: unknown, i: number) => String(o.mmTicks[i]),
        }),
  ];
}

const withTemp = (weather: WeatherHour[]) => weather.filter((w): w is WeatherHour & { temperature: number } => w.temperature !== null);

function rangeData(weather: WeatherHour[], days: RangeDays, now: number) {
  const { from, to } = lastDays(days, now);
  const shown = weather.filter((w) => w.ts >= from && w.ts <= to);
  const bars =
    days === 7
      ? shown
          .filter((w) => w.precipitation !== null)
          .map((w) => ({ x1: w.ts - 3600, x2: w.ts, mm: w.precipitation as number }))
      : dailyPrecipitation(shown)
          .filter((d) => d.end > from)
          .map((d) => ({ x1: Math.max(from, d.start), x2: d.end, mm: d.precipitation ?? 0 }));
  return { shown, bars };
}

function todayData(weather: WeatherHour[], now: number) {
  const date = berlin(now).date;
  const from = startOfDay(date);
  const to = startOfDay(addDays(date, 1));
  const bars = weather
    .filter((w) => w.ts > from && w.precipitation !== null)
    .map((w) => ({ x1: w.ts - 3600, x2: w.ts, mm: w.precipitation as number, forecast: w.ts > now }));
  return { from, to, bars };
}

export function weatherScale(
  now: number,
  today: WeatherHour[] | null,
  history: WeatherHour[] | null,
  ranges: readonly RangeDays[],
): WeatherScale {
  const temps: number[] = [];
  const perHour = [0.5];
  const perDay = [0.5];
  if (today) {
    temps.push(...withTemp(today).map((w) => w.temperature));
    perHour.push(...todayData(today, now).bars.map((b) => b.mm));
  }
  for (const days of history ? ranges : []) {
    const { shown, bars } = rangeData(history!, days, now);
    temps.push(...withTemp(shown).map((w) => w.temperature));
    (days === 7 ? perHour : perDay).push(...bars.map((b) => b.mm));
  }
  return {
    tempLo: temps.length ? Math.min(...temps) : 0,
    tempHi: temps.length ? Math.max(...temps) : 10,
    mmPerHour: Math.max(...perHour),
    mmPerDay: Math.max(...perDay),
  };
}

function precipKey(perDay: boolean): LegendItem {
  return { label: perDay ? "Precipitation, mm per day" : "Precipitation, mm per hour", key: "bar", color: theme().rain };
}

/** Weather for the 7 and 30 day charts, whose x is a timestamp. */
export function rangeWeather(weather: WeatherHour[], days: RangeDays, now: number, scale: WeatherScale, yMax: number): WeatherLayer {
  const c = theme();
  const { shown, bars } = rangeData(weather, days, now);
  const hourlyBars = days === 7;
  const dry = bars.every((b) => b.mm === 0);
  const o = overlayScales(scale, hourlyBars ? scale.mmPerHour : scale.mmPerDay, yMax);
  const temps = withTemp(shown);
  const barAt = (ts: number) => bars.find((b) => ts > b.x1 && ts <= b.x2);
  const marks: Plot.Markish[] = [
    ...axes(o, hourlyBars ? "mm/h" : "mm/day", dry),
    Plot.rectY(dry ? [] : bars, {
      x1: "x1",
      x2: "x2",
      y1: 0,
      y2: (b) => o.mmY(b.mm),
      fill: c.rain,
      fillOpacity: 0.45,
      insetLeft: hourlyBars ? 0.5 : 1,
      insetRight: hourlyBars ? 0.5 : 1,
      ry2: hourlyBars ? 0 : 3,
      className: "grow",
    }),
    Plot.line(shown, { x: "ts", y: (w: WeatherHour) => (w.temperature === null ? NaN : o.tempY(w.temperature)), stroke: c.temperature, strokeWidth: 1.5, className: "reveal" }),
  ];
  const points = temps.map((w) => {
    const mm = barAt(w.ts)?.mm ?? 0;
    const title = `${fmtDateTime(w.ts)}\n${w.temperature} °C` + (mm > 0 ? `\n${mm.toFixed(1)} ${hourlyBars ? "mm in this hour" : "mm that day"}` : "");
    return { x: w.ts, y: o.tempY(w.temperature), title };
  });
  const keys: LegendItem[] = [{ label: "Temperature, °C", key: "line", color: c.temperature }, precipKey(!hourlyBars)];
  return { marks, keys, points };
}

/** Weather for today's chart, whose x is the hour of the day; the forecast for the rest of the day is dotted. */
export function todayWeather(weather: WeatherHour[], now: number, hours: { lo: number; hi: number }, scale: WeatherScale, yMax: number): WeatherLayer {
  const { lo, hi } = hours;
  const c = theme();
  const { to, bars: dayBars } = todayData(weather, now);
  const hourX = (ts: number) => (ts >= to ? 24 : hourOfDay(ts));
  const inDay = (x: number) => x >= lo && x <= hi;
  // The DST fall-back day repeats an hour; keep its first pass so the line never runs backwards.
  const pts = withTemp(weather)
    .map((w) => ({ ...w, x: hourX(w.ts) }))
    .filter((w, i, all) => i === 0 || w.x > all[i - 1].x);
  const shown = pts.filter((w) => inDay(w.x));
  const bars = dayBars.map((b) => ({ ...b, h2: hourX(b.x2) })).filter((b) => inDay(b.h2 - 1) && inDay(b.h2));
  const dry = bars.every((b) => b.mm === 0);
  const past = shown.filter((w) => w.ts <= now);
  const ahead = shown.filter((w) => w.ts >= (past.at(-1)?.ts ?? -Infinity));
  const o = overlayScales(scale, scale.mmPerHour, yMax);
  const mmAt = (ts: number) => dayBars.find((b) => b.x2 === ts)?.mm ?? 0;
  const barMarks = (forecast: boolean) =>
    Plot.rectY(dry ? [] : bars.filter((b) => b.forecast === forecast), {
      x1: (b) => b.h2 - 1,
      x2: "h2",
      y1: 0,
      y2: (b) => o.mmY(b.mm),
      fill: c.rain,
      fillOpacity: forecast ? 0.15 : 0.45,
      ...(forecast ? { stroke: c.rain, strokeWidth: 1.5, ...DOTTED } : {}),
      inset: 1,
      className: "grow",
    });
  const tempY = (w: { temperature: number }) => o.tempY(w.temperature);
  const marks: Plot.Markish[] = [
    ...axes(o, "mm/h", dry),
    barMarks(false),
    barMarks(true),
    Plot.line(past, { x: "x", y: tempY, stroke: c.temperature, strokeWidth: 1.5, className: "reveal" }),
    Plot.line(ahead, { x: "x", y: tempY, stroke: c.temperature, strokeWidth: 1.5, ...DOTTED, className: "reveal reveal-late" }),
  ];
  const points = shown.map((w) => {
    const mm = mmAt(w.ts);
    const title = `${fmtTime(w.ts)}${w.ts > now ? ", forecast" : ""}\n${w.temperature} °C` + (mm > 0 ? `\n${mm.toFixed(1)} mm in the hour before` : "");
    return { x: w.x, y: tempY(w), title };
  });
  const keys: LegendItem[] = [{ label: "Temperature, °C", key: "line", color: c.temperature }, precipKey(false)];
  if (ahead.length > 1 || bars.some((b) => b.forecast && b.mm > 0)) keys.push({ label: "Forecast", key: "dotted", color: c.muted });
  return { marks, keys, points };
}

/** Weather rows keyed by the Berlin hour they cover (each row's precipitation is for the hour before its timestamp). */
export function weatherByHour(weather: WeatherHour[], date: string): Map<number, WeatherHour> {
  const byHour = new Map<number, WeatherHour>();
  for (const w of weather) {
    const b = berlin(w.ts - 3600);
    if (b.date === date && !byHour.has(b.hour)) byHour.set(b.hour, w);
  }
  return byHour;
}

/** Mean temperature and precipitation total per Berlin day. */
export function weatherByDay(weather: WeatherHour[]): Map<string, { temp: number | null; mm: number | null }> {
  const acc = new Map<string, { temps: number[]; mm: number | null }>();
  for (const w of weather) {
    const date = berlin(w.ts - 3600).date;
    let d = acc.get(date);
    if (!d) acc.set(date, (d = { temps: [], mm: null }));
    if (w.temperature !== null) d.temps.push(w.temperature);
    if (w.precipitation !== null) d.mm = (d.mm ?? 0) + w.precipitation;
  }
  return new Map(
    [...acc].map(([date, d]) => [date, { temp: d.temps.length ? d.temps.reduce((a, b) => a + b, 0) / d.temps.length : null, mm: d.mm }]),
  );
}

export const fmtTemp = (t: number | null | undefined): string => (t == null ? "n/a" : `${t.toFixed(1)} °C`);
export const fmtMm = (mm: number | null | undefined): string => (mm == null ? "n/a" : `${mm.toFixed(1)} mm`);
