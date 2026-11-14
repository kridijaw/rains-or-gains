# rains-or-gains

Does the weather (or a holiday) change how full the gym is? A Cloudflare Worker logs the live occupancy of [FitX Berlin-East Side Mall](https://www.fitx.de/fitnessstudios/berlin-east-side-mall) every 5 minutes into D1, for later comparison with weather and holiday data.

Runs entirely on the Cloudflare free plan. Besides the crons, the Worker serves a public dashboard at <https://gym.kridi.dev> and a small read-only JSON API under `/api/*`. See [docs/web.md](docs/web.md) for the dashboard and [docs/data.md](docs/data.md#http-api) for the API.

## Setup

```sh
npm install
npm run migrate && npm run deploy   # migrations first: the cron writes to the hourly table
npm run tail                        # watch the next cron runs
```

`npm run deploy` first bundles the dashboard in `web/` into `public/` (gitignored build output).

## Local development

```sh
npm run seed:local   # synthetic samples in the local D1 database
npm run dev          # build web/ into public/, then wrangler dev
npm run check        # type-check the Worker and the web client
npm test
```

## Getting the data out

```sh
npm run export    # writes data/samples.csv, data/studios.csv, data/profiles.csv
```

Add more studios by putting their `branchId` into `STUDIOS` in `wrangler.jsonc`, then `npm run types` and redeploy.

See [docs/data.md](docs/data.md) for where the numbers come from, what each column means, and which weather and holiday sources to join them with.
