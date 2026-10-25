// Q12 demo page: search -> confirm -> analyze (in a worker) -> result with evidence; history in this browser (IndexedDB) with an integrity hash.
const HIST_MAX = 20;
const STEP_TIMEOUT_MS = { load: 240000, run: 90000 };    // first load may download ~25 MB; an analysis itself takes seconds
const $ = (id) => document.getElementById(id);
let MANIFEST = null, CHOSEN = null, WORKER = null, TIMER = null, BUSY = false;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k === "onclick") e.onclick = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
function show(id) { for (const s of ["step-confirm", "step-run", "step-error", "step-result"]) $(s).classList.toggle("hidden", s !== id); }
async function sha256Text(t) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- history (IndexedDB)
function db() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open("stock-agent-demo", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("runs", { keyPath: "run_id" });
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((ok, bad) => { const t = d.transaction("runs", mode); const s = t.objectStore("runs"); const out = fn(s);
    t.oncomplete = () => ok(out && out.result !== undefined ? out.result : out); t.onerror = () => bad(t.error); });
}
async function histAll() { try { return (await tx("readonly", (s) => s.getAll())) || []; } catch { return []; } }
async function histSave(entry) {
  const all = (await histAll()).sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  await tx("readwrite", (s) => { s.put(entry); for (const old of all.slice(0, Math.max(0, all.length + 1 - HIST_MAX))) s.delete(old.run_id); });
}
async function histDelete(id) { await tx("readwrite", (s) => s.delete(id)); }
async function histClear() { await tx("readwrite", (s) => s.clear()); }

async function renderHistory() {
  const box = $("history"); box.textContent = "";
  const all = (await histAll()).sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  if (!all.length) { box.append(el("p", { class: "hint" }, "还没有记录。")); return; }
  for (const h of all) {
    box.append(el("div", { class: "item" },
      el("div", {}, el("div", {}, h.title), el("div", { class: "meta" }, `${h.saved_at.slice(0, 19).replace("T", " ")} · 运行编号 ${h.run_id}`)),
      el("div", { class: "row" },
        el("button", { onclick: () => openHistory(h.run_id) }, "打开"),
        el("button", { class: "secondary", onclick: async () => { await histDelete(h.run_id); renderHistory(); } }, "删除"))));
  }
}
async function openHistory(id) {
  const all = await histAll(); const h = all.find((x) => x.run_id === id);
  if (!h) return;
  const ok = (await sha256Text(h.payload)) === h.payload_sha256;
  let data = null;
  try { data = ok ? JSON.parse(h.payload) : null; } catch { data = null; }
  if (!data || (await sha256Text(data.record_text)) !== data.view.record_sha256) {
    show("step-error"); $("error-text").textContent = "这条历史记录的内容和保存时的校验值不一致（可能被改动或损坏），不显示。可以删除它。"; return;
  }
  renderResult(data.view, data.record_text, true);
}

// ---------------------------------------------------------------- search and confirm
function matches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return MANIFEST.cases.filter((c) => [c.title, c.code, c.case_id, c.note].some((s) => String(s).toLowerCase().includes(q)));
}
function renderMatches(q) {
  const box = $("matches"); box.textContent = "";
  if (q.length > 40) { box.append(el("p", { class: "hint" }, "输入太长（最多 40 个字符）。")); return; }
  const ms = matches(q);
  if (!q.trim()) return;
  if (!ms.length) { box.append(el("p", { class: "hint" }, "没有找到。这个演示只支持“支持范围”里列出的合成公司和场景，不支持任意股票。")); return; }
  for (const c of ms) box.append(el("div", { class: "item" },
    el("div", {}, el("div", {}, c.title, el("span", { class: "pill" }, c.kind === "COMPANY" ? "合成公司" : "演示场景")), el("div", { class: "meta" }, `代码 ${c.code} · ${c.note}`)),
    el("button", { onclick: () => choose(c) }, "选择")));
}
function choose(c) {
  CHOSEN = c; const b = $("confirm-box"); b.textContent = "";
  b.append(el("p", {}, el("strong", {}, c.title), el("span", { class: "pill" }, c.kind === "COMPANY" ? "合成公司" : "演示场景")),
    el("p", { class: "meta" }, `代码 ${c.code} · 数据截止日 ${MANIFEST.as_of[c.case_id] || ""} · ${c.note}`),
    el("p", { class: "hint" }, "全部是合成演示数据，不对应任何真实公司。"));
  show("step-confirm");
}

// ---------------------------------------------------------------- analysis
const STEPS = ["加载运行环境", "加载数据处理库", "载入分析程序并校验完整性", "五个专家运行中", "整理结果"];
function setStep(n, text) {
  const ol = $("progress"); ol.textContent = "";
  STEPS.forEach((s, i) => ol.append(el("li", { class: i + 1 < n ? "done" : i + 1 === n ? "now" : "" }, i + 1 === n && text ? text : s)));
}
function stopWorker() { if (WORKER) { WORKER.terminate(); WORKER = null; } if (TIMER) { clearTimeout(TIMER); TIMER = null; } BUSY = false; $("btn-analyze").disabled = false; }
function fail(text) { stopWorker(); show("step-error"); $("error-text").textContent = text; }
function arm(ms, text) { if (TIMER) clearTimeout(TIMER); TIMER = setTimeout(() => fail(text), ms); }

function analyze() {
  if (BUSY || !CHOSEN) return;                 // one analysis at a time in this page
  BUSY = true; $("btn-analyze").disabled = true;
  show("step-run"); setStep(1); $("run-hint").textContent = "分析在你的浏览器里运行；可以随时取消。";
  WORKER = new Worker("worker.js", { type: "module" });
  arm(STEP_TIMEOUT_MS.load, "运行环境加载超时（网络慢或浏览器内存不足）。可以稍后再试；已有的历史记录不受影响。");
  WORKER.onmessage = async (ev) => {
    const m = ev.data;
    if (m.type === "step") { setStep(m.n, m.text); if (m.n === 4) arm(STEP_TIMEOUT_MS.run, "分析超时，已停止。没有保存任何结果。"); return; }
    if (m.type === "error") {
      fail(m.kind === "INTEGRITY" ? "下载的分析程序和网站登记的校验值不一致，已停止，没有运行。请刷新页面后重试。"
         : m.kind === "NETWORK" ? "下载运行环境失败（网络问题）。请检查网络后重试。"
         : "分析过程出错，没有生成结果。可以重试一次；如果仍然出错，说明这个版本有缺陷。"); return;
    }
    if (m.type === "done") {
      stopWorker();
      let r; try { r = JSON.parse(m.out); } catch { return fail("结果格式不对，不显示。"); }
      if (!r.view || !r.view.ok) return fail((r.view && r.view.error) || r.error || "没有结果。");
      if ((await sha256Text(r.record_text)) !== r.view.record_sha256) return fail("结果和它自带的校验值不一致，不显示。");
      const payload = JSON.stringify({ view: r.view, record_text: r.record_text });
      await histSave({ run_id: r.view.run_id, case_id: r.view.case_id, title: r.view.case.title, saved_at: new Date().toISOString(),
                       payload, payload_sha256: await sha256Text(payload) });
      renderHistory(); renderResult(r.view, r.record_text, false);
    }
  };
  WORKER.onerror = () => fail("分析程序启动失败。请换用较新的浏览器（Chrome、Edge、Safari 新版本）。");
  WORKER.postMessage({ caseId: CHOSEN.case_id, bundle: MANIFEST.bundle, bundleSha256: MANIFEST.bundle_sha256 });
}

// ---------------------------------------------------------------- result
function evidence(ev) {
  if (!ev) return null;
  const rows = [];
  const add = (k, v) => { if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) rows.push(el("div", {}, `${k}：`, typeof v === "object" ? JSON.stringify(v) : String(v))); };
  add("证据类型", ev.kind); add("文件", ev.document || ev.source); add("表格", ev.form); add("章节", ev.section);
  add("数据日期（公开时间）", ev.available); add("财年", ev.fiscal_year); add("所用输入", ev.inputs); add("数据集", ev.dataset); add("指标", ev.metric);
  add("截止日", ev.as_of); add("读取的文件", ev.documents);
  if (ev.quote) rows.push(el("div", { class: "q" }, `原文：“${ev.quote}”`));
  if (ev.date_quote) rows.push(el("div", {}, `日期原文：“${ev.date_quote}”`));
  return el("details", { class: "ev" }, el("summary", {}, "证据与数据日期"), el("div", { class: "evbox" }, ...rows));
}
function section(title, items, empty) {
  const box = el("div", {}, el("h3", {}, title));
  if (!items || !items.length) { box.append(el("p", { class: "hint" }, empty)); return box; }
  for (const x of items) box.append(el("div", { class: "fact" }, x.kind ? el("div", { class: "k" }, x.kind) : null, el("div", {}, typeof x === "string" ? x : x.text),
    x.status && typeof x.status === "string" && /[一-龥]/.test(x.status) ? el("div", { class: "meta" }, x.status) : null, typeof x === "object" ? evidence(x.evidence) : null));
  return box;
}
function renderResult(v, recordText, fromHistory) {
  const b = v.beginner || {}; const box = $("result"); box.textContent = "";
  box.append(el("p", {}, el("strong", {}, v.case.title), el("span", { class: "pill" }, v.case.kind === "COMPANY" ? "合成公司" : "演示场景"), fromHistory ? el("span", { class: "pill" }, "来自历史") : null),
    el("p", { class: "meta" }, `代码 ${v.case.code} · 数据截止日 ${String(v.as_of).slice(0, 10)} · 运行编号 ${v.run_id} · 用时 ${v.seconds} 秒`),
    el("p", { class: "notice" }, b.data_notice || "演示数据。"));
  const t = el("table", { class: "experts" }, el("tr", {}, el("th", {}, "专家"), el("th", {}, "状态"), el("th", {}, "版本")));
  for (const e of v.experts) {
    const why = e.reasons && e.reasons.length ? el("details", { class: "ev" }, el("summary", {}, "原因"), el("div", { class: "evbox" }, ...e.reasons.map((r) => el("div", {}, r.meaning || "")))) : null;
    t.append(el("tr", {}, el("td", {}, e.name, el("div", { class: "meta" }, e.tier)), el("td", { class: e.status === "COMPLETED" ? "ok" : "bad" }, e.status_zh, why), el("td", { class: "meta" }, e.version)));
  }
  box.append(el("h3", {}, "五个专家"), t,
    section("事实（带证据）", b.facts, "没有可以列出的事实。"),
    section("读数（描述值，不判断好坏）", b.readings, "没有读数。"),
    section("需要核实", b.needs_check, "没有需要核实的条目。"),
    section("没有算的项目和原因", b.gaps, "没有缺口。"),
    section("限制", b.limits, ""));
  const dl = el("button", { class: "secondary", onclick: () => {
    const a = el("a", { href: URL.createObjectURL(new Blob([recordText], { type: "application/json" })), download: `${v.run_id}.json` }); a.click(); URL.revokeObjectURL(a.href); } }, "下载这次运行的完整记录（JSON）");
  box.append(el("div", { class: "row" }, dl, el("button", { class: "secondary", onclick: () => { CHOSEN = null; show(null); window.scrollTo(0, 0); } }, "再分析一家")),
    el("p", { class: "meta" }, `记录校验值 SHA-256 ${v.record_sha256.slice(0, 16)}…；页面、下载和历史都是这一次运行。`));
  show("step-result"); $("step-result").scrollIntoView({ behavior: "smooth" });
}

// ---------------------------------------------------------------- start
async function start() {
  $("hist-max").textContent = HIST_MAX;
  try { MANIFEST = await (await fetch("manifest.json", { cache: "no-cache" })).json(); }
  catch { $("ver").textContent = "版本信息读取失败"; return; }
  $("ver").textContent = `版本 ${MANIFEST.version} · ${MANIFEST.built_at.slice(0, 10)} · ${MANIFEST.source_commit.slice(0, 7)}`;
  $("foot").textContent = `构建 ${MANIFEST.built_at} · 源码提交 ${MANIFEST.source_commit.slice(0, 12)} · Python ${MANIFEST.python} (Pyodide ${MANIFEST.pyodide}) · 分析程序 SHA-256 ${MANIFEST.bundle_sha256.slice(0, 16)}…`;
  for (const c of MANIFEST.cases) $("supported").append(el("li", {}, `${c.title}（代码 ${c.code}）— ${c.note}`));
  $("search-form").onsubmit = (e) => { e.preventDefault(); renderMatches($("q").value); };
  $("q").oninput = () => renderMatches($("q").value);
  $("btn-analyze").onclick = analyze;
  $("btn-back").onclick = () => { CHOSEN = null; show(null); };
  $("btn-cancel").onclick = () => { stopWorker(); show("step-confirm"); };
  $("btn-error-back").onclick = () => show(CHOSEN ? "step-confirm" : null);
  $("btn-clear").onclick = async () => { await histClear(); renderHistory(); };
  renderHistory();
}
start();
