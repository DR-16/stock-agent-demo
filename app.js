// Q13 demo page (rewrite of the Q12 page; same worker contract and the same integrity checks).
// Flow: choose (search or pick from the supported list) -> confirm -> run (one worker per analysis; real stages, real elapsed time and the real
// number of bytes transferred, never a guessed percentage) -> read (things to look at first, then every section; evidence on demand) -> full
// report page (print, or download as one HTML file) -> history in this browser (IndexedDB; every entry re-checked against its SHA-256; empty,
// damaged and unavailable storage are shown as such). Nothing is scored: every number on the page is a count of items the report contains.
// Revised after an independent review (records/q13_reviews/review_frontend.md, M1-M6 and MINOR 1-18).
const HIST_MAX = 20;
const TIMEOUT_MS = { load: 240000, run: 90000 };        // the first load downloads the runtime; the five experts themselves take seconds
const STAGES = [
  ["下载并启动 Python 运行环境", "首次需要下载，之后由浏览器缓存；实际传输量显示在下方"],
  ["加载数据处理库", "numpy、pandas"],
  ["下载分析程序并核对校验值", "和网站登记的 SHA-256 比对，不一致就停止"],
  ["五个专家运行", "技术面、宏观、基本面、估值、公告"],
  ["核对并保存结果", "核对结果自带的校验值，保存到这个浏览器的历史"],
];
const KIND_ZH = { COMPANY: "合成公司", SCENARIO: "演示场景" };
const KIND_LONG = { COMPANY: "合成公司（虚构，不对应任何真实公司）", SCENARIO: "演示场景（同一家合成公司，部分资料被故意改坏）" };
const RUN_ID_RX = /^[A-Za-z0-9-]{8,80}$/;
const $ = (id) => document.getElementById(id);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let MANIFEST = null, CHOSEN = null, WORKER = null, TIMER = null, TICK = null, BUSY = false, RUN = null, CURRENT = null;
let STEP_AT = 0, ROUTE_GEN = 0, HIST_GEN = 0, HIST_BUSY = false, LAST_DEL = -1e9;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== "") e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
async function sha256Text(t) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function focusTo(e, block = "start") { if (!e) return; if (!e.hasAttribute("tabindex")) e.setAttribute("tabindex", "-1"); e.focus({ preventScroll: true }); e.scrollIntoView({ block, behavior: reduced() ? "auto" : "smooth" }); }
const focusStep = (id) => focusTo($(id), "nearest");        // a step inside the panel: keep the stepper in view
function localTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return String(iso || "");
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function saveFile(blob, name) { const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const mb = (b) => (b / 1e6).toFixed(1);                     // decimal megabytes, as the text says "MB"
function siteLine(site) {
  if (!site) return "未记录（旧版本保存的记录）";
  return `${site.version} · 源码 ${String(site.commit).slice(0, 12)}${site.dirty ? "（构建时有未提交的改动）" : ""} · 分析程序 ${String(site.bundle_sha256).slice(0, 16)}…`;
}

// ---------------------------------------------------------------- views and steps
function setView(v) {
  document.body.dataset.view = v;
  $("view-home").hidden = v === "report";
  $("view-report").hidden = v !== "report";
  $("hero").hidden = v !== "start";
  $("result-view").hidden = v !== "result";
  if (v !== "report") $("view-report").textContent = "";   // review M2: nothing stale is left to print
  if (v === "start") document.title = "股票研究工作台 · 演示预览";
}
function setStep(s) {
  for (const id of ["choose", "confirm", "run", "error"]) $("step-" + id).hidden = id !== s;
  const n = { choose: 1, confirm: 2, run: 3, error: 3 }[s];
  for (const li of $("stepper").children) {
    const k = Number(li.dataset.n);
    li.classList.toggle("done", k < n);
    if (k === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
  STEP_AT = performance.now();                             // review M4: a second click right after a step change is not a decision
}
function go(hash) { if (location.hash === hash || (hash === "" && !location.hash)) route(); else location.hash = hash; }
function newAnalysis() {                                    // review M5: during a run the run panel stays; nothing is cleared
  if (!BUSY) { CHOSEN = null; setStep("choose"); }
  go("");                                                   // Q13 re-review U-1: route() moves the focus once the start view is shown
}

// ---------------------------------------------------------------- choose and confirm
const norm = (x) => String(x).normalize("NFKC").trim().toLowerCase();   // full-width input (ＳＹＮＤＥＭＯ２) is the same text
function caseMatches(q) {
  q = norm(q);
  if (!q) return MANIFEST.cases;
  return MANIFEST.cases.filter((c) => [c.title, c.code, c.case_id, c.note].some((s) => norm(s).includes(q)));
}
function renderCases(raw) {
  const msg = $("match-msg"), list = $("cases"), q = String(raw || "").normalize("NFKC").trim();
  list.textContent = ""; msg.textContent = ""; msg.className = "match-msg";
  if (q.length > 40) { msg.textContent = "输入太长（最多 40 个字符）。"; msg.classList.add("warn"); }
  const ms = q.length > 40 ? [] : caseMatches(q);
  if (q && q.length <= 40 && !ms.length) {
    msg.textContent = `没有找到“${q}”。这个演示只有下面 ${MANIFEST.cases.length} 项合成数据，不支持任意股票，也不支持真实代码。`;
    msg.classList.add("warn");
  } else if (q && ms.length > 1) {
    const mixed = ms.some((c) => c.kind === "SCENARIO") && ms.some((c) => c.kind === "COMPANY");
    msg.textContent = `找到 ${ms.length} 项，请选一个。` + (mixed ? "“演示场景”用的是同一家合成公司，只是故意改坏了部分资料。" : "");
  } else if (q && ms.length === 1) msg.textContent = "找到 1 项。";
  const shown = q && ms.length ? ms : MANIFEST.cases;
  for (const c of shown) {
    list.append(el("li", {}, el("button", { type: "button", class: "case" + (q && ms.includes(c) ? " hit" : ""), onclick: () => choose(c) },
      el("span", { class: "case-top" }, el("span", { class: "case-title" }, c.title), el("span", { class: "tag " + (c.kind === "COMPANY" ? "tag-co" : "tag-sc") }, KIND_ZH[c.kind])),
      el("span", { class: "case-meta" }, `代码 ${c.code} · 数据截止 ${MANIFEST.as_of[c.case_id] || "—"}`),
      el("span", { class: "case-note" }, c.note))));
  }
  $("cases-n").textContent = q && ms.length ? `匹配 ${ms.length} 项，共 ${MANIFEST.cases.length} 项` : `${MANIFEST.cases.length} 项`;
}
function choose(c) {
  if (BUSY) return;
  CHOSEN = c;
  const b = $("confirm-box"); b.textContent = "";
  b.append(el("p", { class: "confirm-name" }, c.title, el("span", { class: "tag " + (c.kind === "COMPANY" ? "tag-co" : "tag-sc") }, KIND_ZH[c.kind])),
    el("dl", { class: "kv" },
      el("dt", {}, "代码"), el("dd", { class: "mono" }, c.code),
      el("dt", {}, "数据截止日"), el("dd", {}, MANIFEST.as_of[c.case_id] || "—"),
      el("dt", {}, "类型"), el("dd", {}, KIND_LONG[c.kind]),
      el("dt", {}, "看点"), el("dd", {}, c.note)),
    el("p", { class: "help" }, "五个专家都会运行：技术面、宏观、基本面、估值、公告。分析在你的浏览器里完成，不上传任何内容；结果会自动保存到这个浏览器的历史。"));
  $("confirm-note").textContent = "";
  setStep("confirm"); focusStep("confirm-title");
}

// ---------------------------------------------------------------- run
function stageText(i) {
  const s = RUN && RUN.at[i]; if (!s) return "等待";
  const sec = ((s.end || performance.now()) - s.start) / 1000;
  return s.end ? `完成 · ${sec.toFixed(1)} 秒` : `进行中 · ${Math.floor(sec)} 秒`;
}
function renderStages(announce) {
  const ol = $("stages"); ol.textContent = "";
  STAGES.forEach(([name, sub], i) => {
    const s = RUN.at[i], state = !s ? "wait" : s.end ? "done" : "now";
    ol.append(el("li", { class: "stage " + state, "aria-current": state === "now" ? "step" : null },
      el("span", { class: "st-icon", "aria-hidden": "true" }),
      el("span", {}, el("span", { class: "st-name" }, name), el("span", { class: "st-sub" }, sub)),
      el("span", { class: "st-time", id: "st-time-" + i }, stageText(i))));
  });
  if (announce && RUN.stage) $("run-live").textContent = `第 ${RUN.stage} 步，共 ${STAGES.length} 步：${STAGES[RUN.stage - 1][0]}`;
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
function release() { BUSY = false; RUN = null; $("btn-analyze").disabled = false; $("btn-cancel").disabled = false; lockHistory(false); }   // Q13 re-review U-8: cancel enabled again
function arm(ms, kind) {                                    // review MINOR 16: a hidden (suspended) tab does not run out its time
  if (TIMER) clearTimeout(TIMER);
  const run = RUN;
  TIMER = setTimeout(() => {
    if (RUN !== run) return;
    if (document.hidden) { arm(ms, kind); return; }
    fail(kind);
  }, ms);
  if (RUN) RUN.timer = { ms, kind };
}

const FAIL = {
  INTEGRITY: ["分析程序校验不一致", "下载的分析程序和网站登记的校验值不一致，已经停止，没有运行。请刷新页面后重试；如果仍然出现，说明网站文件不完整。"],
  NETWORK: ["下载或启动运行环境失败", "多半是网络问题（文件没有下载完整）；如果网络正常，也可能是浏览器版本太旧或内存不足。可以点“重试”。"],
  RUNTIME: ["分析过程出错", "运行环境已经加载，但五个专家运行时出错，没有生成结果。可以重试一次；如果仍然出错，说明这个版本有缺陷。"],
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
  if (BUSY || !CHOSEN) return;                        // one analysis at a time in this page; a second click does nothing
  if (e && e.detail > 1) return;                      // Q13 re-review U-4: the 2nd click of a double click is not a decision
  if (performance.now() - STEP_AT < 600) return;      // review M4 (Q13 re-review U-4: 600 ms): the click that opened the confirm step does not start the run
  BUSY = true; $("btn-analyze").disabled = true; lockHistory(true);
  $("confirm-note").textContent = "";
  RUN = { t0: performance.now(), stage: 0, at: [], net: null, caseId: CHOSEN.case_id };
  $("run-title").textContent = `正在分析：${CHOSEN.title}`; $("run-net").textContent = ""; $("run-elapsed").textContent = "";
  setStep("run"); renderStages(false); focusStep("run-title");
  try { WORKER = new Worker("worker.js", { type: "module" }); } catch { return fail("START"); }
  arm(TIMEOUT_MS.load, "TIMEOUT_LOAD");
  TICK = setInterval(tick, 500);
  WORKER.onerror = (e) => {                           // Q13 re-review U-6: classified by the stage reached, like the worker's own error messages
    if (e && e.preventDefault) e.preventDefault();
    const st = RUN ? RUN.stage : 0;
    fail(!st ? "START" : st <= 3 ? "NETWORK" : "RUNTIME", st ? `第 ${st} 步` : "");
  };
  WORKER.onmessage = (ev) => onWorker(ev.data);
  WORKER.postMessage({ caseId: CHOSEN.case_id, bundle: MANIFEST.bundle, bundleSha256: MANIFEST.bundle_sha256 });
}
async function onWorker(m) {
  if (!RUN || !m) return;
  const run = RUN;                                    // review MINOR 1: every await below re-checks that this run is still the current one
  if (m.type === "stage") { setStage(m.n); if (m.n === 4) arm(TIMEOUT_MS.run, "TIMEOUT_RUN"); return; }
  if (m.type === "net") { run.net = m; $("run-net").textContent = netText(m); return; }
  if (m.type === "error") return fail(m.kind, m.stage ? `第 ${m.stage} 步` : "");
  if (m.type !== "done") return;
  if (m.net) run.net = m.net;
  if (WORKER) { WORKER.onmessage = null; WORKER.onerror = null; WORKER.terminate(); WORKER = null; }
  setStage(5);
  $("btn-cancel").disabled = true;                    // Q13 re-review U-8: the save stage is not cancelled half-way (release() enables it again)
  let r; try { r = JSON.parse(m.out); } catch { return fail("RESULT"); }
  if (!r || !r.view || !r.view.ok) return fail("RESULT", (r && r.view && r.view.error) || (r && r.error) || "");
  const okHash = typeof r.record_text === "string" && (await sha256Text(r.record_text)) === r.view.record_sha256;
  if (RUN !== run) return;                            // cancelled while hashing: nothing is saved
  if (!okHash) return fail("RESULT_HASH");
  const site = { version: MANIFEST.version, commit: MANIFEST.source_commit, dirty: !!MANIFEST.source_dirty, bundle_sha256: MANIFEST.bundle_sha256 };
  const payload = JSON.stringify({ view: r.view, record_text: r.record_text, site });
  const ph = await sha256Text(payload);
  if (RUN !== run) return;
  const save = await histSave({ run_id: r.view.run_id, case_id: r.view.case_id, title: r.view.case.title, kind: r.view.case.kind,
                                saved_at: new Date().toISOString(), payload, payload_sha256: ph });
  if (RUN !== run) {                                  // cancelled (or timed out) during the save: the page does not jump
    if (save.saved) {                                 // Q13 re-review U-8: the entry was committed - the history shows it and the page says so
      await renderHistory();
      const said = "结果在停止前已经保存到历史，可以在下面的历史里打开。";
      if (!$("step-confirm").hidden && /没有保存/.test($("confirm-note").textContent)) $("confirm-note").textContent = "已取消，但" + said;
      if (!$("step-error").hidden && /没有保存/.test($("error-text").textContent)) $("error-text").textContent = `${$("error-title").textContent}，但${said}`;
    }
    return;
  }
  stopWorker();
  run.at[4].end = performance.now();
  const load = { stages: STAGES.map(([n], i) => ({ name: n, seconds: run.at[i] && run.at[i].end ? (run.at[i].end - run.at[i].start) / 1000 : null })),
                 total: (performance.now() - run.t0) / 1000, net: run.net };
  CURRENT = { view: r.view, recordText: r.record_text, site, fromHistory: false, save, load };
  release();
  CHOSEN = null; setStep("choose");
  await renderHistory();
  go("#run/" + encodeURIComponent(r.view.run_id));
}

// ---------------------------------------------------------------- history (IndexedDB)
function idb() {
  return new Promise((ok, bad) => {
    let r, done = false;
    const t = setTimeout(() => { if (!done) { done = true; bad(Object.assign(new Error("timeout"), { name: "TimeoutError" })); } }, 8000);   // review MINOR 1: a hung open
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
      try { t = d.transaction("runs", mode); req = fn(t.objectStore("runs"), t); } catch (e) { try { t && t.abort(); } catch { /* already finished */ } bad(e); return; }
      t.oncomplete = () => ok(req && req instanceof IDBRequest ? req.result : req && req.value !== undefined ? req.value : undefined);
      t.onerror = (e) => bad((e && e.target && e.target.error) || t.error);      // review MINOR 13: the request's own error (QuotaExceededError)
      t.onabort = (e) => bad(t.error || (e && e.target && e.target.error) || new Error("abort"));
    });
  } finally { d.close(); }
}
function storageWhy(e) {
  const n = e && e.name;
  if (n === "QuotaExceededError") return "浏览器给本站的存储空间不够";
  if (n === "TimeoutError") return "浏览器的存储没有响应";
  if (n === "SecurityError" || n === "InvalidStateError" || !window.indexedDB) return "浏览器不允许本站保存数据（例如无痕模式，或者关闭了网站数据）";
  return "浏览器存储出错（可能是空间不足或浏览器限制）";   // Q13 re-review U-7: UnknownError and any other name - not called private mode
}
async function histList() { try { return { ok: true, items: (await tx("readonly", (s) => s.getAll())) || [] }; } catch (e) { return { ok: false, error: e }; } }
async function histSave(entry) {
  // review MINOR 13: read, drop the oldest and write in ONE transaction (two tabs cannot both add a 20th entry)
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
async function checkEntry(h) {
  if (!h || typeof h.payload !== "string" || typeof h.payload_sha256 !== "string" || typeof h.run_id !== "string") return null;
  if ((await sha256Text(h.payload)) !== h.payload_sha256) return null;
  let d; try { d = JSON.parse(h.payload); } catch { return null; }
  if (!d || !d.view || typeof d.record_text !== "string" || d.view.run_id !== h.run_id) return null;
  if ((await sha256Text(d.record_text)) !== d.view.record_sha256) return null;
  return d;
}
function lockHistory(on) {
  $("hist-lock").hidden = !on;
  for (const b of $("history-box").querySelectorAll("[data-lock]")) b.disabled = on || HIST_BUSY;
}
async function renderHistory() {
  // review M3: one render at a time wins (a newer call supersedes an older one), and the list is built off the page, then swapped in at once
  const gen = ++HIST_GEN;
  const L = await histList();
  const frag = document.createDocumentFragment();
  let count = "", clear = false;
  if (!L.ok) {
    frag.append(el("li", { class: "empty warn" }, el("strong", {}, "历史不可用"),
      el("p", {}, `${storageWhy(L.error)}。分析仍然可以运行，只是结果不会保存，刷新页面后无法再打开；需要保留时请在结果页下载。`)));
  } else if (!L.items.length) {
    frag.append(el("li", { class: "empty" }, el("strong", {}, "还没有保存的分析"), el("p", {}, `完成一次分析后，结果会自动保存在这里（只在这个浏览器里，最多 ${HIST_MAX} 条）。`)));
  } else {
    const items = L.items.slice().sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
    count = `${items.length} / ${HIST_MAX} 条`; clear = true;
    for (const h of items) {
      const ok = !!(await checkEntry(h));
      if (gen !== HIST_GEN) return;
      const title = typeof h.title === "string" ? h.title : "（无法识别的记录）";
      const when = h.saved_at ? localTime(h.saved_at) : "时间未知";
      frag.append(el("li", { class: "h-item" + (ok ? "" : " damaged") },
        el("div", {},
          el("div", { class: "h-title" }, title, h.kind ? el("span", { class: "tag " + (h.kind === "COMPANY" ? "tag-co" : "tag-sc") }, KIND_ZH[h.kind] || "") : null,
            ok ? null : el("span", { class: "tag tag-bad" }, "已损坏，不能打开")),
          el("div", { class: "h-meta" }, `保存于 ${when}（本地时间） · 运行编号 `, el("span", { class: "mono" }, String(h.run_id || "—")))),
        el("div", { class: "h-actions" },
          ok ? el("button", { type: "button", class: "btn btn-sm", "data-lock": true, "aria-label": `打开 ${title}（${when}）`, onclick: () => go("#run/" + encodeURIComponent(h.run_id)) }, "打开") : null,
          el("button", { type: "button", class: "btn ghost btn-sm", "data-lock": true, "aria-label": `删除 ${title}（${when}）的记录`, onclick: (e) => { if (e.detail > 1 || performance.now() - LAST_DEL < 600) return; delOne(h.run_id); } }, "删除"))));   // review M3: the 2nd click of a double click, or one right after a delete, lands on another row
    }
  }
  if (gen !== HIST_GEN) return;
  if (L.ok) $("hist-msg").textContent = "";                  // Q13 re-review U-2: an old failure message does not outlive a list that renders
  const box = $("history"); box.textContent = ""; box.append(frag);
  $("hist-count").textContent = count; $("btn-clear").hidden = !clear; $("clear-confirm").hidden = true; $("clear-n").textContent = count ? count.split(" ")[0] : "";
  lockHistory(BUSY);
}
function markUnsaved(why) {                                  // review MINOR 3: the page stops claiming the run is saved
  if (!CURRENT) return;
  CURRENT.save = { saved: false, why }; CURRENT.fromHistory = false;
  const m = /^#run\/(.+)$/.exec(location.hash);              // Q13 re-review U-3: re-render only when the page shows this very record
  let id = null; try { id = m ? decodeURIComponent(m[1]) : null; } catch { id = null; }
  if (document.body.dataset.view === "result" && id === CURRENT.view.run_id) renderResultSafe(CURRENT);
}
async function delOne(id) {
  if (HIST_BUSY) return false;                               // review M3: a double click deletes one record only
  HIST_BUSY = true; lockHistory(BUSY);
  $("hist-msg").textContent = "";                            // Q13 re-review U-2
  let err = null;
  try { await tx("readwrite", (s) => s.delete(id)); } catch (e) { err = e; }
  HIST_BUSY = false; LAST_DEL = performance.now();
  await renderHistory();
  LAST_DEL = performance.now();
  if (err) { $("hist-msg").textContent = `删除失败：${storageWhy(err)}。`; focusTo($("hist-title"), "nearest"); return false; }   // Q13 re-review U-1: focus stays on a visible element
  if (CURRENT && CURRENT.view.run_id === id) markUnsaved("这条记录已从历史中删除");
  focusTo($("hist-title"), "nearest");
  return true;                                               // Q13 re-review U-2: the caller acts on the result, not on the message
}

// ---------------------------------------------------------------- result
function splitName(n) { const m = /^(.+?)[(（](.+)[)）]$/.exec(n || ""); return m ? [m[1], m[2]] : [n, ""]; }
function evidenceBody(ev) {
  const rows = [];
  const add = (k, v) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    const s = Array.isArray(v) ? v.join("、") : typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join("；") : String(v);
    rows.push(el("dt", {}, k), el("dd", {}, s));
  };
  add("证据类型", ev.kind); add("文件", ev.document || ev.source); add("表格", ev.form); add("章节", ev.section);
  add("价格日期", ev.price_date); add("公开时间（数据日期）", ev.available); add("财年", ev.fiscal_year); add("数据集", ev.dataset); add("指标", ev.metric); add("数值", ev.metric_value);
  add("数据截至", ev.as_of); add("读取的文件", ev.documents); add("所用输入", ev.inputs);
  const out = [];
  if (rows.length) out.push(el("dl", { class: "kv" }, rows));
  if (ev.quote) out.push(el("blockquote", { class: "quote" }, el("span", { class: "ql" }, "原文（合成文件）"), ev.quote));
  if (ev.date_quote) out.push(el("blockquote", { class: "quote" }, el("span", { class: "ql" }, "日期原文"), ev.date_quote));
  if (ev.footnote) out.push(el("blockquote", { class: "quote" }, el("span", { class: "ql" }, "申报脚注原文"), ev.footnote));
  return out;
}
function dateChip(ev) {
  if (!ev) return null;
  if (ev.price_date) return `价格日期 ${ev.price_date}`;          // a valuation reading: the price's date (the financials get their own chip)
  if (ev.available) return `公开于 ${String(ev.available).slice(0, 10)}`;
  if (ev.as_of) return `数据截至 ${String(ev.as_of).slice(0, 10)}`;
  if (ev.fiscal_year) return `财年 ${ev.fiscal_year}`;
  return null;
}
function itemCard(x, type) {
  if (typeof x === "string") x = { text: x };
  const ev = x.evidence || null, chips = [];
  const d = dateChip(ev); if (d) chips.push(el("span", { class: "chip chip-date" }, d));
  if (ev && ev.price_date && ev.fiscal_year) chips.push(el("span", { class: "chip chip-date" }, ev.fiscal_year + (ev.available ? ` · 公开于 ${ev.available}` : "")));
  if (ev && (ev.document || ev.form) && !ev.price_date) chips.push(el("span", { class: "chip" }, [ev.form, ev.document].filter(Boolean).join(" · ")));
  if (x.status && /[一-龥]/.test(x.status)) chips.push(el("span", { class: "chip chip-status" }, x.status));
  const body = ev ? evidenceBody(ev) : [];
  return el("li", { class: "it it-" + type }, el("p", { class: "it-text" }, x.text), chips.length ? el("div", { class: "chips" }, chips) : null,
    body.length ? el("details", { class: "ev" }, el("summary", {}, "证据与数据日期"), el("div", { class: "evbox" }, body)) : null);
}
function itemList(items, type) { return el("ul", { class: "items" }, (items || []).map((x) => itemCard(x, type))); }
function grouped(items) { const m = new Map(); for (const x of items || []) { const k = x.kind || "其他"; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
const noFinding = (e) => e.status === "COMPLETED" && /没有有效发现/.test(e.plain || "");
function attention(v) {
  const out = [];
  for (const e of v.experts || []) if (e.status !== "COMPLETED") {
    const why = e.plain ? [e.plain] : uniq((e.reasons || []).map((r) => r.meaning));
    out.push({ bad: true, label: "专家没有结果", text: `${e.name}：${e.plain ? "" : e.status_zh}${why.length ? (e.plain ? "" : "——") + why.join("；") : ""}`, href: "sec-experts" });
  }
  for (const s of (v.cross && v.cross.sections) || []) if (s.count && (s.key === "D1_cross_expert_contradictions" || s.key === "S_same_expert_source_conflicts"))
    out.push({ label: s.title, text: `${s.count} 条，未核实；内容见“专家之间的对照”` + (s.key === "S_same_expert_source_conflicts" ? "，涉及的条目也在“需要核实”里。" : "。"), href: "sec-cross" });
  for (const g of (v.beginner && v.beginner.gaps) || []) if (/^价格走势只算到|不是同一天/.test(g.text || ""))
    out.push({ label: "数据日期不同", text: g.text, href: "sec-gaps" });           // review MINOR 11
  for (const x of (v.beginner && v.beginner.needs_check) || []) out.push({ label: "需要核实", text: x.text, href: "sec-check" });
  return out;
}
function expertTile(e) {
  const [nm, scope] = splitName(e.name), ok = e.status === "COMPLETED", nf = noFinding(e);
  const reasons = (e.reasons || []).filter((r, i, a) => a.findIndex((y) => y.meaning === r.meaning && y.detail === r.detail) === i);
  return el("li", { class: "ex " + (ok ? (nf ? "ex-none" : "ex-ok") : "ex-bad") },
    el("span", { class: "ex-name" }, nm), scope ? el("span", { class: "ex-scope" }, scope) : null,
    el("span", { class: "ex-status" }, el("span", { class: "mk", "aria-hidden": "true" }, ok ? (nf ? "○" : "✓") : "✕"), ok && nf ? "已运行，没有有效发现" : e.status_zh),
    el("span", { class: "ex-tier" }, e.tier),
    (!ok || nf) && e.plain ? el("p", { class: "ex-plain" }, e.plain) : null,
    !ok && reasons.length ? el("details", { class: "ev" }, el("summary", {}, e.plain ? "系统记录的原因" : "原因"),
      el("ul", { class: "ex-why" }, reasons.map((r) => el("li", {}, r.meaning || "原因未记录", r.detail ? el("div", { class: "ex-detail" }, r.detail) : null)))) : null,
    e.version ? el("span", { class: "ex-ver mono" }, e.version) : null);
}
function crossBlock(v) {
  const c = v.cross;
  if (!c) return el("p", { class: "sec-help" }, "这条记录由旧版本保存，没有专家之间的对照信息。");
  const out = [el("ul", { class: "cross-grid" }, c.sections.map((s) => el("li", { class: "cx" + (s.count && /^(D1|S_)/.test(s.key) ? " cx-warn" : "") }, el("b", {}, s.count), el("span", {}, s.title))))];
  for (const s of c.sections) if (s.count) out.push(el("details", { class: "more" }, el("summary", {}, `${s.title}：${s.count} 条`),
    s.explain ? el("p", { class: "sec-help" }, s.explain) : null, el("ul", { class: "plain" }, s.items.map((t) => el("li", {}, t))),
    s.count > s.items.length ? el("p", { class: "sec-help" }, `只列出前 ${s.items.length} 条；全部 ${s.count} 条在完整记录（JSON）里。`) : null));
  if (c.not_compared.length) out.push(el("h3", { class: "group-title" }, `没有比较的规则（${c.not_compared.length} 条；不能读作“没有矛盾”）`), el("ul", { class: "plain" }, c.not_compared.map((t) => el("li", {}, t))));
  return out;
}
function saveLine(d) {
  if (d.fromHistory) return el("p", { class: "save-line" }, "来自这个浏览器的历史；打开时已重新核对校验值。");
  const s = d.save || {};
  if (s.saved) return el("p", { class: "save-line" }, "已保存到这个浏览器的历史。",
    (s.dropped || []).length ? ` 历史已满 ${HIST_MAX} 条，自动删除了最早的：${s.dropped.map((x) => `${x.title}（${localTime(x.saved_at)}）`).join("、")}。` : "");
  return el("p", { class: "save-line warn" }, `没有保存到历史：${s.why || "原因未知"}。刷新页面后无法再打开这次结果；需要保留请先下载。`);
}
function loadLine(d) {
  if (!d.load) return null;
  const parts = d.load.stages.filter((s) => s.seconds != null).map((s) => `${s.name} ${s.seconds.toFixed(1)} 秒`);
  const n = netText(d.load.net);
  return el("details", { class: "more" }, el("summary", {}, `从点击“开始分析”到显示，共 ${d.load.total.toFixed(1)} 秒`), el("ul", { class: "plain" }, parts.map((p) => el("li", {}, p)), n ? el("li", {}, n) : null));
}
function actions(d) {
  const v = d.view, saved = d.fromHistory || (d.save && d.save.saved);
  return el("div", { class: "res-actions" }, el("p", {}, (saved ? "页面、报告、下载和历史都是同一次运行" : "页面、报告和下载都是同一次运行（没有保存到历史）") + "（记录校验值 SHA-256 " + v.record_sha256.slice(0, 16) + "…）。"),
    el("button", { type: "button", class: "btn", onclick: () => go("#report/" + encodeURIComponent(v.run_id)) }, "打开完整报告"),
    el("button", { type: "button", class: "btn ghost", onclick: () => downloadReport(d) }, "下载报告（HTML）"),
    el("button", { type: "button", class: "btn ghost", onclick: () => saveFile(new Blob([d.recordText], { type: "application/json" }), `${v.run_id}.json`) }, "下载完整记录（JSON）"));
}
const jump = (id) => (e) => { e.preventDefault(); focusTo($(id).querySelector("h2")); };
function renderResult(d) {
  const v = d.view, b = v.beginner || {}, box = $("result-view");
  const secs = [
    ["sec-experts", "五个专家", null], ["sec-attention", "先看这些", null], ["sec-facts", "事实", b.facts], ["sec-leads", "公告线索", b.leads],
    ["sec-readings", "读数", b.readings], ["sec-check", "需要核实", b.needs_check], ["sec-gaps", "没有算的项目", b.gaps], ["sec-cross", "专家之间的对照", null], ["sec-limits", "限制", null]];
  const att = attention(v);
  const frag = el("div", {},
    el("div", { class: "res-top" }, el("button", { type: "button", class: "linkbtn", onclick: newAnalysis }, "← 新的分析"),
      el("button", { type: "button", class: "btn ghost btn-sm", onclick: () => go("#report/" + encodeURIComponent(v.run_id)) }, "完整报告")),
    el("header", { class: "res-head" },
      el("div", { class: "res-name" }, el("h1", { id: "res-title" }, v.case.title), el("span", { class: "tag " + (v.case.kind === "COMPANY" ? "tag-co" : "tag-sc") }, KIND_ZH[v.case.kind]),
        d.fromHistory ? el("span", { class: "tag" }, "来自历史") : null),
      el("dl", { class: "meta-row" },
        el("div", {}, el("dt", {}, "代码"), el("dd", { class: "mono" }, v.case.code)),
        el("div", {}, el("dt", {}, "数据截止日"), el("dd", {}, String(v.as_of).slice(0, 10))),
        el("div", {}, el("dt", {}, "运行编号"), el("dd", { class: "mono" }, v.run_id)),
        el("div", {}, el("dt", {}, "五个专家用时"), el("dd", {}, `${v.seconds} 秒`))),
      el("p", { class: "synth" }, b.data_notice || "演示数据。"),
      saveLine(d), loadLine(d),
      el("ul", { class: "counts", "aria-label": "各部分条数" }, secs.filter((s) => s[2]).map(([id, t, xs]) => el("li", {}, el("a", { href: "#" + id, onclick: jump(id) }, t, el("b", {}, xs.length)))))),
    el("div", { class: "res-grid" },
      el("nav", { class: "toc", "aria-label": "结果目录" }, el("ol", {}, secs.map(([id, t, xs]) => el("li", {}, el("a", { href: "#" + id, onclick: jump(id) }, t, xs ? el("span", { class: "n" }, xs.length) : null))))),
      el("div", { class: "res-main" },
        sec("sec-experts", "五个专家", null, "技术面、宏观是生产在用的规则模型；基本面、估值、公告是实验版本。“已运行”只表示跑完了，不代表结论可靠。",
          el("ul", { class: "experts" }, (v.experts || []).map(expertTile))),
        sec("sec-attention", "先看这些", null, "按类型列出：没有结果的专家、文件或专家之间的冲突、数据日期不一致、需要核实的条目。这不是重要性评分。",
          att.length ? el("ul", { class: "attn" }, att.slice(0, 6).map((a) => el("li", { class: a.bad ? "bad" : "" }, el("span", { class: "al" }, a.label), a.text,
            el("a", { href: "#" + a.href, onclick: jump(a.href) }, "查看")))) : el("p", { class: "calm" }, "没有需要特别注意的事项。这不等于没有风险。"),
          att.length > 6 ? el("p", { class: "sec-help" }, `还有 ${att.length - 6} 条，见下面各部分。`) : null),
        sec("sec-facts", "事实", b.facts, "从财报和申报里直接读出的内容，每条可以展开看出处和数据日期。", b.facts && b.facts.length ? itemList(b.facts, "fact") : el("p", { class: "sec-help" }, "没有可以列出的事实。")),
        sec("sec-leads", "公告线索", b.leads, "规则从 8-K 公告和 Form 4 申报原文抽取，未经人工核实。", b.leads && b.leads.length ? itemList(b.leads, "lead") : el("p", { class: "sec-help" }, "没有公告线索。")),
        sec("sec-readings", "读数", b.readings, "描述值，不判断好坏，不是买卖信号。", b.readings && b.readings.length ? [...grouped(b.readings)].map(([k, xs]) => [el("h3", { class: "group-title" }, `${k}（${xs.length}）`), itemList(xs, "reading")]) : el("p", { class: "sec-help" }, "没有读数。")),
        sec("sec-check", "需要核实", b.needs_check, "系统不能确定的内容放在这里，不当作确定事实。", b.needs_check && b.needs_check.length ? itemList(b.needs_check, "check") : el("p", { class: "sec-help" }, "没有需要核实的条目。")),
        sec("sec-gaps", "没有算的项目", b.gaps, "缺的数据不按零或中性处理；没有算不等于没有风险。", b.gaps && b.gaps.length ? itemList(b.gaps, "gap") : el("p", { class: "sec-help" }, "没有列出的缺口。")),
        sec("sec-cross", "专家之间的对照", null, "综合层按固定规则做的对照：只列出和归类，不打分，不判断哪一方对。", crossBlock(v)),
        sec("sec-limits", "限制", null, null, el("ul", { class: "plain" }, (b.limits || []).map((t) => el("li", {}, t))),
          v.cross && v.cross.not_included.length ? el("p", { class: "sec-help" }, "这份报告不包含：" + v.cross.not_included.join("、") + "。") : null),
        actions(d))));
  box.textContent = ""; box.append(...frag.childNodes);
  document.title = `${v.case.title} · ${v.run_id} · 股票研究工作台`;
}
function renderResultSafe(d) {                              // review MINOR 14: an unexpected record shape shows a message, never a blank area
  try { renderResult(d); return true; }
  catch (e) { showMessage("这条记录无法显示", `它的格式和这个版本的页面对不上（${String(e && e.message || e).slice(0, 80)}）。可以下载完整记录查看，或删除它。`); return false; }
}
function sec(id, title, xs, help, ...body) {
  return el("section", { id, "aria-labelledby": id + "-h" }, el("h2", { id: id + "-h" }, title, xs ? el("span", { class: "n" }, `${xs.length} 条`) : null),
    help ? el("p", { class: "sec-help" }, help) : null, body);
}
function showMessage(title, text, extra) {
  const box = $("result-view"); box.textContent = "";
  box.append(el("div", { class: "msg-box" }, el("h1", { id: "res-title" }, title), el("p", {}, text),
    el("div", { class: "row" }, extra || null, el("button", { type: "button", class: "btn", onclick: newAnalysis }, "回到首页"))));
  setView("result"); focusTo($("res-title"));
  document.title = `${title} · 股票研究工作台`;               // Q13 re-review U-3: the tab names the message, not the record shown before
}

// ---------------------------------------------------------------- full report (page, print, download)
function buildReport(d) {
  const v = d.view, b = v.beginner || {}, site = d.site || null;
  const ritems = (xs) => el("ol", { class: "ritems" }, (xs || []).map((x) => {
    if (typeof x === "string") x = { text: x };
    const ev = x.evidence ? evidenceBody(x.evidence) : [];
    return el("li", {}, x.text, x.status && /[一-龥]/.test(x.status) ? ` （${x.status}）` : null, ev.length ? el("div", { class: "rev" }, ev) : null);
  }));
  const part = (title, xs, empty, help) => [el("h2", {}, title, xs ? `（${xs.length}）` : ""), help ? el("p", { class: "kicker" }, help) : null,
    xs && xs.length ? ritems(xs) : el("p", {}, empty)];
  const c = v.cross;
  return el("article", { class: "report" },
    el("p", { class: "kicker" }, "股票研究工作台 · 演示预览 · 研究记录"),
    el("h1", {}, v.case.title),
    el("p", { class: "synth" }, b.data_notice || "演示数据。"),
    el("h2", {}, "运行信息"),
    el("dl", { class: "kv" },
      el("dt", {}, "分析对象"), el("dd", {}, `${(v.subject && v.subject.name) || v.case.title}（代码 ${v.case.code}，${KIND_LONG[v.case.kind] || ""}）`),
      el("dt", {}, "数据截止日"), el("dd", {}, String(v.as_of)),
      el("dt", {}, "运行编号"), el("dd", { class: "mono" }, v.run_id),
      el("dt", {}, "开始 / 结束（UTC）"), el("dd", { class: "mono" }, `${v.started_at || "—"} / ${v.finished_at || "—"}`),
      el("dt", {}, "五个专家用时"), el("dd", {}, `${v.seconds} 秒（在浏览器里，Python ${v.python || "—"}）`),
      el("dt", {}, "网站版本"), el("dd", { class: "mono" }, siteLine(site)),
      el("dt", {}, "记录校验值"), el("dd", { class: "mono" }, `SHA-256 ${v.record_sha256}`),
      el("dt", {}, "案例校验值"), el("dd", { class: "mono" }, `SHA-256 ${v.case_sha256 || "—"}`)),
    el("h2", {}, "五个专家"),
    (v.experts || []).map((e) => el("div", { class: "rex" }, el("strong", {}, e.name), `：${noFinding(e) ? "已运行，没有有效发现" : e.status_zh} · ${e.tier}`, e.version ? [" · 版本 ", el("span", { class: "mono" }, e.version)] : null,
      e.plain && e.status !== "COMPLETED" ? el("p", {}, e.plain) : null,
      (e.reasons || []).length ? el("ul", { class: "plain" }, e.reasons.map((r) => el("li", {}, r.meaning || "", r.detail ? `：${r.detail}` : ""))) : null)),
    el("h2", {}, "先看这些"), (() => { const a = attention(v); return a.length ? el("ul", { class: "plain" }, a.map((x) => el("li", {}, `【${x.label}】${x.text}`))) : el("p", {}, "没有需要特别注意的事项。这不等于没有风险。"); })(),
    part("事实", b.facts, "没有可以列出的事实。", "从财报和申报里直接读出的内容。"),
    part("公告线索", b.leads, "没有公告线索。", "规则从 8-K 公告和 Form 4 申报原文抽取，未经人工核实。"),
    part("读数", b.readings, "没有读数。", "描述值，不判断好坏，不是买卖信号。"),
    part("需要核实", b.needs_check, "没有需要核实的条目。", "系统不能确定的内容，不当作确定事实。"),
    part("没有算的项目", b.gaps, "没有列出的缺口。", "缺的数据不按零或中性处理；没有算不等于没有风险。"),
    el("h2", {}, "专家之间的对照"),
    c ? [el("p", { class: "kicker" }, "综合层按固定规则做的对照：只列出和归类，不打分，不判断哪一方对。"),
      c.sections.map((s) => [el("h3", {}, `${s.title}：${s.count} 条`), s.count ? el("ul", { class: "plain" }, s.items.map((t) => el("li", {}, t))) : null,
        s.count > s.items.length ? el("p", { class: "kicker" }, `只列出前 ${s.items.length} 条（共 ${s.count} 条）；全部在同一运行编号的完整记录（JSON）里。`) : null]),   // Q13 re-review U-9
      c.not_compared.length ? [el("h3", {}, `没有比较的规则（${c.not_compared.length} 条；不能读作“没有矛盾”）`), el("ul", { class: "plain" }, c.not_compared.map((t) => el("li", {}, t)))] : null]
      : el("p", {}, "这条记录由旧版本保存，没有对照信息。"),
    el("h2", {}, "限制"), el("ul", { class: "plain" }, (b.limits || []).map((t) => el("li", {}, t))),
    c && c.not_included.length ? el("p", {}, "这份报告不包含：" + c.not_included.join("、") + "。") : null,
    el("p", { class: "kicker" }, `这份报告由演示网站在浏览器里生成；完整的技术记录是同一运行编号的 JSON 文件。生成时间 ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC。`));
}
const REPORT_CSS = `body{margin:0;background:#fff;color:#1b1e22;font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.report{max-width:820px;margin:0 auto;padding:28px 20px 48px}.report h1,.report h2{font-family:"Songti SC","Noto Serif SC",Georgia,serif}
.report h1{font-size:28px;margin:6px 0}.report h2{font-size:19px;margin:28px 0 8px;padding-top:10px;border-top:2px solid #1b1e22}.report h3{font-size:15px;margin:14px 0 4px}
.kicker{font-size:13px;color:#555;margin:0}.synth{background:#fbefd6;color:#7a4600;border-radius:8px;padding:8px 12px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:8px 0}.kv dt{color:#555}.kv dd{margin:0;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;overflow-wrap:anywhere}.ritems{padding-left:22px}.ritems>li{margin:0 0 12px;overflow-wrap:anywhere}
.rev{font-size:13px;background:#f3f1ec;border-radius:6px;padding:6px 10px;margin-top:4px}.quote{margin:6px 0 0;padding:4px 10px;border-left:3px solid #c9c2b4;color:#333}
.ql{display:block;font-size:12px;color:#555}.rex{border-bottom:1px solid #ddd;padding:6px 0}.plain{padding-left:20px}.plain li{overflow-wrap:anywhere}
@media print{.report{padding:0}.ritems>li,.rex{break-inside:avoid}}`;
function downloadReport(d) {
  const art = buildReport(d);
  const t = `研究记录 · ${d.view.case.title} · ${d.view.run_id}`.replace(/[<>&"]/g, "");
  const html = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title><style>${REPORT_CSS}</style></head><body>${art.outerHTML}</body></html>\n`;
  saveFile(new Blob([html], { type: "text/html;charset=utf-8" }), `${d.view.run_id}-report.html`);
}
function renderReport(d) {
  const box = $("view-report"); box.textContent = "";
  const id = encodeURIComponent(d.view.run_id);
  box.append(el("div", { class: "rep-bar" },
    el("button", { type: "button", class: "linkbtn", onclick: () => go("#run/" + id) }, "← 返回结果"), el("span", { class: "sp" }),
    el("button", { type: "button", class: "btn ghost btn-sm", onclick: () => window.print() }, "打印或存为 PDF"),
    el("button", { type: "button", class: "btn btn-sm", onclick: () => downloadReport(d) }, "下载报告（HTML）")), buildReport(d));
  document.title = `研究记录 · ${d.view.case.title} · ${d.view.run_id}`;
}

// ---------------------------------------------------------------- routing: "" (start), "#run/<id>", "#report/<id>"
async function route() {
  if (location.hash === "#main") return;                     // review M1: the skip link is not a route
  const gen = ++ROUTE_GEN;                                   // review MINOR 2: only the newest route may render
  const m = /^#(run|report)\/(.+)$/.exec(location.hash);
  if (!m) {
    const from = document.body.dataset.view;
    setView("start"); if (BUSY) setStep("run"); else if ($("step-error").hidden && $("step-confirm").hidden) setStep("choose");
    if (from !== "start") {                                  // Q13 re-review U-1: back from a result / report: focus the visible step heading, now that it is shown
      const s = ["choose", "confirm", "run", "error"].find((x) => !$("step-" + x).hidden);
      if (s) focusStep(s + "-title");
    }
    return;
  }
  let id; try { id = decodeURIComponent(m[2]); } catch { id = ""; }
  if (!RUN_ID_RX.test(id)) return showMessage("地址里的运行编号格式不对", "请从历史列表打开一条记录，或者开始新的分析。");   // review MINOR 15
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
      el("button", { type: "button", class: "btn danger", onclick: async () => { if (await delOne(id)) newAnalysis(); } }, "删除这条记录"));   // Q13 re-review U-2
    if (CURRENT && !CURRENT.fromHistory && CURRENT.save && !CURRENT.save.saved) { /* an unsaved fresh run is not silently replaced: it stays reachable by Back */ }
    d = CURRENT = { view: x.view, recordText: x.record_text, site: x.site || null, fromHistory: true, save: null, load: null };
  }
  if (m[1] === "run") { if (renderResultSafe(d)) { setView("result"); focusTo($("res-title")); } }
  else {
    try { renderReport(d); setView("report"); focusTo($("view-report").querySelector("h1")); }
    catch (e) { showMessage("这条记录无法显示", `它的格式和这个版本的页面对不上（${String(e && e.message || e).slice(0, 80)}）。`); }
  }
}

// ---------------------------------------------------------------- start
async function start() {
  $("hist-max").textContent = HIST_MAX;
  // review MINOR 17: history, routing and the controls do not depend on the manifest
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (RUN && RUN.timer) arm(RUN.timer.ms, RUN.timer.kind);       // review MINOR 16: a fresh budget after the tab was in the background
    if (!BUSY) renderHistory();                                    // another tab may have changed the history
  });
  document.querySelector(".skip").addEventListener("click", (e) => { e.preventDefault(); focusTo($("main")); });   // review M1
  // Q13 re-review U-5: a closed <details> is not rendered in print whatever its CSS, so the evidence of the shown result is opened for printing
  // and closed again afterwards (only the ones this opened)
  let printOpened = [];
  window.addEventListener("beforeprint", () => {
    printOpened = $("result-view").hidden ? [] : [...$("result-view").querySelectorAll("details:not([open])")];
    for (const d of printOpened) d.open = true;
  });
  window.addEventListener("afterprint", () => { for (const d of printOpened) d.open = false; printOpened = []; });
  $("search-form").addEventListener("submit", (e) => { e.preventDefault(); if (!MANIFEST) return; renderCases($("q").value); const ms = caseMatches($("q").value); if ($("q").value.trim() && ms.length === 1) choose(ms[0]); });
  $("q").addEventListener("input", (e) => { if (!MANIFEST || e.isComposing) return; renderCases($("q").value); });   // review MINOR 5: not during IME composition
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
    $("hist-msg").textContent = "";                                                          // Q13 re-review U-2
    let err = null;
    try { await tx("readwrite", (s) => s.clear()); } catch (e) { err = e; }
    HIST_BUSY = false;
    await renderHistory();
    if (err) { $("hist-msg").textContent = `清空失败：${storageWhy(err)}。`; focusTo($("hist-title"), "nearest"); return; }   // review MINOR 3: a failed clear marks nothing (Q13 re-review U-1: focus kept visible)
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
  $("ver").textContent = `版本 ${MANIFEST.version} · ${MANIFEST.built_at.slice(0, 10)} · ${MANIFEST.source_commit.slice(0, 7)}${dirty}`;
  $("foot").textContent = `构建 ${MANIFEST.built_at} · 源码提交 ${MANIFEST.source_commit.slice(0, 12)}${dirty} · Python ${MANIFEST.python}（Pyodide ${MANIFEST.pyodide}） · 分析程序 SHA-256 ${MANIFEST.bundle_sha256.slice(0, 16)}… · 第三方许可见 licenses/`;
  const nCo = MANIFEST.cases.filter((c) => c.kind === "COMPANY").length, nSc = MANIFEST.cases.length - nCo;
  $("scope-n").textContent = `只有 ${nCo} 家合成公司和 ${nSc} 个演示场景`;          // review MINOR 18: from the manifest, not hard-coded
  renderCases("");
  setStep("choose");
  await route();
}
start();
