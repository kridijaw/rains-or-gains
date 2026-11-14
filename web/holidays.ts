import { cached, webStorage } from "./cache";
import { addDays, berlin } from "./time";

const BASE = "https://openholidaysapi.org";
const REGION = "countryIsoCode=DE&subdivisionCode=DE-BE";
const MAX_AGE_MS = 30 * 86400_000;

export type HolidayKind = "public" | "school";

export interface Holiday {
  id: string;
  kind: HolidayKind;
  /** YYYY-MM-DD, inclusive, Berlin dates */
  start: string;
  end: string;
  name: string;
}

export function parseHolidays(body: unknown, kind: HolidayKind): Holiday[] {
  if (!Array.isArray(body)) throw new Error("OpenHolidays response is not an array");
  return body.flatMap((h) => {
    if (typeof h?.startDate !== "string" || typeof h?.endDate !== "string") return [];
    const names: { language?: string; text?: string }[] = Array.isArray(h.name) ? h.name : [];
    const name = (names.find((n) => n.language === "EN") ?? names.find((n) => n.language === "DE") ?? names[0])?.text;
    return [{ id: String(h.id ?? `${h.startDate}:${name}`), kind, start: h.startDate, end: h.endDate, name: name ?? kind }];
  });
}

export function yearsBetween(from: number, to: number): number[] {
  const first = Number(berlin(from).date.slice(0, 4));
  const last = Number(berlin(Math.max(from, to - 1)).date.slice(0, 4));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function holidayCalendar(holidays: readonly Holiday[]): Map<string, Holiday[]> {
  const days = new Map<string, Holiday[]>();
  for (const h of holidays)
    for (let d = h.start; d <= h.end; d = addDays(d, 1)) {
      const list = days.get(d);
      if (!list) days.set(d, [h]);
      else if (!list.some((x) => x.id === h.id && x.kind === h.kind)) list.push(h);
    }
  return days;
}

export function dayKind(calendar: Map<string, Holiday[]>, date: string): HolidayKind | null {
  const list = calendar.get(date);
  if (!list) return null;
  return list.some((h) => h.kind === "public") ? "public" : "school";
}

export function holidayLabel(holidays: readonly Holiday[], date: string): string | null {
  const on = holidays.filter((h) => h.start <= date && date <= h.end);
  const pub = on.find((h) => h.kind === "public");
  const school = on.find((h) => h.kind === "school");
  if (pub) return school ? `Public holiday: ${pub.name}, school holidays` : `Public holiday: ${pub.name}`;
  return school ? `School holidays: ${school.name}` : null;
}

async function fetchKind(kind: HolidayKind, year: number): Promise<Holiday[]> {
  const path = kind === "public" ? "PublicHolidays" : "SchoolHolidays";
  const res = await fetch(`${BASE}/${path}?${REGION}&validFrom=${year}-01-01&validTo=${year}-12-31`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OpenHolidays ${path} HTTP ${res.status}`);
  return parseHolidays(await res.json(), kind);
}

export const getHolidaysForYear = (year: number): Promise<Holiday[]> =>
  cached(webStorage("localStorage"), `holidays:v1:DE-BE:${year}`, MAX_AGE_MS, async () =>
    (await Promise.all([fetchKind("public", year), fetchKind("school", year)])).flat(),
  );

export async function getHolidays(from: number, to: number): Promise<Holiday[]> {
  const perYear = await Promise.all(yearsBetween(from, to).map(getHolidaysForYear));
  const first = berlin(from).date;
  const last = berlin(Math.max(from, to - 1)).date;
  const unique = new Map(perYear.flat().map((h) => [`${h.kind}:${h.id}`, h]));
  return [...unique.values()]
    .filter((h) => h.end >= first && h.start <= last)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
