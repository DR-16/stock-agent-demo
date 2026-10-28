// Q15 demo page (successor of the Q13 / Q14 page; same worker contract and the same integrity checks).
// Flow: choose (search or pick a synthetic case) -> confirm -> run (one worker per analysis; real stages, real elapsed time and the real number of
// bytes transferred, never a guessed percentage) -> read (two-layer summary, then the simple or the professional version of the SAME run) ->
// full report page (print, or download as one HTML file) -> history in this browser (IndexedDB; every entry re-checked against its SHA-256).
// The page renders FROM the analysis record whose SHA-256 the worker returned (browser/entry.py, Q15_DEMO_ANALYSIS_RECORD_V1): the page, the
// report, the download and the history entry are one run by construction. Rendering lives in render.js (shared with the real-trial page).
import { $, el, localTime, renderResult, buildReport, REPORT_CSS, planMatrix, planRules } from "./render.js";

const HIST_MAX = 20;
const TIMEOUT_MS = { load: 240000, run: 90000 };        // the first load downloads the runtime; the five experts themselves take seconds
const STAGES = [
  ["下载并启动 Python 运行环境", "首次需要下载，之后由浏览器缓存；实际传输量显示在下方"],
  ["加载数据处理库", "numpy、pandas"],
  ["下载分析程序并核对校验值", "和网站登记的 SHA-256 比对，不一致就停止"],
  ["五个专家运行，生成两层判断", "技术面、宏观、基本面、估值、公告 → 经营评价、投资研究判断"],
  ["核对并保存结果", "核对结果自带的校验值，保存到这个浏览器的历史"],
];
const KIND_ZH = { COMPANY: "合成公司", SCENARIO: "演示场景" };
const KIND_LONG = { COMPANY: "合成公司（虚构，不对应任何真实公司）", SCENARIO: "演示场景（同一家合成公司，部分资料被故意改坏）" };
const RECORD_SCHEMA = "Q15_DEMO_ANALYSIS_RECORD_V1";
const RUN_ID_RX = /^[A-Za-z0-9-]{8,80}$/;
const USAGE_LIMIT = 10;                                  // prototype free allowance per day in this browser: counted and shown, never enforced
const MODE_KEY = "q15-mode:" + location.pathname;        // the reading mode is remembered per page (a per-viewer convenience)
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let MANIFEST = null, CHOSEN = null, WORKER = null, TIMER = null, TICK = null, BUSY = false, RUN = null, CURRENT = null;
const CONFIRM_GUARD_MS = 1000;                             // Q14 (S-5, engineering convention): a slow double tap cannot skip the confirm step
let CONFIRM_T = 0;
let STEP_AT = 0, ROUTE_GEN = 0, HIST_GEN = 0, HIST_BUSY = false, LAST_DEL = -1e9;

async function sha256Text(t) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function focusTo(e, block = "start") { if (!e) return; if (!e.hasAttribute("tabindex")) e.setAttribute("tabindex", "-1"); e.focus({ preventScroll: true }); e.scrollIntoView({ block, behavior: reduced() ? "auto" : "smooth" }); }
const focusStep = (id) => focusTo($(id), "nearest");
function saveFile(blob, name) { const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const mb = (b) => (b / 1e6).toFixed(1);
function store(get, key, val) {                             // localStorage can be missing or throw (private windows, blocked site data): never required
  try { if (get) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { /* the page works without it */ }
  return null;
}
function siteLine(site) {
  if (!site) return "未记录";
  return `${site.version} · 源码 ${String(site.commit).slice(0, 12)}${site.dirty ? "（构建时有未提交的改动）" : ""} · 分析程序 ${String(site.bundle_sha256).slice(0, 16)}…`;
}
function announce(t) { const a = $("live"); a.textContent = ""; setTimeout(() => { a.textContent = t; }, 30); }

// ---------------------------------------------------------------- usage counter (prototype; per browser; not an authorisation)
function usage() {
  const today = new Date().toISOString().slice(0, 10);
  let u = null; try { u = JSON.parse(store(true, "q15-demo-usage") || "null"); } catch { u = null; }
  return u && u.day === today && Number.isInteger(u.n) ? u : { day: today, n: 0 };
}
function countUse() { const u = usage(); u.n += 1; store(false, "q15-demo-usage", JSON.stringify(u)); return u; }
function usageText() {
  const u = usage();
  return `今天在这个浏览器里运行了 ${u.n} 次基础分析。原型额度：每天 ${USAGE_LIMIT} 次——只在本机计数，演示不会因此阻止你，也不是真实的鉴权。` +
    (u.n > USAGE_LIMIT ? `已超过原型额度；在正式方案里，超出部分属于付费候选“更多分析次数”（规划中）。` : "");
}

// ---------------------------------------------------------------- views and steps
function setView(v) {
  document.body.dataset.view = v;
  $("view-home").hidden = v === "report";
  $("view-report").hidden = v !== "report";
  for (const id of ["hero", "plans-home", "about"]) $(id).hidden = v !== "start";
  $("result-view").hidden = v !== "result";
  if (v !== "report") $("view-report").textContent = "";
  if (v === "start") document.title = "股票研究工作台 · 演示";
}
function setStep(s) {
  for (const id of ["choose", "confirm", "run", "error"]) $("step-" + id).hidden = id !== s;
  document.body.dataset.step = s;
  const n = { choose: 1, confirm: 2, run: 3, error: 3 }[s];
  for (const li of $("stepper").children) {
    const k = Number(li.dataset.n);
    li.classList.toggle("done", k < n);
    if (k === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
  STEP_AT = performance.now();
}
function go(hash) { if (location.hash === hash || (hash === "" && !location.hash)) route(); else location.hash = hash; }
function newAnalysis() { if (!BUSY) { CHOSEN = null; setStep("choose"); } go(""); }

// ---------------------------------------------------------------- choose and confirm
const norm = (x) => String(x).normalize("NFKC").trim().toLowerCase();
function caseMatches(q) {
  q = norm(q);
  if (!q) return MANIFEST.cases;
  return MANIFEST.cases.filter((c) => [c.title, c.code, c.case_id, c.note].some((s) => norm(s || "").includes(q)));
}
function caseTag(c) { return el("span", { class: "tag " + (c.kind === "COMPANY" ? "" : "tag-sc") }, KIND_ZH[c.kind] || ""); }
function renderCases(raw) {
  const msg = $("match-msg"), list = $("cases"), q = String(raw || "").normalize("NFKC").trim();
  list.textContent = ""; msg.textContent = ""; msg.className = "match-msg";
  if (q.length > 40) { msg.textContent = "输入太长（最多 40 个字符）。"; msg.classList.add("warn"); }
  const ms = q.length > 40 ? [] : caseMatches(q);
  if (q && q.length <= 40 && !ms.length) {
    msg.textContent = `没有找到“${q}”。这个演示只有下面 ${MANIFEST.cases.length} 项合成数据，不支持任意股票，也不支持真实代码。`;
    msg.classList.add("warn");
  } else if (q && ms.length > 1) msg.textContent = `找到 ${ms.length} 项，请选一个。`;
  else if (q && ms.length === 1) msg.textContent = "找到 1 项。按回车或点它继续。";
  const shown = q && ms.length ? ms : MANIFEST.cases;
  for (const c of shown) {
    list.append(el("li", {}, el("button", { type: "button", class: "case" + (q && ms.includes(c) ? " hit" : ""), onclick: () => choose(c) },
      el("span", { class: "case-top" }, el("span", { class: "case-title" }, c.title), caseTag(c)),
      el("span", { class: "case-meta" }, `代码 ${c.code} · 数据截止 ${MANIFEST.as_of[c.case_id] || "—"}${c.has_synthetic_comparison ? " · 含合成比较区间" : ""}`),
      el("span", { class: "case-note" }, c.note))));
  }
  $("cases-n").textContent = q && ms.length ? `匹配 ${ms.length} 项，共 ${MANIFEST.cases.length} 项` : `${MANIFEST.cases.length} 项`;
}
function choose(c) {
  if (BUSY) return;
  CHOSEN = c;
  const b = $("confirm-box"); b.textContent = "";
  b.append(el("p", { class: "confirm-name" }, c.title, caseTag(c)),
    el("dl", { class: "kv" },
      el("dt", {}, "代码"), el("dd", { class: "mono" }, c.code),
      el("dt", {}, "数据截止日"), el("dd", {}, MANIFEST.as_of[c.case_id] || "—"),
      el("dt", {}, "类型"), el("dd", {}, KIND_LONG[c.kind]),
      el("dt", {}, "看点"), el("dd", {}, c.note),
      c.has_synthetic_comparison ? [el("dt", {}, "估值比较依据"), el("dd", {}, "演示用的合成同行区间（开发者编写，不是市场数据）")] : null),
    el("p", { class: "help" }, "五个专家都会运行，然后生成经营评价和投资研究判断。分析在你的浏览器里完成，不上传任何内容；结果会自动保存到这个浏览器的历史。"));
  $("confirm-note").textContent = usage().n >= USAGE_LIMIT ? `今天已运行 ${usage().n} 次，超过原型额度 ${USAGE_LIMIT} 次；演示不会阻止你继续（只在本机计数，不是真实鉴权）。` : "";
  setStep("confirm"); focusStep("confirm-title");
  const b2 = $("btn-analyze"); b2.disabled = true; b2.setAttribute("aria-disabled", "true");
  clearTimeout(CONFIRM_T); CONFIRM_T = setTimeout(() => { if (!BUSY) { b2.disabled = false; b2.removeAttribute("aria-disabled"); } }, CONFIRM_GUARD_MS);
}

// ---------------------------------------------------------------- run
function stageText(i) {
  const s = RUN && RUN.at[i]; if (!s) return "等待";
  const sec = ((s.end || performance.now()) - s.start) / 1000;
  return s.end ? `完成 · ${sec.toFixed(1)} 秒` : `进行中 · ${Math.floor(sec)} 秒`;
}
function renderStages(say) {
  const ol = $("stages"); ol.textContent = "";
  STAGES.forEach(([name, sub], i) => {
    const s = RUN.at[i], state = !s ? "wait" : s.end ? "done" : "now";
    ol.append(el("li", { class: "stage " + state, "aria-current": state === "now" ? "step" : null },
      el("span", { class: "st-icon", "aria-hidden": "true" }),
      el("span", {}, el("span", { class: "st-name" }, name), el("span", { class: "st-sub" }, sub)),
      el("span", { class: "st-time", id: "st-time-" + i }, state === "wait" ? "等待" : stageText(i))));
  });
  if (say && RUN.stage) $("run-live").textContent = `第 ${RUN.stage} 步，共 ${STAGES.length} 步：${STAGES[RUN.stage - 1][0]}`;
}
function tick() {
  if (!RUN) return;
  if (RUN.stage) { const e = $("st-time-" + (RUN.stage - 1)); if (e) e.textContent = stageText(RUN.stage - 1); }
  $("run-elapsed").textContent = `已用时 ${Math.floor((performance.now() - RUN.t0) / 1000)} 秒`;
}
function netText(n) {
  if (!n || !n.supported || !n.files) return "";
  return `已传输 ${mb(n.bytes)} MB · ${n.files} 个文件` + (n.cached ? `（${n.cached} 个来自浏览器缓存）` : "");
}
function setStage(n) {
  const now = performance.now();
  if (RUN.stage && RUN.at[RUN.stage - 1] && !RUN.at[RUN.stage - 1].end) RUN.at[RUN.stage - 1].end = now;
  RUN.stage = n; RUN.at[n - 1] = { start: now };
  renderStages(true);
}
function stopWorker() {
  if (WORKER) { WORKER.onmessage = null; WORKER.onerror = null; WORKER.terminate(); WORKER = null; }
  if (TIMER) { clearTimeout(TIMER); TIMER = null; }
  if (TICK) { clearInterval(TICK); TICK = null; }
}
function release() { BUSY = false; RUN = null; $("btn-analyze").disabled = false; $("btn-cancel").disabled = false; lockHistory(false); }
function arm(ms, kind) {
  if (TIMER) clearTimeout(TIMER);
  const run = RUN;
  TIMER = setTimeout(() => { if (RUN !== run) return; if (document.hidden) { arm(ms, kind); return; } fail(kind); }, ms);
  if (RUN) RUN.timer = { ms, kind };
}
const FAIL = {
  INTEGRITY: ["分析程序校验不一致", "下载的分析程序和网站登记的校验值不一致，已经停止，没有运行。请刷新页面后重试；如果仍然出现，说明网站文件不完整。"],
  NETWORK: ["下载或启动运行环境失败", "多半是网络问题（文件没有下载完整）；如果网络正常，也可能是浏览器版本太旧或内存不足。可以点“重试”。"],
  RUNTIME: ["分析过程出错", "运行环境已经加载，但运行时出错，没有生成结果。可以重试一次；如果仍然出错，说明这个版本有缺陷。"],
  START: ["无法启动分析程序", "启动分析程序的文件没有下载成功（网络中断），或者这个浏览器不支持模块化 Web Worker。检查网络后重试；仍不行请换用较新的 Chrome、Edge、Safari 或 Firefox。"],
  TIMEOUT_LOAD: ["加载超时", "运行环境 4 分钟内没有加载完成（网络慢或设备内存不足），已经停止。可以稍后重试。"],
  TIMEOUT_RUN: ["分析超时", "五个专家 90 秒内没有完成，已经停止，没有保存任何结果。可以重试。"],
  RESULT: ["结果无法显示", "分析程序返回的结果格式不对，没有显示，也没有保存。"],
  RESULT_HASH: ["结果校验不一致", "结果和它自带的校验值不一致，没有显示，也没有保存。"],
};
function fail(kind, extra) {
  stopWorker(); release();
  const [t, x] = FAIL[kind] || FAIL.RUNTIME;
  $("error-title").textContent = t;
  $("error-text").textContent = extra ? `${x}（${extra}）` : x;
  $("btn-retry").hidden = !CHOSEN;
  setView("start"); setStep("error"); focusStep("error-title");
}
function analyze(e) {
  if (BUSY || !CHOSEN) return;
  if (e && e.detail > 1) return;
  if (performance.now() - STEP_AT < CONFIRM_GUARD_MS) return;
  BUSY = true; $("btn-analyze").disabled = true; lockHistory(true);
  $("confirm-note").textContent = "";
  RUN = { t0: performance.now(), stage: 0, at: [], net: null, caseId: CHOSEN.case_id };
  $("run-title").textContent = `正在分析：${CHOSEN.title}`; $("run-net").textContent = ""; $("run-elapsed").textContent = "";
  setStep("run"); renderStages(false); focusStep("run-title");
  try { WORKER = new Worker("worker.js", { type: "module" }); } catch { return fail("START"); }
  arm(TIMEOUT_MS.load, "TIMEOUT_LOAD");
  TICK = setInterval(tick, 500);
  WORKER.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); const st = RUN ? RUN.stage : 0; fail(!st ? "START" : st <= 3 ? "NETWORK" : "RUNTIME", st ? `第 ${st} 步` : ""); };
  WORKER.onmessage = (ev) => onWorker(ev.data);
  WORKER.postMessage({ caseId: CHOSEN.case_id, bundle: MANIFEST.bundle, bundleSha256: MANIFEST.bundle_sha256 });
}
// the record is trusted only if its SHA-256 matches the header and its own run id / fingerprint match the header too
async function verify(view, recordText) {
  if (!view || typeof recordText !== "string" || typeof view.record_sha256 !== "string") return null;
  if ((await sha256Text(recordText)) !== view.record_sha256) return null;
  let rec; try { rec = JSON.parse(recordText); } catch { return null; }
  if (!rec || rec.run_id !== view.run_id) return null;
  return rec;
}
async function onWorker(m) {
  if (!RUN || !m) return;
  const run = RUN;
  if (m.type === "stage") { setStage(m.n); if (m.n === 4) arm(TIMEOUT_MS.run, "TIMEOUT_RUN"); return; }
  if (m.type === "net") { run.net = m; $("run-net").textContent = netText(m); return; }
  if (m.type === "error") return fail(m.kind, m.stage ? `第 ${m.stage} 步` : "");
  if (m.type !== "done") return;
  if (m.net) run.net = m.net;
  if (WORKER) { WORKER.onmessage = null; WORKER.onerror = null; WORKER.terminate(); WORKER = null; }
  setStage(5);
  $("btn-cancel").disabled = true;
  let r; try { r = JSON.parse(m.out); } catch { return fail("RESULT"); }
  if (!r || !r.view || !r.view.ok) return fail("RESULT", (r && r.view && r.view.error) || (r && r.error) || "");
  const rec = await verify(r.view, r.record_text);
  if (RUN !== run) return;
  if (!rec) return fail("RESULT_HASH");
  const site = { version: MANIFEST.version, commit: MANIFEST.source_commit, dirty: !!MANIFEST.source_dirty, bundle_sha256: MANIFEST.bundle_sha256 };
  const payload = JSON.stringify({ view: r.view, record_text: r.record_text, site });
  const ph = await sha256Text(payload);
  if (RUN !== run) return;
  const save = await histSave({ run_id: r.view.run_id, case_id: r.view.case_id, title: r.view.title, kind: r.view.kind, saved_at: new Date().toISOString(), payload, payload_sha256: ph });
  if (RUN !== run) {
    if (save.saved) await renderHistory();
    return;
  }
  stopWorker();
  run.at[4].end = performance.now();
  const load = { stages: STAGES.map(([n], i) => ({ name: n, seconds: run.at[i] && run.at[i].end ? (run.at[i].end - run.at[i].start) / 1000 : null })), total: (performance.now() - run.t0) / 1000, net: run.net };
  countUse();
  CURRENT = { view: r.view, recordText: r.record_text, record: rec, site, fromHistory: false, save, load };
  release();
  CHOSEN = null; setStep("choose");
  await renderHistory();
  go("#run/" + encodeURIComponent(r.view.run_id));
}

// ---------------------------------------------------------------- history (IndexedDB; same database as the Q13 / Q14 page)
function idb() {
  return new Promise((ok, bad) => {
    let r, done = false;
    const t = setTimeout(() => { if (!done) { done = true; bad(Object.assign(new Error("timeout"), { name: "TimeoutError" })); } }, 8000);
    const fin = (f, x) => { if (!done) { done = true; clearTimeout(t); f(x); } };
    try { r = indexedDB.open("stock-agent-demo", 1); } catch (e) { fin(bad, e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore("runs", { keyPath: "run_id" });
    r.onsuccess = () => { if (done) { r.result.close(); return; } fin(ok, r.result); };
    r.onerror = () => fin(bad, r.error || new Error("open"));
    r.onblocked = () => fin(bad, new Error("blocked"));
  });
}
async function tx(mode, fn) {
  const d = await idb();
  try {
    return await new Promise((ok, bad) => {
      let t, req;
      try { t = d.transaction("runs", mode); req = fn(t.objectStore("runs"), t); } catch (e) { try { t && t.abort(); } catch { /* finished */ } bad(e); return; }
      t.oncomplete = () => ok(req && req instanceof IDBRequest ? req.result : req && req.value !== undefined ? req.value : undefined);
      t.onerror = (e) => bad((e && e.target && e.target.error) || t.error);
      t.onabort = (e) => bad(t.error || (e && e.target && e.target.error) || new Error("abort"));
    });
  } finally { d.close(); }
}
function storageWhy(e) {
  const n = e && e.name;
  if (n === "QuotaExceededError") return "浏览器给本站的存储空间不够";
  if (n === "TimeoutError") return "浏览器的存储没有响应";
  if (n === "SecurityError" || n === "InvalidStateError" || !window.indexedDB) return "浏览器不允许本站保存数据（例如无痕模式，或者关闭了网站数据）";
  return "浏览器存储出错（可能是空间不足或浏览器限制）";
}
async function histList() { try { return { ok: true, items: (await tx("readonly", (s) => s.getAll())) || [] }; } catch (e) { return { ok: false, error: e }; } }
async function histSave(entry) {
  try {
    const out = await tx("readwrite", (s) => {
      const box = { value: [] };
      const q = s.getAll();
      q.onsuccess = () => {
        const others = (q.result || []).filter((x) => x.run_id !== entry.run_id).sort((a, b) => String(a.saved_at).localeCompare(String(b.saved_at)));
        const drop = others.slice(0, Math.max(0, others.length + 1 - HIST_MAX));
        s.put(entry);
        for (const o of drop) s.delete(o.run_id);
        box.value = drop.map((o) => ({ title: o.title, saved_at: o.saved_at }));
      };
      return box;
    });
    return { saved: true, dropped: out || [] };
  } catch (e) { return { saved: false, why: storageWhy(e) }; }
}
// an entry: { payload (view + record_text + site), payload_sha256 } -> null if damaged; otherwise the parsed payload (+ the record when it is a Q15 one)
async function checkEntry(h) {
  if (!h || typeof h.payload !== "string" || typeof h.payload_sha256 !== "string" || typeof h.run_id !== "string") return null;
  if ((await sha256Text(h.payload)) !== h.payload_sha256) return null;
  let d; try { d = JSON.parse(h.payload); } catch { return null; }
  if (!d || !d.view || typeof d.record_text !== "string" || d.view.run_id !== h.run_id) return null;
  if ((await sha256Text(d.record_text)) !== d.view.record_sha256) return null;
  let rec = null; try { rec = JSON.parse(d.record_text); } catch { return null; }
  d.record = rec && rec.schema === RECORD_SCHEMA && rec.run_id === h.run_id ? rec : null;   // older pages saved the bare run record: shown as such
  return d;
}
function lockHistory(on) {
  $("hist-lock").hidden = !on;
  for (const b of $("history-box").querySelectorAll("[data-lock]")) b.disabled = on || HIST_BUSY;
}
async function renderHistory() {
  const gen = ++HIST_GEN;
  const L = await histList();
  const frag = document.createDocumentFragment();
  let count = "", clear = false;
  if (!L.ok) {
    frag.append(el("li", { class: "empty" }, el("strong", {}, "历史不可用"), el("p", {}, `${storageWhy(L.error)}。分析仍然可以运行，只是结果不会保存；需要保留时请在结果页下载。`)));
  } else if (!L.items.length) {
    frag.append(el("li", { class: "empty" }, el("strong", {}, "还没有保存的分析"), el("p", {}, `完成一次分析后，结果会自动保存在这里（只在这个浏览器里，最多 ${HIST_MAX} 条）。`)));
  } else {
    const items = L.items.slice().sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
    count = `${items.length} / ${HIST_MAX} 条`; clear = true;
    for (const h of items) {
      const x = await checkEntry(h);
      if (gen !== HIST_GEN) return;
      const ok = !!x, rec = x && x.record;
      const title = typeof h.title === "string" ? h.title : "（无法识别的记录）";
      const when = h.saved_at ? localTime(h.saved_at) : "时间未知";
      const dd = rec && rec.decision;
      frag.append(el("li", { class: "h-item" + (ok ? "" : " damaged") },
        el("div", {},
          el("div", { class: "h-title" }, title, h.kind ? el("span", { class: "tag " + (h.kind === "COMPANY" ? "" : "tag-sc") }, KIND_ZH[h.kind] || "") : null,
            ok ? (rec ? null : el("span", { class: "tag" }, "旧版本记录")) : el("span", { class: "tag tag-bad" }, "✕ 已损坏，不能打开")),
          dd ? el("div", { class: "h-concl" }, `经营评价 ${dd.operations_evaluation.label} · 投资研究判断 ${dd.investment_judgement.label}（依据${dd.investment_judgement.basis}）`) : null,
          el("div", { class: "h-meta" }, `保存于 ${when}（本地时间） · 运行编号 `, el("span", { class: "mono" }, String(h.run_id || "—")))),
        el("div", { class: "h-actions" },
          ok ? el("button", { type: "button", class: "btn btn-sm", "data-lock": true, "aria-label": `打开 ${title}（${when}）`, onclick: () => go("#run/" + encodeURIComponent(h.run_id)) }, "打开") : null,
          el("button", { type: "button", class: "btn ghost btn-sm", "data-lock": true, "aria-label": `删除 ${title}（${when}）的记录`, onclick: (e) => { if (e.detail > 1 || performance.now() - LAST_DEL < 600) return; delOne(h.run_id); } }, "删除"))));
    }
  }
  if (gen !== HIST_GEN) return;
  if (L.ok) $("hist-msg").textContent = "";
  const box = $("history"); box.textContent = ""; box.append(frag);
  $("hist-count").textContent = count; $("btn-clear").hidden = !clear; $("clear-confirm").hidden = true; $("clear-n").textContent = count ? count.split(" ")[0] : "";
  lockHistory(BUSY);
}
function markUnsaved(why) {
  if (!CURRENT) return;
  CURRENT.save = { saved: false, why }; CURRENT.fromHistory = false;
  const m = /^#run\/(.+)$/.exec(location.hash);
  let id = null; try { id = m ? decodeURIComponent(m[1]) : null; } catch { id = null; }
  if (document.body.dataset.view === "result" && id === CURRENT.view.run_id) renderResultSafe(CURRENT);
}
async function delOne(id) {
  if (HIST_BUSY) return false;
  HIST_BUSY = true; lockHistory(BUSY);
  $("hist-msg").textContent = "";
  let err = null;
  try { await tx("readwrite", (s) => s.delete(id)); } catch (e) { err = e; }
  HIST_BUSY = false; LAST_DEL = performance.now();
  await renderHistory();
  LAST_DEL = performance.now();
  if (err) { $("hist-msg").textContent = `删除失败：${storageWhy(err)}。`; focusTo($("hist-title"), "nearest"); return false; }
  if (CURRENT && CURRENT.view.run_id === id) markUnsaved("这条记录已从历史中删除");
  focusTo($("hist-title"), "nearest");
  return true;
}

// ---------------------------------------------------------------- result
function modelOf(d) {
  const r = d.record, c = r.case || {}, dec = r.decision || {}, obj = dec.object || {};
  return { ctx: "demo", title: c.title || obj.name, code: c.code || obj.security, industry: obj.industry_zh, as_of: r.as_of || dec.as_of,
    data_kind: r.data_kind, data_label: ((r.views || {}).simple || {}).data_kind_label || "合成演示数据（虚构公司）", run_id: r.run_id,
    record_sha256: d.view.record_sha256, decision: dec, views: r.views, experts: (r.page || {}).experts || [],
    meta: { ...(r.page || {}), price_source: r.price_series_source, decision_inputs: r.decision_inputs, case_kind: c.kind } };
}
function saveLine(d) {
  if (d.fromHistory) return el("p", { class: "run-line" }, "来自这个浏览器的历史；打开时已重新核对校验值。");
  const s = d.save || {};
  if (s.saved) return el("p", { class: "run-line" }, "已保存到这个浏览器的历史。",
    (s.dropped || []).length ? ` 历史已满 ${HIST_MAX} 条，自动删除了最早的：${s.dropped.map((x) => `${x.title}（${localTime(x.saved_at)}）`).join("、")}。` : "",
    d.load ? ` 从点击“开始分析”到显示共 ${d.load.total.toFixed(1)} 秒。` : "");
  return el("p", { class: "run-line warn-text" }, `没有保存到历史：${s.why || "原因未知"}。刷新页面后无法再打开这次结果；需要保留请先下载。`);
}
function actions(d) {
  const v = d.view, saved = d.fromHistory || (d.save && d.save.saved);
  return el("div", { class: "res-actions" },
    el("p", {}, (saved ? "页面、简单版、专业版、完整报告、下载和历史都是同一次运行" : "页面、简单版、专业版、完整报告和下载都是同一次运行（没有保存到历史）") + `（记录 SHA-256 ${v.record_sha256.slice(0, 16)}…）。`),
    el("div", { class: "row" },
      el("button", { type: "button", class: "btn", onclick: () => go("#report/" + encodeURIComponent(v.run_id)) }, "打开完整报告"),
      el("button", { type: "button", class: "btn ghost", onclick: () => downloadReport(d) }, "下载报告（HTML）"),
      el("button", { type: "button", class: "btn ghost", onclick: () => saveFile(new Blob([d.recordText], { type: "application/json" }), `${v.run_id}.json`) }, "下载完整记录（JSON）")));
}
function renderResult_(d) {
  const box = $("result-view");
  if (!d.record) {                                         // an entry saved by an older page: verified, but not shown in the new layout
    showMessage("这条记录由旧版本保存", "它的校验值核对无误，但它没有 Q15 的两层判断；新页面不会用新版本补算，以免混用版本。可以下载它的完整记录（JSON）查看，或在历史里删除它。",
      el("button", { type: "button", class: "btn ghost", onclick: () => saveFile(new Blob([d.recordText], { type: "application/json" }), `${d.view.run_id}.json`) }, "下载完整记录（JSON）"));
    return false;
  }
  const m = modelOf(d);
  if (!m.views) {
    showMessage("这次运行没有生成页面内容", `判断层已经运行，但视图没有生成（${d.record.views_error || "原因未记录"}）。可以下载完整记录（JSON）查看。`,
      el("button", { type: "button", class: "btn ghost", onclick: () => saveFile(new Blob([d.recordText], { type: "application/json" }), `${d.view.run_id}.json`) }, "下载完整记录（JSON）"));
    return false;
  }
  const mode = store(true, MODE_KEY) === "pro" ? "pro" : "simple";
  const parts = renderResult(m, {
    mode, onMode: (x) => store(false, MODE_KEY, x), announce,
    top: [el("button", { type: "button", class: "linkbtn", onclick: newAnalysis }, "← 新的分析"),
      el("button", { type: "button", class: "btn ghost btn-sm bar-report", onclick: () => go("#report/" + encodeURIComponent(m.run_id)) }, "完整报告")],
    saveLine: saveLine(d), actions: actions(d), plans: true, usage: usageText(),
  });
  box.textContent = ""; box.append(...parts);
  document.title = `${m.title} · 两层判断 · 股票研究工作台`;
  return true;
}
function renderResultSafe(d) {
  try { return renderResult_(d); }
  catch (e) { showMessage("这条记录无法显示", `它的格式和这个版本的页面对不上（${String((e && e.message) || e).slice(0, 80)}）。可以下载完整记录查看，或删除它。`); return false; }
}
function showMessage(title, text, extra) {
  const box = $("result-view"); box.textContent = "";
  box.append(el("div", { class: "wrap" }, el("div", { class: "msg-box" }, el("h1", { id: "res-title", tabindex: "-1" }, title), el("p", {}, text),
    el("div", { class: "row" }, extra || null, el("button", { type: "button", class: "btn", onclick: newAnalysis }, "回到首页")))));
  setView("result"); focusTo($("res-title"));
  document.title = `${title} · 股票研究工作台`;
}

// ---------------------------------------------------------------- full report (page, print, download)
function reportMeta(d) {
  return { site: siteLine(d.site), footer: "这份报告由演示网站在浏览器里生成，数据全部是合成的；完整的技术记录是同一运行编号的 JSON 文件。" };
}
function downloadReport(d) {
  const art = buildReport(modelOf(d), reportMeta(d));
  for (const x of art.querySelectorAll("details")) x.open = true;
  const t = `研究记录 · ${d.view.title} · ${d.view.run_id}`.replace(/[<>&"]/g, "");
  const html = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title><style>${REPORT_CSS}</style></head><body>${art.outerHTML}</body></html>\n`;
  saveFile(new Blob([html], { type: "text/html;charset=utf-8" }), `${d.view.run_id}-report.html`);
}
function renderReport(d) {
  const box = $("view-report"); box.textContent = "";
  const id = encodeURIComponent(d.view.run_id);
  box.append(el("div", { class: "rep-bar" },
    el("button", { type: "button", class: "linkbtn", onclick: () => go("#run/" + id) }, "← 返回结果"), el("span", { class: "sp" }),
    el("button", { type: "button", class: "btn ghost btn-sm", onclick: () => window.print() }, "打印或存为 PDF"),
    el("button", { type: "button", class: "btn btn-sm", onclick: () => downloadReport(d) }, "下载报告（HTML）")), buildReport(modelOf(d), reportMeta(d)));
  document.title = `研究记录 · ${d.view.title} · ${d.view.run_id}`;
}

// ---------------------------------------------------------------- routing: "" (start), "#run/<id>", "#report/<id>"
async function route() {
  if (location.hash === "#main") return;
  const gen = ++ROUTE_GEN;
  const m = /^#(run|report)\/(.+)$/.exec(location.hash);
  if (!m) {
    const from = document.body.dataset.view;
    setView("start"); if (BUSY) setStep("run"); else if ($("step-error").hidden && $("step-confirm").hidden) setStep("choose");
    if (from !== "start") { const s = ["choose", "confirm", "run", "error"].find((x) => !$("step-" + x).hidden); if (s) focusStep(s + "-title"); }
    return;
  }
  let id; try { id = decodeURIComponent(m[2]); } catch { id = ""; }
  if (!RUN_ID_RX.test(id)) return showMessage("地址里的运行编号格式不对", "请从历史列表打开一条记录，或者开始新的分析。");
  let d = CURRENT && CURRENT.view.run_id === id ? CURRENT : null;
  if (!d) {
    const L = await histList();
    if (gen !== ROUTE_GEN) return;
    if (!L.ok) return showMessage("历史不可用", `${storageWhy(L.error)}，所以无法打开运行编号 ${id} 的记录。`);
    const h = L.items.find((x) => x.run_id === id);
    if (!h) return showMessage("找不到这条记录", `运行编号 ${id} 不在这个浏览器的历史里：可能已经删除、超过 ${HIST_MAX} 条后被自动删除，或者是在别的浏览器里保存的。`);
    const x = await checkEntry(h);
    if (gen !== ROUTE_GEN) return;
    if (!x) return showMessage("这条记录已损坏", "它的内容和保存时的校验值不一致（可能被改动，或者存储出错），所以不显示。可以删除它。",
      el("button", { type: "button", class: "btn danger", onclick: async () => { if (await delOne(id)) newAnalysis(); } }, "删除这条记录"));
    d = CURRENT = { view: x.view, recordText: x.record_text, record: x.record, site: x.site || null, fromHistory: true, save: null, load: null };
  }
  if (m[1] === "run") { if (renderResultSafe(d)) { setView("result"); focusTo($("res-title")); } }
  else {
    if (!d.record) { renderResultSafe(d); return; }
    try { renderReport(d); setView("report"); focusTo($("view-report").querySelector("h1")); }
    catch (e) { showMessage("这条记录无法显示", `它的格式和这个版本的页面对不上（${String((e && e.message) || e).slice(0, 80)}）。`); }
  }
}

// ---------------------------------------------------------------- start
async function start() {
  $("hist-max").textContent = HIST_MAX;
  $("plans-home-body").append(planRules(), planMatrix());
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (RUN && RUN.timer) arm(RUN.timer.ms, RUN.timer.kind);
    if (!BUSY) renderHistory();
  });
  document.querySelector(".skip").addEventListener("click", (e) => { e.preventDefault(); focusTo($("main")); });
  let printOpened = [];
  window.addEventListener("beforeprint", () => {
    const scope = document.body.dataset.view === "report" ? $("view-report") : $("result-view");
    printOpened = [...scope.querySelectorAll("details:not([open])")];
    for (const x of printOpened) x.open = true;
  });
  window.addEventListener("afterprint", () => { for (const x of printOpened) x.open = false; printOpened = []; });
  $("search-form").addEventListener("submit", (e) => { e.preventDefault(); if (!MANIFEST) return; renderCases($("q").value); const ms = caseMatches($("q").value); if ($("q").value.trim() && ms.length === 1) choose(ms[0]); });
  $("q").addEventListener("input", (e) => { if (!MANIFEST || e.isComposing) return; renderCases($("q").value); });
  $("q").addEventListener("compositionend", () => { if (MANIFEST) renderCases($("q").value); });
  $("btn-analyze").addEventListener("click", analyze);
  $("btn-back").addEventListener("click", () => { CHOSEN = null; setStep("choose"); focusStep("choose-title"); });
  $("btn-cancel").addEventListener("click", () => { if (!BUSY) return; stopWorker(); release(); setStep("confirm"); $("confirm-note").textContent = "已取消，没有保存任何结果。"; focusStep("confirm-title"); });
  $("btn-retry").addEventListener("click", () => { if (CHOSEN) { STEP_AT = 0; analyze(); } });
  $("btn-error-back").addEventListener("click", () => { $("confirm-note").textContent = ""; setStep(CHOSEN ? "confirm" : "choose"); focusStep(CHOSEN ? "confirm-title" : "choose-title"); });
  $("btn-clear").addEventListener("click", () => { $("btn-clear").hidden = true; $("clear-confirm").hidden = false; $("btn-clear-no").focus(); });
  $("btn-clear-no").addEventListener("click", () => { $("clear-confirm").hidden = true; $("btn-clear").hidden = false; $("btn-clear").focus(); });
  $("btn-clear-yes").addEventListener("click", async () => {
    if (BUSY || HIST_BUSY) return;
    HIST_BUSY = true; lockHistory(BUSY);
    $("hist-msg").textContent = "";
    let err = null;
    try { await tx("readwrite", (s) => s.clear()); } catch (e) { err = e; }
    HIST_BUSY = false;
    await renderHistory();
    if (err) { $("hist-msg").textContent = `清空失败：${storageWhy(err)}。`; focusTo($("hist-title"), "nearest"); return; }
    if (CURRENT) markUnsaved("历史已清空");
    focusTo($("hist-title"), "nearest");
  });
  renderHistory();
  try { MANIFEST = await (await fetch("manifest.json", { cache: "no-cache" })).json(); }
  catch {
    $("ver").textContent = "版本信息读取失败";
    $("match-msg").textContent = "网站的清单文件读取失败，无法开始新的分析（已保存的历史仍可打开）。请检查网络后刷新页面。"; $("match-msg").className = "match-msg warn";
    await route();
    return;
  }
  const dirty = MANIFEST.source_dirty ? "（构建时有未提交的改动）" : "";
  $("ver").textContent = `版本 ${MANIFEST.version}`;
  $("foot").textContent = `版本 ${MANIFEST.version} · 构建 ${MANIFEST.built_at} · 源码 ${String(MANIFEST.source_commit).slice(0, 12)}${dirty} · Python ${MANIFEST.python}（Pyodide ${MANIFEST.pyodide}） · 分析程序 SHA-256 ${MANIFEST.bundle_sha256.slice(0, 16)}… · 第三方许可见 licenses/`;
  const nCo = MANIFEST.cases.filter((c) => c.kind === "COMPANY").length, nSc = MANIFEST.cases.length - nCo;
  $("scope-n").textContent = `${nCo} 家合成公司和 ${nSc} 个演示场景`;
  renderCases("");
  setStep("choose");
  await route();
}
start();
