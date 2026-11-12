// Usage: npm run seed:local [-- --days 5]
// Fills the LOCAL D1 database with synthetic samples for branch 82 and rebuilds the hourly rollup.
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
const DAYS = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 5;
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

const term = (p) => (p < 30 ? "low" : p < 60 ? "medium" : p < 90 ? "high" : "full");
const sqlText = (s) => (s === null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);

const end = Math.floor(Date.now() / 1000 / SLOT) * SLOT - SLOT;
const start = end - DAYS * 86400;
const rows = [];
for (let ts = start; ts <= end; ts += SLOT) {
  if (rand() < 0.01) {
    rows.push(`(${BRANCH}, ${ts}, NULL, NULL, NULL, 0, NULL, 'synthetic: GET workload -> HTTP 503')`);
    continue;
  }
  const { weekday, hour } = localTime(ts);
  const p = Math.max(1, Math.round(shape(weekday, hour) * (0.9 + rand() * 0.2) + (rand() - 0.5) * 6));
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
console.log(`seeded ${rows.length} samples for branch ${BRANCH} over ${DAYS} days (local only)`);
