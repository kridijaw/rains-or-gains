import * as Plot from "@observablehq/plot";
import type { NowBody } from "./api";
import { chartBlock, dataTable, el, fmtAge, fmtHour, fmtPct, fmtTime, legend, MARGIN, message, theme } from "./chart";
import { freshness, hourOfDay, isComparable, lastGood, termLabel } from "./series";
import { berlin, WEEKDAYS } from "./time";
import { describeSource, typicalDay, type TypicalModel } from "./typical";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface NowInput {
  now: number;
  body: NowBody;
  model: TypicalModel;
  width: number;
}

function statusLine(kind: "warning" | "critical" | "info", label: string, text: string): HTMLElement {
  return el(
    "p",
    { className: `status status-${kind}` },
    el("span", { className: "status-icon", text: kind === "info" ? "i" : "!" }),
    el("strong", { text: label }),
    el("span", { text }),
  );
}

function hero(input: NowInput): HTMLElement {
  const { now, body, model } = input;
  const f = freshness(body.latest, now);
  const latest = body.latest;
  const parts: (HTMLElement | null)[] = [];

  if (f.state === "none" || !latest) {
    return el("div", { className: "now-hero" }, message("No samples yet. The first one arrives within 5 minutes of deploying."));
  }

  const good = lastGood(body.samples);
  let value: number | null = latest.percentage;
  let valueTs = latest.ts;
  if (f.state === "error") {
    parts.push(statusLine("critical", "Fetch failed", `${latest.error} (${fmtTime(latest.ts)}, ${fmtAge(f.age)}).`));
    value = good?.percentage ?? null;
    valueTs = good?.ts ?? latest.ts;
  } else if (f.state === "stale") {
    parts.push(statusLine("warning", "Stale", `No new sample for ${fmtAge(f.age).replace(" ago", "")}. The logger may be down.`));
  } else if (f.state === "hidden") {
    parts.push(statusLine("info", "Hidden", "FitX is not showing the gauge for this studio right now."));
    value = null;
  }

  const term = f.state === "ok" || f.state === "stale" ? termLabel(latest.term) : null;
  parts.push(
    el(
      "p",
      { className: "hero" },
      el("span", { className: "hero-value", text: value === null ? "n/a" : `${value}%` }),
      term && el("span", { className: "hero-term", text: term }),
    ),
  );
  if (value !== null && value > 100) parts.push(message("FitX's scale goes past 100%. Shown as reported."));
  parts.push(
    message(
      value === null
        ? `Last sample ${fmtTime(latest.ts)}, ${fmtAge(f.age)}.`
        : `${valueTs === latest.ts ? "Updated" : "Last good reading"} ${fmtTime(valueTs)}, ${fmtAge(now - valueTs)}.`,
    ),
  );

  const { weekday, hour } = berlin(now);
  const t = model.typical(weekday, hour);
  const usual = el("p", { className: "usual" });
  if (t.value !== null && isComparable(t.source)) {
    usual.append(el("span", { text: "Usual for " }), el("span", { text: `${WEEKDAYS[weekday]} ${fmtHour(hour)}: ` }));
    usual.append(el("strong", { text: fmtPct(t.value) }));
    if (value !== null) {
      const diff = Math.round(value - t.value);
      usual.append(
        el("span", { text: diff === 0 ? ", right on usual." : `, now ${Math.abs(diff)} points ${diff > 0 ? "above" : "below"}.` }),
      );
    }
  } else if (t.source === "profile-relative") {
    usual.textContent = "Usual for now: not on the % scale yet, only the FitX profile shape is known.";
  } else {
    usual.textContent = "Usual for now: no data yet.";
  }
  parts.push(usual);
  if (t.source !== "none") parts.push(message(`Usual: ${describeSource(t.source, model)}.`, "muted small"));
  return el("div", { className: "now-hero" }, ...parts);
}

function todayChart(input: NowInput): HTMLElement[] {
  const { now, body, model, width } = input;
  const c = theme();
  const { weekday, date } = berlin(now);
  const day = typicalDay(model, weekday);
  const usualPts = day.flatMap((t, h) => (t.value !== null && isComparable(t.source) ? [{ x: h + 0.5, v: t.value }] : []));

  const pts: { ts: number; x: number; p: number | null }[] = [];
  let prev: number | null = null;
  for (const [ts, p] of body.samples) {
    if (berlin(ts).date !== date) continue;
    const x = hourOfDay(ts);
    // On the DST fall-back day the 02:00 hour repeats; break the line instead of drawing backwards.
    const wrapped = pts.length > 0 && x < pts[pts.length - 1].x;
    if (prev !== null && (ts - prev > 600 || wrapped)) pts.push({ ts: prev + 300, x: wrapped ? x : hourOfDay(prev + 300), p: null });
    pts.push({ ts, x, p });
    prev = ts;
  }
  const valid = pts.filter((d): d is { ts: number; x: number; p: number } => d.p !== null);
  const last = valid.at(-1);
  const usualAt = (x: number) => usualPts.find((u) => Math.floor(u.x) === Math.floor(x))?.v ?? null;
  const yMax = Math.max(100, ...valid.map((d) => d.p), ...usualPts.map((d) => d.v));

  const chart = Plot.plot({
    width,
    height: 220,
    ...MARGIN,
    style: { overflow: "visible" },
    x: { domain: [0, 24], ticks: width < 560 ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24], tickFormat: fmtHour, label: null },
    y: { domain: [0, yMax], nice: true, grid: true, label: "%", tickFormat: (v: number) => `${v}` },
    marks: [
      Plot.ruleX([hourOfDay(now)], { stroke: c.grid, strokeWidth: 1 }),
      Plot.ruleY([0], { stroke: c.baseline }),
      Plot.line(usualPts, { x: "x", y: "v", stroke: c.neutral, strokeWidth: 2 }),
      Plot.line(pts, { x: "x", y: "p", stroke: c.occupancy, strokeWidth: 2 }),
      last && Plot.dot([last], { x: "x", y: "p", r: 4, fill: c.occupancy, stroke: c.surface, strokeWidth: 2 }),
      last &&
        Plot.text([last], {
          x: "x",
          y: "p",
          text: (d) => `${d.p}%`,
          dy: -12,
          textAnchor: last.x > 20 ? "end" : "middle",
          fill: c.text,
          fontWeight: 600,
          stroke: c.surface,
          strokeWidth: 3,
        }),
      Plot.ruleX(valid, Plot.pointerX({ x: "x", stroke: c.faint })),
      Plot.tip(
        valid,
        Plot.pointerX({
          x: "x",
          y: "p",
          title: (d) => {
            const u = usualAt(d.x);
            return `${fmtTime(d.ts)}  ${d.p}%${u === null ? "" : `\nUsual ${fmtPct(u)}`}`;
          },
        }),
      ),
    ],
  });

  const blocks: HTMLElement[] = [];
  const keys = [{ label: "Today, every 5 min", key: "line" as const, color: c.occupancy }];
  if (usualPts.length) keys.push({ label: `Usual ${DAY_NAMES[weekday]}`, key: "line", color: c.neutral });
  blocks.push(chartBlock(null, chart, legend(keys)));
  if (valid.length === 0) blocks.unshift(message("No readings since midnight yet."));

  if (usualPts.length === 0 && model.profile) {
    const profilePts = model.profile[weekday].map((v, h) => ({ x: h + 0.5, v }));
    const shape = Plot.plot({
      width,
      height: 90,
      ...MARGIN,
      x: { domain: [0, 24], ticks: [0, 6, 12, 18, 24], tickFormat: fmtHour, label: null },
      y: { axis: null },
      marks: [
        Plot.areaY(profilePts, { x: "x", y: "v", fill: c.neutral, fillOpacity: 0.15 }),
        Plot.line(profilePts, { x: "x", y: "v", stroke: c.neutral, strokeWidth: 2 }),
        Plot.ruleY([0], { stroke: c.baseline }),
      ],
    });
    blocks.push(chartBlock(`FitX profile for ${DAY_NAMES[weekday]}, shape only (unknown unit, not comparable to %)`, shape));
  }

  const byHour = new Map<number, number[]>();
  for (const d of valid) {
    const h = berlin(d.ts).hour;
    byHour.set(h, [...(byHour.get(h) ?? []), d.p]);
  }
  const rows = Array.from({ length: 24 }, (_, h) => h)
    .filter((h) => byHour.has(h) || day[h].value !== null)
    .map((h) => {
      const v = byHour.get(h);
      const mean = v ? v.reduce((a, b) => a + b, 0) / v.length : null;
      const u = isComparable(day[h].source) ? day[h].value : null;
      return [fmtHour(h), fmtPct(mean), fmtPct(u)];
    });
  if (rows.length) blocks.push(dataTable("Today by hour as a table", ["Hour", "Today (mean)", "Usual"], rows));
  return blocks;
}

export function renderNow(root: HTMLElement, input: NowInput): void {
  root.replaceChildren(el("div", { className: "now" }, hero(input), el("div", { className: "now-chart" }, ...todayChart(input))));
}
