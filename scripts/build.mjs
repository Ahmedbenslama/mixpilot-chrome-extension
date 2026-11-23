// Builds the loadable extension into dist/.
//   node scripts/build.mjs           one-off build
//   node scripts/build.mjs --watch   rebuild on change
// Everything executable is bundled locally (MV3: no remotely hosted code).
import { build, context } from "esbuild";
import { cp, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

const options = {
  absWorkingDir: root,
  entryPoints: {
    "service-worker": "src/background/service-worker.ts",
    offscreen: "src/offscreen/offscreen.ts",
    popup: "src/popup/popup.ts",
    "limiter.worklet": "src/audio/limiter.worklet.ts",
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: "linked",
  minify: false,
  logLevel: "info",
};

async function copyStatic() {
  await cp(join(root, "static"), dist, { recursive: true });
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: "static", setup(b) { b.onEnd(copyStatic); } }] });
  await ctx.watch();
  console.log("watching…");
} else {
  await build(options);
  const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  for (const f of [manifest.background.service_worker, manifest.action.default_popup, "offscreen.html", "offscreen.js", "popup.js", "limiter.worklet.js"]) {
    if (!existsSync(join(dist, f))) throw new Error(`build output missing: ${f}`);
  }
  console.log(`dist/ ready (manifest v${manifest.version}). Load it via chrome://extensions → Load unpacked → dist`);
}
