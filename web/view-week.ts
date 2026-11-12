import * as Plot from "@observablehq/plot";
import type { HourlyTuple } from "./api";
import {
  chartBlock,
  dataTable,
  fmtDate,
  fmtDateTime,
  fmtDayMonth,
  fmtPct,
  fmtWeekdayDay,
  legend,
  MARGIN,
  message,
  segmented,
  theme,
  type LegendKey,
} from "./chart";
import { dayKind, holidayCalendar, type Holiday } from "./holidays";
import { dailyPrecipitation, dayTicks, hourSeries, usualValue } from "./series";
import { addDays, berlin, lastDays, startOfDay } from "./time";
import { describeSource, openHours, type TypicalModel } from "./typical";
import type { WeatherHour } from "./weather";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export interface WeekInput {
  now: number;
  days: RangeDays;
  hourly: HourlyTuple[];
  model: TypicalModel;
  weather: WeatherHour[] | string | null;
  holidays: Holiday[] | string | null;
  width: number;
  onRange(days: RangeDays): void;
}

const rangePicker = (current: RangeDays, onRange: (days: RangeDays) => void): HTMLElement =>
  segmented(
    RANGES.map((d) => ({ value: d, label: `${d} days` })),
    current,
    onRange,
    "Time range",
  );

// Night shading turns into noise at 30 and 90 days, so only the 7 day view gets it.
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

function xAxis(from: number, to: number, days: RangeDays, width: number) {
  return {
    domain: [from, to],
    ticks: dayTicks(from, to, Math.floor((width - MARGIN.marginLeft) / 64)),
    tickFormat: days === 7 ? fmtWeekdayDay : fmtDayMonth,
    label: null,
  };
}

export function renderWeek(root: HTMLElement, input: WeekInput): void {
  const { now, days, hourly, model, holidays, width } = input;
  const c = theme();
  const { from, to } = lastDays(days, now);
  const weather = Array.isArray(input.weather) ? input.weather.filter((w) => w.ts >= from && w.ts <= to) : input.weather;
  const x = xAxis(from, to, days, width);
  const blocks: (HTMLElement | null)[] = [rangePicker(days, input.onRange)];

  const firstData = hourly.find((r) => r[1] !== null)?.[0] ?? Infinity;
  const pts = hourSeries(hourly, from, to, usualValue(model)).map((p) => ({
    ...p,
    mid: p.ts + 1800,
    typical: p.ts >= startOfDay(berlin(firstData === Infinity ? to : firstData).date) ? p.typical : null,
  }));
  const withData = pts.filter((p): p is typeof p & { avg: number } => p.avg !== null);
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
  const yMax = Math.ceil(Math.max(100, ...withData.map((p) => p.avg), ...pts.map((p) => p.typical ?? 0)) / 20) * 20;
  const closed = days === 7 ? closedSpans(model, from, to) : [];

  if (withData.length === 0) {
    blocks.push(message(`No occupancy data in the last ${days} days yet.`));
  } else if (withData[0].ts > from + 86400) {
    blocks.push(message(`Own data starts ${fmtDate(withData[0].ts)}.`, "muted small"));
  }

  const occupancy = Plot.plot({
    width,
    height: 220,
    ...MARGIN,
    x,
    y: { domain: [0, yMax], grid: true, label: "%" },
    marks: [
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
      Plot.areaY(pts, { x: "mid", y: "typical", fill: c.occupancy, fillOpacity: 0.14, curve: "step" }),
      Plot.line(pts, { x: "mid", y: "avg", stroke: c.occupancy, strokeWidth: days === 7 ? 2 : 1.5 }),
      Plot.ruleX(withData, Plot.pointerX({ x: "mid", stroke: c.faint })),
      Plot.tip(
        withData,
        Plot.pointerX({
          x: "mid",
          y: "avg",
          title: (p) =>
            `${fmtDateTime(p.ts)}\n${fmtPct(p.avg)} mean, ${p.max}% max` +
            (p.typical === null ? "" : `\nUsual ${fmtPct(p.typical)}`) +
            (p.n < 12 ? `\n${p.n} of 12 samples` : ""),
        }),
      ),
    ],
  });

  const keys: { label: string; key: LegendKey; color: string }[] = [
    { label: "Hourly mean", key: "line", color: c.occupancy },
  ];
  if (hasBand) keys.push({ label: "Usual", key: "wash", color: c.occupancy });
  if (closed.length) keys.push({ label: "Closed", key: "wash", color: c.neutral });
  if (school.length) keys.push({ label: "School holidays", key: "ribbon", color: c.neutral });
  if (publicDays.length) keys.push({ label: "Public holiday", key: "triangle", color: c.muted });
  blocks.push(chartBlock("Occupancy, %", occupancy, legend(keys)));
  const source = model.typical(berlin(now).weekday, berlin(now).hour).source;
  if (hasBand) blocks.push(message(`Usual: ${describeSource(source, model)}.`, "muted small"));
  if (typeof holidays === "string") blocks.push(message(`Holidays unavailable: ${holidays}`, "error small"));

  if (weather === null) {
    blocks.push(message("Loading weather…"));
  } else if (typeof weather === "string") {
    blocks.push(message(`Weather unavailable: ${weather}`, "error"));
  } else {
    const hourlyBars = days === 7;
    const bars = hourlyBars
      ? weather
          .filter((w) => w.precipitation !== null)
          .map((w) => ({ x1: w.ts - 3600, x2: w.ts, mm: w.precipitation as number, label: `${fmtDateTime(w.ts - 3600)}, 1 h` }))
      : dailyPrecipitation(weather)
          .filter((d) => d.end > from)
          .map((d) => ({ x1: Math.max(from, d.start), x2: d.end, mm: d.precipitation ?? 0, label: fmtDate(d.start) }));
    const dry = bars.every((b) => b.mm === 0);
    const temps = weather.filter((w) => w.temperature !== null);
    const temperature = Plot.plot({
      width,
      height: dry ? 110 : 90,
      ...MARGIN,
      ...(dry ? {} : { marginBottom: 6 }),
      x: dry ? x : { ...x, axis: null },
      y: { grid: true, nice: true, label: "°C", ticks: 3 },
      marks: [
        Plot.line(weather, { x: "ts", y: "temperature", stroke: c.temperature, strokeWidth: 2 }),
        Plot.ruleX(temps, Plot.pointerX({ x: "ts", stroke: c.faint })),
        Plot.tip(temps, Plot.pointerX({ x: "ts", y: "temperature", title: (w) => `${fmtDateTime(w.ts)}\n${w.temperature} °C` })),
      ],
    });

    const maxMm = Math.max(1, ...bars.map((b) => b.mm));
    const rain =
      !dry &&
      Plot.plot({
        width,
        height: 84,
        ...MARGIN,
        x,
        y: { domain: [0, maxMm], nice: true, grid: true, label: hourlyBars ? "mm/h" : "mm/day", ticks: 2 },
        marks: [
          Plot.rectY(bars, {
            x1: "x1",
            x2: "x2",
            y: "mm",
            fill: c.rain,
            insetLeft: hourlyBars ? 0.5 : 1,
            insetRight: hourlyBars ? 0.5 : 1,
            ry2: hourlyBars ? 0 : 3,
          }),
          Plot.ruleY([0], { stroke: c.baseline }),
          Plot.tip(
            bars.filter((b) => b.mm > 0),
            Plot.pointerX({ x1: "x1", x2: "x2", y: "mm", title: (b) => `${b.label}\n${b.mm.toFixed(1)} mm` }),
          ),
        ],
      });

    const weatherKeys: { label: string; key: LegendKey; color: string }[] = [
      { label: "Temperature, °C", key: "line", color: c.temperature },
    ];
    if (!dry) weatherKeys.push({ label: hourlyBars ? "Precipitation, mm per hour" : "Precipitation, mm per day", key: "bar", color: c.rain });
    blocks.push(
      chartBlock(
        "Weather",
        temperature,
        rain,
        legend(weatherKeys),
        dry && message("No precipitation in this period.", "muted small"),
      ),
    );
  }

  blocks.push(dayTable(input, weather, from, to));
  root.replaceChildren(...blocks.filter((b): b is HTMLElement => b !== null));
}

function dayTable({ hourly, holidays }: WeekInput, weather: WeekInput["weather"], from: number, to: number): HTMLElement {
  const days = new Map<string, { sum: number; n: number; max: number; temp: number[]; mm: number | null }>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { sum: 0, n: 0, max: -Infinity, temp: [], mm: null }));
    return d;
  };
  for (const [ts, avg, max, n] of hourly) {
    if (ts < from || ts >= to || avg === null) continue;
    const d = day(berlin(ts).date);
    d.sum += avg * n;
    d.n += n;
    d.max = Math.max(d.max, max ?? -Infinity);
  }
  if (Array.isArray(weather))
    for (const w of weather) {
      const d = day(berlin(w.ts - 3600).date);
      if (w.temperature !== null) d.temp.push(w.temperature);
      if (w.precipitation !== null) d.mm = (d.mm ?? 0) + w.precipitation;
    }
  const calendar = holidayCalendar(Array.isArray(holidays) ? holidays : []);
  const rows = [...days.entries()]
    .filter(([date]) => date >= berlin(from).date && date <= berlin(to - 1).date)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, d]) => {
      const kind = dayKind(calendar, date);
      const names = (calendar.get(date) ?? []).map((h) => h.name).join(", ");
      return [
        fmtDate(startOfDay(date)),
        d.n ? fmtPct(d.sum / d.n) : "n/a",
        Number.isFinite(d.max) ? `${d.max}%` : "n/a",
        d.temp.length ? `${(d.temp.reduce((a, b) => a + b, 0) / d.temp.length).toFixed(1)} °C` : "n/a",
        d.mm === null ? "n/a" : `${d.mm.toFixed(1)} mm`,
        kind ? `${kind === "public" ? "Public" : "School"}: ${names}` : "",
      ];
    });
  return dataTable("Days as a table", ["Day", "Mean", "Max", "Mean temp.", "Precip.", "Holiday"], rows);
}
