import { handleApi } from "./api";
import { fetchProfile, fetchWorkload, type Studio } from "./fitx";

const PROFILE_CRON = "7 3 * * *";

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env) {
    if (controller.cron === PROFILE_CRON) await snapshotProfiles(env);
    else await sample(env, Math.floor(controller.scheduledTime / 1000));
  },
} satisfies ExportedHandler<Env>;

async function sample(env: Env, ts: number): Promise<void> {
  const results = await Promise.allSettled(env.STUDIOS.map((id) => fetchWorkload(id)));
  const statements: D1PreparedStatement[] = [];

  results.forEach((result, i) => {
    const branchId = env.STUDIOS[i];
    if (result.status === "rejected") {
      console.error(`branch ${branchId}: ${result.reason}`);
      statements.push(
        env.DB.prepare("INSERT OR REPLACE INTO samples (branch_id, ts, error) VALUES (?, ?, ?)").bind(
          branchId,
          ts,
          String(result.reason).slice(0, 500),
        ),
      );
      return;
    }
    const { studio, workload: w } = result.value;
    statements.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO samples (branch_id, ts, percentage, term, source, hidden, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(branchId, ts, w.percentage, w.term, w.source, w.hidden ? 1 : 0, w.status),
      rollupHour(env, branchId, ts),
      upsertStudio(env, studio, ts),
    );
  });

  await env.DB.batch(statements);
}

// Recomputing the whole hour (about 12 rows) keeps it correct even when earlier runs in the hour failed.
function rollupHour(env: Env, branchId: number, ts: number): D1PreparedStatement {
  const hour = ts - (ts % 3600);
  return env.DB.prepare(
    `INSERT OR REPLACE INTO hourly (branch_id, hour_ts, avg_pct, max_pct, n)
     SELECT branch_id, ?, avg(percentage), max(percentage), count(percentage)
     FROM samples WHERE branch_id = ? AND ts >= ? AND ts < ? AND percentage IS NOT NULL AND hidden = 0
     GROUP BY branch_id`,
  ).bind(hour, branchId, hour, hour + 3600);
}

// The WHERE clause skips the write when nothing changed, so this costs no D1 writes on most runs.
function upsertStudio(env: Env, s: Studio, ts: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO studios (branch_id, name, alias, lat, lon, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (branch_id) DO UPDATE SET
       name = excluded.name, alias = excluded.alias, lat = excluded.lat, lon = excluded.lon, updated_at = excluded.updated_at
     WHERE name IS NOT excluded.name OR alias IS NOT excluded.alias OR lat IS NOT excluded.lat OR lon IS NOT excluded.lon`,
  ).bind(s.branchId, s.name, s.alias, s.lat, s.lon, ts);
}

async function snapshotProfiles(env: Env): Promise<void> {
  const { results: studios } = await env.DB.prepare("SELECT branch_id, alias FROM studios").all<{
    branch_id: number;
    alias: string;
  }>();
  const now = Math.floor(Date.now() / 1000);

  for (const { branch_id, alias } of studios) {
    try {
      const data = JSON.stringify(await fetchProfile(alias));
      const latest = await env.DB.prepare(
        "SELECT data FROM profiles WHERE branch_id = ? ORDER BY fetched_at DESC LIMIT 1",
      )
        .bind(branch_id)
        .first<string>("data");
      if (latest === data) continue;
      await env.DB.prepare("INSERT INTO profiles (branch_id, fetched_at, data) VALUES (?, ?, ?)")
        .bind(branch_id, now, data)
        .run();
    } catch (err) {
      console.error(`profile ${branch_id}: ${err}`);
    }
  }
}
