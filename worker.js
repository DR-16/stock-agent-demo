// Q12 demo - one analysis in its own worker (a fresh Python interpreter); the page ends this worker after the result or on timeout / cancel.
import { loadPyodide } from "./pyodide/pyodide.mjs";

const step = (n, text) => self.postMessage({ type: "step", n, text });

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (ev) => {
  const { caseId, bundle, bundleSha256 } = ev.data;
  try {
    step(1, "加载运行环境（首次约 21 MB，之后由浏览器缓存）");
    const py = await loadPyodide({ indexURL: new URL("./pyodide/", import.meta.url).href });
    step(2, "加载数据处理库（numpy、pandas）");
    await py.loadPackage(["numpy", "pandas"], { messageCallback: () => {}, errorCallback: () => {} });
    step(3, "载入分析程序并校验完整性");
    const res = await fetch(new URL(bundle, import.meta.url), { cache: "no-cache" });
    if (!res.ok) throw new Error("bundle " + res.status);
    const buf = await res.arrayBuffer();
    if ((await sha256Hex(buf)) !== bundleSha256) throw new Error("INTEGRITY");
    py.unpackArchive(buf, "zip", { extractDir: "/sa" });
    step(4, "五个专家运行中");
    py.globals.set("CASE_ID", caseId);
    const out = py.runPython(`
import sys
sys.path.insert(0, "/sa/stock_agent/experiments/preview_app/browser")
import entry
entry.analyze(CASE_ID)
`);
    step(5, "整理结果");
    self.postMessage({ type: "done", out });
  } catch (e) {
    // only a short kind goes to the page - no stack, no file path
    const msg = String((e && e.message) || e);
    const kind = msg === "INTEGRITY" ? "INTEGRITY" : /fetch|network|NetworkError|Failed to fetch|bundle \d+/i.test(msg) ? "NETWORK" : "RUNTIME";
    self.postMessage({ type: "error", kind });
  }
};
