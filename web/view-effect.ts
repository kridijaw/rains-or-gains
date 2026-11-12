import * as Plot from "@observablehq/plot";
import type { HourlyTuple } from "./api";
import { chartBlock, dataTable, el, fmtDateTime, fmtPct, fmtSigned, legend, MARGIN, message, theme } from "./chart";
import type { Holiday } from "./holidays";
import {
  DAY_GROUPS,
  dataDays,
  groupStats,
  RAIN_BUCKETS,
  rainBucket,
  residuals,
  type GroupStats,
  type Residual,
} from "./series";
import { describeSource, MIN_FIT_HOURS, MIN_WEEKS, type TypicalModel } from "./typical";
import type { WeatherHour } from "./weather";

export interface EffectInput {
  now: number;
  hourly: HourlyTuple[];
  model: TypicalModel;
  weather: WeatherHour[] | string | null;
  holidays: Holiday[] | string | null;
  width: number;
}

const residualAxis = { grid: true, nice: true, label: "Residual, points" } as const;

function strip<G extends string>(rows: Residual[], stats: GroupStats<G>[], groupOf: (r: Residual) => G | null, width: number) {
  const c = theme();
  const n = new Map(stats.map((s) => [s.group, s.n]));
  const data = rows.flatMap((r) => {
    const group = groupOf(r);
    return group === null ? [] : [{ ...r, group }];
  });
  const medians = stats.filter((s) => s.median !== null);
  return Plot.plot({
    width,
    height: 220,
    ...MARGIN,
    marginBottom: 36,
    x: { domain: stats.map((s) => s.group), tickFormat: (g: G) => `${g}\nn = ${n.get(g) ?? 0}`, tickSize: 0, label: null, padding: 0.3 },
    y: residualAxis,
    marks: [
      Plot.ruleY([0], { stroke: c.baseline }),
      Plot.tickY(data, { x: "group", y: "residual", stroke: c.neutral, strokeOpacity: 0.35, strokeWidth: 1 }),
      Plot.tickY(medians, {
        x: "group",
        y: "median",
        stroke: c.text,
        strokeWidth: 3,
        title: (s: GroupStats<G>) => `${s.group}\nmedian ${fmtSigned(s.median)}\nmean ${fmtSigned(s.mean)}\nn = ${s.n} hours`,
        tip: true,
      }),
    ],
  });
}

export function renderEffect(root: HTMLElement, input: EffectInput): void {
  const { now, hourly, model, weather, holidays, width } = input;
  const c = theme();
  const weatherRows = Array.isArray(weather) ? weather : [];
  const rows = residuals(hourly, model, weatherRows, Array.isArray(holidays) ? holidays : []);
  const days = dataDays(hourly, now);
  const blocks: (HTMLElement | false)[] = [
    message(
      `Residual = hourly mean minus the usual value for that weekday and hour. ` +
        `This needs weeks of data, with dry and rainy hours at every time of day, before it means anything. ` +
        `So far: ${rows.length} hours over ${days} day${days === 1 ? "" : "s"}.`,
    ),
  ];

  if (rows.length === 0) {
    blocks.push(
      message(
        model.scale === null && !model.own.some((r) => r.some((s) => s.weeks >= MIN_WEEKS))
          ? `Nothing to compare yet: the usual value needs ${MIN_FIT_HOURS} hours of own data overlapping the FitX profile first.`
          : "Nothing to compare yet.",
      ),
    );
    root.replaceChildren(...blocks.filter((b): b is HTMLElement => b !== false));
    return;
  }
  const sources = [...new Set(rows.map((r) => r.source))].map((s) => describeSource(s, model));
  blocks.push(message(`Usual: ${sources.join("; ")}.`, "muted small"));

  const twoUp = width >= 760;
  const half = twoUp ? Math.floor((width - 24) / 2) : width;
  const rainStats = groupStats(rows, RAIN_BUCKETS, (r) => (r.precipitation === null ? null : rainBucket(r.precipitation)), (r) => r.residual);
  const dayStats = groupStats(rows, DAY_GROUPS, (r) => r.day, (r) => r.residual);

  if (weather === null) blocks.push(message("Loading weather…"));
  else if (typeof weather === "string") blocks.push(message(`Weather unavailable: ${weather}`, "error"));
  else {
    const scatter = rows
      .filter((r) => r.temperature !== null && r.precipitation !== null)
      .map((r) => ({ ...r, wet: (r.precipitation as number) > 0 ? "Rain" : "Dry" }));
    blocks.push(
      chartBlock(
        "Residual vs temperature",
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
              fillOpacity: 0.75,
              stroke: c.surface,
              strokeWidth: 1,
            }),
            Plot.tip(
              scatter,
              Plot.pointer({
                x: "temperature",
                y: "residual",
                title: (r) =>
                  `${fmtDateTime(r.ts)}\n${fmtSigned(r.residual)} points (${fmtPct(r.avg)} vs usual ${fmtPct(r.typical)})\n` +
                  `${r.temperature} °C, ${r.precipitation?.toFixed(1)} mm`,
              }),
            ),
          ],
        }),
        legend([
          { label: `Dry (n = ${scatter.filter((r) => r.wet === "Dry").length})`, key: "dot", color: c.neutral },
          { label: `Rain (n = ${scatter.filter((r) => r.wet === "Rain").length})`, key: "triangle", color: c.rain },
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
  blocks.push(message("Thin ticks are single hours; the bold tick is the median.", "muted small"));

  const fmtRow = (s: GroupStats<string>) => [s.group, s.n, fmtSigned(s.mean), fmtSigned(s.median)];
  blocks.push(
    dataTable(
      "Groups as a table",
      ["Group", "Hours", "Mean residual", "Median residual"],
      [...(Array.isArray(weather) ? rainStats.map(fmtRow) : []), ...dayStats.map(fmtRow)],
    ),
  );
  root.replaceChildren(...blocks.filter((b): b is HTMLElement => b !== false));
}
