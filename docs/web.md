# Web dashboard

A public, read-only dashboard at <https://gym.kridi.dev>, served by the same Worker that logs the samples. No auth and no extra services: static assets from `public/` plus a small JSON API under `/api/*`, all on the Cloudflare free plan.

## Views

One page. A studio picker appears at the top only when `STUDIOS` lists more than one studio; the choice is kept in `?studio=<branchId>` and in `localStorage` (`studio`), and the URL wins. With neither set, the page shows the studio with the lowest `branchId` (82, Berlin-East Side Mall). The header is titled "Rains or Gains" (the repo and Worker use the `rains-or-gains` slug; the D1 database keeps `rain-or-gains` because D1 databases cannot be renamed). While a reading is shown, the tab title leads with it, e.g. "62% · Rains or Gains". A button at the right end of the header cycles the theme through auto, light and dark. The choice is kept in `localStorage` (`theme`), and an inline script in `index.html` applies it before first paint, so the palette in `style.css` keys off `html[data-theme]` instead of the media query.

Under the header, a progress strip shows how far data collection has come: three milestones with ETAs, each behind an info icon next to its label. These are the usual value on the % scale (needs the FitX profile plus 12 overlapping hours), the usual value from own data (3 weeks per weekday and hour), and the weather effect (worth reading after 4 weeks). Once all three are reached it is hidden. Views with nothing to show yet collapse to a one-line dashed card instead of explaining their own emptiness.

1. **Now**: the time of the latest reading and its age sit next to the view title. Below, the latest percentage in large type with FitX's term ("Busy", "Very busy", ...). A meter under it shows the value with a tick for the usual value at this hour. Values above 100% are shown as reported. On a public holiday or during school holidays a pill under the meter names it (e.g. "Public holiday: Christmas Day"), with a note that the usual value is for a normal weekday, since the typical model ignores holidays. The outlook for the rest of today comes from the usual curve for today's weekday, shifted by how far the current value is off it, with that shift fading over about 1.5 hours (`outlook()` in `web/series.ts`). It drives the dashed "expected" line and the suggested hour on the chart, and a short label in the sticky bar, e.g. "Quieter from 21:00" (before opening, the opening time; after closing, "Closed"). A status line under the page header appears when the latest sample is older than 15 minutes (stale), failed (error, with the last good reading shown instead) or is hidden by FitX. The chart shows today's 5-minute line, the usual curve and a dashed "expected" line from now to closing, with the suggested hour marked. Its x axis is cropped to opening hours (see below), but never hides a non-zero reading. Its % axis is shared with the 7 and 30 day charts and sized to the highest value any of the three shows, so switching ranges keeps the scale. While the usual value is only the FitX profile's relative shape, that shape gets its own small chart instead of a second y axis. Once the big number scrolls out of view, a sticky bar at the top keeps the percentage, term and outlook label visible. The Now view refetches every 5 minutes.
   A Now / 7 days / 30 days picker sits at the top right of the view, beside its title. "Now" shows today's chart; 7 or 30 days swaps it for the history below, keeping the big number and meter above. Buttons on either side of the picker step the chart back and forward by one range (a day, 7 or 30 days); the big number, meter and sticky bar stay on the present. Back stops at the first day with data, within the 90 loaded days, and forward stops at the present. While the chart is in the past, a line under the picker names the date or dates shown, with a "Back to today" button that returns to the present on the same range. On phones (480px and narrower) the picker and that line move to the bottom of the view, and the tables are left out. Switching ranges keeps the end date, and so does switching studios. A past day on "Now" draws that day's 5-minute line from `/api/samples` with its usual curve and weather, without the expected line; its legend and table are titled with the date instead of "Today". The % axis and the weather axes also fit the past window shown, so they can grow while stepping back. The hourly mean line is drawn over a faint band for the usual value, which starts where own data starts. On the 7 day view closed hours are shaded (left out at 30 days, where they turn into stripes). School holidays are a ribbon along the top of the chart, and public holidays are marked with a rule and a triangle.
   Weather is drawn into the same chart, under the occupancy marks (`web/view-weather.ts`): a temperature line and precipitation bars, hourly in mm/h for Now and 7 days and daily totals in mm/day for 30 days. On Now, the forecast for the rest of today is dotted. The % axis is on the left; °C and the precipitation unit are two axes on the right. Both are mapped onto the % gridlines, one tick per 20%, so all three share one grid. Precipitation only uses the lower half, so its bars stay under the occupancy line. The precipitation axis is left out when the period was dry, but its legend entry stays. The weather axes do not change between ranges: the temperature axis covers all three, the mm/h axis is shared by Now and 7 days, and the mm/day axis of 30 days fits its own totals. Weather loads after occupancy and adds to the chart without changing its height; if it fails, a line under the chart says so. Tooltips show the weather of the hour, and hours without occupancy get a weather-only tooltip. The tables gain temperature and precipitation columns.
2. **Typical week**: one full-width weekday x hour heatmap with a toggle between own data, the FitX profile and the difference (own minus scaled profile, on a diverging scale; available once the scale is fitted). Cells with fewer than 3 weeks of data are faded, because there the usual value still comes from the profile. Once the profile is scaled to percent, the own and profile maps share one colour scale. The hours shown span the earliest opening to the latest closing of the week. An outline marks the current weekday and hour.
3. **Weather effect**: `residual = (hourly mean - usual) / usual`, in % of usual, only for hours whose usual value is on the percentage scale and at least 10% (below that, a point of rounding swings the ratio by tens of percent). It shows a scatter of residual against temperature (dry vs rain, by colour and shape), plus strips by precipitation bucket (dry, under 1 mm, 1 mm or more) and by day type (normal, school holiday, public holiday). Each strip shows one tick per hour, a box for the middle half (first to third quartile) and the median. Each group is labelled with its hours and the number of distinct days they come from, since hours of one day are not independent and the day count is the real sample size.

Opening hours per weekday come from the FitX profile (hours where it is above 0). Until there is a profile, they come from own data, but only for a weekday seen for at least 20 hours; otherwise the whole day is shown (`openHours()` in `web/typical.ts`).

Motion is kept to entrances: views fade up, time series sweep in from the left, heatmap cells ripple in, and the big number counts up to a new reading. A view animates on its first draw and on a range or mode switch, but not on resize, theme change or the 5-minute refresh (`enter()` in `web/main.ts`). A pulse marks the latest reading while it is fresh. Everything is off under `prefers-reduced-motion`.

Every chart has a hover tooltip and a "as a table" disclosure with the same numbers. Every view renders with zero to a few days of data.

Definitions and how-to-read notes that never change sit behind an info icon (`infoTip` in `web/chart.ts`), shown on hover, tap or focus: the progress milestones, what "usual" means (on the Now legend), the residual and box plot notes (on the Weather effect heading) and the unit caveat of the FitX profile shape chart. Status that changes with the data (errors, staleness, empty states) stays visible as text.

All timestamps are UTC on the wire. The browser converts them to `Europe/Berlin` with `Intl`, so axes and tooltips show Berlin time wherever the viewer is.

## Where the numbers come from

| data | source | cached |
|---|---|---|
| studios, latest sample, today's samples, profile | `/api/studios`, `/api/now` | edge and browser, 1 day / 60 s |
| a past day's 5-minute samples, when the Now chart steps back | `/api/samples` | edge and browser, 1 day once the range is over |
| hourly means for the last 90 days (one request feeds all views) | `/api/hourly` | edge and browser, 300 s |
| weather (temperature, precipitation), today's forecast | Open-Meteo, fetched by the browser | `sessionStorage`, 1 h for recent ranges and today |
| Berlin public and school holidays | OpenHolidays, fetched by the browser | `localStorage`, 30 days per year |

The API routes and response shapes are documented in [data.md](data.md#http-api). The "usual" value and its fallback from own data to the scaled or relative FitX profile are implemented in `web/typical.ts`.

## Code layout

| file | role |
|---|---|
| `web/main.ts` | loads data, owns state, re-renders on resize, theme change, range and heatmap mode change; drives the sticky bar |
| `web/view-now.ts`, `view-week.ts`, `view-heatmap.ts`, `view-effect.ts`, `view-progress.ts` | one module per view, each `render*(root, input)` |
| `web/view-weather.ts` | the weather layer (marks, axes, legend keys, tooltip points) drawn into the Now and history charts |
| `web/series.ts` | pure data shaping (freshness, hour series, outlook, data progress, residuals, group stats), unit-tested |
| `web/chart.ts` | theme colours from CSS variables, Berlin time formatters, legend, info icon, segmented control and table helpers |
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

The API is public, and the Workers request limit and D1 read limit are account-wide: running out of either stops the cron from logging until 00:00 UTC. A per-IP WAF rate limiting rule on `/api/*` (Security > WAF > Rate limiting rules) blocks floods before they reach the Worker. Its exact settings live in the Cloudflare dashboard.

A normal page load makes 3 API requests and an open tab about 13 an hour, so keep the limit well above that.
