import { describe, expect, it } from "vitest";
import type { HourlyTuple } from "../web/api";
import { readCache, writeCache, type Store } from "../web/cache";
import {
  dailyPrecipitation,
  dataDays,
  dataProgress,
  dayTicks,
  freshness,
  groupStats,
  hourOfDay,
  hourSeries,
  lastGood,
  outlook,
  OUTLOOK_DECAY_H,
  rainBucket,
  residuals,
  termLabel,
  usualValue,
} from "../web/series";
import { dayKind, holidayCalendar, parseHolidays, yearsBetween } from "../web/holidays";
import { addDays, berlin, daysBetween, hourFloor, lastDays, startOfDay } from "../web/time";
import { buildTypical, cellStats, describeSource, fitScale, MIN_FIT_HOURS, openHours, typicalDay } from "../web/typical";
import { mergeWeather, parseOpenMeteo, weatherRequests } from "../web/weather";

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const at = (date: string, hour: number) => startOfDay(date) + hour * 3600;
const profile = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h < 6 ? 0 : 10 * (d + 1) + h)));

describe("time", () => {
  it("converts UTC to Berlin weekday (0 = Monday) and hour", () => {
    expect(berlin(utc(2026, 11, 12, 18, 23))).toEqual({ date: "2026-11-12", weekday: 3, hour: 19 });
    expect(berlin(utc(2026, 7, 5, 22))).toEqual({ date: "2026-07-06", weekday: 0, hour: 0 });
    expect(berlin(utc(2026, 11, 15, 12)).weekday).toBe(6);
  });

  it("handles DST changes", () => {
    expect(berlin(utc(2026, 3, 29, 0)).hour).toBe(1);
    expect(berlin(utc(2026, 3, 29, 1)).hour).toBe(3);
    expect(berlin(utc(2026, 10, 25, 0)).hour).toBe(2);
    expect(berlin(utc(2026, 10, 25, 1)).hour).toBe(2);
  });

  it("finds Berlin midnight, including on DST days", () => {
    expect(startOfDay("2026-11-12")).toBe(utc(2026, 11, 11, 23));
    expect(startOfDay("2026-07-06")).toBe(utc(2026, 7, 5, 22));
    expect(startOfDay("2026-03-29")).toBe(utc(2026, 3, 28, 23));
    expect(startOfDay("2026-03-30")).toBe(utc(2026, 3, 29, 22));
    expect(startOfDay("2026-10-25")).toBe(utc(2026, 10, 24, 22));
    expect(startOfDay("2026-10-26")).toBe(utc(2026, 10, 25, 23));
  });

  it("does date arithmetic and hour-aligned ranges", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-20", "2026-11-12")).toBe(23);
    expect(hourFloor(utc(2026, 11, 12, 18, 23))).toBe(utc(2026, 11, 12, 18));
    expect(lastDays(7, utc(2026, 11, 12, 18, 23))).toEqual({ from: utc(2026, 11, 5, 23), to: utc(2026, 11, 12, 19) });
    expect(lastDays(1, utc(2026, 11, 12, 18, 23)).from).toBe(startOfDay("2026-11-12"));
  });
});

describe("typical", () => {
  const mondays = ["2026-10-26", "2026-11-02", "2026-11-09"];

  it("uses own data once a cell has 3 distinct weeks", () => {
    const rows: HourlyTuple[] = mondays.map((d, i) => [at(d, 18), 60 + 10 * i, 90, 12]);
    const model = buildTypical(rows, profile);
    expect(model.typical(0, 18)).toEqual({ value: 70, source: "own", weeks: 3 });
    expect(model.own[0][18]).toEqual({ mean: 70, n: 36, weeks: 3 });
  });

  it("weights the mean by sample count and ignores empty hours", () => {
    const rows: HourlyTuple[] = [
      [at(mondays[0], 18), 60, 70, 12],
      [at(mondays[1], 18), 90, 95, 6],
      [at(mondays[2], 18), null, null, 0],
    ];
    expect(cellStats(rows)[0][18]).toEqual({ mean: 70, n: 18, weeks: 2 });
  });

  it("falls back to the profile as relative shape before a scale can be fitted", () => {
    const rows: HourlyTuple[] = mondays.slice(0, 2).map((d) => [at(d, 18), 50, 60, 12]);
    const model = buildTypical(rows, profile);
    expect(model.scale).toBeNull();
    expect(model.typical(0, 18)).toEqual({ value: profile[0][18], source: "profile-relative", weeks: 2 });
    expect(describeSource("profile-relative", model)).toMatch(/relative/);
  });

  it("fits one scale factor from overlapping hours and applies it to the profile", () => {
    const rows: HourlyTuple[] = [];
    for (let h = 6; h < 6 + MIN_FIT_HOURS; h++) rows.push([at("2026-11-11", h), 0.8 * profile[2][h], 100, 12]);
    rows.push([at("2026-11-11", 2), 3, 3, 12]);
    expect(fitScale(rows, profile).hours).toBe(MIN_FIT_HOURS);
    const model = buildTypical(rows, profile);
    expect(model.scale).toBeCloseTo(0.8, 10);
    expect(model.typical(4, 20).source).toBe("profile-scaled");
    expect(model.typical(4, 20).value).toBeCloseTo(0.8 * profile[4][20], 10);
    expect(describeSource("profile-scaled", model)).toContain("×0.80");
  });

  it("derives opening hours from the profile, else from fully observed own days", () => {
    expect(openHours(buildTypical([], profile), 0)).toEqual({ open: 6, close: 24 });
    const day: HourlyTuple[] = Array.from({ length: 24 }, (_, h) => [at("2026-11-09", h), h < 7 || h >= 22 ? 0 : 40, 50, 12]);
    expect(openHours(buildTypical(day, null), 0)).toEqual({ open: 7, close: 22 });
    expect(openHours(buildTypical(day.slice(18), null), 0)).toBeNull();
    expect(openHours(buildTypical(day, null), 1)).toBeNull();
  });

  it("reports none without data or a valid profile", () => {
    const model = buildTypical([], [[1, 2, 3]]);
    expect(model.profile).toBeNull();
    expect(model.typical(0, 0)).toEqual({ value: null, source: "none", weeks: 0 });
    expect(typicalDay(model, 6)).toHaveLength(24);
    expect(buildTypical([], null).typical(3, 12).source).toBe("none");
  });
});

describe("weather", () => {
  const today = "2026-11-12";
  const urls = (start: string, end: string) => weatherRequests(52.5, 13.45, start, end, today);

  it("uses the archive for old ranges", () => {
    const [req, ...rest] = urls("2026-10-01", "2026-10-31");
    expect(rest).toEqual([]);
    expect(req.api).toBe("archive");
    expect(req.url).toContain("archive-api.open-meteo.com/v1/archive?");
    expect(req.url).toContain("start_date=2026-10-01&end_date=2026-10-31");
    expect(req.url).toContain("hourly=temperature_2m,precipitation,sunshine_duration,cloud_cover");
    expect(req.url).toContain("timezone=UTC");
  });

  it("uses the forecast API with past_days for recent ranges", () => {
    const reqs = urls("2026-11-10", "2026-11-12");
    expect(reqs).toHaveLength(1);
    expect(reqs[0].api).toBe("forecast");
    expect(reqs[0].url).toContain("api.open-meteo.com/v1/forecast?");
    expect(reqs[0].url).toContain("past_days=2&forecast_days=1");
  });

  it("splits a range that spans the archive lag", () => {
    const [archive, forecast] = urls("2026-11-01", "2026-11-12");
    expect(archive.url).toContain("start_date=2026-11-01&end_date=2026-11-06");
    expect(forecast.url).toContain("past_days=5");
  });

  it("parses and merges hourly responses", () => {
    const body = {
      hourly: {
        time: [100, 3700, 7300],
        temperature_2m: [1.5, null, 2],
        precipitation: [0, 0.4, 0],
        sunshine_duration: [0, 0, 1800],
        cloud_cover: [100, 90, 40],
      },
    };
    const parsed = parseOpenMeteo(body);
    expect(parsed[1]).toEqual({ ts: 3700, temperature: null, precipitation: 0.4, sunshine: 0, cloudCover: 90 });
    const later = [{ ...parsed[2], temperature: 9 }, { ts: 10900, temperature: 3, precipitation: 0, sunshine: 0, cloudCover: 0 }];
    expect(mergeWeather([parsed, later], 3700, 10900).map((h) => [h.ts, h.temperature])).toEqual([
      [3700, null],
      [7300, 2],
    ]);
    expect(() => parseOpenMeteo({ error: true })).toThrow(/hourly/);
  });
});

describe("holidays", () => {
  const body = [
    {
      id: "a",
      startDate: "2026-12-23",
      endDate: "2027-01-02",
      name: [
        { language: "DE", text: "Weihnachtsferien" },
        { language: "EN", text: "Christmas holidays" },
      ],
    },
    { id: "b", startDate: "2026-12-25", endDate: "2026-12-25", name: [{ language: "DE", text: "1. Weihnachtstag" }] },
    { broken: true },
  ];

  it("parses OpenHolidays entries and prefers English names", () => {
    const school = parseHolidays(body, "school");
    expect(school).toHaveLength(2);
    expect(school[0]).toEqual({ id: "a", kind: "school", start: "2026-12-23", end: "2027-01-02", name: "Christmas holidays" });
    expect(school[1].name).toBe("1. Weihnachtstag");
    expect(() => parseHolidays({}, "public")).toThrow();
  });

  it("expands spans to days with public taking precedence", () => {
    const [school] = parseHolidays(body.slice(0, 1), "school");
    const [xmas] = parseHolidays(body.slice(1, 2), "public");
    const cal = holidayCalendar([school, xmas, school]);
    expect(cal.size).toBe(11);
    expect(cal.get("2026-12-25")).toHaveLength(2);
    expect(dayKind(cal, "2026-12-25")).toBe("public");
    expect(dayKind(cal, "2027-01-02")).toBe("school");
    expect(dayKind(cal, "2027-01-03")).toBeNull();
  });

  it("lists the Berlin years a range touches", () => {
    expect(yearsBetween(startOfDay("2026-12-01"), startOfDay("2027-01-01"))).toEqual([2026]);
    expect(yearsBetween(startOfDay("2026-12-01"), startOfDay("2027-01-01") + 1)).toEqual([2026, 2027]);
  });
});

describe("cache", () => {
  const memory = (): Store => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  };

  it("returns fresh entries and drops expired or corrupt ones", () => {
    const store = memory();
    writeCache(store, "k", { a: 1 }, 1000);
    expect(readCache(store, "k", 500, 1400)).toEqual({ a: 1 });
    expect(readCache(store, "k", 500, 1600)).toBeNull();
    expect(store.getItem("k")).toBeNull();
    store.setItem("bad", "{");
    expect(readCache(store, "bad", 500)).toBeNull();
    expect(readCache(null, "k", 500)).toBeNull();
  });
});

describe("series", () => {
  const latest = (ts: number, extra: Partial<{ percentage: number | null; hidden: boolean; error: string | null }> = {}) => ({
    ts,
    percentage: 50,
    term: "medium",
    hidden: false,
    status: 2,
    error: null,
    ...extra,
  });

  it("classifies the latest sample", () => {
    const now = utc(2026, 11, 12, 18);
    expect(freshness(null, now)).toEqual({ state: "none" });
    expect(freshness(latest(now - 300), now)).toEqual({ state: "ok", age: 300 });
    expect(freshness(latest(now - 16 * 60), now).state).toBe("stale");
    expect(freshness(latest(now - 60, { error: "HTTP 503", percentage: null }), now).state).toBe("error");
    expect(freshness(latest(now - 60, { hidden: true, percentage: null }), now).state).toBe("hidden");
  });

  it("finds the last good reading and labels terms", () => {
    expect(lastGood([[1, 10], [2, 20], [3, null]])).toEqual({ ts: 2, percentage: 20 });
    expect(lastGood([[1, null]])).toBeNull();
    expect(termLabel("vhigh")).toBe("Very busy");
    expect(termLabel("odd")).toBe("odd");
    expect(termLabel(null)).toBeNull();
  });

  it("places samples on the Berlin hour of day", () => {
    expect(hourOfDay(utc(2026, 11, 12, 17, 30))).toBe(18.5);
    expect(hourOfDay(utc(2026, 7, 5, 22, 15))).toBe(0.25);
  });

  it("puts day ticks on Berlin midnights and thins them", () => {
    const from = startOfDay("2026-11-06");
    const to = at("2026-11-12", 20);
    expect(dayTicks(from, to, 10)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => startOfDay(addDays("2026-11-06", i))));
    expect(dayTicks(from, to, 4)).toEqual([0, 2, 4, 6].map((i) => startOfDay(addDays("2026-11-06", i))));
    expect(dayTicks(startOfDay("2026-03-28"), startOfDay("2026-03-30"), 10)).toEqual([
      utc(2026, 3, 27, 23),
      utc(2026, 3, 28, 23),
      utc(2026, 3, 29, 22),
    ]);
  });

  it("fills missing hours with null so lines break", () => {
    const from = at("2026-11-12", 10);
    const rows: HourlyTuple[] = [[from, 40, 45, 12], [from + 7200, 60, 70, 6]];
    const pts = hourSeries(rows, from, from + 3 * 3600, () => 50);
    expect(pts.map((p) => p.avg)).toEqual([40, null, 60]);
    expect(pts.map((p) => p.n)).toEqual([12, 0, 6]);
    expect(pts.every((p) => p.typical === 50)).toBe(true);
  });

  it("only uses typical values on the percentage scale", () => {
    const relative = buildTypical([], profile);
    expect(usualValue(relative)(3, 18)).toBeNull();
    const hours: HourlyTuple[] = Array.from({ length: MIN_FIT_HOURS }, (_, i) => [at("2026-11-12", 8 + i), 50, 50, 12]);
    expect(usualValue(buildTypical(hours, profile))(3, 18)).not.toBeNull();
  });

  it("counts data days including today", () => {
    expect(dataDays([], utc(2026, 11, 12))).toBe(0);
    expect(dataDays([[at("2026-11-10", 9), 30, 30, 12]], at("2026-11-12", 20))).toBe(3);
  });

  it("sums precipitation per Berlin day using the preceding hour", () => {
    const h = (ts: number, mm: number | null) => ({ ts, temperature: 5, precipitation: mm, sunshine: 0, cloudCover: 50 });
    const days = dailyPrecipitation([h(at("2026-11-12", 0), 1), h(at("2026-11-12", 1), 0.5), h(at("2026-11-12", 2), null)]);
    expect(days.map((d) => [d.date, d.precipitation])).toEqual([
      ["2026-11-11", 1],
      ["2026-11-12", 0.5],
    ]);
  });

  it("computes residuals with weather from the end of the hour and holiday groups", () => {
    const ts = at("2026-10-03", 11);
    const model = { typical: () => ({ value: 40, source: "own" as const, weeks: 3 }) };
    const weather = [{ ts: ts + 3600, temperature: 12, precipitation: 0.4, sunshine: 0, cloudCover: 90 }];
    const holidays = [{ id: "u", kind: "public" as const, start: "2026-10-03", end: "2026-10-03", name: "German Unity Day" }];
    const [r] = residuals([[ts, 55, 60, 12], [ts + 3600, null, null, 0]], model, weather, holidays);
    expect(r).toMatchObject({ residual: 15, temperature: 12, precipitation: 0.4, day: "Public holiday" });
    expect(residuals([[ts, 55, 60, 12]], { typical: () => ({ value: 90, source: "profile-relative", weeks: 0 }) }, [], [])).toEqual([]);
  });

  it("buckets rain and summarises groups", () => {
    expect([0, 0.2, 1, 3].map(rainBucket)).toEqual(["Dry", "Under 1 mm", "1 mm or more", "1 mm or more"]);
    const stats = groupStats(
      [1, 2, 3, 10],
      ["low", "high", "none"] as const,
      (v) => (v < 5 ? "low" : "high"),
      (v) => v,
      (v) => (v < 2 ? "2026-10-03" : "2026-10-04"),
    );
    expect(stats).toEqual([
      { group: "low", n: 3, days: 2, mean: 2, median: 2 },
      { group: "high", n: 1, days: 1, mean: 10, median: 10 },
      { group: "none", n: 0, days: 0, mean: null, median: null },
    ]);
  });

  describe("outlook", () => {
    const usual = Array.from({ length: 24 }, (_, h) => ({ 18: 80, 19: 80, 20: 60, 21: 40, 22: 30 })[h] ?? (h >= 6 && h < 23 ? 50 : null));
    const hours = { open: 6, close: 23 };

    it("finds the first clearly quieter hour and the quietest one left", () => {
      const o = outlook(usual, hours, 18.5, 80)!;
      expect(o.state).toBe("open");
      expect(o.quieterFrom).toEqual({ hour: 20, v: 60 });
      expect(o.best).toEqual({ hour: 22, v: 30 });
      expect(o.peak).toEqual({ hour: 19, v: 80 });
      expect(o.expected.map((e) => e.x)).toEqual([18.5, 19.5, 20.5, 21.5, 22.5]);
    });

    it("shifts the usual curve by today's difference and lets it fade", () => {
      const o = outlook(usual, hours, 18.5, 100)!;
      expect(o.expected[0]).toEqual({ x: 18.5, v: 100 });
      expect(o.expected[1].v).toBeCloseTo(80 + 20 * Math.exp(-1 / OUTLOOK_DECAY_H), 10);
      expect(outlook(usual, hours, 18.5, 30)!.best).toBeNull();
    });

    it("handles closed hours and missing usual values", () => {
      const before = outlook(usual, hours, 3, 0)!;
      expect(before.state).toBe("before");
      expect(before.best).toEqual({ hour: 22, v: 30 });
      expect(before.expected).toEqual([]);
      const after = outlook(usual, hours, 23.5, 5)!;
      expect(after.state).toBe("after");
      expect(after.best).toBeNull();
      expect(outlook(Array(24).fill(null), hours, 12, 50)).toBeNull();
    });
  });

  it("summarises how far data collection has come", () => {
    const rows: HourlyTuple[] = [];
    for (let h = 6; h < 6 + MIN_FIT_HOURS; h++) rows.push([at("2026-11-11", h), 0.8 * profile[2][h], 100, 12]);
    const model = buildTypical(rows, profile);
    const p = dataProgress(rows, model, at("2026-11-12", 10));
    expect(p).toMatchObject({
      since: "2026-11-11",
      days: 2,
      profile: true,
      fitHours: MIN_FIT_HOURS,
      onScale: true,
      ownShare: 0,
      ownCompleteFrom: "2026-12-02",
      comparableHours: MIN_FIT_HOURS,
      effectFrom: "2026-12-09",
    });
    expect(dataProgress([], buildTypical([], null), at("2026-11-12", 10))).toMatchObject({ since: null, onScale: false });
  });
});
