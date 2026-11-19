import { getHourly, getNow, getStudios, type HourlyTuple, type NowBody, type Studio } from "./api";
import { webStorage } from "./cache";
import { chartWidth, el, infoTip, message, percentMax, reducedMotion, segmented, skeleton } from "./chart";
import { getHolidays, type Holiday } from "./holidays";
import { dataDays, dataProgress } from "./series";
import { berlin, lastDays, startOfDay } from "./time";
import { buildTypical, type TypicalModel } from "./typical";
import { EFFECT_INFO, renderEffect } from "./view-effect";
import { renderHeatmap, type HeatMode } from "./view-heatmap";
import { renderNow, todayHours, todayPeak, type NowSummary } from "./view-now";
import { renderProgress } from "./view-progress";
import { RANGES, weekBlocks, weekPeak, type RangeDays } from "./view-week";
import { renderWeather, renderWeatherToday, weatherScale } from "./view-weather";
import { themeToggle } from "./theme";
import { getWeather, getWeatherToday, type WeatherHour } from "./weather";

const HISTORY_DAYS = 90;
const REFRESH_MS = 5 * 60_000;
const STUDIO_KEY = "studio";

const picker = document.querySelector<HTMLLabelElement>(".studio-picker")!;
const select = document.querySelector<HTMLSelectElement>("#studio")!;
const studioName = document.querySelector<HTMLElement>("#studio-name")!;
const progress = document.querySelector<HTMLElement>("#progress")!;
const sticky = document.querySelector<HTMLAnchorElement>("#sticky-now")!;
const nowUpdated = document.querySelector<HTMLElement>("#now-updated")!;
const nowStatus = document.querySelector<HTMLElement>("#now-status")!;
const baseTitle = document.title;
const body = (id: string) => document.querySelector<HTMLElement>(`#${id} .view-body`)!;
const views = { now: body("view-now"), weather: body("view-weather"), heatmap: body("view-heatmap"), effect: body("view-effect") };
document.querySelector("#view-effect h2")!.append(infoTip(EFFECT_INFO));
type View = keyof typeof views;
const ALL: View[] = ["now", "weather", "heatmap", "effect"];

type Range = "now" | RangeDays;
const RANGE_OPTIONS = [{ value: "now" as Range, label: "Now" }, ...RANGES.map((d) => ({ value: d as Range, label: `${d} days` }))];

// A string holds an error message, null means still loading.
type Loadable<T> = T | string | null;

interface State {
  studio: Studio;
  now: number;
  nowBody: Loadable<NowBody>;
  hourly: Loadable<HourlyTuple[]>;
  hourlyTo: number;
  model: TypicalModel;
  range: Range;
  weatherRange: Range;
  heatMode: HeatMode | null;
  weather: Loadable<{ days: number; hours: WeatherHour[] }>;
  weatherToday: Loadable<WeatherHour[]>;
  holidays: Loadable<Holiday[]>;
  refreshedAt: number;
}

let state: State | null = null;

// Entrance animations run once per view, and again on a range or mode switch, but not on resize or refresh.
const ENTER_MS = 1800;
const enteredAt = new Map<View | "progress", number>();
let shownValue: number | null = null;

function enter(root: HTMLElement, key: View | "progress", restart = false): void {
  if (restart || !enteredAt.has(key)) enteredAt.set(key, performance.now());
  const elapsed = performance.now() - enteredAt.get(key)!;
  root.classList.toggle("enter", elapsed < ENTER_MS && !reducedMotion());
  // A redraw during the entrance resumes the animations where they were instead of restarting them.
  root.style.setProperty("--t0", `${-Math.round(elapsed)}ms`);
}

function countUp(node: HTMLElement, from: number, to: number): void {
  const start = performance.now();
  const step = (t: number) => {
    if (!node.isConnected) return;
    const k = Math.min(1, (t - start) / 900);
    node.textContent = `${Math.round(from + (to - from) * (1 - (1 - k) ** 3))}%`;
    if (k < 1) requestAnimationFrame(step);
  };
  node.textContent = `${from}%`;
  requestAnimationFrame(step);
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const settled = <T>(r: PromiseSettledResult<T>): T | string => (r.status === "fulfilled" ? r.value : errorText(r.reason));
const nowSeconds = () => Math.floor(Date.now() / 1000);

function updateSticky(summary: NowSummary | null, studio: Studio): void {
  document.title = summary?.value == null ? baseTitle : `${summary.value}% · ${baseTitle}`;
  sticky.hidden = !summary;
  if (!summary) {
    sticky.replaceChildren();
    return;
  }
  const value = summary.value === null ? "n/a" : `${summary.value}%`;
  sticky.replaceChildren(
    ...[
      el("strong", { text: value }),
      summary.term && el("span", { text: summary.term }),
      summary.outlook && el("span", { className: "sticky-outlook", text: summary.outlook }),
      el("span", { className: "sticky-studio", text: studio.name }),
    ].filter((n): n is HTMLElement => !!n),
  );
}

// Swaps the text in place when the kind of status is unchanged, so redraws don't replay its entrance.
function setStatus(node: HTMLElement | null): void {
  const shown = nowStatus.firstElementChild;
  nowStatus.hidden = !node;
  if (node && shown?.className === node.className) shown.replaceChildren(...node.childNodes);
  else nowStatus.replaceChildren(...(node ? [node] : []));
}

// Shows the sticky bar once the big number has scrolled out at the top.
const heroWatcher = new IntersectionObserver(([entry]) => {
  sticky.classList.toggle("show", !entry.isIntersecting && entry.boundingClientRect.top < 0);
});

function draw(which: View[] = ALL, restart = false): void {
  const s = state;
  if (!s) return;
  const hourly = Array.isArray(s.hourly) ? s.hourly : null;
  const weather = s.weather === null || typeof s.weather === "string" ? s.weather : s.weather.hours;
  if (hourly) enter(progress, "progress");
  renderProgress(progress, hourly && dataProgress(hourly, s.model, s.now));
  for (const view of which) {
    const root = views[view];
    let empty = false;
    root.classList.remove("loading");
    try {
      if (view === "now") {
        nowUpdated.textContent = "";
        nowUpdated.classList.remove("live");
        if (typeof s.nowBody === "string") {
          root.replaceChildren(message(`Could not load: ${s.nowBody}`, "error"));
          setStatus(null);
          document.title = baseTitle;
        } else if (s.nowBody) {
          enter(root, view, restart);
          const width = chartWidth(root);
          const picker = segmented(RANGE_OPTIONS, s.range, setRange, "Time range");
          const data = { now: s.now, body: s.nowBody, model: s.model };
          // One axis for every range, so switching ranges does not rescale the chart.
          const yMax = percentMax([todayPeak(data), ...(hourly ? RANGES.map((days) => weekPeak({ ...data, days, hourly })) : [])]);
          const summary = renderNow(root, {
            ...data,
            width,
            picker,
            history: historyBlocks(s, hourly, width, picker, yMax),
            holidays: s.holidays,
            weather: Array.isArray(s.weatherToday) ? s.weatherToday : null,
            yMax,
          });
          const value = summary?.value ?? null;
          const valueNode = root.querySelector<HTMLElement>(".hero-value");
          if (value !== null && value !== shownValue && valueNode && !reducedMotion()) countUp(valueNode, shownValue ?? 0, value);
          shownValue = value;
          nowUpdated.textContent = summary?.updated ?? "";
          nowUpdated.classList.toggle("live", !!summary?.live);
          setStatus(summary?.status ?? null);
          updateSticky(summary, s.studio);
          const hero = root.querySelector(".hero");
          heroWatcher.disconnect();
          if (hero) heroWatcher.observe(hero);
        }
        continue;
      }
      if (view === "weather") {
        const days = s.weatherRange;
        const shown = days === "now" ? s.weatherToday : weather;
        if (shown === null) root.replaceChildren(skeleton(220));
        else if (typeof shown === "string") root.replaceChildren(message(`Weather unavailable: ${shown}`, "error"));
        else {
          enter(root, view, restart);
          const scale = weatherScale(s.now, Array.isArray(s.weatherToday) ? s.weatherToday : null, Array.isArray(weather) ? weather : null);
          const picker = segmented(RANGE_OPTIONS, days, setWeatherRange, "Weather time range");
          const input = { now: s.now, weather: shown, width: chartWidth(root), picker, scale };
          if (days === "now") {
            const hours =
              s.nowBody && typeof s.nowBody === "object" ? todayHours({ now: s.now, body: s.nowBody, model: s.model }) : { lo: 0, hi: 24 };
            renderWeatherToday(root, { ...input, hours });
          } else renderWeather(root, { ...input, days });
        }
        continue;
      }
      if (typeof s.hourly === "string") {
        root.replaceChildren(message(`Could not load history: ${s.hourly}`, "error"));
        continue;
      }
      if (!hourly) continue;
      enter(root, view, restart);
      const width = chartWidth(root);
      if (view === "heatmap") empty = !renderHeatmap(root, { now: s.now, model: s.model, width, mode: s.heatMode, onMode: setHeatMode });
      else empty = !renderEffect(root, { hourly, model: s.model, weather, holidays: s.holidays, width });
    } catch (err) {
      console.error(err);
      root.replaceChildren(message(`Could not draw this view: ${errorText(err)}`, "error"));
    } finally {
      root.parentElement!.classList.toggle("view-empty", empty);
    }
  }
}

function historyBlocks(
  s: State,
  hourly: HourlyTuple[] | null,
  width: number,
  picker: HTMLElement,
  yMax: number,
): HTMLElement[] | null {
  if (s.range === "now") return null;
  const foot = el("div", { className: "chart-foot" }, picker);
  if (typeof s.hourly === "string") return [message(`Could not load history: ${s.hourly}`, "error"), foot];
  if (!hourly) return [skeleton(220), foot];
  const weather = s.weather && typeof s.weather === "object" ? s.weather.hours : null;
  return weekBlocks({ now: s.now, days: s.range, hourly, model: s.model, holidays: s.holidays, weather, width, picker, yMax });
}

function setHeatMode(mode: HeatMode): void {
  if (!state) return;
  state.heatMode = mode;
  draw(["heatmap"], true);
}

async function loadWeather(s: State, days: number): Promise<void> {
  const want = Math.min(HISTORY_DAYS, Math.max(days, dataDays(Array.isArray(s.hourly) ? s.hourly : [], s.now)));
  const { from, to } = lastDays(want, s.now);
  try {
    const hours = await getWeather(s.studio, from, to, s.now);
    if (state === s) s.weather = { days: want, hours };
  } catch (err) {
    if (state === s) s.weather = errorText(err);
  }
}

async function loadWeatherToday(s: State): Promise<void> {
  try {
    const hours = await getWeatherToday(s.studio, s.now);
    if (state === s) s.weatherToday = hours;
  } catch (err) {
    if (state === s) s.weatherToday = errorText(err);
  }
}

function setRange(range: Range): void {
  if (!state) return;
  state.range = range;
  draw(["now"], true);
}

async function setWeatherRange(days: Range): Promise<void> {
  const s = state;
  if (!s) return;
  s.weatherRange = days;
  if (days === "now") return draw(["weather"], true);
  if (s.weather !== null && typeof s.weather !== "string" && s.weather.days >= days) return draw(["weather"], true);
  views.weather.classList.add("loading");
  await loadWeather(s, days);
  if (state !== s) return;
  draw(["weather"], true);
  draw(["effect"]);
}

const profileOf = (body: Loadable<NowBody>) => (typeof body === "object" ? body?.profile?.data : null);

async function loadHourly(s: State): Promise<void> {
  const { from, to } = lastDays(HISTORY_DAYS, s.now);
  const [hourly] = await Promise.allSettled([getHourly(s.studio.branchId, from, to)]);
  if (state !== s) return;
  s.hourly = settled(hourly);
  s.hourlyTo = to;
  s.model = buildTypical(Array.isArray(s.hourly) ? s.hourly : [], profileOf(s.nowBody));
}

async function refreshNow(): Promise<void> {
  const s = state;
  if (!s || document.hidden) return;
  s.now = nowSeconds();
  s.refreshedAt = Date.now();
  const newHour = lastDays(HISTORY_DAYS, s.now).to > s.hourlyTo;
  try {
    const body = await getNow(s.studio.branchId, startOfDay(berlin(s.now).date));
    if (state !== s) return;
    s.nowBody = body;
  } catch (err) {
    if (state !== s) return;
    s.nowBody = errorText(err);
  }
  await loadWeatherToday(s);
  if (state !== s) return;
  if (!newHour) return draw(["now", "weather"]);
  await loadHourly(s);
  if (state === s) draw();
}

async function render(studio: Studio): Promise<void> {
  studioName.textContent = studio.name;
  document.title = baseTitle;
  const now = nowSeconds();
  const s: State = {
    studio,
    now,
    nowBody: null,
    hourly: null,
    hourlyTo: 0,
    model: buildTypical([], null),
    range: state?.range ?? "now",
    weatherRange: state?.weatherRange ?? "now",
    heatMode: state?.heatMode ?? null,
    weather: null,
    weatherToday: null,
    holidays: null,
    refreshedAt: Date.now(),
  };
  state = s;
  enteredAt.clear();
  shownValue = null;
  for (const [view, root] of Object.entries(views)) root.replaceChildren(skeleton(view === "now" ? 300 : 220));

  const { from, to } = lastDays(HISTORY_DAYS, now);
  const holidays = getHolidays(from, to).then((h): Holiday[] | string => h, errorText);
  const [nowBody] = await Promise.allSettled([getNow(studio.branchId, startOfDay(berlin(now).date)), loadHourly(s)]);
  if (state !== s) return;
  s.nowBody = settled(nowBody);
  s.model = buildTypical(Array.isArray(s.hourly) ? s.hourly : [], profileOf(s.nowBody));
  draw();

  await Promise.all([
    // The longest range up front, so the weather axes fit every range from the first draw.
    loadWeather(s, Math.max(...RANGES)),
    loadWeatherToday(s),
    holidays.then((h) => {
      s.holidays = h;
    }),
  ]);
  if (state === s) draw(["now", "weather", "effect"]);
}

function selectedStudio(studios: Studio[]): Studio {
  const find = (v: string | null | undefined) => studios.find((s) => v && s.branchId === Number(v));
  return (
    find(new URLSearchParams(location.search).get("studio")) ??
    find(webStorage("localStorage")?.getItem(STUDIO_KEY)) ??
    studios[0]
  );
}

function watchLayout(): void {
  let lastWidth = views.now.clientWidth;
  let timer: number | undefined;
  new ResizeObserver(() => {
    const w = views.now.clientWidth;
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(timer);
    timer = window.setTimeout(() => draw(), 150);
  }).observe(document.querySelector("#views")!);
  setInterval(refreshNow, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (state && Date.now() - state.refreshedAt > REFRESH_MS) void refreshNow();
  });
}

async function main(): Promise<void> {
  themeToggle(document.querySelector<HTMLButtonElement>("#theme-toggle")!, () => draw());
  let studios: Studio[];
  try {
    studios = await getStudios();
  } catch (err) {
    views.now.replaceChildren(message(`Could not load studios: ${errorText(err)}`, "error"));
    return;
  }
  if (studios.length === 0) {
    views.now.replaceChildren(message("No studios logged yet. The first sample arrives within 5 minutes of deploying."));
    for (const v of [views.weather, views.heatmap, views.effect]) v.replaceChildren(message("Waiting for the first sample."));
    return;
  }

  if (studios.length > 1) {
    select.replaceChildren(...studios.map((s) => new Option(s.name, String(s.branchId))));
    picker.hidden = false;
    select.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("studio", select.value);
      history.replaceState(null, "", url);
      try {
        webStorage("localStorage")?.setItem(STUDIO_KEY, select.value);
      } catch {
        // Storage can be blocked or full; the choice then lives only in the URL.
      }
      void render(selectedStudio(studios));
    });
  }
  const studio = selectedStudio(studios);
  select.value = String(studio.branchId);
  watchLayout();
  await render(studio);
}

void main();
