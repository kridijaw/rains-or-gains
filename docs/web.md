# Web dashboard

A public, read-only dashboard at <https://gym.kridi.dev>, served by the same Worker that logs the samples. No auth and no extra services: static assets from `public/` plus a small JSON API under `/api/*`, all on the Cloudflare free plan.

## Views

One page. A studio picker appears at the top only when `STUDIOS` lists more than one studio; the choice is kept in `?studio=<branchId>`. The header is titled "Rain or Gains" (the repo, Worker and database keep the `rain-or-gains` slug). While a reading is shown, the tab title leads with it, e.g. "62% · Rain or Gains". A button at the right end of the header cycles the theme through auto, light and dark. The choice is kept in `localStorage` (`theme`), and an inline script in `index.html` applies it before first paint, so the palette in `style.css` keys off `html[data-theme]` instead of the media query.

Under the header, a progress strip shows how far data collection has come: three milestones with ETAs. These are the usual value on the % scale (needs the FitX profile plus 12 overlapping hours), the usual value from own data (3 weeks per weekday and hour), and the weather effect (worth reading after 4 weeks). Once all three are reached it is hidden. Views with nothing to show yet collapse to a one-line dashed card instead of explaining their own emptiness.

1. **Now**: the time of the latest reading and its age sit next to the view title. Below, the latest percentage in large type with FitX's term ("Busy", "Very busy", ...). A meter under it shows the value with a tick for the usual value at this hour. Values above 100% are shown as reported. The outlook for the rest of today comes from the usual curve for today's weekday, shifted by how far the current value is off it, with that shift fading over about 1.5 hours (`outlook()` in `web/series.ts`). It drives the dashed "expected" line and the suggested hour on the chart, and a short label in the sticky bar, e.g. "Quieter from 21:00" (before opening, the opening time; after closing, "Closed"). A status line under the page header appears when the latest sample is older than 15 minutes (stale), failed (error, with the last good reading shown instead) or is hidden by FitX. The chart shows today's 5-minute line, the usual curve and a dashed "expected" line from now to closing, with the suggested hour marked. Its x axis is cropped to opening hours (see below), but never hides a non-zero reading. While the usual value is only the FitX profile's relative shape, that shape gets its own small chart instead of a second y axis. Once the big number scrolls out of view, a sticky bar at the top keeps the percentage, term and outlook label visible. The Now view refetches every 5 minutes.
2. **Week and weather**: a 7 / 30 / 90 day picker. The hourly mean line is drawn over a faint band for the usual value, which starts where own data starts. On the 7 day view closed hours are shaded (left out at 30 and 90 days, where they turn into stripes). School holidays are a ribbon along the top of the chart, and public holidays are marked with a rule and a triangle. Below it, one "Weather" figure on the same x axis stacks temperature over precipitation: hourly bars for 7 days, daily totals for 30 and 90. The precipitation part is left out when the period was dry.
3. **Typical week**: one full-width weekday x hour heatmap with a toggle between own data, the FitX profile and the difference (own minus scaled profile, on a diverging scale; available once the scale is fitted). Cells with fewer than 3 weeks of data are faded, because there the usual value still comes from the profile. Once the profile is scaled to percent, the own and profile maps share one colour scale. The hours shown span the earliest opening to the latest closing of the week.
4. **Weather effect**: `residual = (hourly mean - usual) / usual`, in % of usual, only for hours whose usual value is on the percentage scale and at least 10% (below that, a point of rounding swings the ratio by tens of percent). It shows a scatter of residual against temperature (dry vs rain, by colour and shape), plus strips by precipitation bucket (dry, under 1 mm, 1 mm or more) and by day type (normal, school holiday, public holiday). Each strip shows one tick per hour, a box for the middle half (first to third quartile) and the median. Each group is labelled with its hours and the number of distinct days they come from, since hours of one day are not independent and the day count is the real sample size.

Opening hours per weekday come from the FitX profile (hours where it is above 0). Until there is a profile, they come from own data, but only for a weekday seen for at least 20 hours; otherwise the whole day is shown (`openHours()` in `web/typical.ts`).

Motion is kept to entrances: views fade up, time series sweep in from the left, heatmap cells ripple in, and the big number counts up to a new reading. A view animates on its first draw and on a range or mode switch, but not on resize, theme change or the 5-minute refresh (`enter()` in `web/main.ts`). A pulse marks the latest reading while it is fresh. Everything is off under `prefers-reduced-motion`.

Every chart has a hover tooltip and a "as a table" disclosure with the same numbers. Every view renders with zero to a few days of data.

All timestamps are UTC on the wire. The browser converts them to `Europe/Berlin` with `Intl`, so axes and tooltips show Berlin time wherever the viewer is.

## Where the numbers come from

| data | source | cached |
|---|---|---|
| studios, latest sample, today's samples, profile | `/api/studios`, `/api/now` | edge and browser, 1 day / 60 s |
| hourly means for the last 90 days (one request feeds all views) | `/api/hourly` | edge and browser, 300 s |
| weather (temperature, precipitation) | Open-Meteo, fetched by the browser | `sessionStorage`, 1 h for recent ranges |
| Berlin public and school holidays | OpenHolidays, fetched by the browser | `localStorage`, 30 days per year |

The API routes and response shapes are documented in [data.md](data.md#http-api). The "usual" value and its fallback from own data to the scaled or relative FitX profile are implemented in `web/typical.ts`.

## Code layout

| file | role |
|---|---|
| `web/main.ts` | loads data, owns state, re-renders on resize, theme change, range and heatmap mode change; drives the sticky bar |
| `web/view-now.ts`, `view-week.ts`, `view-heatmap.ts`, `view-effect.ts`, `view-progress.ts` | one module per view, each `render*(root, input)` |
| `web/series.ts` | pure data shaping (freshness, hour series, outlook, data progress, residuals, group stats), unit-tested |
| `web/chart.ts` | theme colours from CSS variables, Berlin time formatters, legend, segmented control and table helpers |
| `web/api.ts`, `time.ts`, `typical.ts`, `weather.ts`, `holidays.ts`, `cache.ts` | data layer |

Charts use Observable Plot only. Colours are CSS variables in `web/style.css` with separate light and dark values: occupancy, temperature and rain each keep one hue across all charts, and the heatmaps use a single-hue blue ramp (a blue to red diverging ramp for the difference map).

## Develop

```sh
npm run seed:local   # synthetic samples in the local D1 database
npm run dev          # build web/ into public/, then wrangler dev
npm run check
npm test
```

`npm run build:web` bundles `web/main.ts` into `public/app.js` with esbuild and copies `index.html` and `style.css`. `public/` is build output and gitignored.

## Deploy

`wrangler.jsonc` routes the Worker to the custom domain `gym.kridi.dev` (`custom_domain: true`, so Cloudflare creates the DNS record and certificate). `workers_dev` stays off. Apply the migration first, because the 5-minute cron writes to the `hourly` table that it creates:

```sh
npm run migrate && npm run deploy
```

Then open <https://gym.kridi.dev>, check that the Now view shows live data, and check that a second `/api/now` request within a minute comes back with `cf-cache-status: HIT`.

### Rate limiting

The API is public, and the Workers request limit and D1 read limit are account-wide: running out of either stops the cron from logging until 00:00 UTC. A WAF rate limiting rule on the kridi.dev zone (Security > WAF > Rate limiting rules; the free plan allows one) blocks floods before they reach the Worker:

- Expression: `(starts_with(http.request.uri.path, "/api/"))`. The free plan only allows the path field, so this also covers `kridi.dev/api/*`, which the main site does not use.
- Counting characteristic: IP. Limit: 30 requests per 10 seconds.
- Action: Block, for 10 seconds.

A normal page load makes 3 API requests and an open tab about 13 an hour, so the limit only trips on scripted traffic.
