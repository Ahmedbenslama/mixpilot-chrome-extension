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
    // Kept as an extension page (no longer the toolbar popup); the e2e tests drive the engine through it.
    popup: "src/popup/popup.ts",
    "limiter.worklet": "src/audio/limiter.worklet.ts",
    "separation.worklet": "src/audio/separation.worklet.ts",
    "separation.worker": "src/engine/separation.worker.ts",
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: "linked",
  minify: false,
  logLevel: "info",
};

// Content scripts are classic scripts, not ES modules, so they get their own IIFE bundle.
const contentOptions = {
  absWorkingDir: root,
  entryPoints: { content: "src/content/panel.ts" },
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome116",
  sourcemap: "linked",
  minify: false,
  logLevel: "info",
};

// Runtime assets: the ONNX Runtime WASM binary (plain SIMD build; the WebGPU/JSEP build is not
// needed, see docs/MODEL_BENCHMARK.md) and the separation model. Copied, never fetched remotely.
const ASSETS = [
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort/ort-wasm-simd-threaded.wasm"],
  ["models/dfn3_stream.onnx", "models/dfn3_stream.onnx"],
];

async function copyStatic() {
  await cp(join(root, "static"), dist, { recursive: true });
  for (const [from, to] of ASSETS) {
    await mkdir(dirname(join(dist, to)), { recursive: true });
    await cp(join(root, from), join(dist, to));
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: "static", setup(b) { b.onEnd(copyStatic); } }] });
  const contentCtx = await context(contentOptions);
  await ctx.watch();
  await contentCtx.watch();
  console.log("watching…");
} else {
  await build(options);
  await build(contentOptions);
  const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  const contentFiles = (manifest.content_scripts ?? []).flatMap((c) => c.js ?? []);
  for (const f of [manifest.background.service_worker, ...contentFiles, "offscreen.html", "offscreen.js", "popup.html", "popup.js", "limiter.worklet.js", "separation.worklet.js", "separation.worker.js", ...ASSETS.map((a) => a[1])]) {
    if (!existsSync(join(dist, f))) throw new Error(`build output missing: ${f}`);
  }
  console.log(`dist/ ready (manifest v${manifest.version}). Load it via chrome://extensions → Load unpacked → dist`);
}
