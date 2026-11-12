import * as Plot from "@observablehq/plot";
import { chartBlock, dataTable, el, fmtHour, fmtPct, message, theme } from "./chart";
import { WEEKDAYS } from "./time";
import { MIN_WEEKS, type TypicalModel } from "./typical";

export interface HeatmapInput {
  model: TypicalModel;
  width: number;
}

interface Cell {
  weekday: string;
  hour: number;
  value: number | null;
  n: number;
  weeks: number;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MARGIN_LEFT = 36;

function heatmap(cells: Cell[], width: number, domainMax: number, label: string, title: (d: Cell) => string, fade: boolean) {
  const c = theme();
  const rowHeight = Math.min(26, Math.max(16, Math.floor((width - MARGIN_LEFT - 8) / 24)));
  const filled = cells.filter((d) => d.value !== null);
  return Plot.plot({
    width,
    height: 7 * rowHeight + 30,
    marginLeft: MARGIN_LEFT,
    marginRight: 8,
    marginTop: 4,
    padding: 0,
    x: { domain: HOURS, ticks: [0, 6, 12, 18], tickFormat: fmtHour, tickSize: 0, label: null },
    y: { domain: [...WEEKDAYS], tickSize: 0, label: null },
    color: {
      type: "linear",
      domain: [0, domainMax],
      range: [c.seqLo, c.seqHi],
      interpolate: "lab",
      legend: true,
      label,
      width: Math.min(260, width - 20),
    },
    marks: [
      Plot.cell(cells, { x: "hour", y: "weekday", fill: c.grid, fillOpacity: 0.5, inset: 1, r: 2 }),
      Plot.cell(filled, {
        x: "hour",
        y: "weekday",
        fill: "value",
        fillOpacity: fade ? (d: Cell) => (d.weeks >= MIN_WEEKS ? 1 : 0.45) : 1,
        inset: 1,
        r: 2,
        title,
        tip: true,
      }),
    ],
  });
}

export function renderHeatmap(root: HTMLElement, { model, width }: HeatmapInput): void {
  const twoUp = width >= 760;
  const w = twoUp ? Math.floor((width - 24) / 2) : width;
  const own: Cell[] = model.own.flatMap((row, d) =>
    row.map((s, h) => ({ weekday: WEEKDAYS[d], hour: h, value: s.mean, n: s.n, weeks: s.weeks })),
  );
  const scale = model.scale;
  const profile: Cell[] = model.profile
    ? model.profile.flatMap((row, d) =>
        row.map((v, h) => ({ weekday: WEEKDAYS[d], hour: h, value: scale === null ? v : v * scale, n: 0, weeks: 0 })),
      )
    : [];

  const ownMax = Math.max(0, ...own.map((d) => d.value ?? 0));
  const profileMax = Math.max(0, ...profile.map((d) => d.value ?? 0));
  const shared = scale !== null;
  const ownDomain = Math.max(100, shared ? Math.max(ownMax, profileMax) : ownMax);

  const hasOwn = own.some((d) => d.value !== null);
  const faded = own.some((d) => d.value !== null && d.weeks < MIN_WEEKS);
  const ownBlock = chartBlock(
    "Own data, mean per weekday and hour",
    heatmap(
      own,
      w,
      ownDomain,
      "Mean occupancy, %",
      (d) => `${d.weekday} ${fmtHour(d.hour)}\n${fmtPct(d.value)} mean\n${d.n} samples, ${d.weeks} week${d.weeks === 1 ? "" : "s"}`,
      true,
    ),
    !hasOwn && message("No own data yet. Cells fill in hour by hour."),
    faded && message(`Faded cells have fewer than ${MIN_WEEKS} weeks of data; the usual value falls back to the FitX profile there.`, "muted small"),
  );

  const profileBlock = model.profile
    ? chartBlock(
        shared ? `FitX profile, scaled ×${scale?.toFixed(2)} to %` : "FitX profile, relative units",
        heatmap(
          profile,
          w,
          shared ? ownDomain : Math.max(1, profileMax),
          shared ? "Scaled profile, %" : "Relative (unknown unit)",
          (d) => `${d.weekday} ${fmtHour(d.hour)}\n${shared ? fmtPct(d.value) : Math.round(d.value ?? 0)}`,
          false,
        ),
        message(
          shared
            ? `Scale fitted on ${model.fitHours} hours of own data, so both maps share one colour scale.`
            : "Not on the % scale until enough own data overlaps it.",
          "muted small",
        ),
      )
    : chartBlock("FitX profile", message("No FitX profile fetched yet. It is snapshotted daily at 03:07 UTC."));

  const rows = WEEKDAYS.map((name, d) => [name, ...model.own[d].map((s) => (s.mean === null ? "" : Math.round(s.mean)))]);
  root.replaceChildren(
    el("div", { className: twoUp ? "pair" : "stack" }, ownBlock, profileBlock),
    hasOwn ? dataTable("Own means as a table (%)", ["", ...HOURS.map((h) => String(h))], rows) : "",
  );
}
