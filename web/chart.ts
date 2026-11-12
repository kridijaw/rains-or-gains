import { TZ } from "./time";

export interface Theme {
  surface: string;
  text: string;
  muted: string;
  faint: string;
  grid: string;
  baseline: string;
  occupancy: string;
  temperature: string;
  rain: string;
  neutral: string;
  divLo: string;
  divMid: string;
  divHi: string;
  seqLo: string;
  seqHi: string;
}

export function theme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    surface: v("--surface"),
    text: v("--text"),
    muted: v("--muted"),
    faint: v("--faint"),
    grid: v("--grid"),
    baseline: v("--baseline"),
    occupancy: v("--series-1"),
    temperature: v("--series-2"),
    rain: v("--series-3"),
    neutral: v("--neutral"),
    divLo: v("--div-lo"),
    divMid: v("--div-mid"),
    divHi: v("--div-hi"),
    seqLo: v("--seq-lo"),
    seqHi: v("--seq-hi"),
  };
}

export const MARGIN = { marginLeft: 40, marginRight: 16 } as const;

type Child = Node | string | null | false | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const c of children) if (c) node.append(c);
  return node;
}

export const message = (text: string, className = "muted"): HTMLParagraphElement => el("p", { className, text });

let tipCount = 0;

/** Info icon that shows `text` in a tooltip on hover, tap or focus. */
export function infoTip(text: string): HTMLButtonElement {
  const icon = el("span", { className: "info-icon", text: "i" });
  icon.setAttribute("aria-hidden", "true");
  const tip = el("span", { className: "info-tip", text });
  tip.id = `info-tip-${++tipCount}`;
  tip.setAttribute("role", "tooltip");
  const button = el("button", { className: "info" }, icon, tip);
  button.type = "button";
  button.setAttribute("aria-label", "More info");
  button.setAttribute("aria-describedby", tip.id);
  const place = () => {
    tip.style.setProperty("--dx", "0px");
    const r = tip.getBoundingClientRect();
    const right = document.documentElement.clientWidth - 8;
    const dx = r.left < 8 ? 8 - r.left : r.right > right ? right - r.right : 0;
    tip.style.setProperty("--dx", `${dx}px`);
  };
  button.addEventListener("pointerenter", place);
  button.addEventListener("focus", place);
  return button;
}

const fmt = (options: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...options });
  return (ts: number) => f.format(ts * 1000);
};

export const fmtTime = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const fmtWeekdayDay = fmt({ weekday: "short", day: "numeric" });
export const fmtDayMonth = fmt({ day: "numeric", month: "short" });
export const fmtDateTime = fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const fmtDate = fmt({ weekday: "short", day: "numeric", month: "short" });
export const fmtPct = (v: number | null): string => (v === null ? "n/a" : `${Math.round(v)}%`);
export const fmtSigned = (v: number | null, unit = ""): string =>
  v === null ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}${unit}`;
export const fmtHour = (h: number): string => `${String(h % 24).padStart(2, "0")}:00`;

export function fmtAge(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 1) return "just now";
  if (min < 90) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export type LegendKey = "line" | "dash" | "wash" | "ribbon" | "bar" | "rule" | "dot" | "triangle" | "triangle-up" | "outline";

export interface LegendItem {
  label: string;
  key: LegendKey;
  color: string;
  info?: string;
}

export function legend(items: LegendItem[]): HTMLElement {
  return el(
    "ul",
    { className: "legend" },
    ...items.map(({ label, key, color, info }) => {
      const swatch = el("span", { className: `key key-${key}` });
      swatch.style.setProperty("--key", color);
      return el("li", {}, swatch, el("span", { className: info ? "with-info" : "" }, label, info && infoTip(info)));
    }),
  );
}

export function chartBlock(title: string | null, chart: Element, ...extra: Child[]): HTMLElement {
  return captionedBlock(title, null, chart, ...extra);
}

export function captionedBlock(title: string | null, info: string | null, chart: Element, ...extra: Child[]): HTMLElement {
  return el("figure", { className: "chart" }, title && el("figcaption", { className: info ? "with-info" : "" }, title, info && infoTip(info)), chart, ...extra);
}

export function dataTable(summary: string, head: string[], rows: (string | number)[][]): HTMLDetailsElement {
  const table = el(
    "table",
    {},
    el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { text: h })))),
    el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c) => el("td", { text: String(c) }))))),
  );
  return el("details", { className: "table-view" }, el("summary", { text: summary }), el("div", { className: "table-scroll" }, table));
}

interface Segments {
  group: HTMLElement;
  thumb: HTMLElement;
  buttons: HTMLButtonElement[];
  index: number;
  pick(i: number): void;
}

// Views rebuild their DOM on every draw; reusing the control keeps the thumb's position so it can glide.
const segmentGroups = new Map<string, Segments>();

function selectSegment(s: Segments, index: number): void {
  s.index = index;
  s.buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
  requestAnimationFrame(() => {
    const b = s.buttons[s.index];
    if (!s.group.isConnected || !b) return;
    // Flush the old position first, so a control that was just re-inserted still transitions.
    void s.thumb.offsetWidth;
    s.thumb.style.width = `${b.offsetWidth}px`;
    s.thumb.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!s.group.classList.contains("ready")) {
      void s.thumb.offsetWidth;
      s.group.classList.add("ready");
    }
  });
}

export function segmented<T extends string | number>(
  options: readonly { value: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
  label: string,
): HTMLElement {
  const key = `${label}:${options.map((o) => o.label).join("|")}`;
  let s = segmentGroups.get(key);
  if (!s) {
    const thumb = el("span", { className: "seg-thumb" });
    const buttons = options.map(({ label }, i) => {
      const b = el("button", { text: label });
      b.type = "button";
      b.addEventListener("click", () => s!.pick(i));
      return b;
    });
    const group = el("div", { className: "segmented" }, thumb, ...buttons);
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    s = { group, thumb, buttons, index: -1, pick: () => {} };
    segmentGroups.set(key, s);
  }
  const seg = s;
  seg.pick = (i) => {
    if (i === seg.index) return;
    selectSegment(seg, i);
    onPick(options[i].value);
  };
  selectSegment(seg, options.findIndex((o) => o.value === current));
  return seg.group;
}

/** Placeholder block with a shimmer while a view loads. */
export function skeleton(height = 220): HTMLElement {
  const node = el("div", { className: "skeleton" }, el("span", { className: "visually-hidden", text: "Loading…" }));
  node.style.setProperty("--h", `${height}px`);
  return node;
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whole-hour ticks across [lo, hi], thinned to fit the width. */
export function hourTicks(lo: number, hi: number, width: number): number[] {
  const fit = Math.max(2, Math.floor((width - MARGIN.marginLeft) / 56));
  const step = [1, 2, 3, 4, 6].find((s) => (hi - lo) / s <= fit) ?? 6;
  const ticks: number[] = [];
  for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) ticks.push(h);
  return ticks;
}

export const chartWidth = (body: HTMLElement): number => Math.max(280, Math.floor(body.clientWidth));
