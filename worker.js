// Q13 demo - one analysis in its own worker (a fresh Python interpreter); the page ends this worker after the result or on timeout / cancel.
// Besides the stages it reports what was really transferred: the Resource Timing entries of this worker (the runtime, the wheels, the bundle) -
// bytes over the network (transferSize; 0 when the browser cache served the file) and how many files came from the cache. No estimate.
import { loadPyodide } from "./pyodide/pyodide.mjs";

const post = (m) => self.postMessage(m);
function net() {
  try {
    const es = performance.getEntriesByType("resource");
    let bytes = 0, cached = 0;
    for (const e of es) { bytes += e.transferSize || 0; if (!e.transferSize && e.decodedBodySize) cached += 1; }
    return { type: "net", supported: true, files: es.length, bytes, cached };
  } catch {
    return { type: "net", supported: false };
  }
}
let cur = 0;                                          // the stage in progress: an error is classified by where it happened (review M6)
const stage = (n) => { cur = n; post({ type: "stage", n }); post(net()); };

// Q13 (browser long run): when the runtime's .wasm file fails (a non-OK response) or arrives incomplete, Pyodide only logs
// "wasm instantiation failed!" and never settles, so the page waited for its 4-minute load timeout. That warning now fails the load at once.
// A download that stalls without an error still ends only at the page's load timeout. scripts/check_release.py checks the text is still there.
let wasmFailed = () => {};
const wasmFail = new Promise((_, bad) => { wasmFailed = bad; });
const warn = console.warn.bind(console);
console.warn = (...a) => { if (typeof a[0] === "string" && a[0].includes("wasm instantiation failed")) wasmFailed(new Error("WASM")); warn(...a); };

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (ev) => {
  const { caseId, bundle, bundleSha256 } = ev.data;
  try { performance.setResourceTimingBufferSize(1000); } catch { /* older browsers: the default buffer (250 entries) is enough */ }
  const ticker = setInterval(() => post(net()), 400);
  try {
    stage(1);
    const py = await Promise.race([loadPyodide({ indexURL: new URL("./pyodide/", import.meta.url).href }), wasmFail]);
    stage(2);
    const pkgErrors = [];
    await py.loadPackage(["numpy", "pandas"], { messageCallback: () => {}, errorCallback: (m) => pkgErrors.push(String(m)) });
    const loaded = py.loadedPackages || {};
    if (pkgErrors.length || !loaded.numpy || !loaded.pandas) throw new Error("PACKAGES");   // loadPackage does not reject on a failed download
    stage(3);
    const get = async (mode) => {
      const res = await fetch(new URL(bundle, import.meta.url), { cache: mode });
      if (!res.ok) throw new Error("bundle " + res.status);
      return res.arrayBuffer();
    };
    let buf = await get("no-cache");
    if ((await sha256Hex(buf)) !== bundleSha256) {
      buf = await get("reload");                      // Q13: a damaged copy in the browser cache is fetched again past the cache once before giving up
      if ((await sha256Hex(buf)) !== bundleSha256) throw new Error("INTEGRITY");
    }
    py.unpackArchive(buf, "zip", { extractDir: "/sa" });
    clearInterval(ticker);
    stage(4);
    await new Promise((r) => setTimeout(r, 0));          // let the stage message leave before the synchronous run
    py.globals.set("CASE_ID", caseId);
    const out = py.runPython(`
import sys
sys.path.insert(0, "/sa/stock_agent/experiments/preview_app/browser")
import entry
entry.analyze(CASE_ID)
`);
    post({ type: "done", out, net: net() });
  } catch (e) {
    // only a short kind goes to the page - no stack, no file path
    const msg = String((e && e.message) || e);
    const kind = msg === "INTEGRITY" ? "INTEGRITY" : cur <= 3 ? "NETWORK" : "RUNTIME";       // stages 1-3 download and start things; 4 runs the experts
    post({ type: "error", kind, stage: cur });
  } finally {
    clearInterval(ticker);
  }
};
