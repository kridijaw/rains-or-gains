# rain-or-gains

Does the weather (or a holiday) change how full the gym is? A Cloudflare Worker logs the live occupancy of [FitX Berlin-East Side Mall](https://www.fitx.de/fitnessstudios/berlin-east-side-mall) every 5 minutes into D1, for later comparison with weather and holiday data.

Runs entirely on the Cloudflare free plan. The Worker has no HTTP routes; it only runs on cron.

## Setup

```sh
npm install
npm run migrate   # apply migrations/ to the remote D1 database
npm run deploy
npm run tail      # watch the next cron runs
```

## Getting the data out

```sh
npm run export    # writes data/samples.csv, data/studios.csv, data/profiles.csv
```

Add more studios by putting their `branchId` into `STUDIOS` in `wrangler.jsonc`, then `npm run types` and redeploy.

See [docs/data.md](docs/data.md) for where the numbers come from, what each column means, and which weather and holiday sources to join them with.
