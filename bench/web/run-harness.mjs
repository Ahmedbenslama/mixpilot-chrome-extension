// Runs the ground-truth harness in real Chrome and compares in-browser real-time SI-SDR with the
// offline streaming-ONNX scores from bench/out/scores.json.
//   npm run build && node bench/web/run-harness.mjs [clipId ...]
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, ROOT, sleep } from "../../tests/e2e/harness.mjs";

const DEFAULT = [
  "carefree__smr+5", "windswept__smr-5", "infraction_dance__smr+0",
  "vocal_lost_in_a_dream__smr+5", "vocal_i_will_remember__smr+0", "scheming_weasel__smr+10",
];
const clips = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

await build({
  entryPoints: [join(ROOT, "bench/web/harness.ts")], outfile: join(ROOT, "bench/web/harness.js"),
  bundle: true, format: "esm", target: "chrome116", logLevel: "warning",
});
writeFileSync(join(ROOT, "bench/web/harness.html"),
  `<!doctype html><meta charset="utf-8"><title>MixPilot harness</title><script type="module" src="./harness.js"></script>`);

const server = spawn(process.execPath, [join(ROOT, "bench/web/serve.mjs")], { env: { ...process.env, PORT: "8766" }, stdio: "ignore" });
await sleep(800);
const h = await launch({ port: 9335 });
const offline = JSON.parse(readFileSync(join(ROOT, "bench/out/scores.json"), "utf8")).filter((r) => r.system === "dfn3_stream");
const rows = [];
try {
  const { targetId } = (await h.c.send("Target.createTarget", { url: "http://127.0.0.1:8766/bench/web/harness.html" })).result;
  await sleep(1500);
  const P = await h.attach(targetId);
  for (const id of clips) {
    const r = await h.ev(P, `window.runClip(${JSON.stringify(id)})`, true, 60000);
    if (r?.__err) { console.log(id, "ERROR", r.__err); continue; }
    const off = offline.find((o) => o.id === id);
    const row = {
      id,
      delayOk: r.measuredStemDelaySamples === r.expectedDelaySamples,
      measuredDelay: r.measuredStemDelaySamples,
      speechDeltaLive: +(r.speechSiSdr - r.mixSpeechSiSdr).toFixed(2),
      speechDeltaOffline: off ? +off.speech_sisdri.toFixed(2) : null,
      musicDeltaLive: +(r.musicSiSdr - r.mixMusicSiSdr).toFixed(2),
      musicDeltaOffline: off ? +off.music_sisdri.toFixed(2) : null,
      underrunMs: r.underrunMs,
      inferenceP95Ms: +(r.inferenceP95Ms ?? NaN).toFixed(2),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  await h.close();
  server.kill();
}
const avg = (k) => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(2);
console.log("\nmean SI-SDR improvement (dB)  live vs offline:",
  `speech ${avg("speechDeltaLive")} vs ${avg("speechDeltaOffline")},  music ${avg("musicDeltaLive")} vs ${avg("musicDeltaOffline")}`);
console.log("stem delay exact on all clips:", rows.every((r) => r.delayOk), " underruns:", rows.reduce((a, r) => a + r.underrunMs, 0), "ms");
writeFileSync(join(ROOT, "bench/out/harness_results.json"), JSON.stringify(rows, null, 1));
