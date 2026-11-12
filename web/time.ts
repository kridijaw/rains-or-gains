export const TZ = "Europe/Berlin";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface LocalHour {
  /** YYYY-MM-DD in Berlin */
  date: string;
  /** 0 = Monday */
  weekday: number;
  hour: number;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const memo = new Map<number, LocalHour>();

export const hourFloor = (ts: number): number => ts - (((ts % 3600) + 3600) % 3600);

// Berlin offsets are whole hours, so every second of a UTC hour shares one local hour.
export function berlin(ts: number): LocalHour {
  const hourTs = hourFloor(ts);
  let local = memo.get(hourTs);
  if (!local) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(hourTs * 1000)).map((x) => [x.type, x.value]));
    local = {
      date: `${p.year}-${p.month}-${p.day}`,
      weekday: WEEKDAYS.indexOf(p.weekday as (typeof WEEKDAYS)[number]),
      hour: Number(p.hour),
    };
    memo.set(hourTs, local);
  }
  return local;
}

export const startOfUtcDay = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
};

export const utcDate = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => utcDate(startOfUtcDay(date) + days * 86400);

export const daysBetween = (from: string, to: string): number => Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / 86400);

function offsetAt(ts: number): number {
  const { date, hour } = berlin(ts);
  return startOfUtcDay(date) + hour * 3600 - hourFloor(ts);
}

export function startOfDay(date: string): number {
  const midnightUtc = startOfUtcDay(date);
  return midnightUtc - offsetAt(midnightUtc - offsetAt(midnightUtc));
}

// Hour-aligned and stable within an hour, so API requests hit the edge cache.
export function lastDays(days: number, now: number): { from: number; to: number } {
  return { from: startOfDay(addDays(berlin(now).date, 1 - days)), to: hourFloor(now) + 3600 };
}
