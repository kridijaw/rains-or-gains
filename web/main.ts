import { getHourly, getNow, getStudios, type HourlyTuple, type NowBody, type Studio } from "./api";
import { chartWidth, el, message } from "./chart";
import { getHolidays, type Holiday } from "./holidays";
import { dataDays, dataProgress } from "./series";
import { berlin, lastDays, startOfDay } from "./time";
import { buildTypical, type TypicalModel } from "./typical";
import { renderEffect } from "./view-effect";
import { renderHeatmap, type HeatMode } from "./view-heatmap";
import { renderNow, type NowSummary } from "./view-now";
import { renderProgress } from "./view-progress";
import { renderWeek, type RangeDays } from "./view-week";
import { getWeather, type WeatherHour } from "./weather";

const HISTORY_DAYS = 90;
const REFRESH_MS = 5 * 60_000;

const picker = document.querySelector<HTMLLabelElement>(".studio-picker")!;
const select = document.querySelector<HTMLSelectElement>("#studio")!;
const studioName = document.querySelector<HTMLElement>("#studio-name")!;
const progress = document.querySelector<HTMLElement>("#progress")!;
const sticky = document.querySelector<HTMLAnchorElement>("#sticky-now")!;
const body = (id: string) => document.querySelector<HTMLElement>(`#${id} .view-body`)!;
const views = { now: body("view-now"), week: body("view-week"), heatmap: body("view-heatmap"), effect: body("view-effect") };
type View = keyof typeof views;
const ALL: View[] = ["now", "week", "heatmap", "effect"];

// A string holds an error message, null means still loading.
type Loadable<T> = T | string | null;

interface State {
  studio: Studio;
  now: number;
  nowBody: Loadable<NowBody>;
  hourly: Loadable<HourlyTuple[]>;
  hourlyTo: number;
  model: TypicalModel;
  days: RangeDays;
  heatMode: HeatMode | null;
  weather: Loadable<{ days: number; hours: WeatherHour[] }>;
  holidays: Loadable<Holiday[]>;
  refreshedAt: number;
}

let state: State | null = null;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const settled = <T>(r: PromiseSettledResult<T>): T | string => (r.status === "fulfilled" ? r.value : errorText(r.reason));
const nowSeconds = () => Math.floor(Date.now() / 1000);

function updateSticky(summary: NowSummary | null, studio: Studio): void {
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

// Shows the sticky bar once the big number has scrolled out at the top.
const heroWatcher = new IntersectionObserver(([entry]) => {
  sticky.classList.toggle("show", !entry.isIntersecting && entry.boundingClientRect.top < 0);
});

function draw(which: View[] = ALL): void {
  const s = state;
  if (!s) return;
  const hourly = Array.isArray(s.hourly) ? s.hourly : null;
  const weather = s.weather === null || typeof s.weather === "string" ? s.weather : s.weather.hours;
  renderProgress(progress, hourly && dataProgress(hourly, s.model, s.now));
  for (const view of which) {
    const root = views[view];
    let empty = false;
    root.classList.remove("loading");
    try {
      if (view === "now") {
        if (typeof s.nowBody === "string") root.replaceChildren(message(`Could not load: ${s.nowBody}`, "error"));
        else if (s.nowBody) {
          updateSticky(renderNow(root, { now: s.now, body: s.nowBody, model: s.model, width: chartWidth(root) }), s.studio);
          const hero = root.querySelector(".hero");
          heroWatcher.disconnect();
          if (hero) heroWatcher.observe(hero);
        }
        continue;
      }
      if (typeof s.hourly === "string") {
        root.replaceChildren(message(`Could not load history: ${s.hourly}`, "error"));
        continue;
      }
      if (!hourly) continue;
      const width = chartWidth(root);
      if (view === "week")
        renderWeek(root, {
          now: s.now,
          days: s.days,
          hourly,
          model: s.model,
          weather,
          holidays: s.holidays,
          width,
          onRange: setRange,
        });
      else if (view === "heatmap") empty = !renderHeatmap(root, { model: s.model, width, mode: s.heatMode, onMode: setHeatMode });
      else empty = !renderEffect(root, { now: s.now, hourly, model: s.model, weather, holidays: s.holidays, width });
    } catch (err) {
      console.error(err);
      root.replaceChildren(message(`Could not draw this view: ${errorText(err)}`, "error"));
    } finally {
      root.parentElement!.classList.toggle("view-empty", empty);
    }
  }
}

function setHeatMode(mode: HeatMode): void {
  if (!state) return;
  state.heatMode = mode;
  draw(["heatmap"]);
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

async function setRange(days: RangeDays): Promise<void> {
  const s = state;
  if (!s) return;
  s.days = days;
  if (s.weather !== null && typeof s.weather !== "string" && s.weather.days >= days) return draw(["week"]);
  views.week.classList.add("loading");
  await loadWeather(s, days);
  if (state === s) draw(["week", "effect"]);
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
  if (!newHour) return draw(["now"]);
  await loadHourly(s);
  if (state === s) draw();
}

async function render(studio: Studio): Promise<void> {
  studioName.textContent = studio.name;
  const now = nowSeconds();
  const s: State = {
    studio,
    now,
    nowBody: null,
    hourly: null,
    hourlyTo: 0,
    model: buildTypical([], null),
    days: state?.days ?? 7,
    heatMode: state?.heatMode ?? null,
    weather: null,
    holidays: null,
    refreshedAt: Date.now(),
  };
  state = s;
  for (const root of Object.values(views)) root.replaceChildren(message("Loading…"));

  const { from, to } = lastDays(HISTORY_DAYS, now);
  const holidays = getHolidays(from, to).then((h): Holiday[] | string => h, errorText);
  const [nowBody] = await Promise.allSettled([getNow(studio.branchId, startOfDay(berlin(now).date)), loadHourly(s)]);
  if (state !== s) return;
  s.nowBody = settled(nowBody);
  s.model = buildTypical(Array.isArray(s.hourly) ? s.hourly : [], profileOf(s.nowBody));
  draw();

  await Promise.all([
    loadWeather(s, s.days),
    holidays.then((h) => {
      s.holidays = h;
    }),
  ]);
  if (state === s) draw(["week", "effect"]);
}

function selectedStudio(studios: Studio[]): Studio {
  const wanted = Number(new URLSearchParams(location.search).get("studio"));
  return studios.find((s) => s.branchId === wanted) ?? studios[0];
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
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => draw());
  setInterval(refreshNow, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (state && Date.now() - state.refreshedAt > REFRESH_MS) void refreshNow();
  });
}

async function main(): Promise<void> {
  let studios: Studio[];
  try {
    studios = await getStudios();
  } catch (err) {
    views.now.replaceChildren(message(`Could not load studios: ${errorText(err)}`, "error"));
    return;
  }
  if (studios.length === 0) {
    views.now.replaceChildren(message("No studios logged yet. The first sample arrives within 5 minutes of deploying."));
    for (const v of [views.week, views.heatmap, views.effect]) v.replaceChildren(message("Waiting for the first sample."));
    return;
  }

  if (studios.length > 1) {
    select.replaceChildren(...studios.map((s) => new Option(s.name, String(s.branchId))));
    picker.hidden = false;
    select.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("studio", select.value);
      history.replaceState(null, "", url);
      void render(selectedStudio(studios));
    });
  }
  const studio = selectedStudio(studios);
  select.value = String(studio.branchId);
  watchLayout();
  await render(studio);
}

void main();
