import * as Plot from "@observablehq/plot";
import { chartBlock, dataTable, fmtHour, fmtPct, fmtSigned, message, segmented, theme } from "./chart";
import { WEEKDAYS } from "./time";
import { MIN_WEEKS, openHours, type TypicalModel } from "./typical";

export type HeatMode = "own" | "fitx" | "diff";

export interface HeatmapInput {
  model: TypicalModel;
  width: number;
  mode: HeatMode | null;
  onMode(mode: HeatMode): void;
}

interface Cell {
  weekday: string;
  hour: number;
  value: number | null;
  n: number;
  weeks: number;
}

const MARGIN_LEFT = 36;

function heatmap(
  cells: Cell[],
  hours: number[],
  width: number,
  color: Plot.ScaleOptions,
  title: (d: Cell) => string,
  fade: boolean,
) {
  const c = theme();
  const cellWidth = (width - MARGIN_LEFT - 8) / hours.length;
  const rowHeight = Math.round(Math.min(34, Math.max(18, cellWidth * 0.7)));
  const shown = cells.filter((d) => hours.includes(d.hour));
  const filled = shown.filter((d) => d.value !== null);
  return Plot.plot({
    width,
    height: 7 * rowHeight + 30,
    marginLeft: MARGIN_LEFT,
    marginRight: 8,
    marginTop: 4,
    padding: 0,
    x: { domain: hours, ticks: hours.filter((h) => h % (cellWidth < 16 ? 6 : cellWidth < 30 ? 3 : 2) === 0), tickFormat: fmtHour, tickSize: 0, label: null },
    y: { domain: [...WEEKDAYS], tickSize: 0, label: null },
    color: { legend: true, width: Math.min(280, width - 20), ...color },
    marks: [
      Plot.cell(shown, { x: "hour", y: "weekday", fill: c.grid, fillOpacity: 0.5, inset: 1, r: 2 }),
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

/** Earliest opening to latest closing over the week, so all rows share one x axis. */
function weekHours(model: TypicalModel): number[] {
  const spans = WEEKDAYS.map((_, d) => openHours(model, d)).filter((h) => h !== null);
  const open = spans.length ? Math.min(...spans.map((h) => h.open)) : 0;
  const close = spans.length ? Math.max(...spans.map((h) => h.close)) : 24;
  return Array.from({ length: close - open }, (_, i) => open + i);
}

const weeksLabel = (d: Cell) => `${d.n} samples, ${d.weeks} week${d.weeks === 1 ? "" : "s"}`;

/** Returns false when there is nothing to show yet. */
export function renderHeatmap(root: HTMLElement, { model, width, mode, onMode }: HeatmapInput): boolean {
  const c = theme();
  const hours = weekHours(model);
  const scale = model.scale;
  const own: Cell[] = model.own.flatMap((row, d) =>
    row.map((s, h) => ({ weekday: WEEKDAYS[d], hour: h, value: s.mean, n: s.n, weeks: s.weeks })),
  );
  const profile: Cell[] = model.profile
    ? model.profile.flatMap((row, d) =>
        row.map((v, h) => ({ weekday: WEEKDAYS[d], hour: h, value: scale === null ? v : v * scale, n: 0, weeks: 0 })),
      )
    : [];
  const diff: Cell[] =
    scale === null ? [] : own.map((d, i) => ({ ...d, value: d.value === null ? null : d.value - (profile[i].value ?? 0) }));

  const hasOwn = own.some((d) => d.value !== null);
  const modes: { value: HeatMode; label: string }[] = [];
  if (hasOwn) modes.push({ value: "own", label: "Own data" });
  if (model.profile) modes.push({ value: "fitx", label: "FitX profile" });
  if (hasOwn && scale !== null) modes.push({ value: "diff", label: "Difference" });
  if (modes.length === 0) {
    root.replaceChildren(message("Fills in once the first hours are logged or the FitX profile is fetched."));
    return false;
  }
  const current = modes.find((m) => m.value === mode)?.value ?? modes[0].value;

  const ownMax = Math.max(0, ...own.map((d) => d.value ?? 0));
  const profileMax = Math.max(0, ...profile.map((d) => d.value ?? 0));
  const pctDomain = Math.max(100, scale !== null ? Math.max(ownMax, profileMax) : ownMax);
  const pctColor = (label: string): Plot.ScaleOptions => ({
    type: "linear",
    domain: [0, pctDomain],
    range: [c.seqLo, c.seqHi],
    interpolate: "lab",
    label,
  });

  const blocks: (HTMLElement | false)[] = [modes.length > 1 && segmented(modes, current, onMode, "Heatmap")];
  if (current === "own") {
    const faded = own.some((d) => d.value !== null && d.weeks < MIN_WEEKS);
    blocks.push(
      chartBlock(
        null,
        heatmap(
          own,
          hours,
          width,
          pctColor("Mean occupancy, %"),
          (d) => `${d.weekday} ${fmtHour(d.hour)}\n${fmtPct(d.value)} mean\n${weeksLabel(d)}`,
          true,
        ),
        faded &&
          message(`Faded cells have fewer than ${MIN_WEEKS} weeks of data; the usual value falls back to the FitX profile there.`, "muted small"),
      ),
    );
  } else if (current === "fitx") {
    const shared = scale !== null;
    blocks.push(
      chartBlock(
        null,
        heatmap(
          profile,
          hours,
          width,
          shared
            ? pctColor("Scaled profile, %")
            : { ...pctColor("Relative (unknown unit)"), domain: [0, Math.max(1, profileMax)] },
          (d) => `${d.weekday} ${fmtHour(d.hour)}\n${shared ? fmtPct(d.value) : Math.round(d.value ?? 0)}`,
          false,
        ),
      ),
    );
  } else {
    const m = Math.max(10, ...diff.filter((d) => hours.includes(d.hour)).map((d) => Math.abs(d.value ?? 0)));
    blocks.push(
      chartBlock(
        null,
        heatmap(
          diff,
          hours,
          width,
          { type: "linear", domain: [-m, 0, m], range: [c.divLo, c.divMid, c.divHi], interpolate: "lab", label: "Points, own minus FitX" },
          (d) => `${d.weekday} ${fmtHour(d.hour)}\n${fmtSigned(d.value, " points")}\n${weeksLabel(d)}`,
          true,
        ),
      ),
    );
  }

  if (hasOwn) {
    const rows = WEEKDAYS.map((name, d) => [name, ...hours.map((h) => model.own[d][h].mean).map((v) => (v === null ? "" : Math.round(v)))]);
    blocks.push(dataTable("Own means as a table (%)", ["", ...hours.map((h) => String(h))], rows));
  }
  root.replaceChildren(...blocks.filter((b): b is HTMLElement => b !== false));
  return true;
}
