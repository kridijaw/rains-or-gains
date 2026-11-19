import * as Plot from "@observablehq/plot";
import {
  chartBlock,
  dataTable,
  el,
  LABELLED,
  labelledHeight,
  fmtDate,
  fmtDateTime,
  fmtHour,
  fmtTime,
  hourTicks,
  legend,
  message,
  theme,
  type LegendKey,
} from "./chart";
import { dailyPrecipitation } from "./series";
import { addDays, berlin, lastDays, startOfDay } from "./time";
import { MARGIN_X, xAxis, type RangeDays } from "./view-week";
import type { WeatherHour } from "./weather";

export interface WeatherInput {
  now: number;
  days: RangeDays;
  weather: WeatherHour[];
  width: number;
  picker: HTMLElement;
}

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

// Both weather axes get the same number of intervals so their ticks share one grid.
function weatherScales(temps: number[], maxMm: number) {
  const lo = temps.length ? Math.min(...temps) : 0;
  const hi = temps.length ? Math.max(...temps) : 10;
  const tStep = NICE.find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= 5) ?? 100;
  const t0 = Math.floor(lo / tStep) * tStep;
  const n = Math.max(1, Math.ceil(hi / tStep) - Math.floor(lo / tStep));
  const mmStep = NICE.find((s) => s * n >= maxMm) ?? 100;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    domain: [t0, t0 + n * tStep],
    tempTicks: Array.from({ length: n + 1 }, (_, i) => round(t0 + i * tStep)),
    mmTicks: Array.from({ length: n + 1 }, (_, i) => round(i * mmStep)),
    toY: (mm: number) => t0 + (mm / mmStep) * tStep,
  };
}

export function renderWeather(root: HTMLElement, input: WeatherInput): void {
  const { now, days, width } = input;
  const c = theme();
  const { from, to } = lastDays(days, now);
  const weather = input.weather.filter((w) => w.ts >= from && w.ts <= to);
  const hourlyBars = days === 7;
  const bars = hourlyBars
    ? weather
        .filter((w) => w.precipitation !== null)
        .map((w) => ({ x1: w.ts - 3600, x2: w.ts, mm: w.precipitation as number }))
    : dailyPrecipitation(weather)
        .filter((d) => d.end > from)
        .map((d) => ({ x1: Math.max(from, d.start), x2: d.end, mm: d.precipitation ?? 0 }));
  const dry = bars.every((b) => b.mm === 0);
  const temps = weather.filter((w): w is WeatherHour & { temperature: number } => w.temperature !== null);
  const { domain, tempTicks, mmTicks, toY } = weatherScales(
    temps.map((w) => w.temperature),
    Math.max(0.5, ...bars.map((b) => b.mm)),
  );
  const unit = hourlyBars ? "mm/h" : "mm/day";
  const barAt = (ts: number) => bars.find((b) => ts > b.x1 && ts <= b.x2);
  const tipText = (w: (typeof temps)[number]) => {
    const mm = barAt(w.ts)?.mm ?? 0;
    return `${fmtDateTime(w.ts)}\n${w.temperature} °C` + (mm > 0 ? `\n${mm.toFixed(1)} ${hourlyBars ? "mm in this hour" : "mm that day"}` : "");
  };
  const chart = Plot.plot({
    width,
    height: labelledHeight(tempTicks.length - 1),
    ...MARGIN_X,
    ...LABELLED,
    x: xAxis(from, to, days, width),
    y: { domain },
    marks: [
      Plot.gridY(tempTicks),
      Plot.axisY(tempTicks, { label: "°C" }),
      dry ? null : Plot.axisY(mmTicks.map(toY), { anchor: "right", label: unit, tickFormat: (_, i) => String(mmTicks[i]) }),
      Plot.rectY(dry ? [] : bars, {
        x1: "x1",
        x2: "x2",
        y1: domain[0],
        y2: (b) => toY(b.mm),
        fill: c.rain,
        insetLeft: hourlyBars ? 0.5 : 1,
        insetRight: hourlyBars ? 0.5 : 1,
        ry2: hourlyBars ? 0 : 3,
        className: "grow",
      }),
      Plot.line(weather, { x: "ts", y: "temperature", stroke: c.temperature, strokeWidth: 2, className: "reveal" }),
      Plot.ruleX(temps, Plot.pointerX({ x: "ts", stroke: c.faint })),
      Plot.tip(temps, Plot.pointerX({ x: "ts", y: "temperature", title: tipText })),
    ],
  });

  const keys: { label: string; key: LegendKey; color: string }[] = [{ label: "Temperature, °C", key: "line", color: c.temperature }];
  if (!dry) keys.push({ label: hourlyBars ? "Precipitation, mm per hour" : "Precipitation, mm per day", key: "bar", color: c.rain });
  root.replaceChildren(
    ...[
      chartBlock(
        null,
        chart,
        el("div", { className: "chart-foot" }, legend(keys), input.picker),
        dry && message("No precipitation in this period.", "muted small"),
      ),
      dayTable(weather, from, to),
    ],
  );
}

function dayTable(weather: WeatherHour[], from: number, to: number): HTMLElement {
  const days = new Map<string, { temp: number[]; mm: number | null }>();
  for (const w of weather) {
    const date = berlin(w.ts - 3600).date;
    let d = days.get(date);
    if (!d) days.set(date, (d = { temp: [], mm: null }));
    if (w.temperature !== null) d.temp.push(w.temperature);
    if (w.precipitation !== null) d.mm = (d.mm ?? 0) + w.precipitation;
  }
  const rows = [...days.entries()]
    .filter(([date]) => date >= berlin(from).date && date <= berlin(to - 1).date)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, d]) => [
      fmtDate(startOfDay(date)),
      d.temp.length ? `${(d.temp.reduce((a, b) => a + b, 0) / d.temp.length).toFixed(1)} °C` : "n/a",
      d.temp.length ? `${Math.min(...d.temp)} to ${Math.max(...d.temp)} °C` : "n/a",
      d.mm === null ? "n/a" : `${d.mm.toFixed(1)} mm`,
    ]);
  return dataTable("Days as a table", ["Day", "Mean temp.", "Range", "Precip."], rows);
}

export interface WeatherTodayInput {
  now: number;
  /** Midnight to midnight in Berlin, forecast included. */
  weather: WeatherHour[];
  width: number;
  picker: HTMLElement;
}

const DOTTED = { strokeDasharray: "0.5,4", strokeLinecap: "round" } as const;

export function renderWeatherToday(root: HTMLElement, input: WeatherTodayInput): void {
  const { now, weather, width } = input;
  const c = theme();
  const date = berlin(now).date;
  const from = startOfDay(date);
  const to = startOfDay(addDays(date, 1));
  const bars = weather
    .filter((w) => w.ts > from && w.precipitation !== null)
    .map((w) => ({ x1: w.ts - 3600, x2: w.ts, mm: w.precipitation as number, forecast: w.ts > now }));
  const dry = bars.every((b) => b.mm === 0);
  const temps = weather.filter((w): w is WeatherHour & { temperature: number } => w.temperature !== null);
  const past = temps.filter((w) => w.ts <= now);
  const ahead = temps.filter((w) => w.ts >= (past.at(-1)?.ts ?? -Infinity));
  const { domain, tempTicks, mmTicks, toY } = weatherScales(
    temps.map((w) => w.temperature),
    Math.max(0.5, ...bars.map((b) => b.mm)),
  );
  const tickHours = hourTicks(0, 24, width);
  const ticks = [];
  for (let ts = from; ts <= to; ts += 3600) if (tickHours.includes(berlin(ts).hour)) ticks.push(ts);
  const mmAt = (ts: number) => bars.find((b) => b.x2 === ts)?.mm ?? 0;
  const tipText = (w: (typeof temps)[number]) => {
    const mm = mmAt(w.ts);
    return `${fmtTime(w.ts)}${w.ts > now ? ", forecast" : ""}\n${w.temperature} °C` + (mm > 0 ? `\n${mm.toFixed(1)} mm in the hour before` : "");
  };
  const barMarks = (forecast: boolean) =>
    Plot.rectY(dry ? [] : bars.filter((b) => b.forecast === forecast), {
      x1: "x1",
      x2: "x2",
      y1: domain[0],
      y2: (b) => toY(b.mm),
      fill: c.rain,
      fillOpacity: forecast ? 0.25 : 1,
      ...(forecast ? { stroke: c.rain, strokeWidth: 1.5, ...DOTTED } : {}),
      inset: 1,
      className: "grow",
    });

  const chart = Plot.plot({
    width,
    height: labelledHeight(tempTicks.length - 1),
    ...MARGIN_X,
    ...LABELLED,
    x: { domain: [from, to], ticks, tickFormat: (ts: number) => fmtHour(berlin(ts).hour), label: null },
    y: { domain },
    marks: [
      Plot.gridY(tempTicks),
      Plot.axisY(tempTicks, { label: "°C" }),
      dry ? null : Plot.axisY(mmTicks.map(toY), { anchor: "right", label: "mm/h", tickFormat: (_, i) => String(mmTicks[i]) }),
      Plot.ruleX([now], { stroke: c.grid, strokeWidth: 1 }),
      barMarks(false),
      barMarks(true),
      Plot.line(past, { x: "ts", y: "temperature", stroke: c.temperature, strokeWidth: 2, className: "reveal" }),
      Plot.line(ahead, { x: "ts", y: "temperature", stroke: c.temperature, strokeWidth: 2, ...DOTTED, className: "reveal reveal-late" }),
      Plot.ruleX(temps, Plot.pointerX({ x: "ts", stroke: c.faint })),
      Plot.tip(temps, Plot.pointerX({ x: "ts", y: "temperature", title: tipText })),
    ],
  });

  const keys: { label: string; key: LegendKey; color: string }[] = [{ label: "Temperature, °C", key: "line", color: c.temperature }];
  if (!dry) keys.push({ label: "Precipitation, mm per hour", key: "bar", color: c.rain });
  if (ahead.length > 1 || bars.some((b) => b.forecast && b.mm > 0)) keys.push({ label: "Forecast", key: "dotted", color: c.muted });
  const rows = temps
    .filter((w) => w.ts > from)
    .map((w) => [fmtTime(w.ts), `${w.temperature} °C`, `${mmAt(w.ts).toFixed(1)} mm`, w.ts > now ? "yes" : ""]);
  root.replaceChildren(
    ...[
      chartBlock(
        null,
        chart,
        el("div", { className: "chart-foot" }, legend(keys), input.picker),
        dry && message("No precipitation in this period.", "muted small"),
      ),
      dataTable("Today by hour as a table", ["Time", "Temp.", "Precip. in the hour before", "Forecast"], rows),
    ],
  );
}
