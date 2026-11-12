import { cached, webStorage } from "./cache";
import { addDays, daysBetween, startOfUtcDay, utcDate } from "./time";

// The archive API lags about 5 days and returns nulls for that tail; one spare day avoids gaps.
export const ARCHIVE_LAG_DAYS = 6;
const HOURLY = "temperature_2m,precipitation,sunshine_duration,cloud_cover";
const RECENT_MAX_AGE_MS = 3600_000;
const OLD_MAX_AGE_MS = 7 * 86400_000;

export interface WeatherHour {
  ts: number;
  temperature: number | null;
  /** mm in the preceding hour */
  precipitation: number | null;
  /** seconds of sunshine in the preceding hour */
  sunshine: number | null;
  cloudCover: number | null;
}

export interface WeatherRequest {
  api: "archive" | "forecast";
  url: string;
}

export function weatherRequests(lat: number, lon: number, start: string, end: string, today: string): WeatherRequest[] {
  const common = `latitude=${lat}&longitude=${lon}&hourly=${HOURLY}&timezone=UTC&timeformat=unixtime`;
  const lastArchive = addDays(today, -ARCHIVE_LAG_DAYS);
  const requests: WeatherRequest[] = [];
  if (start <= lastArchive) {
    const archiveEnd = end < lastArchive ? end : lastArchive;
    requests.push({
      api: "archive",
      url: `https://archive-api.open-meteo.com/v1/archive?${common}&start_date=${start}&end_date=${archiveEnd}`,
    });
  }
  if (end > lastArchive && start <= today) {
    const recentStart = start > lastArchive ? start : addDays(lastArchive, 1);
    requests.push({
      api: "forecast",
      url: `https://api.open-meteo.com/v1/forecast?${common}&past_days=${daysBetween(recentStart, today)}&forecast_days=1`,
    });
  }
  return requests;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseOpenMeteo(body: unknown): WeatherHour[] {
  const hourly = (body as { hourly?: Record<string, unknown[]> } | null)?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) throw new Error("Open-Meteo response has no hourly.time");
  const col = (name: string, i: number) => numOrNull(hourly[name]?.[i]);
  return hourly.time.flatMap((t, i) =>
    typeof t === "number"
      ? [
          {
            ts: t,
            temperature: col("temperature_2m", i),
            precipitation: col("precipitation", i),
            sunshine: col("sunshine_duration", i),
            cloudCover: col("cloud_cover", i),
          },
        ]
      : [],
  );
}

// Earlier responses win on overlap.
export function mergeWeather(parts: readonly WeatherHour[][], from: number, to: number): WeatherHour[] {
  const byTs = new Map<number, WeatherHour>();
  for (const part of parts) for (const h of part) if (h.ts >= from && h.ts < to && !byTs.has(h.ts)) byTs.set(h.ts, h);
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function getWeather(
  coords: { lat: number | null; lon: number | null },
  from: number,
  to: number,
  now = Date.now() / 1000,
): Promise<WeatherHour[]> {
  const { lat, lon } = coords;
  if (lat === null || lon === null) throw new Error("studio has no coordinates");
  const start = utcDate(from);
  const end = utcDate(to - 1);
  const today = utcDate(now);
  const maxAge = end > addDays(today, -ARCHIVE_LAG_DAYS) ? RECENT_MAX_AGE_MS : OLD_MAX_AGE_MS;
  const key = `weather:v1:${lat.toFixed(3)},${lon.toFixed(3)}:${start}:${end}`;

  const hours = await cached(webStorage("sessionStorage"), key, maxAge, async () => {
    const bodies = await Promise.all(weatherRequests(lat, lon, start, end, today).map((r) => fetchJson(r.url)));
    return mergeWeather(bodies.map(parseOpenMeteo), startOfUtcDay(start), startOfUtcDay(end) + 86400);
  });
  return hours.filter((h) => h.ts >= from && h.ts < to);
}
