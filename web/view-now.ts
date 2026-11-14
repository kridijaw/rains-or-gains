import * as Plot from "@observablehq/plot";
import type { NowBody } from "./api";
import {
  captionedBlock,
  chartBlock,
  dataTable,
  el,
  fmtAge,
  fmtHour,
  fmtPct,
  fmtTime,
  hourTicks,
  legend,
  MARGIN,
  LABELLED,
  LABEL_GAP,
  message,
  theme,
  type LegendItem,
} from "./chart";
import { freshness, hourOfDay, isComparable, lastGood, outlook, termLabel, type Outlook } from "./series";
import { berlin } from "./time";
import { MIN_FIT_HOURS, MIN_WEEKS, openHours, typicalDay, type OpenHours, type TypicalModel } from "./typical";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const USUAL_INFO =
  `The mean of own data for this weekday and hour once it covers ${MIN_WEEKS} weeks. ` +
  `Until then, the FitX profile scaled to % from at least ${MIN_FIT_HOURS} hours where both overlap.`;

export interface NowInput {
  now: number;
  body: NowBody;
  model: TypicalModel;
  width: number;
  /** Range picker, placed at the bottom right of the chart. */
  picker: HTMLElement;
  /** Shown in place of today's chart when a longer range is picked. */
  history: HTMLElement[] | null;
}

export interface NowSummary {
  value: number | null;
  term: string | null;
  outlook: string | null;
  updated: string;
  /** The latest sample is recent and valid. */
  live: boolean;
  /** Stale, failed or hidden sample; shown under the page header. */
  status: HTMLElement | null;
}

interface Current {
  value: number | null;
  ts: number;
  term: string | null;
}

function current({ now, body }: NowInput): Current | null {
  const f = freshness(body.latest, now);
  const latest = body.latest;
  if (f.state === "none" || !latest) return null;
  if (f.state === "hidden") return { value: null, ts: latest.ts, term: null };
  if (f.state === "error") {
    const good = lastGood(body.samples);
    return { value: good?.percentage ?? null, ts: good?.ts ?? latest.ts, term: null };
  }
  return { value: latest.percentage, ts: latest.ts, term: termLabel(latest.term) };
}

const about = (v: number) => `about ${fmtPct(v)}`;

/** Short outlook for the sticky bar, e.g. "Quieter from 22:00". */
function outlookText(o: Outlook, value: number | null): string {
  const close = fmtHour(o.hours.close);
  if (o.state === "after") return "Closed";
  if (o.state === "before") return `Opens ${fmtHour(o.hours.open)}`;
  const { quieterFrom: qf, best, peak } = o;
  if (qf) return `Quieter from ${fmtHour(qf.hour)}`;
  if (best && value !== null) return `Slightly quieter ${fmtHour(best.hour)}`;
  if (best) return `Quietest ${fmtHour(best.hour)}`;
  if (peak && value !== null && peak.v >= value + 10) return "Busier later";
  if (peak) return `Open until ${close}`;
  return `Closes ${close}`;
}

interface Today {
  cur: Current | null;
  outlook: Outlook | null;
  text: string | null;
  hours: OpenHours | null;
  usualNow: number | null;
}

function today(input: NowInput): Today {
  const { now, model } = input;
  const cur = current(input);
  const { weekday } = berlin(now);
  const hours = openHours(model, weekday);
  const usual = typicalDay(model, weekday).map((t) => (t.value !== null && isComparable(t.source) ? t.value : null));
  const o = outlook(usual, hours, hourOfDay(now), cur?.value ?? null);
  const text = o && outlookText(o, cur?.value ?? null);
  return { cur, outlook: o, text, hours, usualNow: usual[Math.floor(hourOfDay(now))] ?? null };
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

function updatedText({ now, body }: NowInput, cur: Current): string {
  const latest = body.latest!;
  if (cur.value === null) return `Last sample ${fmtTime(latest.ts)}, ${fmtAge(Math.max(0, now - latest.ts))}.`;
  return `${cur.ts === latest.ts ? "Updated" : "Last good reading"} ${fmtTime(cur.ts)}, ${fmtAge(Math.max(0, now - cur.ts))}.`;
}

function status({ now, body }: NowInput): HTMLElement | null {
  const f = freshness(body.latest, now);
  const latest = body.latest;
  if (!latest) return null;
  if (f.state === "error") return statusLine("critical", "Fetch failed", `${latest.error} (${fmtTime(latest.ts)}, ${fmtAge(f.age)}).`);
  if (f.state === "stale") return statusLine("warning", "Stale", `No new sample for ${fmtAge(f.age).replace(" ago", "")}. The logger may be down.`);
  if (f.state === "hidden") return statusLine("info", "Hidden", "FitX is not showing the gauge for this studio right now.");
  return null;
}

/** Horizontal gauge for the big number, with a tick for the usual value at this hour. */
function meter(value: number, usual: number | null): HTMLElement {
  const max = Math.max(100, value, usual ?? 0);
  const fill = el("span", { className: "meter-fill" });
  fill.style.setProperty("--v", String(value / max));
  const node = el("div", { className: "meter" }, el("span", { className: "meter-track" }, fill));
  let label = `${value}% now`;
  if (usual !== null) {
    const tick = el("span", { className: "meter-usual" }, el("span", { text: `usual ${fmtPct(usual)}` }));
    tick.style.setProperty("--u", String(usual / max));
    node.append(tick);
    label += `, usually ${fmtPct(usual)} at this hour`;
  }
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", label);
  return node;
}

function hero(input: NowInput, t0: Today): HTMLElement {
  const { now, body } = input;
  const f = freshness(body.latest, now);
  const parts: (HTMLElement | null)[] = [];

  if (f.state === "none" || !body.latest) {
    return el("div", { className: "now-hero" }, message("No samples yet. The first one arrives within 5 minutes of deploying."));
  }

  const value = t0.cur?.value ?? null;
  parts.push(
    el(
      "p",
      { className: "hero" },
      el("span", { className: "hero-value", text: value === null ? "n/a" : `${value}%` }),
      t0.cur?.term && el("span", { className: "hero-term", text: t0.cur.term }),
    ),
  );
  if (value !== null) parts.push(meter(value, t0.usualNow));
  if (value !== null && value > 100) parts.push(message("FitX's scale goes past 100%. Shown as reported.", "muted small"));

  return el("div", { className: "now-hero" }, ...parts);
}

function todayChart(input: NowInput, t0: Today): HTMLElement[] {
  const { now, body, model, width } = input;
  const c = theme();
  const { weekday, date } = berlin(now);
  const nowX = hourOfDay(now);
  const day = typicalDay(model, weekday);

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

  // Crop to opening hours, but never hide a non-zero reading.
  const base = t0.hours ?? { open: 0, close: 24 };
  const active = pts.filter((d) => (d.p ?? 0) > 0);
  const lo = Math.min(base.open, ...active.map((d) => Math.floor(d.x)));
  const hi = Math.max(base.close, ...active.map((d) => Math.ceil(d.x)));
  const inDay = (x: number) => x >= lo && x <= hi;

  const shown = pts.filter((d) => inDay(d.x));
  const valid = shown.filter((d): d is { ts: number; x: number; p: number } => d.p !== null);
  const last = valid.at(-1);
  const usualPts = day.flatMap((t, h) =>
    t.value !== null && isComparable(t.source) && inDay(h + 0.5) ? [{ x: h + 0.5, v: t.value }] : [],
  );
  const usualAt = (x: number) => usualPts.find((u) => Math.floor(u.x) === Math.floor(x))?.v ?? null;
  const expected = t0.outlook?.expected ?? [];
  const ahead = expected.filter((e) => e.x > nowX);
  const pick = t0.outlook && t0.outlook.state !== "after" ? (t0.outlook.quieterFrom ?? t0.outlook.best) : null;
  const live = freshness(body.latest, now).state === "ok";
  const yMax = Math.max(100, ...valid.map((d) => d.p), ...usualPts.map((d) => d.v), ...expected.map((d) => d.v));

  const tips = [
    ...valid.map((d) => {
      const u = usualAt(d.x);
      return { x: d.x, y: d.p, title: `${fmtTime(d.ts)}  ${d.p}%${u === null ? "" : `\nUsual ${fmtPct(u)}`}` };
    }),
    ...ahead.map((e) => {
      const h = Math.floor(e.x);
      const u = usualAt(e.x);
      return { x: e.x, y: e.v, title: `${fmtHour(h)} to ${fmtHour(h + 1)}\nExpected ${about(e.v)}${u === null ? "" : `\nUsual ${fmtPct(u)}`}` };
    }),
  ];

  const chart = Plot.plot({
    width,
    height: 220 + LABEL_GAP,
    ...MARGIN,
    ...LABELLED,
    style: { overflow: "visible" },
    x: { domain: [lo, hi], ticks: hourTicks(lo, hi, width), tickFormat: fmtHour, label: null },
    y: { domain: [0, yMax], nice: true, grid: true, label: "%", tickFormat: (v: number) => `${v}` },
    marks: [
      Plot.ruleX(inDay(nowX) ? [nowX] : [], { stroke: c.grid, strokeWidth: 1 }),
      Plot.ruleY([0], { stroke: c.baseline }),
      Plot.areaY(shown, { x: "x", y: "p", fill: c.occupancy, fillOpacity: 0.08, className: "reveal" }),
      Plot.line(usualPts, { x: "x", y: "v", stroke: c.neutral, strokeWidth: 2, className: "fade" }),
      Plot.line(expected, {
        x: "x",
        y: "v",
        stroke: c.occupancy,
        strokeWidth: 2,
        strokeDasharray: "4,4",
        strokeOpacity: 0.85,
        className: "reveal reveal-late",
      }),
      Plot.line(shown, { x: "x", y: "p", stroke: c.occupancy, strokeWidth: 2, className: "reveal" }),
      pick &&
        Plot.dot([pick], { x: (d) => d.hour + 0.5, y: "v", r: 4, fill: c.surface, stroke: c.occupancy, strokeWidth: 2, className: "pop pop-late" }),
      last && live ? Plot.dot([last], { x: "x", y: "p", r: 4, fill: c.occupancy, className: "pulse" }) : null,
      last && Plot.dot([last], { x: "x", y: "p", r: 4, fill: c.occupancy, stroke: c.surface, strokeWidth: 2, className: "pop" }),
      last &&
        Plot.text([last], {
          x: "x",
          y: "p",
          text: (d) => `${d.p}%`,
          dy: -12,
          textAnchor: last.x > hi - (hi - lo) * 0.12 ? "end" : "middle",
          fill: c.text,
          fontWeight: 600,
          stroke: c.surface,
          strokeWidth: 3,
          className: "pop",
        }),
      Plot.ruleX(tips, Plot.pointerX({ x: "x", stroke: c.faint })),
      Plot.tip(tips, Plot.pointerX({ x: "x", y: "y", title: "title" })),
    ],
  });

  const blocks: HTMLElement[] = [];
  const keys: LegendItem[] = [
    { label: "Today, every 5 min", key: "line", color: c.occupancy },
  ];
  if (ahead.length) keys.push({ label: "Expected rest of today", key: "dash", color: c.occupancy });
  if (usualPts.length) keys.push({ label: `Usual ${DAY_NAMES[weekday]}`, key: "line", color: c.neutral, info: USUAL_INFO });
  blocks.push(chartBlock(null, chart, el("div", { className: "chart-foot" }, legend(keys), input.picker)));
  if (valid.length === 0) blocks.unshift(message("No readings since midnight yet."));

  if (usualPts.length === 0 && model.profile) {
    const profilePts = model.profile[weekday].map((v, h) => ({ x: h + 0.5, v })).filter((d) => inDay(d.x));
    const shape = Plot.plot({
      width,
      height: 90,
      ...MARGIN,
      x: { domain: [lo, hi], ticks: hourTicks(lo, hi, width), tickFormat: fmtHour, label: null },
      y: { axis: null },
      marks: [
        Plot.areaY(profilePts, { x: "x", y: "v", fill: c.neutral, fillOpacity: 0.15, className: "reveal" }),
        Plot.line(profilePts, { x: "x", y: "v", stroke: c.neutral, strokeWidth: 2, className: "reveal" }),
        Plot.ruleY([0], { stroke: c.baseline }),
      ],
    });
    blocks.push(
      captionedBlock(
        `FitX profile for ${DAY_NAMES[weekday]}, shape only`,
        "FitX publishes this curve in an unknown unit, so it shows the shape of the day but cannot be compared with the % values.",
        shape,
      ),
    );
  }

  const byHour = new Map<number, number[]>();
  for (const d of valid) {
    const h = berlin(d.ts).hour;
    byHour.set(h, [...(byHour.get(h) ?? []), d.p]);
  }
  const aheadByHour = new Map(ahead.map((e) => [Math.floor(e.x), e.v]));
  const rows = Array.from({ length: 24 }, (_, h) => h)
    .filter((h) => byHour.has(h) || aheadByHour.has(h) || (day[h].value !== null && inDay(h + 0.5)))
    .map((h) => {
      const v = byHour.get(h);
      const mean = v ? v.reduce((a, b) => a + b, 0) / v.length : null;
      const u = isComparable(day[h].source) ? day[h].value : null;
      return [fmtHour(h), fmtPct(mean), fmtPct(aheadByHour.get(h) ?? null), fmtPct(u)];
    });
  if (rows.length) blocks.push(dataTable("Today by hour as a table", ["Hour", "Today (mean)", "Expected", "Usual"], rows));
  return blocks;
}

export function renderNow(root: HTMLElement, input: NowInput): NowSummary | null {
  const t0 = today(input);
  root.replaceChildren(el("div", { className: "now" }, hero(input, t0), el("div", { className: "now-chart" }, ...(input.history ?? todayChart(input, t0)))));
  return t0.cur
    ? {
        value: t0.cur.value,
        term: t0.cur.term,
        outlook: t0.text,
        updated: updatedText(input, t0.cur),
        live: freshness(input.body.latest, input.now).state === "ok",
        status: status(input),
      }
    : null;
}
