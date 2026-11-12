// Usage: npm run export [-- --local]
// Writes data/samples.csv, data/studios.csv and data/profiles.csv from the D1 database.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const target = process.argv.includes("--local") ? "--local" : "--remote";
const PAGE = 20000;

function query(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "rain-or-gains", target, "--json", "--command", sql], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return JSON.parse(out)[0].results;
}

const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

function writeCsv(name, columns, rows) {
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))];
  writeFileSync(`data/${name}.csv`, lines.join("\n") + "\n");
  console.log(`data/${name}.csv: ${rows.length} rows`);
}

mkdirSync("data", { recursive: true });

// Keyset pagination keeps each wrangler response small.
const samples = [];
let cursor = { branch_id: -1, ts: -1 };
for (;;) {
  const page = query(
    `SELECT branch_id, ts, strftime('%Y-%m-%dT%H:%M:%SZ', ts, 'unixepoch') AS time_utc,
            percentage, term, source, hidden, status, error
     FROM samples WHERE (branch_id, ts) > (${cursor.branch_id}, ${cursor.ts})
     ORDER BY branch_id, ts LIMIT ${PAGE}`,
  );
  samples.push(...page);
  if (page.length < PAGE) break;
  cursor = page.at(-1);
}
writeCsv("samples", ["branch_id", "time_utc", "ts", "percentage", "term", "source", "hidden", "status", "error"], samples);

writeCsv("studios", ["branch_id", "name", "alias", "lat", "lon"], query("SELECT * FROM studios ORDER BY branch_id"));

const profileRows = query("SELECT branch_id, fetched_at, data FROM profiles ORDER BY branch_id, fetched_at").flatMap(
  ({ branch_id, fetched_at, data }) =>
    JSON.parse(data).flatMap((hours, weekday) =>
      hours.map((value, hour) => ({ branch_id, fetched_at, weekday, hour, value })),
    ),
);
writeCsv("profiles", ["branch_id", "fetched_at", "weekday", "hour", "value"], profileRows);
