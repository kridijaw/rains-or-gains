const BASE = "https://www.fitx.de";
const USER_AGENT = "rains-or-gains/1.0 (personal occupancy logger, one request per 5 min)";

export interface Studio {
  branchId: number;
  name: string;
  alias: string;
  lat: number | null;
  lon: number | null;
}

export interface Workload {
  percentage: number | null;
  term: string | null;
  source: string | null;
  hidden: boolean;
  status: number | null;
}

export type Profile = number[][];

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The endpoint returns a JSON array whose single element is itself a JSON-encoded string.
export function parseWorkloadResponse(body: unknown): { studio: Studio; workload: Workload } {
  if (!Array.isArray(body) || body.length === 0) throw new Error("workload response is not a non-empty array");
  const first = typeof body[0] === "string" ? JSON.parse(body[0]) : body[0];
  if (typeof first !== "object" || first === null) throw new Error("workload entry is not an object");
  const s = first as Record<string, any>;

  const branchId = num(s.branchId);
  const name = str(s.name);
  const alias = str(s.alias);
  if (branchId === null || name === null || alias === null) throw new Error("workload entry lacks branchId/name/alias");

  const w = (s.workload ?? {}) as Record<string, unknown>;
  return {
    studio: { branchId, name, alias, lat: num(s.location?.lat), lon: num(s.location?.lon) },
    workload: {
      percentage: num(w.percentage),
      term: str(w.term),
      source: str(w.source),
      hidden: Boolean(s.hideWorkload),
      status: num(s.status),
    },
  };
}

export function parseProfile(html: string): Profile {
  const match = html.match(/data-visitordata="([^"]+)"/);
  if (!match) throw new Error("data-visitordata not found");
  const parsed: unknown = JSON.parse(match[1].replaceAll("&quot;", '"'));
  const valid =
    Array.isArray(parsed) &&
    parsed.length === 7 &&
    parsed.every((day) => Array.isArray(day) && day.length === 24 && day.every((v) => typeof v === "number"));
  if (!valid) throw new Error("data-visitordata is not a 7x24 number grid");
  return parsed as Profile;
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, text/html" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res;
}

export async function fetchWorkload(branchId: number) {
  const res = await get(`${BASE}/fitnessstudio/${branchId}/workload`);
  return parseWorkloadResponse(await res.json());
}

export async function fetchProfile(alias: string): Promise<Profile> {
  const res = await get(`${BASE}/fitnessstudios/${encodeURIComponent(alias)}`);
  return parseProfile(await res.text());
}
