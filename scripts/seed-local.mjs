// Usage: npm run seed:local [-- --days 60]
// Fills the LOCAL D1 database with synthetic samples for branch 82 and rebuilds the hourly rollup.
// Occupancy rises in hours that really rained in Berlin (Open-Meteo), so the weather effect view has something to find.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv.some((a) => a.startsWith("--remote"))) {
  console.error("seed-local only ever writes to the local database; refusing --remote.");
  process.exit(1);
}

const BRANCH = 82;
const SLOT = 300;
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 60;
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 400) {
  console.error("--days must be an integer between 1 and 400");
  process.exit(1);
}

const d1 = (...args) => execFileSync("npx", ["wrangler", "d1", ...args], { stdio: "inherit" });

// mulberry32: deterministic, so repeated seeds produce the same series.
let state = 82;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const berlin = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function localTime(ts) {
  const parts = Object.fromEntries(berlin.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
  return { weekday: WEEKDAYS.indexOf(parts.weekday), hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

const bump = (h, center, width, height) => height * Math.exp(-(((h - center) / width) ** 2));

// Open 24/7 like the real studio: a thin floor at night, never zero.
function shape(weekday, h) {
  const base = h < 6 || h >= 23 ? 3 : 8;
  if (weekday >= 5) return base + bump(h, 14, 3.2, 80);
  return base + bump(h, 9, 1.6, 30) + bump(h, 18.5, 2.2, 100 + (weekday === 0 ? 15 : 0));
}

const LAT = 52.5064596;
const LON = 13.4460136;
// Must match web/weather.ts: the dashboard has to see the same rain that shaped the samples.
const ARCHIVE_LAG_DAYS = 6;

const utcDate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const dayTs = (date) => Date.parse(`${date}T00:00:00Z`) / 1000;
const addDays = (date, n) => utcDate(dayTs(date) + n * 86400);

/** Open-Meteo precipitation keyed by hour end (its value at h covers the hour before h). */
async function fetchRain(from, to) {
  const common = `latitude=${LAT}&longitude=${LON}&hourly=precipitation&timezone=UTC&timeformat=unixtime`;
  const start = utcDate(from);
  const end = utcDate(to);
  const today = utcDate(Date.now() / 1000);
  const lastArchive = addDays(today, -ARCHIVE_LAG_DAYS);
  const urls = [];
  if (start <= lastArchive)
    urls.push(`https://archive-api.open-meteo.com/v1/archive?${common}&start_date=${start}&end_date=${end < lastArchive ? end : lastArchive}`);
  if (end > lastArchive) {
    const recentStart = start > lastArchive ? start : addDays(lastArchive, 1);
    const pastDays = Math.round((dayTs(today) - dayTs(recentStart)) / 86400);
    urls.push(`https://api.open-meteo.com/v1/forecast?${common}&past_days=${pastDays}&forecast_days=1`);
  }
  const rain = new Map();
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const { hourly } = await res.json();
    hourly.time.forEach((t, i) => {
      const mm = hourly.precipitation[i];
      if (typeof mm === "number" && !rain.has(t)) rain.set(t, mm);
    });
  }
  return rain;
}

// Rain pushes workouts indoors: +15% for a drizzle, up to +40% from about 1 mm per hour.
const rainLift = (mm) => (mm > 0 ? 1 + Math.min(0.4, 0.15 + 0.25 * mm) : 1);

const term = (p) => (p < 30 ? "low" : p < 60 ? "medium" : p < 90 ? "high" : "full");
const sqlText = (s) => (s === null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);

const end = Math.floor(Date.now() / 1000 / SLOT) * SLOT - SLOT;
const start = end - DAYS * 86400;

let rain = new Map();
try {
  rain = await fetchRain(start, end);
} catch (err) {
  console.warn(`No rain data (${err.message}); seeding without a weather effect.`);
}
const rainAt = (ts) => rain.get(ts - (ts % 3600) + 3600) ?? 0;

const rows = [];
for (let ts = start; ts <= end; ts += SLOT) {
  if (rand() < 0.01) {
    rows.push(`(${BRANCH}, ${ts}, NULL, NULL, NULL, 0, NULL, 'synthetic: GET workload -> HTTP 503')`);
    continue;
  }
  const { weekday, hour } = localTime(ts);
  const p = Math.max(1, Math.round(shape(weekday, hour) * rainLift(rainAt(ts)) * (0.9 + rand() * 0.2) + (rand() - 0.5) * 6));
  rows.push(`(${BRANCH}, ${ts}, ${p}, ${sqlText(term(p))}, 'capacity', 0, 2, NULL)`);
}

const profile = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) => Math.round(shape(d, h + 0.5) * 1.2)),
);
const now = Math.floor(Date.now() / 1000);

// Replace earlier synthetic rows so a change to shape() takes effect on reseed.
const statements = [`DELETE FROM samples WHERE branch_id = ${BRANCH};`, `DELETE FROM profiles WHERE branch_id = ${BRANCH};`];
for (let i = 0; i < rows.length; i += 200) {
  statements.push(
    `INSERT OR IGNORE INTO samples (branch_id, ts, percentage, term, source, hidden, status, error) VALUES\n${rows
      .slice(i, i + 200)
      .join(",\n")};`,
  );
}
statements.push(
  `INSERT OR IGNORE INTO studios (branch_id, name, alias, lat, lon, updated_at)
   VALUES (${BRANCH}, 'Berlin-East Side Mall', 'berlin-east-side-mall', 52.5064596, 13.4460136, ${now});`,
  `INSERT INTO profiles (branch_id, fetched_at, data) VALUES (${BRANCH}, ${now}, ${sqlText(JSON.stringify(profile))});`,
  "DELETE FROM hourly;",
  `INSERT INTO hourly (branch_id, hour_ts, avg_pct, max_pct, n)
   SELECT branch_id, ts - ts % 3600, avg(percentage), max(percentage), count(percentage)
   FROM samples WHERE percentage IS NOT NULL AND hidden = 0 GROUP BY 1, 2;`,
);

const dir = mkdtempSync(join(tmpdir(), "rain-or-gains-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, statements.join("\n\n") + "\n");
try {
  d1("migrations", "apply", "rain-or-gains", "--local");
  d1("execute", "rain-or-gains", "--local", "--file", file);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const wetHours = [...rain].filter(([t, mm]) => mm > 0 && t > start && t <= end + 3600);
const wetDays = new Set(wetHours.map(([t]) => utcDate(t - 3600))).size;
console.log(`seeded ${rows.length} samples for branch ${BRANCH} over ${DAYS} days (local only)`);
console.log(`rain lifted ${wetHours.length} hours on ${wetDays} days`);
