import * as Plot from "@observablehq/plot";
import type { HourlyTuple } from "./api";
import { chartBlock, dataTable, el, fmtDateTime, fmtPct, fmtSigned, legend, MARGIN, message, theme } from "./chart";
import type { Holiday } from "./holidays";
import {
  DAY_GROUPS,
  groupStats,
  RAIN_BUCKETS,
  rainBucket,
  residuals,
  type GroupStats,
  type Residual,
} from "./series";
import { MIN_FIT_HOURS, MIN_WEEKS, type TypicalModel } from "./typical";
import { berlin } from "./time";
import type { WeatherHour } from "./weather";

export interface EffectInput {
  hourly: HourlyTuple[];
  model: TypicalModel;
  weather: WeatherHour[] | string | null;
  holidays: Holiday[] | string | null;
  width: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const countLabel = (s: GroupStats<string> | undefined) => (s ? `${s.n} h over ${plural(s.days, "day")}` : "0 h");

const residualAxis = { grid: true, nice: true, label: "Residual, % of usual" } as const;

function strip<G extends string>(rows: Residual[], stats: GroupStats<G>[], groupOf: (r: Residual) => G | null, width: number) {
  const c = theme();
  const byGroup = new Map(stats.map((s) => [s.group, s]));
  const data = rows.flatMap((r) => {
    const group = groupOf(r);
    return group === null ? [] : [{ ...r, group }];
  });
  const medians = stats.filter((s) => s.median !== null);
  // Hundreds of ticks at a fixed opacity merge into a solid block; thin them out as the group grows.
  const tickOpacity = (g: G) => Math.min(0.5, Math.max(0.05, 2 / Math.sqrt(byGroup.get(g)?.n || 1)));
  const narrow = width / stats.length < 150;
  const count = (s: GroupStats<string> | undefined) => (s && narrow ? `${s.n} h, ${s.days} d` : countLabel(s));
  return Plot.plot({
    width,
    height: 220,
    ...MARGIN,
    marginBottom: 36,
    x: { domain: stats.map((s) => s.group), tickFormat: (g: G) => `${g}\n${count(byGroup.get(g))}`, tickSize: 0, label: null, padding: 0.3 },
    y: residualAxis,
    marks: [
      Plot.ruleY([0], { stroke: c.baseline }),
      Plot.tickY(data, { x: "group", y: "residual", stroke: c.neutral, strokeOpacity: (d) => tickOpacity(d.group), strokeWidth: 1, className: "fade" }),
      Plot.barY(medians, { x: "group", y1: "q1", y2: "q3", fill: c.neutral, fillOpacity: 0.12, stroke: c.muted, strokeWidth: 1.5, rx: 4, insetLeft: -6, insetRight: -6, className: "fade" }),
      Plot.tickY(medians, {
        x: "group",
        y: "median",
        stroke: c.text,
        strokeWidth: 3,
        strokeLinecap: "round",
        className: "pop pop-late",
        title: (s: GroupStats<G>) =>
          `${s.group}\nmedian ${fmtSigned(s.median, "%")}\nmiddle half ${fmtSigned(s.q1, "%")} to ${fmtSigned(s.q3, "%")}\nmean ${fmtSigned(s.mean, "%")}\n${countLabel(s)}`,
        tip: true,
      }),
    ],
  });
}

/** Returns false while there is nothing to compare yet. */
export function renderEffect(root: HTMLElement, input: EffectInput): boolean {
  const { hourly, model, weather, holidays, width } = input;
  const c = theme();
  const weatherRows = Array.isArray(weather) ? weather : [];
  const rows = residuals(hourly, model, weatherRows, Array.isArray(holidays) ? holidays : []);
  if (rows.length === 0) {
    root.replaceChildren(
      message(
        model.scale === null && !model.own.some((r) => r.some((s) => s.weeks >= MIN_WEEKS))
          ? `Appears once the usual value is on the % scale (${MIN_FIT_HOURS} hours of own data overlapping the FitX profile).`
          : "Nothing to compare yet.",
      ),
    );
    return false;
  }
  const blocks: (HTMLElement | false)[] = [
    message("Residual = hourly mean minus the usual value for that weekday and hour, as % of usual.", "muted small"),
  ];

  const twoUp = width >= 760;
  const half = twoUp ? Math.floor((width - 24) / 2) : width;
  const dateOf = (r: Residual) => berlin(r.ts).date;
  const rainStats = groupStats(
    rows,
    RAIN_BUCKETS,
    (r) => (r.precipitation === null ? null : rainBucket(r.precipitation)),
    (r) => r.residual,
    dateOf,
  );
  const dayStats = groupStats(rows, DAY_GROUPS, (r) => r.day, (r) => r.residual, dateOf);

  if (weather === null) blocks.push(message("Loading weather…"));
  else if (typeof weather === "string") blocks.push(message(`Weather unavailable: ${weather}`, "error"));
  else {
    const scatter = rows
      .filter((r) => r.temperature !== null && r.precipitation !== null)
      .map((r) => ({ ...r, wet: (r.precipitation as number) > 0 ? "Rain" : "Dry" }));
    blocks.push(
      chartBlock(
        null,
        Plot.plot({
          width,
          height: 260,
          ...MARGIN,
          x: { label: "Temperature, °C", nice: true },
          y: residualAxis,
          color: { domain: ["Dry", "Rain"], range: [c.neutral, c.rain] },
          symbol: { domain: ["Dry", "Rain"], range: ["circle", "triangle"] },
          marks: [
            Plot.ruleY([0], { stroke: c.baseline }),
            Plot.dot(scatter, {
              x: "temperature",
              y: "residual",
              fill: "wet",
              symbol: "wet",
              r: 4,
              fillOpacity: (d: { wet: string }) => (d.wet === "Rain" ? 0.9 : 0.4),
              stroke: c.surface,
              strokeWidth: 1,
              className: "reveal",
            }),
            Plot.tip(
              scatter,
              Plot.pointer({
                x: "temperature",
                y: "residual",
                title: (r) =>
                  `${fmtDateTime(r.ts)}\n${fmtSigned(r.residual, "%")} (${fmtPct(r.avg)} vs usual ${fmtPct(r.typical)})\n` +
                  `${r.temperature} °C, ${r.precipitation?.toFixed(1)} mm`,
              }),
            ),
          ],
        }),
        legend([
          { label: `Dry (n = ${scatter.filter((r) => r.wet === "Dry").length})`, key: "dot", color: c.neutral },
          { label: `Rain (n = ${scatter.filter((r) => r.wet === "Rain").length})`, key: "triangle-up", color: c.rain },
        ]),
      ),
    );
  }

  const pair = el("div", { className: twoUp ? "pair" : "stack" });
  if (Array.isArray(weather))
    pair.append(
      chartBlock(
        "By precipitation in that hour",
        strip(rows, rainStats, (r) => (r.precipitation === null ? null : rainBucket(r.precipitation)), half),
      ),
    );
  pair.append(
    chartBlock(
      "Holiday vs normal day",
      strip(rows, dayStats, (r) => r.day, half),
      typeof holidays === "string" && message(`Holidays unavailable: ${holidays}`, "error small"),
    ),
  );
  blocks.push(pair);
  blocks.push(message("Thin ticks are single hours, the shaded box holds the middle half, and the bold tick is the median. Hours of one day move together, so the day count is the real sample size.", "muted small"));

  const fmtRow = (s: GroupStats<string>) => [s.group, s.n, s.days, fmtSigned(s.mean, "%"), fmtSigned(s.median, "%")];
  blocks.push(
    dataTable(
      "Groups as a table",
      ["Group", "Hours", "Days", "Mean residual, %", "Median residual, %"],
      [...(Array.isArray(weather) ? rainStats.map(fmtRow) : []), ...dayStats.map(fmtRow)],
    ),
  );
  root.replaceChildren(...blocks.filter((b): b is HTMLElement => b !== false));
  return true;
}
