# Data

## Source

The gauge on the studio page is rendered by JavaScript from an undocumented JSON endpoint:

```
GET https://www.fitx.de/fitnessstudio/<branchId>/workload
```

It returns a JSON array whose only element is a JSON-encoded string with the studio object. The relevant part is:

```json
"workload": { "term": "full", "percentage": 111, "source": "capacity" }
```

The `branchId` of a studio is in the studio page HTML (search for `"branchId"`). Berlin-East Side Mall is `82`.

The studio page also carries `data-visitordata`, a 7x24 grid of historical hourly averages. Row 0 is Monday (inferred: rows 5 and 6 have the late-morning start typical of weekends). This is snapshotted daily and stored only when it changes.

## Tables

### samples (one row per studio per 5 minutes)

| column | meaning |
|---|---|
| `branch_id` | FitX studio id |
| `ts` | unix seconds UTC, the cron's scheduled minute (so rows align exactly on :00, :05, ...) |
| `percentage` | occupancy relative to the studio's configured capacity. **Can exceed 100**; the page's bar caps visually, the data does not |
| `term` | label shown on the page, e.g. `full` |
| `source` | what the percentage is measured against, so far always `capacity` |
| `hidden` | 1 when FitX hides the gauge (`hideWorkload`) |
| `status` | FitX studio status code; `2` observed while open. Meaning of other values unknown, watch for changes around closures |
| `error` | set when the fetch failed; the measurement columns are then NULL. Distinguishes "no data" from "empty gym" |

### studios

Name, alias and coordinates per studio, kept current from each sample. The coordinates are what to query weather for.

### profiles

`data` is the JSON 7x24 grid described above, with `fetched_at` of the snapshot.

### hourly (rollup of samples, one row per studio per UTC hour)

| column | meaning |
|---|---|
| `hour_ts` | unix seconds UTC, start of the hour |
| `avg_pct`, `max_pct` | mean and max `percentage` over the hour's samples |
| `n` | samples with a percentage (12 for a complete hour). Error rows and hidden gauges are excluded, so a low `n` marks a coverage gap |

Every sample run recomputes its current hour from `samples`, so the table stays live and self-heals. Migration `0002_hourly.sql` backfilled it from existing samples. The dashboard API reads this table instead of raw samples to stay within the D1 free tier.

## HTTP API

Served by the same Worker under `/api/*`; everything else is static assets from `public/`. All times are unix seconds UTC.

| route | returns | cache |
|---|---|---|
| `GET /api/studios` | `[{branchId, name, alias, lat, lon}]` | 1 day (60 s while still empty) |
| `GET /api/now?branch=82&since=<unix>` | `{latest, samples: [[ts, pct], ...], profile: {fetchedAt, data} \| null}`. `since` defaults to 24 h ago and is capped at 36 h | 60 s |
| `GET /api/hourly?branch=82&from=<unix>&to=<unix>` | `[[hour_ts, avg, max, n], ...]` for `from <= hour_ts < to`, at most 100 days (the page asks for 90) | 300 s |

`latest` is `{ts, percentage, term, hidden, status, error}` or `null`. In `samples`, hidden gauges have a null percentage. `since`, `from` and `to` must be hour-aligned (multiples of 3600). The edge cache is keyed on the parsed parameters, so extra query params do not bypass it. Invalid parameters return 400 with `{error}`.

For local work, `npm run seed:local` applies migrations to the local D1 and fills it with a few days of synthetic samples for branch 82 (never touches the remote database).

## Analysis notes

- Convert `ts` to `Europe/Berlin` before grouping by hour or weekday; DST shifts the UTC hour twice a year.
- Weather can be fetched afterwards for the exact collected range: [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api) (hourly temperature, precipitation, sunshine; free, no key) or [Bright Sky](https://brightsky.dev/) (DWD data).
- Public holidays: the Python `holidays` package with `subdiv="BE"`, or [Nager.Date](https://date.nager.at/).
- Berlin school holidays: [OpenHolidays API](https://www.openholidaysapi.org/).
- Other confounders worth a column: sunset time, January resolution season, events at Uber Arena next door, mall opening hours on Sundays.
- Logging a few other Berlin studios helps separate city-wide effects (weather, holidays) from location-specific ones.
