# Web dashboard

A public, read-only dashboard at <https://gym.kridi.dev>, served by the same Worker that logs the samples. No auth and no extra services: static assets from `public/` plus a small JSON API under `/api/*`, all on the Cloudflare free plan.

## Views

One page. A studio picker appears at the top only when `STUDIOS` lists more than one studio; the choice is kept in `?studio=<branchId>`.

1. **Now**: the latest percentage in large type with FitX's term ("Busy", "Very busy", ...). Values above 100% are shown as reported. Below it is the usual value for this weekday and hour, and how far the current value is from it. The page shows a status line when the latest sample is older than 15 minutes (stale), failed (error, with the last good reading shown instead) or is hidden by FitX. The chart shows today's 5-minute line over the usual curve for today's weekday. While the usual value is only the FitX profile's relative shape, that shape gets its own small chart instead of a second y axis. The Now view refetches every 5 minutes.
2. **Week and weather**: a 7 / 30 / 90 day picker. The hourly mean line is drawn over a faint band for the usual value, which starts where own data starts. Under the same x axis sit a temperature chart and a precipitation chart: hourly bars for 7 days, daily totals for 30 and 90. School holidays are shaded spans and public holidays are marked with a rule and a triangle.
3. **Typical week**: weekday x hour heatmaps of the own-data mean next to the FitX profile. Cells with fewer than 3 weeks of data are faded, because there the usual value still comes from the profile. Once the profile is scaled to percent, both maps share one colour scale.
4. **Weather effect**: `residual = hourly mean - usual`, only for hours whose usual value is on the percentage scale. It shows a scatter of residual against temperature (dry vs rain, by colour and shape), plus strips by precipitation bucket (dry, under 1 mm, 1 mm or more) and by day type (normal, school holiday, public holiday), each with n. The view says that this needs weeks of data before it means anything.

Every chart has a hover tooltip and a "as a table" disclosure with the same numbers. Every view renders with zero to a few days of data: empty frames, short explanations, and no band or residuals until the usual value is comparable.

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
| `web/main.ts` | loads data, owns state, re-renders on resize, theme change and range change |
| `web/view-now.ts`, `view-week.ts`, `view-heatmap.ts`, `view-effect.ts` | one module per view, each `render*(root, input)` |
| `web/series.ts` | pure data shaping (freshness, hour series, residuals, group stats), unit-tested |
| `web/chart.ts` | theme colours from CSS variables, Berlin time formatters, legend and table helpers |
| `web/api.ts`, `time.ts`, `typical.ts`, `weather.ts`, `holidays.ts`, `cache.ts` | data layer |

Charts use Observable Plot only. Colours are CSS variables in `web/style.css` with separate light and dark values: occupancy, temperature and rain each keep one hue across all charts, and the heatmaps use a single-hue blue ramp.

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
