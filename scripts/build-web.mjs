import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = `${root}web/`;
const out = `${root}public/`;

await rm(out, { recursive: true, force: true });
await mkdir(out);

await build({
  entryPoints: [`${web}main.ts`],
  outfile: `${out}app.js`,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: "linked",
  legalComments: "linked",
  logLevel: "info",
});

await Promise.all(["index.html", "style.css"].map((f) => copyFile(`${web}${f}`, `${out}${f}`)));
