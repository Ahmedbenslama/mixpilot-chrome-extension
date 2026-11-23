// Minimal static server for the in-browser benchmark.
// Sends COOP/COEP so the page is cross-origin isolated (SharedArrayBuffer + WASM threads),
// mirroring what the extension's offscreen document will get via manifest COEP/COOP keys.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PORT = Number(process.env.PORT || 8765);
const TYPES = {
  ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
  ".onnx": "application/octet-stream", ".json": "application/json", ".wav": "audio/wav",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT)) throw new Error("outside root");
    const s = await stat(p);
    if (!s.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": TYPES[extname(p)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`bench server: http://127.0.0.1:${PORT}/bench/web/bench.html  root=${ROOT}`));
