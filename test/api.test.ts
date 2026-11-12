import { describe, expect, it } from "vitest";
import {
  cacheKeyUrl,
  HOURLY_MAX_SPAN,
  NOW_MAX_SPAN,
  parseBranch,
  parseHourlyQuery,
  parseInteger,
  parseNowQuery,
  toHourly,
  toLatest,
  toProfile,
  toStudios,
} from "../src/api";

const q = (s: string) => new URLSearchParams(s);
const STUDIOS = [82];

describe("parseInteger", () => {
  it("accepts plain integers only", () => {
    expect(parseInteger("82")).toBe(82);
    expect(parseInteger("-5")).toBe(-5);
    expect(parseInteger(null)).toBeNull();
    for (const bad of ["", "1.5", "1e3", " 1", "0x10", "abc", "9".repeat(16)]) expect(parseInteger(bad)).toBeNull();
  });
});

describe("parseBranch", () => {
  it("requires a known integer branch", () => {
    expect(parseBranch(q("branch=82"), STUDIOS)).toEqual({ ok: true, value: 82 });
    expect(parseBranch(q("branch=83"), STUDIOS)).toEqual({ ok: false, error: "unknown branch 83" });
    expect(parseBranch(q(""), STUDIOS).ok).toBe(false);
    expect(parseBranch(q("branch=82.0"), STUDIOS).ok).toBe(false);
  });
});

describe("parseNowQuery", () => {
  const now = 1_800_000_000;
  const hour = (ts: number) => ts - (ts % 3600);

  it("passes a recent since through", () => {
    expect(parseNowQuery(q(`branch=82&since=${hour(now) - 3600}`), STUDIOS, now)).toEqual({
      ok: true,
      value: { branch: 82, since: hour(now) - 3600 },
    });
  });

  it("caps since at 36 hours back and defaults to 24 hours, both hour-aligned", () => {
    expect(parseNowQuery(q("branch=82&since=0"), STUDIOS, now)).toEqual({
      ok: true,
      value: { branch: 82, since: hour(now - NOW_MAX_SPAN) },
    });
    expect(parseNowQuery(q("branch=82"), STUDIOS, now)).toEqual({
      ok: true,
      value: { branch: 82, since: hour(now - 86400) },
    });
  });

  it("rejects bad input", () => {
    expect(parseNowQuery(q("branch=82&since=yesterday"), STUDIOS, now).ok).toBe(false);
    expect(parseNowQuery(q("branch=82&since=-1"), STUDIOS, now).ok).toBe(false);
    expect(parseNowQuery(q("since=3600"), STUDIOS, now).ok).toBe(false);
    expect(parseNowQuery(q(`branch=82&since=${hour(now) - 1}`), STUDIOS, now).ok).toBe(false);
  });
});

describe("parseHourlyQuery", () => {
  it("accepts a valid range", () => {
    expect(parseHourlyQuery(q("branch=82&from=3600&to=7200"), STUDIOS)).toEqual({
      ok: true,
      value: { branch: 82, from: 3600, to: 7200 },
    });
    expect(parseHourlyQuery(q(`branch=82&from=0&to=${HOURLY_MAX_SPAN}`), STUDIOS).ok).toBe(true);
  });

  it("rejects missing, inverted and oversized ranges", () => {
    expect(parseHourlyQuery(q("branch=82&from=3600"), STUDIOS).ok).toBe(false);
    expect(parseHourlyQuery(q("branch=82&from=7200&to=7200"), STUDIOS)).toEqual({
      ok: false,
      error: "to must be after from",
    });
    expect(parseHourlyQuery(q(`branch=82&from=0&to=${HOURLY_MAX_SPAN + 3600}`), STUDIOS).ok).toBe(false);
    expect(parseHourlyQuery(q("branch=1&from=0&to=3600"), STUDIOS).ok).toBe(false);
  });

  it("rejects bounds that are not hour-aligned", () => {
    expect(parseHourlyQuery(q("branch=82&from=3601&to=7200"), STUDIOS).ok).toBe(false);
    expect(parseHourlyQuery(q("branch=82&from=3600&to=7201"), STUDIOS).ok).toBe(false);
  });
});

describe("cacheKeyUrl", () => {
  it("is built from parsed values only", () => {
    expect(cacheKeyUrl("https://gym.kridi.dev", "/api/hourly", { branch: 82, from: 0, to: 3600 })).toBe(
      "https://gym.kridi.dev/api/hourly?branch=82&from=0&to=3600",
    );
    expect(cacheKeyUrl("https://gym.kridi.dev", "/api/studios", {})).toBe("https://gym.kridi.dev/api/studios");
  });
});

describe("response shapes", () => {
  it("maps studios and drops ones not in STUDIOS", () => {
    const rows = [
      { branch_id: 82, name: "Berlin-East Side Mall", alias: "berlin-east-side-mall", lat: 52.5, lon: 13.4 },
      { branch_id: 99, name: "Old", alias: "old", lat: null, lon: null },
    ];
    expect(toStudios(rows, STUDIOS)).toEqual([
      { branchId: 82, name: "Berlin-East Side Mall", alias: "berlin-east-side-mall", lat: 52.5, lon: 13.4 },
    ]);
  });

  it("maps the latest sample, including error rows", () => {
    expect(toLatest(undefined)).toBeNull();
    expect(
      toLatest({ ts: 10, percentage: null, term: null, hidden: 0, status: null, error: "HTTP 503" }),
    ).toEqual({ ts: 10, percentage: null, term: null, hidden: false, status: null, error: "HTTP 503" });
    expect(toLatest({ ts: 10, percentage: 111, term: "full", hidden: 1, status: 2, error: null })?.hidden).toBe(true);
  });

  it("parses the stored profile grid", () => {
    expect(toProfile(undefined)).toBeNull();
    expect(toProfile({ fetched_at: 5, data: "[[1,2],[3,4]]" })).toEqual({ fetchedAt: 5, data: [[1, 2], [3, 4]] });
  });

  it("emits compact hourly tuples with avg rounded to 0.1", () => {
    expect(
      toHourly([
        { hour_ts: 3600, avg_pct: 41.6666, max_pct: 50, n: 12 },
        { hour_ts: 7200, avg_pct: null, max_pct: null, n: 0 },
      ]),
    ).toEqual([
      [3600, 41.7, 50, 12],
      [7200, null, null, 0],
    ]);
  });
});
