export interface Studio {
  branchId: number;
  name: string;
  alias: string;
  lat: number | null;
  lon: number | null;
}

export interface LatestSample {
  ts: number;
  percentage: number | null;
  term: string | null;
  hidden: boolean;
  status: number | null;
  error: string | null;
}

/** [weekday 0=Mon..6=Sun][Berlin hour 0..23], unknown unit */
export type Profile = number[][];

export interface NowBody {
  latest: LatestSample | null;
  samples: [number, number | null][];
  profile: { fetchedAt: number; data: Profile } | null;
}

/** [hour_ts, avg_pct, max_pct, n]; n = 12 for a complete hour. */
export type HourlyTuple = [number, number | null, number | null, number];

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new Error(`${path}: ${typeof message === "string" ? message : `HTTP ${res.status}`}`);
  }
  return body as T;
}

export const getStudios = (): Promise<Studio[]> => getJson("/api/studios");

/** `since` should be Berlin midnight (see startOfDay) so the URL, and thus the edge cache key, is stable. */
export const getNow = (branch: number, since: number): Promise<NowBody> =>
  getJson(`/api/now?branch=${branch}&since=${since}`);

export const getSamples = (branch: number, from: number, to: number): Promise<NowBody["samples"]> =>
  getJson(`/api/samples?branch=${branch}&from=${from}&to=${to}`);

export const getHourly =(branch: number, from: number, to: number): Promise<HourlyTuple[]> =>
  getJson(`/api/hourly?branch=${branch}&from=${from}&to=${to}`);
