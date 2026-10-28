// Q15 shared renderer: one analysis (decision Q15_DECISION_V2 + its views {simple, pro, charts, consistency}) -> the result page, the full
// report and the entitlement area. Used by the demo page (site/app.js) and by the local real-trial page (local_site_q15/real/real.js; a byte
// copy made by tools/q15_make_local_site.py). Nothing here computes a conclusion: every label, reason and number comes from the decision and
// the views of ONE run; the renderer only arranges them. Status is never shown by colour alone (each status has an icon shape and a word).
// Charts are inline SVG drawn from the run's own data, each with a caption and a text alternative; no library, no network.

export const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";

export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  setAttrs(e, attrs);
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== "") e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  setAttrs(e, attrs);
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== "") e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
function setAttrs(e, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.setAttribute("class", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
}
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const uniq = (xs) => [...new Set((xs || []).filter((x) => x != null && x !== ""))];
const str = (x) => (x == null ? "" : String(x));
export const day = (x) => str(x).slice(0, 10);
export function localTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return str(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmt(x, nd = 2) { if (!isNum(x)) return "—"; const r = Math.round(x * 10 ** nd) / 10 ** nd; return (Object.is(r, -0) ? 0 : r).toLocaleString("en-US", { maximumFractionDigits: nd }); }
const pct = (x, nd = 1) => (isNum(x) ? `${fmt(x * 100, nd)}%` : "—");
function money(x) {
  if (!isNum(x)) return "—";
  const a = Math.abs(x);
  return a >= 1e8 ? `${fmt(x / 1e8, 2)} 亿` : a >= 1e4 ? `${fmt(x / 1e4, 0)} 万` : fmt(x, 0);
}
function txt(x) {                                            // an object from the decision shown as one line (known keys first; never JSON in the main text)
  if (x == null) return "";
  if (typeof x !== "object") return String(x);
  if (Array.isArray(x)) return x.map(txt).join("；");
  const keys = ["document_id", "item", "meaning", "date", "person", "role", "action", "claim", "text", "why", "note", "status"];
  const parts = keys.filter((k) => x[k] != null && x[k] !== "").map((k) => (k === "claim" || k === "text" || k === "meaning" || k === "why" || k === "note") ? str(x[k]) : `${str(x[k])}`);
  return parts.length ? parts.join(" · ") : JSON.stringify(x);
}

// ---------------------------------------------------------------- vocabulary (labels come from the decision; these are only icons and words around them)
const OPS_ICON = { "改善": "↗", "稳定": "→", "分化": "⇅", "恶化": "↘", "无法判断": "？" };
const IJ_ICON = { "偏积极": "＋", "中性": "＝", "偏谨慎": "－", "无法判断": "？" };
const OPS_BASIS = { "完整": ["b-full", "✓", "依据完整"], "部分": ["b-part", "◐", "依据部分"], "边缘": ["b-part", "◌", "依据边缘"] };
const IJ_BASIS = { "充分": ["b-full", "✓", "依据充分"], "有限": ["b-part", "◐", "依据有限"], "不足": ["b-none", "○", "依据不足"] };
const KIND = { "事实": ["k-fact", "●"], "规则": ["k-rule", "◆"], "假设": ["k-assume", "▲"], "未知": ["k-unk", "?"] };
const KIND_HELP = { "事实": "从数据里读出的内容", "规则": "系统按公开规则怎样判断", "假设": "声明的或产品设定的假设，没有经过验证", "未知": "缺失、没查完或需要核实的" };
const DIM_ZH = { operations: "经营", trend: "价格趋势", environment: "市场环境", valuation: "估值", events: "公告事件" };
const STRENGTH_ZH = { core: "核心", soft: "较弱", risk: "风险", conditional: "条件性（基于声明的假设）", context: "背景" };
const RISK_ICON = { TRIGGERED: ["rs-t", "!"], NOT_TRIGGERED: ["rs-n", "✓"], UNKNOWN: ["rs-u", "?"], NOT_APPLICABLE: ["rs-a", "—"] };
const EXPERT_ZH = { technical: "技术面", macro: "宏观", fundamental: "基本面", valuation: "估值", information: "公告" };

export function kindBadge(k) {
  const [c, i] = KIND[k] || ["k-unk", "?"];
  return el("span", { class: "kind " + c, title: KIND_HELP[k] || "" }, el("span", { class: "ki", "aria-hidden": "true" }, i), k);
}
function basisPill(map, b, emptyText) {
  const [c, i, t] = map[b] || ["b-none", "○", emptyText];
  return el("span", { class: "basis " + c }, el("span", { class: "bi", "aria-hidden": "true" }, i), t);
}

// ---------------------------------------------------------------- the model: one run, whatever page shows it
// fields: ctx ("demo" | "real"), title, code, industry, as_of, data_kind, data_label, run_id, record_sha256, fingerprint, decision, views,
//         experts (list), meta {seconds, started_at, finished_at, python, price_source, decision_inputs, site, case_kind}
export function modelProblems(m) {
  const out = [];
  if (!m || !m.decision || !m.views || !m.views.simple || !m.views.pro) out.push("缺少判断或视图");
  else {
    const fp = m.decision.core_fingerprint;
    if (m.views.simple.same_run.decision_fingerprint !== fp || m.views.pro.same_run.decision_fingerprint !== fp) out.push("视图和判断的指纹不一致");
    const rid = m.record_run_id || m.run_id;                   // the real trial wraps the orchestrator's record (Q12R-...) in its own run (Q15X-...)
    if (rid && m.views.simple.same_run.run_id && (m.views.simple.same_run.run_id !== rid || m.views.pro.same_run.run_id !== rid)) out.push("视图属于另一次运行");
  }
  return out;
}

// ---------------------------------------------------------------- charts (inline SVG; each returns a <figure> or null)
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function svgBox(w, h, label) {
  return sv("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label, preserveAspectRatio: "xMidYMid meet", focusable: "false" });
}
function dataTable(head, rows) {
  return el("details", {}, el("summary", {}, "查看数据表"),
    el("div", { class: "tbl-wrap" }, el("table", { class: "t" }, el("thead", {}, el("tr", {}, head.map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c, i) => el("td", { class: i ? "n" : "" }, c))))))));
}

export function figFinancial(fin) {
  const rows = (Array.isArray(fin) ? fin : []).filter((r) => r && r.fiscal_year != null);
  if (!rows.length) return null;
  const W = 640, H = 250, L = 60, R = 56, T = 28, B = 46, iw = W - L - R, ih = H - T - B;
  const revs = rows.map((r) => r.revenue).filter(isNum), mars = rows.map((r) => r.operating_margin).filter(isNum);
  const yMax = niceMax(Math.max(0, ...revs) * 1.12);
  const mLo = Math.min(0, ...mars), mHi = Math.max(0.01, ...mars);
  const mMax = niceMax(mHi * 1.25), mMin = mLo < 0 ? -niceMax(-mLo * 1.25) : 0;
  const yR = (v) => T + ih - (v / yMax) * ih, yM = (v) => T + ih - ((v - mMin) / (mMax - mMin)) * ih;
  const band = iw / rows.length, bw = Math.min(58, band * 0.5);
  const first = rows[0], last = rows[rows.length - 1];
  const alt = `财务趋势：收入从 FY${first.fiscal_year} 的 ${money(first.revenue)} 美元到 FY${last.fiscal_year} 的 ${money(last.revenue)} 美元；营业利润率从 ${pct(first.operating_margin)} 到 ${pct(last.operating_margin)}。`;
  const s = svgBox(W, H, alt);
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i, y = yR(v);
    s.append(sv("line", { class: "ch-grid", x1: L, x2: W - R, y1: y, y2: y }), sv("text", { class: "ch-axis", x: L - 8, y: y + 4, "text-anchor": "end" }, money(v)));
  }
  for (let i = 0; i <= 2; i++) {
    const v = mMin + ((mMax - mMin) / 2) * i;
    s.append(sv("text", { class: "ch-axis", x: W - R + 8, y: yM(v) + 4 }, pct(v, 0)));
  }
  if (mMin < 0) s.append(sv("line", { class: "ch-ref", x1: L, x2: W - R, y1: yM(0), y2: yM(0) }));
  s.append(sv("text", { class: "ch-axis", x: L - 8, y: T - 12, "text-anchor": "end" }, "收入（美元）"), sv("text", { class: "ch-axis", x: W - R + 8, y: T - 12 }, "利润率"));
  const pts = [];
  rows.forEach((r, i) => {
    const cx = L + band * i + band / 2;
    if (isNum(r.revenue)) s.append(sv("rect", { class: "ch-bar", x: cx - bw / 2, y: yR(r.revenue), width: bw, height: Math.max(0, T + ih - yR(r.revenue)), rx: 3 }));
    else s.append(sv("text", { class: "ch-axis", x: cx, y: T + ih - 6, "text-anchor": "middle" }, "收入缺"));
    s.append(sv("text", { class: "ch-axis", x: cx, y: H - B + 18, "text-anchor": "middle" }, `FY${r.fiscal_year}`),
      sv("text", { class: "ch-val", x: cx, y: H - B + 34, "text-anchor": "middle" }, isNum(r.revenue) ? money(r.revenue) : "—"));
    if (isNum(r.operating_margin)) pts.push([cx, yM(r.operating_margin), r.operating_margin]);
  });
  if (pts.length > 1) s.append(sv("polyline", { class: "ch-line", points: pts.map((p) => `${p[0]},${p[1]}`).join(" ") }));
  for (const [x, y, v] of pts) s.append(sv("circle", { class: "ch-dot", cx: x, cy: y, r: 4.5 }), sv("text", { class: "ch-val", x: x + 8, y: y - 8 }, pct(v)));
  return el("figure", { class: "fig" },
    el("figcaption", {}, el("b", {}, "收入与营业利润率"), el("span", {}, "按财年（年报口径）")), s,
    el("ul", { class: "legend" }, el("li", {}, el("span", { class: "sw", "aria-hidden": "true" }), "收入（柱，左轴，美元）"),
      el("li", {}, el("span", { class: "sw sw-line", "aria-hidden": "true" }), "营业利润率（线，右轴）")),
    el("p", { class: "fig-alt" }, alt),
    dataTable(["财年", "收入（美元）", "营业利润率", "净利润（美元）", "经营现金流（美元）"],
      rows.map((r) => [`FY${r.fiscal_year}`, money(r.revenue), pct(r.operating_margin), money(r.net_income), money(r.operating_cash_flow)])));
}

export function figPrice(ps, src, ctx) {
  const pts = (Array.isArray(ps) ? ps : []).filter((p) => p && isNum(p.close) && p.date);
  const synthetic = ctx !== "real";
  if (!pts.length) {
    const why = ps && !Array.isArray(ps) && ps.withheld ? `${ps.withheld}（原有 ${ps.points ?? "?"} 个点）` : (src && src.problem) ? src.problem : "";
    return el("figure", { class: "fig" }, el("figcaption", {}, el("b", {}, "价格走势")),
      el("p", { class: "fig-alt" }, why ? `没有显示价格走势：${why}。` : "这次运行没有可显示的价格序列。"));
  }
  const W = 640, H = 210, L = 54, R = 70, T = 22, B = 30, iw = W - L - R, ih = H - T - B;
  const cl = pts.map((p) => p.close), lo = Math.min(...cl), hi = Math.max(...cl), pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const X = (i) => L + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw), Y = (v) => T + ih - ((v - y0) / (y1 - y0)) * ih;
  const f = pts[0], z = pts[pts.length - 1];
  const kindWord = synthetic ? "合成数据" : "真实数据（内部测试）";
  const alt = `价格走势（${kindWord}，每周收盘）：从 ${f.date} 的 ${fmt(f.close)} 到 ${z.date} 的 ${fmt(z.close)}；期间最高 ${fmt(hi)}，最低 ${fmt(lo)}。只显示过去的走势，不是预测。`;
  const s = svgBox(W, H, alt);
  for (const v of [lo, (lo + hi) / 2, hi]) s.append(sv("line", { class: "ch-grid", x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), sv("text", { class: "ch-axis", x: L - 8, y: Y(v) + 4, "text-anchor": "end" }, fmt(v)));
  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.close).toFixed(1)}`).join(" ");
  s.append(sv("polygon", { class: "ch-area", points: `${X(0)},${T + ih} ${line} ${X(pts.length - 1)},${T + ih}` }), sv("polyline", { class: "ch-price", points: line }),
    sv("circle", { class: "ch-end", cx: X(pts.length - 1), cy: Y(z.close), r: 4 }), sv("text", { class: "ch-val", x: X(pts.length - 1) + 8, y: Y(z.close) + 4 }, fmt(z.close)),
    sv("text", { class: "ch-axis", x: L, y: H - 8 }, f.date), sv("text", { class: "ch-axis", x: W - R, y: H - 8, "text-anchor": "end" }, z.date));
  if (synthetic) s.append(sv("text", { class: "ch-syn", x: W - R, y: T - 6, "text-anchor": "end" }, "合成数据 · 非真实行情"));
  return el("figure", { class: "fig" },
    el("figcaption", {}, el("b", {}, "价格走势"), el("span", {}, `每周收盘 · ${kindWord} · 截至 ${z.date}`)), s,
    el("p", { class: "fig-alt" }, alt + (src && src.note ? ` ${src.note}` : "")),
    dataTable(["日期", "收盘"], pts.map((p) => [p.date, fmt(p.close)])));
}

const EV_SHAPE = { "重大线索（待核实）": "mat", "人事线索（待核实）": "unc" };
export function figTimeline(events, asOf) {
  const evs = (Array.isArray(events) ? events : []).filter((e) => e && (e.text || e.kind));
  if (!evs.length) return null;
  const dated = evs.map((e, i) => ({ ...e, n: i + 1, t: e.date ? Date.parse(String(e.date).slice(0, 10)) : NaN }));
  const ok = dated.filter((e) => !isNaN(e.t));
  const ao = Date.parse(day(asOf));
  const list = el("ol", { class: "ev-list" }, dated.map((e) => el("li", {}, el("span", { class: "ev-kind" }, e.kind || "事件"),
    el("span", { class: "num" }, e.date ? day(e.date) : "日期未标出"), "：", e.text || "")));
  let s = null;
  if (ok.length) {
    const W = 640, H = 84, L = 20, R = 20, y = 50;
    const t0 = Math.min(...ok.map((e) => e.t)) - 7 * 864e5, t1 = Math.max(isNaN(ao) ? 0 : ao, ...ok.map((e) => e.t)) + 2 * 864e5;
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    s = svgBox(W, H, `公告事件时间线：${ok.length} 个有日期的事件，${dated.length - ok.length} 个没有标出日期；每个事件的内容见下方列表。`);
    s.append(sv("line", { class: "ch-tl", x1: L, x2: W - R, y1: y, y2: y }));
    if (!isNaN(ao)) s.append(sv("line", { class: "ch-ref", x1: X(ao), x2: X(ao), y1: 16, y2: y + 14 }), sv("text", { class: "ch-axis", x: X(ao), y: 12, "text-anchor": "end" }, `截止 ${day(asOf)}`));
    ok.forEach((e, k) => {
      const x = X(e.t), shp = EV_SHAPE[e.kind] || "oth", yy = y - (k % 2) * 0;
      if (shp === "mat") s.append(sv("rect", { class: "ch-ev-mat", x: x - 6, y: yy - 6, width: 12, height: 12, transform: `rotate(45 ${x} ${yy})` }));
      else if (shp === "unc") s.append(sv("polygon", { class: "ch-ev-unc", points: `${x},${yy - 8} ${x + 7},${yy + 6} ${x - 7},${yy + 6}` }));
      else s.append(sv("circle", { class: "ch-ev-oth", cx: x, cy: yy, r: 6 }));
      s.append(sv("text", { class: "ch-val", x, y: yy + 24 + (k % 2) * 12, "text-anchor": "middle" }, String(e.n)));
    });
    s.append(sv("text", { class: "ch-axis", x: L, y: H - 2 }, new Date(t0).toISOString().slice(0, 10)));
  }
  return el("figure", { class: "fig" },
    el("figcaption", {}, el("b", {}, "公告事件时间线"), el("span", {}, "规则从公告原文抽取的线索，未经核实；编号对应下面的列表")),
    s, s ? el("ul", { class: "legend" }, el("li", {}, "◆ 重大线索（待核实）"), el("li", {}, "▲ 人事线索（待核实）"), el("li", {}, "○ 已抽取的事件")) : null, list);
}

export function figValuation(v) {
  if (!v) return null;
  const cmp = (v.comparison || []).filter((c) => isNum(c.observed) && isNum(c.low) && isNum(c.high));
  const cond = (v.conditional || []).filter((c) => isNum(c.low) && isNum(c.high));
  if (!cmp.length && !cond.length) return null;
  const W = 640, L = 16, R = 16, iw = W - L - R, out = [];
  const isY = (n) => /FCF/.test(n || "");
  const fv = (n, x) => (isY(n) ? pct(x) : fmt(x, 1));
  if (cmp.length) {
    const rowH = 64, H = cmp.length * rowH + 6;
    const alt = cmp.map((c) => `${c.name} 观察值 ${fv(c.name, c.observed)}，比较区间 ${fv(c.name, c.low)}–${fv(c.name, c.high)}（${c.synthetic ? "合成" : "非合成"}），${c.relative || ""}`).join("；");
    const s = svgBox(W, H, "估值比较：" + alt);
    cmp.forEach((c, i) => {
      const y = i * rowH + 34, lo = Math.min(c.low, c.observed), hi = Math.max(c.high, c.observed), pad = (hi - lo) * 0.12 || 1;
      const X = (x) => L + ((x - (lo - pad)) / (hi - lo + 2 * pad)) * iw;
      s.append(sv("text", { class: "ch-val", x: L, y: y - 18 }, `${c.name} · ${({ PEER_SET: "同行", OWN_HISTORY: "自身历史", INDUSTRY: "行业" })[c.basis_type] || "比较"}区间${c.synthetic ? "（合成）" : ""} · ${c.relative || ""}`),
        sv("rect", { class: "ch-range", x: X(c.low), y: y - 7, width: Math.max(2, X(c.high) - X(c.low)), height: 14, rx: 4 }),
        sv("text", { class: "ch-axis", x: X(c.low), y: y + 22, "text-anchor": "middle" }, fv(c.name, c.low)),
        sv("text", { class: "ch-axis", x: X(c.high), y: y + 22, "text-anchor": "middle" }, fv(c.name, c.high)),
        sv("rect", { class: "ch-obs", x: X(c.observed) - 6, y: y - 6, width: 12, height: 12, transform: `rotate(45 ${X(c.observed)} ${y})` }),
        sv("text", { class: "ch-val", x: X(c.observed), y: y - 10 + 0, "text-anchor": X(c.observed) > W - 80 ? "end" : "middle", dx: X(c.observed) > W - 80 ? -10 : 0 }, `现在 ${fv(c.name, c.observed)}`));
    });
    out.push(el("p", { class: "vrow-title" }, el("b", {}, "倍数和比较区间"), "（每行刻度不同）"), s, el("p", { class: "fig-alt" }, alt + "。"));
  }
  if (cond.length) {
    const price = isNum(v.price) ? v.price : null;
    const lo = Math.min(...cond.map((c) => c.low), price ?? Infinity), hi = Math.max(...cond.map((c) => c.high), price ?? -Infinity), pad = (hi - lo) * 0.08 || 1;
    const X = (x) => L + ((x - (lo - pad)) / (hi - lo + 2 * pad)) * iw;
    const rowH = 50, H = cond.length * rowH + 30;
    const alt = cond.map((c) => `${c.name} 假设下的每股价值区间 ${fmt(c.low)}–${fmt(c.high)}`).join("；") + (price != null ? `；现价 ${fmt(price)}（${v.price_date || "日期未知"}）` : "");
    const s = svgBox(W, H, "条件性估值（基于声明的假设）：" + alt);
    cond.forEach((c, i) => {
      const y = i * rowH + 34;
      s.append(sv("text", { class: "ch-val", x: L, y: y - 14 }, `${c.name}（声明的假设）`),
        sv("rect", { class: "ch-range", x: X(c.low), y: y - 7, width: Math.max(2, X(c.high) - X(c.low)), height: 14, rx: 4 }),
        sv("text", { class: "ch-axis", x: X(c.low), y: y + 20, "text-anchor": "middle" }, fmt(c.low)), sv("text", { class: "ch-axis", x: X(c.high), y: y + 20, "text-anchor": "middle" }, fmt(c.high)));
    });
    if (price != null) s.append(sv("line", { class: "ch-ref", x1: X(price), x2: X(price), y1: 12, y2: H - 4 }),
      sv("text", { class: "ch-val", x: X(price), y: 10, "text-anchor": X(price) > W - 120 ? "end" : "start", dx: X(price) > W - 120 ? -4 : 4 }, `现价 ${fmt(price)}`));
    out.push(el("p", { class: "vrow-title" }, el("b", {}, "条件性分析：每股价值区间和现价"), "（只在你声明的假设下成立，不是比较依据）"), s, el("p", { class: "fig-alt" }, alt + "。"));
  }
  return el("figure", { class: "fig" }, el("figcaption", {}, el("b", {}, "估值情景"), el("span", {}, v.note || "")), out,
    el("ul", { class: "legend" }, el("li", {}, el("span", { class: "sw sw-range", "aria-hidden": "true" }), "区间"), el("li", {}, el("span", { class: "sw sw-dia", "aria-hidden": "true" }), "现在的倍数"),
      el("li", {}, "┆ 现价")));
}

// ---------------------------------------------------------------- shared result parts
function sideList(items, max, emptyNode, moreText) {
  if (!items.length) return emptyNode;
  return [el("ul", {}, items.slice(0, max).map((t) => el("li", {}, t))), items.length > max ? el("p", { class: "more-n" }, `另有 ${items.length - max} 条，${moreText}`) : null];
}
export function summaryBlock(m) {
  const d = m.decision, oe = d.operations_evaluation, ij = d.investment_judgement, ch = d.checks || {};
  const s = m.views.simple, pro = m.views.pro;
  const missing = ij.missing || [];
  const layers = el("div", { class: "summary" },
    el("section", { class: "layer ops", "aria-labelledby": "lay-ops" },
      el("div", { class: "layer-cap" }, el("h2", { id: "lay-ops" }, "经营评价"), el("span", {}, "只看公司已报告的经营情况")),
      el("div", { class: "layer-label" }, el("span", { class: "layer-ico", "aria-hidden": "true" }, OPS_ICON[oe.label] || "？"), el("strong", { "data-concl": "ops" }, oe.label),
        basisPill(OPS_BASIS, oe.basis, "没有依据")),
      el("p", { class: "layer-why" }, oe.why || ""),
      el("p", { class: "layer-not" }, oe.label === "改善" || oe.label === "稳定" ? "经营好，不等于现在的价格值得买：价格要看投资研究判断。" : "这一层只看经营，不包含价格和估值。")),
    el("section", { class: "layer inv", "aria-labelledby": "lay-inv" },
      el("div", { class: "layer-cap" }, el("h2", { id: "lay-inv" }, "投资研究判断"), el("span", {}, "经营 + 价格 + 估值比较 + 风险 + 公告")),
      el("div", { class: "layer-label" }, el("span", { class: "layer-ico", "aria-hidden": "true" }, IJ_ICON[ij.label] || "？"), el("strong", { "data-concl": "inv" }, ij.label),
        basisPill(IJ_BASIS, ij.basis, "依据不足")),
      el("p", { class: "layer-why" }, ij.why || ""),
      missing.length ? el("div", { class: "missing" }, el("b", {}, ij.label === "无法判断" ? "为什么还不能判断：" : "依据还缺："), el("ul", {}, missing.map((t) => el("li", {}, t)))) : null,
      el("p", { class: "layer-not" }, "研究倾向，不是买入、持有或卖出建议；", (d.horizon && d.horizon.label) || "约 6–12 个月的观察角度", "不是预测期限。")));
  const tile = (name, state, word, more) => el("li", { class: "chk st-" + state },
    el("span", { class: "chk-ico", "aria-hidden": "true" }, { ok: "✓", part: "◐", no: "✕" }[state]), el("span", { class: "chk-name" }, name),
    el("span", { class: "chk-state" }, el("b", {}, word)), more ? el("span", { class: "chk-more" }, more) : null);
  const pr = ch.price || {}, vc = ch.valuation_comparison || {}, rk = ch.risk_checks || {}, ev = ch.events || {};
  const checks = el("ul", { class: "checks", "aria-label": "四项检查" },
    tile("价格", pr.status === "可用" ? "ok" : "no", pr.status === "可用" ? "可用" : "不可用", (pr.why || [])[0] || (pr.status === "可用" ? "最近的价格能用于判断" : "")),
    tile("估值比较", vc.status === "有" ? "ok" : "no", vc.status === "有" ? `有比较依据 · ${vc.judgment || ""}` : "没有比较依据",
      vc.status === "有" ? (vc.robust ? "比较稳健" : "比较不稳健") : (vc.level ? `现有：${vc.level}` : "")),
    tile("硬性风险检查", rk.status === "完成" ? "ok" : "no", rk.status === "完成" ? "已完成" : "未完成", rk.statement || ""),
    tile("公告检查", ev.status === "完成" ? "ok" : ev.status === "部分" ? "part" : "no", ev.status === "完成" ? "已完成" : ev.status === "部分" ? "只检查了一部分" : "未检查",
      ev.status === "完成" ? "只解读管理层变动和内部人交易" : (ev.why || [])[0] || ""));
  const sup = uniq(((pro.evidence || {}).supporting || []).map((r) => r.text));
  const wor0 = uniq([...(s.key_risks || []), ...(s.key_counter_evidence || []), ...(pro.conflicts || [])]);
  const wor = uniq([...wor0, ...((pro.risk_checks || []).filter((r) => r.status === "TRIGGERED" && !wor0.some((t) => t.includes(r.name))).map((r) => `硬性风险触发：${r.name}`))]);
  const unk = uniq([...(s.unknowns || []), ...(rk.status !== "完成" ? [rk.statement] : []), ...(ev.status !== "完成" ? [`公告${ev.status === "部分" ? "只检查了一部分" : "没有检查"}：没检查到的不等于没有重大事件`] : [])]);
  const sides = el("div", { class: "sides" },
    el("section", { class: "side side-sup", "aria-labelledby": "side-sup" }, el("h2", { id: "side-sup" }, el("span", { class: "si", "aria-hidden": "true" }, "✓"), `支持的理由（${sup.length}）`),
      sideList(sup, 4, el("p", { class: "none" }, "没有支持的理由。"), "见专业版“证据”")),
    el("section", { class: "side side-wor", "aria-labelledby": "side-wor", "data-free": "worries" }, el("h2", { id: "side-wor" }, el("span", { class: "si", "aria-hidden": "true" }, "!"), `主要担忧与反面证据（${wor.length}）`),
      sideList(wor, 99, el("p", { class: "none" }, `没有列出反面理由。${rk.statement || ""}；这不等于没有风险。`), "见专业版“证据”")),
    el("section", { class: "side side-unk", "aria-labelledby": "side-unk", "data-free": "unknowns" }, el("h2", { id: "side-unk" }, el("span", { class: "si", "aria-hidden": "true" }, "?"), `还不知道的（${unk.length}）`),
      sideList(unk, 99, el("p", { class: "none" }, `没有列出缺项。检查范围仍有限：${ev.scope || "公告只解读两类内容"}。`), "见专业版")));
  const notIncl = uniq([...(pro.not_included || []), ...(pro.unanswerable || [])]);
  const limit = el("p", { class: "limit-line" }, `${m.data_label} · 实验原型，未经金融验证；判断层的验收结论是“只能支持部分判断”，很多情况会给出“无法判断” · 不是买卖建议。`,
    el("details", {}, el("summary", {}, "这份结果不包含什么"), el("ul", {}, notIncl.map((t) => el("li", {}, t)))));
  const refused = oe.label === "无法判断" && ij.label === "无法判断";
  const banner = refused ? el("div", { class: "alert warn refuse-banner", role: "note" }, el("strong", {}, "这次两层结论都是“无法判断”：系统没有猜"),
    `原因：${missing[0] || ij.why || "缺少必要的资料"}。缺的资料不会按零、中性或安全处理；下面列出缺了什么，以及怎样才能判断。`) : null;
  return [banner, layers, checks, limit, sides];
}

function expertsBlock(m, pro) {
  const xs = m.experts || [];
  if (!xs.length) return null;
  return el("section", { class: "sec", id: "sec-experts", "aria-labelledby": "sec-experts-h" },
    el("h2", { id: "sec-experts-h" }, "五个专家", el("span", { class: "n" }, `${xs.filter((e) => e.status === "COMPLETED").length} / ${xs.length} 已运行`)),
    el("p", { class: "sec-help" }, "“已运行”只表示跑完了，不代表有有效发现；没有结果的专家会让对应维度写“无法判断”。"),
    el("ul", { class: "experts" }, xs.map((e) => {
      const ok = e.ok != null ? e.ok : e.status === "COMPLETED";
      const why = uniq((e.reasons || []).map((r) => r.meaning));
      return el("li", { class: "ex " + (ok ? "ok" : "bad") }, el("span", { class: "ex-name" }, e.name || EXPERT_ZH[e.expert] || e.expert), e.scope ? el("span", { class: "ex-scope" }, e.scope) : null,
        el("span", { class: "ex-st" }, el("span", { class: "mk", "aria-hidden": "true" }, ok ? "✓" : e.ok === false && e.status === "COMPLETED" ? "○" : "✕"), e.status_zh || e.status),
        e.detail ? el("p", { class: "ex-plain" }, e.detail) : !ok && (e.plain || why.length) ? el("p", { class: "ex-plain" }, e.plain || why.join("；")) : null,
        pro ? el("details", {}, el("summary", {}, "版本与原因"), el("p", { class: "mono" }, e.version || "—"), e.tier ? el("p", {}, e.tier) : null,
          (e.reasons || []).length ? el("ul", { class: "plain" }, e.reasons.map((r) => el("li", {}, r.meaning || "", r.detail ? `：${r.detail}` : ""))) : null) : null);
    })));
}

// ---------------------------------------------------------------- simple version
function termsBlock(q, glossary) {
  const g = new Map((glossary || []).map((x) => [x.term, x]));
  const ts = (q.terms || []).filter((t) => g.has(t));
  if (!ts.length) return null;
  return el("div", { class: "terms" }, el("span", { class: "terms-cap" }, "术语："), ts.map((t) => {
    const x = g.get(t);
    return el("details", { class: "term" }, el("summary", {}, t), el("div", { class: "term-body" }, el("p", {}, x.plain), el("p", {}, el("b", {}, "为什么重要："), x.why)));
  }));
}
function simpleBody(m) {
  const s = m.views.simple, c = m.views.charts || {};
  const figs = {
    ops: [figFinancial(c.financial_trend)],
    price: [figValuation(c.valuation), figPrice(c.price, m.meta && m.meta.price_source, m.ctx)],
    worry: [figTimeline(c.events_timeline, m.as_of)],
    watch: [],
  };
  return [
    el("h2", { class: "mode-h" }, "四个问题", el("span", { class: "n" }, "简单版 · 日常语言，术语可展开")),
    el("ul", { class: "kinds-legend", "aria-label": "要点类型" }, Object.keys(KIND).map((k) => el("li", {}, kindBadge(k), KIND_HELP[k]))),
    el("div", { class: "qs" }, (s.questions || []).map((q, i) => el("section", { class: "q", id: "q-" + q.id, "aria-labelledby": "q-" + q.id + "-h" },
      el("div", { class: "q-head" }, el("span", { class: "q-n" }, `问题 ${i + 1}`), el("h3", { id: "q-" + q.id + "-h" }, q.q)),
      el("p", { class: "q-answer" }, q.answer),
      el("p", { class: "q-why" }, el("b", {}, "为什么重要"), q.why_it_matters),
      el("ul", { class: "pts" }, (q.points || []).map((p) => el("li", { class: "pt" }, kindBadge(p.kind), el("span", {}, p.text)))),
      termsBlock(q, s.glossary),
      (figs[q.id] || []).filter(Boolean).map((f) => el("div", { class: "q-fig" }, f))))),
    el("p", { class: "mode-note" }, "指标的期间、单位和来源，完整的证据、规则和阈值，在“专业版”里。两个版本是同一次运行、同一份判断。"),
  ];
}

// ---------------------------------------------------------------- professional version
function sec(id, title, help, ...body) {
  return el("section", { class: "sec", id, "aria-labelledby": id + "-h" }, el("h2", { id: id + "-h", tabindex: "-1" }, title), help ? el("p", { class: "sec-help" }, help) : null, body);
}
function table(head, rows, cls) {
  return el("div", { class: "tbl-wrap" }, el("table", { class: "t " + (cls || "") }, el("thead", {}, el("tr", {}, head.map((h) => el("th", { scope: "col" }, h)))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => (c && c.td ? el("td", c.td, c.v) : el("td", {}, c))))))));
}
const srcTd = (x) => ({ td: { class: "src" }, v: x || "—" });
const numTd = (x) => ({ td: { class: "n" }, v: x });
function srcLine(x) { return `${EXPERT_ZH[x.expert] || x.expert} · ${x.path}${x.value != null && typeof x.value !== "object" ? ` = ${typeof x.value === "number" ? fmt(x.value, 4) : x.value}` : ""}`; }
function evidenceList(xs, cls) {
  if (!xs.length) return el("p", { class: "sec-help" }, "没有。");
  return el("ol", { class: "evl" }, xs.map((r) => el("li", { class: "evi " + cls },
    el("p", {}, r.text),
    el("div", { class: "evi-meta" }, el("span", {}, DIM_ZH[r.dimension] || r.dimension), el("span", {}, STRENGTH_ZH[r.strength] || r.strength), r.kind ? el("span", {}, r.kind) : null),
    el("details", { class: "evi-src" }, el("summary", {}, `取值来源（${(r.source || []).length}）与规则编号`),
      el("ul", { class: "srcs" }, (r.source || []).map((x) => el("li", {}, srcLine(x))), el("li", {}, `规则 ${r.rule}${r.id ? ` · ${r.id}` : ""}`))))));
}
function proBody(m) {
  const d = m.decision, p = m.views.pro, c = m.views.charts || {};
  const oe = p.conclusions.operations_evaluation, ij = p.conclusions.investment_judgement, ch = p.conclusions.checks || {};
  const g = oe.groups || {};
  const toc = [["pro-concl", "结论与检查"], ["pro-metrics", "指标"], ["pro-trend", "走势图"], ["pro-evidence", "证据"], ["pro-risk", "硬性风险检查"], ["pro-val", "估值"],
    ["pro-events", "公告事件"], ["pro-price", "价格趋势与市场环境"], ["pro-inv", "风险、冲突与失效"], ["pro-thr", "阈值与来源"], ["pro-src", "来源与运行身份"], ["pro-scope", "回答不了的问题"]];
  const v = p.valuation || {}, ev = p.events || {}, tr = p.trend || {}, en = p.environment || {};
  const sens = v.sensitivity || {};
  const decl = (p.sources || {}).declared_inputs || {};
  const exps = (p.sources || {}).experts || [];
  const body = [
    sec("pro-concl", "结论与检查", "两层结论和四项检查，均来自同一份判断输出。",
      table(["项目", "结论", "依据", "说明"], [
        ["经营评价", el("b", {}, oe.label), oe.basis || "—", oe.why || ""],
        ["投资研究判断", el("b", {}, ij.label), ij.basis, [ij.why || "", (ij.missing || []).length ? el("ul", { class: "plain" }, ij.missing.map((t) => el("li", {}, t))) : null]],
        ["价格", (ch.price || {}).status, "—", ((ch.price || {}).why || []).join("；") || "—"],
        ["估值比较", (ch.valuation_comparison || {}).status, (ch.valuation_comparison || {}).level || "—",
          `${(ch.valuation_comparison || {}).judgment || "—"}${(ch.valuation_comparison || {}).robust === true ? "（稳健）" : (ch.valuation_comparison || {}).robust === false ? "（不稳健）" : ""}`],
        ["硬性风险检查", (ch.risk_checks || {}).status, "—", [(ch.risk_checks || {}).statement || "", ((ch.risk_checks || {}).missing || []).length ? `；缺：${ch.risk_checks.missing.join("、")}` : ""]],
        ["公告检查", (ch.events || {}).status, "—", [((ch.events || {}).why || []).join("；"), (ch.events || {}).scope ? `（${ch.events.scope}）` : ""]],
      ]),
      (oe.notes || []).length ? el("p", { class: "sec-help" }, `经营评价备注：${oe.notes.join("；")}`) : null),
    sec("pro-metrics", "指标", "期间、单位和取值路径（指向本次运行记录里的字段）。年报口径，不是最近四个季度（TTM）。",
      table(["组", "指标", "数值", "上期", "期间", "单位", "规则 / 阈值", "来源"], (p.metrics || []).map((x) => [x.group, x.name, numTd(x.display || fmt(x.value, 4)),
        numTd(x.prior_display || (isNum(x.prior) ? fmt(x.prior, 4) : "—")), x.period || "—", x.unit || "—", x.rule || "—", srcTd(x.source)]))),
    sec("pro-trend", "走势图", "从本次运行的数据画出；图下有文字说明和数据表。", figFinancial(c.financial_trend), figPrice(c.price, m.meta && m.meta.price_source, m.ctx)),
    sec("pro-evidence", "证据", "每条理由都写明维度、强度、规则编号和取值来源；同一份原始数据只算一次。",
      el("h3", { class: "h3" }, `支持（${((p.evidence || {}).supporting || []).length}）`), evidenceList((p.evidence || {}).supporting || [], "sup"),
      el("h3", { class: "h3" }, `反对（${((p.evidence || {}).opposing || []).length}）`), evidenceList((p.evidence || {}).opposing || [], "opp"),
      el("h3", { class: "h3" }, `只描述、不判断（${((p.evidence || {}).neutral || []).length}）`), evidenceList((p.evidence || {}).neutral || [], "neu")),
    sec("pro-risk", "硬性风险检查", p.risk_statement || "",
      table(["编号", "检查", "状态", "取值来源", "备注"], (p.risk_checks || []).map((r) => {
        const [cls, ic] = RISK_ICON[r.status] || ["rs-a", "?"];
        return [el("span", { class: "mono" }, r.id), r.name, el("span", { class: "rs " + cls }, el("span", { "aria-hidden": "true" }, ic), r.status_zh || r.status),
          srcTd((r.source || []).map(srcLine).join("；")), r.note || "—"];
      }))),
    sec("pro-val", "估值", `依据层级：${v.basis || "—"} · 相对位置：${v.judgment || "—"} · ${v.robust === true ? "稳健" : v.robust === false ? "不稳健" : "稳健性未知"}`,
      (v.notes || []).length ? el("ul", { class: "plain" }, v.notes.map((t) => el("li", {}, t))) : null,
      (v.comparison || []).length ? [el("h3", { class: "h3" }, "比较依据"), table(["指标", "现在", "区间", "类型", "位置", "贴近边界", "来源", "日期", "合成"],
        v.comparison.map((x) => [x.name, numTd(fmt(x.observed, 2)), numTd(`${fmt(x.low, 2)}–${fmt(x.high, 2)}`), x.basis_type_zh || x.basis_type, x.relative || x.position,
          x.near_edge ? "是（不稳健）" : "否", x.source || "—", x.as_of || "—", x.synthetic ? "是（演示用合成区间）" : "否"]))]
        : el("p", {}, "没有比较依据：只能说“无法判断绝对贵贱”。"),
      (decl.rejected || []).length ? [el("h3", { class: "h3" }, "被拒收的比较依据"), el("ul", { class: "plain" }, decl.rejected.map((t) => el("li", {}, t)))] : null,
      (v.conditional || []).length ? [el("h3", { class: "h3" }, "条件性分析（声明的假设，不是比较依据）"), table(["方法", "每股价值区间", "现价位置", "来源"],
        v.conditional.map((x) => [x.name, numTd(`${fmt((x.range || [])[0])}–${fmt((x.range || [])[1])}`), ({ ABOVE: "现价在区间之上", BELOW: "现价在区间之下", INSIDE: "现价在区间之内" })[x.position] || x.position || "—", srcTd(x.path)]))] : null,
      (sens.why_not_robust || []).length ? [el("h3", { class: "h3" }, "敏感性：为什么不稳健"), el("ul", { class: "plain" }, sens.why_not_robust.map((t) => el("li", {}, t)))] : null,
      figValuation(c.valuation),
      v.assumptions ? el("details", {}, el("summary", {}, "声明的假设（原样）"), el("pre", { class: "mono" }, JSON.stringify(v.assumptions, null, 1))) : null),
    sec("pro-events", "公告事件", `${ev.label || ""}（状态：${ev.status || "—"}）。${ev.scope || ""}。${ev.role || ""}`,
      el("p", { class: "sec-help" }, `提供 ${(ev.documents || {}).supplied ?? "—"} 份，分析 ${(ev.documents || {}).analysed ?? "—"} 份。`),
      [["重大线索（待核实）", ev.material], ["人员或职位对不上（待核实）", ev.uncertain], ["出现了但没有解读的事项", ev.unread_items], ["只记录存在的事项", ev.recorded_items],
        ["来源冲突", ev.conflicts], ["只检查了一部分的原因", ev.partial_why], ["备注", ev.notes]].map(([t, xs]) => (xs || []).length ? [el("h3", { class: "h3" }, `${t}（${xs.length}）`), el("ul", { class: "plain" }, xs.map((x) => el("li", {}, txt(x))))] : null),
      figTimeline(c.events_timeline, m.as_of) || el("p", {}, "没有抽取到事件。没有抽取到不等于没有重大事件。")),
    sec("pro-price", "价格趋势与市场环境", "价格趋势只读技术面专家；市场环境只作背景，不改变任何标签。",
      table(["维度", "标签", "作用", "备注"], [
        ["价格趋势", tr.label || "—", tr.effect || "—", (tr.notes || []).join("；") || "—"],
        ["市场环境", en.label || "—", "背景（不改变标签）", [(en.notes || []).join("；"), en.scope ? `（${en.scope}）` : ""]]])),
    sec("pro-inv", "风险、冲突、条件与失效", "失效条件是“哪些读数变化会改变判断”，不是对未来的预测。",
      el("h3", { class: "h3" }, `关键风险（${(p.key_risks || []).length}）`), (p.key_risks || []).length ? el("ul", { class: "plain" }, p.key_risks.map((t) => el("li", {}, t))) : el("p", {}, `没有列出。${p.risk_statement || ""}；这不等于没有风险。`),
      el("h3", { class: "h3" }, `未解决的冲突（${(p.conflicts || []).length}）`), (p.conflicts || []).length ? el("ul", { class: "plain" }, p.conflicts.map((t) => el("li", {}, t))) : el("p", {}, "没有。"),
      el("h3", { class: "h3" }, "会改变投资研究判断的变化"), el("ul", { class: "plain" }, ((p.invalidation || {}).investment_judgement || []).map((t) => el("li", {}, t))),
      el("h3", { class: "h3" }, "会改变经营评价的变化"), el("ul", { class: "plain" }, ((p.invalidation || {}).operations_evaluation || []).map((t) => el("li", {}, t))),
      el("h3", { class: "h3" }, "继续研究之前需要满足的条件（不是买入条件）"), el("ul", { class: "plain" }, ((p.conditions || {}).to_meet || []).map((t) => el("li", {}, t))),
      ((p.conditions || {}).to_verify || []).length ? [el("h3", { class: "h3" }, "需要先核实"), el("ul", { class: "plain" }, p.conditions.to_verify.map((t) => el("li", {}, t)))] : null),
    sec("pro-thr", "阈值与来源", "每个阈值都写明性质：工程约定、产品假设或专家自带；都没有经过金融验证。",
      table(["编号", "值", "单位", "用途", "来源", "依据"], (p.thresholds || []).map((t) => [el("span", { class: "mono" }, t.id),
        typeof t.value === "object" && t.value ? Object.entries(t.value).map(([k, x]) => `${k} ${x}`).join("；") : str(t.value), t.unit || "—", t.use || "—", t.source || "—", t.basis || "—"]))),
    sec("pro-src", "来源与运行身份", "专家状态、是否被判断层使用、声明的输入和数据日期。版本和指纹在页末的技术详情里。",
      table(["专家", "状态", "输出契约", "判断层是否使用"], exps.map((x) => [EXPERT_ZH[x.expert] || x.expert, x.status || "—", x.output_contract || "—",
        x.malformed ? "格式异常，不使用" : x.used ? "使用" : "不使用"])),
      el("dl", { class: "kv" },
        el("dt", {}, "数据类型"), el("dd", {}, m.data_label),
        el("dt", {}, "数据截止日"), el("dd", {}, str(m.as_of)),
        el("dt", {}, "运行编号"), el("dd", { class: "mono" }, m.run_id || "—"),
        m.record_sha256 ? [el("dt", {}, "记录校验值"), el("dd", { class: "mono" }, `SHA-256 ${m.record_sha256}`)] : null,
        el("dt", {}, "判断指纹"), el("dd", { class: "mono" }, d.core_fingerprint || "—"),
        el("dt", {}, "声明的比较依据"), el("dd", {}, `${decl.comparison_basis ?? 0} 条${(decl.rejected || []).length ? `，拒收 ${decl.rejected.length} 条` : ""}${m.ctx === "demo" && (decl.comparison_basis || 0) > 0 ? "（演示用合成区间）" : ""}`),
        m.meta && m.meta.price_source ? [el("dt", {}, "价格序列"), el("dd", {}, `${m.meta.price_source.dataset_id || "—"}，${m.meta.price_source.points || 0} 个点${m.meta.price_source.problem ? `；${m.meta.price_source.problem}` : ""}`)] : null,
        m.meta && m.meta.started_at ? [el("dt", {}, "开始 / 结束（UTC）"), el("dd", { class: "mono" }, `${m.meta.started_at} / ${m.meta.finished_at || "—"}`)] : null)),
    sec("pro-scope", "回答不了的问题", "",
      el("ul", { class: "plain" }, (p.unanswerable || []).map((t) => el("li", {}, t))),
      el("h3", { class: "h3" }, "为什么现在不给买、持、卖建议"), el("p", {}, ((p.action_mapping || {}).why) || ""),
      el("ul", { class: "plain" }, ((p.action_mapping || {}).prerequisites || []).map((t) => el("li", {}, t))),
      el("h3", { class: "h3" }, "这份结果不包含"), el("ul", { class: "plain" }, (p.not_included || []).map((t) => el("li", {}, t)))),
    el("details", { class: "details", id: "pro-details" }, el("summary", {}, "技术详情：规则编号、问题标签、结构化错误、版本"),
      el("div", { class: "details-body" }, el("dl", { class: "kv" },
        el("dt", {}, "触发的规则"), el("dd", { class: "mono" }, ((p.details || {}).rules_fired || []).join(" → ")),
        el("dt", {}, "问题标签"), el("dd", { class: "mono" }, ((p.details || {}).issue_tags || []).join("、") || "—"),
        el("dt", {}, "判断层版本"), el("dd", { class: "mono" }, `${(p.details || {}).decision_layer_version || "—"} · ${(p.details || {}).contract_version || "—"}`),
        el("dt", {}, "判断指纹"), el("dd", { class: "mono" }, (p.details || {}).decision_fingerprint || "—"),
        el("dt", {}, "数据标签"), el("dd", {}, (p.data_labels || []).join("、") || "—"),
        el("dt", {}, "规则（各维度）"), el("dd", { class: "mono" }, [`经营 ${oe.rule || "—"}`, `投资研究判断 ${ij.rule || "—"}`, `价格趋势 ${tr.rule || "—"}`, `市场环境 ${en.rule || "—"}`, `估值 ${v.rule || "—"}`, `公告 ${ev.rule || "—"}`].join(" · ")),
        el("dt", {}, "经营事实组"), el("dd", { class: "mono" }, Object.entries(g).map(([k, x]) => `${k}=${x}`).join(" · ") || "—")),
        el("h3", { class: "h3" }, "专家版本与输出指纹"),
        table(["专家", "版本", "输出指纹"], exps.map((x) => [EXPERT_ZH[x.expert] || x.expert, { td: { class: "src" }, v: x.version || "—" }, { td: { class: "src" }, v: str(x.output_fingerprint) || "—" }])),
        el("h3", { class: "h3" }, `结构化错误（${((p.details || {}).errors || []).length}）`),
        ((p.details || {}).errors || []).length ? el("ul", { class: "plain mono" }, p.details.errors.map((e) => el("li", {}, `${e.where || ""}：${e.problem || ""}${e.affects ? `（影响：${e.affects}）` : ""}`))) : el("p", {}, "没有。"))),
  ];
  return el("div", { class: "pro-grid" }, el("nav", { class: "toc", "aria-label": "专业版目录" }, el("ol", {}, toc.map(([id, t]) => el("li", {}, el("a", { href: "#" + id, onclick: (e) => { e.preventDefault(); const h = document.getElementById(id + "-h"); if (h) { h.focus({ preventScroll: true }); h.scrollIntoView({ block: "start" }); } } }, t))))),
    el("div", { class: "pro-main" }, body));
}

// ---------------------------------------------------------------- entitlement prototype (task D)
// Reading depth (simple / professional) is never the paywall. Free / paid = usage, depth of service and ongoing service. Nothing is sold here:
// no payment, no charge, no account; showing or hiding the paid preview happens in this browser only and is NOT an authorisation.
export const PRICE_LABEL = "测试方案（未定价，不能购买）";
export const ENT_ROWS = [
  // [capability, free, paid candidate, status, statusClass]
  ["演示（合成公司）", "yes:可用", "yes:可用", "已上线（演示）", "live"],
  ["基础分析次数", "demo:有限（原型：本浏览器每天 10 次，只计数）", "plan:更多次数（数量未定）", "原型计数，不实际限制", "demo"],
  ["经营评价 + 投资研究判断（两层结论）", "yes:完整给出", "yes:同一结论，不会更确定或更乐观", "已上线", "live"],
  ["关键风险、反面证据、不确定性", "yes:全部在免费区", "yes:相同（永远不放进付费区）", "已上线", "live"],
  ["主要证据与来源", "yes:可用", "yes:可用", "已上线", "live"],
  ["简单版 / 专业版阅读", "yes:两种都可用", "yes:两种都可用", "已上线（阅读深度不收费）", "live"],
  ["完整报告（打印 / 下载 HTML）与历史", "yes:可用", "yes:可用", "已上线", "live"],
  ["完整研究报告包（报告 + 完整记录 + 方法附录 + 证据索引）", "no:不提供", "plan:付费候选", "演示预览（内容清单）", "demo"],
  ["公司比较", "no:不提供", "plan:付费候选", "规划中", "plan"],
  ["历史变化（同一公司不同运行之间的差异）", "no:不提供", "plan:付费候选", "规划中", "plan"],
  ["更新跟踪（新财报、公告后提醒重新评估）", "no:不提供", "plan:付费候选", "规划中", "plan"],
  ["价格", "yes:免费", "plan:" + PRICE_LABEL, "未定价", "plan"],
];
function entCell(x) { const [k, t] = x.split(/:(.*)/s); return el("td", { class: k }, t); }
export function planMatrix() {
  return el("div", { class: "tbl-wrap ent" }, el("table", { class: "t" },
    el("caption", { class: "sr-only" }, "免费与付费权益矩阵（原型）"),
    el("thead", {}, el("tr", {}, ["能力", "免费", "付费（候选）", "现在的状态"].map((h) => el("th", { scope: "col" }, h)))),
    el("tbody", {}, ENT_ROWS.map(([cap, f, p, st, sc]) => el("tr", {}, el("th", { scope: "row" }, cap), entCell(f), entCell(p),
      el("td", {}, el("span", { class: "st-badge st-" + sc }, st)))))));
}
export function planRules() {
  return el("ul", { class: "plan-rules" },
    el("li", {}, el("b", {}, "阅读方式不收费"), "简单版和专业版是阅读深度，两种都免费。"),
    el("li", {}, el("b", {}, "风险永远免费"), "关键风险、反面证据和不确定性始终在免费区，不放进付费区。"),
    el("li", {}, el("b", {}, "付费不改结论"), "付费只增加用量和服务，不会给出更确定或更乐观的结论。"));
}
export function plansSection(m, opts) {
  const d = m.decision, oe = d.operations_evaluation, ij = d.investment_judgement, p = m.views.pro;
  const fp = d.core_fingerprint || "";
  const pid = "paid-preview";
  const ev = p.evidence || {};
  const nEv = (ev.supporting || []).length + (ev.opposing || []).length + (ev.neutral || []).length;
  const nSrc = uniq([...(ev.supporting || []), ...(ev.opposing || []), ...(ev.neutral || [])].flatMap((r) => (r.source || []).map((x) => x.path))).length;
  const panel = el("div", { class: "paid", id: pid, "data-paid": "1", hidden: true, role: "region", "aria-label": "付费区域预览（演示）" },
    el("div", { class: "paid-head" }, el("h3", {}, "付费区域预览"), el("span", { class: "st-badge st-demo" }, "演示 · 不是已开通的订阅")),
    el("p", { class: "paid-lock" }, "这里的显示和隐藏只发生在你的浏览器里，不是真实的付费鉴权；没有账号、没有支付、不扣费。"),
    el("p", { class: "paid-same" }, "结论与免费区相同：经营评价 ", el("b", { "data-paid-concl": "ops" }, oe.label), `（${oe.basis ? "依据" + oe.basis : "没有依据"}）；投资研究判断 `,
      el("b", { "data-paid-concl": "inv" }, ij.label), `（依据${ij.basis}）；判断指纹 `, el("span", { class: "mono", "data-paid-fp": fp }, fp.slice(0, 16) + "…"), "（与上方相同）。"),
    el("ul", { class: "paid-cards" },
      el("li", { class: "paid-card" }, el("h4", {}, "完整研究报告包", el("span", { class: "st-badge st-demo" }, "演示预览")),
        el("p", {}, "把这次运行整理成一个可归档的包。下面是按这次运行生成的内容清单，不是可下载的文件："),
        el("ul", {}, el("li", {}, "报告正文（与免费的完整报告相同的结论和风险）"), el("li", {}, `证据索引：${nEv} 条理由，${nSrc} 个取值来源`),
          el("li", {}, `方法附录：${(p.thresholds || []).length} 个阈值及其性质，${((p.details || {}).rules_fired || []).length} 条触发的规则`),
          el("li", {}, "完整记录（JSON），带运行编号和校验值"))),
      el("li", { class: "paid-card" }, el("h4", {}, "更多分析次数", el("span", { class: "st-badge st-plan" }, "规划中")), el("p", {}, "超过免费额度后的分析次数。数量和价格都没有确定。")),
      el("li", { class: "paid-card" }, el("h4", {}, "公司比较", el("span", { class: "st-badge st-plan" }, "规划中")), el("p", {}, "把两到三家公司的两层结论、检查状态和关键指标放在一起看。")),
      el("li", { class: "paid-card" }, el("h4", {}, "历史变化", el("span", { class: "st-badge st-plan" }, "规划中")), el("p", {}, "同一家公司两次运行之间，结论、依据和指标的差异。")),
      el("li", { class: "paid-card" }, el("h4", {}, "更新跟踪", el("span", { class: "st-badge st-plan" }, "规划中")), el("p", {}, "有新财报或公告时提醒重新评估。现在没有任何通知。"))),
    el("p", { class: "price-test" }, "价格：", PRICE_LABEL));
  const btn = el("button", { type: "button", class: "btn ghost", "aria-expanded": "false", "aria-controls": pid, onclick: (e) => {
    const open = panel.hidden; panel.hidden = !open; e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "收起付费区域预览" : "预览付费区域（演示）";
  } }, "预览付费区域（演示）");
  return el("section", { class: "sec plans", id: "sec-plans", "aria-labelledby": "sec-plans-h" },
    el("h2", { id: "sec-plans-h" }, "免费与付费", el("span", { class: "n" }, "原型")),
    el("p", { class: "plan-intro" }, "免费和付费区分的是用量、服务深度和持续服务，不是阅读深度。上面的全部内容——两层结论、关键风险、反面证据、不确定性、主要证据、简单版和专业版——都在免费区。"),
    planRules(), opts && opts.usage ? el("p", { class: "usage" }, opts.usage) : null, planMatrix(), el("div", { class: "row" }, btn), panel);
}

// ---------------------------------------------------------------- a refusal (stage, reason, what to do) - used by the real-trial page
export const STAGE_ZH = { identity: "身份解析", support_scope: "支持范围", fetch: "取数", build: "整理数据", input: "输入检查", run: "运行专家", page: "页面检查", busy: "排队" };
export function refusalBlock(ref, extra) {
  ref = ref || {};
  const det = ref.details || {};
  const cands = det.candidates || [], sugg = det.suggestions || [];
  return el("section", { class: "refusal", role: "alert", "aria-labelledby": "ref-h" },
    el("h2", { id: "ref-h", tabindex: "-1" }, "没有完成：系统拒绝了这次分析"),
    el("dl", {},
      el("dt", {}, "停在哪一步"), el("dd", {}, `${STAGE_ZH[ref.stage] || ref.stage || "未知"}`),
      el("dt", {}, "原因"), el("dd", {}, ref.reason_zh || ref.reason || "没有记录原因"),
      el("dt", {}, "你可以做什么"), el("dd", {}, ref.what_you_can_do_zh || ref.what_to_do || "—"),
      el("dt", {}, "代码"), el("dd", { class: "mono" }, ref.code || "—"),
      el("dt", {}, "合成数据替代"), el("dd", {}, "没有：失败时不会改用合成数据或演示数据")),
    extra || (cands.length || sugg.length ? el("ul", { class: "plain" }, [...cands, ...sugg].map((c) => el("li", {}, typeof c === "string" ? c
      : `${c.name || c.ticker || ""}${(c.tickers || []).length ? "：" + c.tickers.map((t) => (typeof t === "string" ? t : t.ticker)).join("、") : c.ticker && c.name ? `（${c.ticker}）` : ""}`))) : null),
    cands.length || sugg.length ? el("p", { class: "sec-help" }, "系统不会替你选择；如需分析，请输入其中一个代码。") : null);
}

// ---------------------------------------------------------------- the result page
// opts: { mode, onMode(mode), top: [elements], saveLine: element, actions: element, plans: bool, usage: string, announce(text) }
export function renderResult(m, opts) {
  opts = opts || {};
  let mode = opts.mode === "pro" ? "pro" : "simple";
  const d = m.decision, probs = modelProblems(m), cons = (m.views && m.views.consistency) || [];
  const body = el("div", { id: "mode-body" });
  const mk = (val, t, sub) => el("button", { type: "button", "data-mode": val, "aria-pressed": String(mode === val), onclick: () => setMode(val) }, t, el("small", {}, sub));
  const toggle = el("div", { class: "mode", role: "group", "aria-label": "阅读方式" }, mk("simple", "简单版", "先看结论"), mk("pro", "专业版", "指标、证据、规则"));
  function paint() {
    body.textContent = "";
    body.append(...[mode === "pro" ? proBody(m) : simpleBody(m), expertsBlock(m, mode === "pro")].flat(Infinity).filter(Boolean));
    for (const b of toggle.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    document.body.dataset.mode = mode;
  }
  function setMode(val) {
    if (val === mode) return;
    mode = val; paint();
    if (opts.onMode) opts.onMode(val);
    if (opts.announce) opts.announce(`已切换到${val === "pro" ? "专业版" : "简单版"}：同一次运行 ${m.run_id || ""}，结论不变。`);
  }
  const head = el("header", { class: "res-head" },
    el("div", { class: "res-title-row" }, el("h1", { id: "res-title", tabindex: "-1" }, m.title || "（没有名称）"),
      el("span", { class: "data-label " + (m.ctx === "real" ? "real" : "syn") }, m.ctx === "real" ? "● " : "◇ ", m.data_label)),
    el("ul", { class: "res-facts" },
      m.code ? el("li", {}, el("b", {}, "代码"), el("span", { class: "mono" }, m.code)) : null,
      m.industry ? el("li", {}, el("b", {}, "行业"), m.industry) : null,
      el("li", {}, el("b", {}, "数据截止"), el("span", { class: "num" }, day(m.as_of))),
      el("li", {}, el("b", {}, "观察角度"), (d.horizon && d.horizon.label) || "约 6–12 个月")),
    el("p", { class: "run-line" }, "运行编号 ", el("span", { class: "mono", "data-run-id": m.run_id || "" }, m.run_id || "—"), " · 判断指纹 ",
      el("span", { class: "mono", "data-fp": d.core_fingerprint || "" }, str(d.core_fingerprint).slice(0, 12) + "…"),
      m.record_sha256 ? [" · 记录 SHA-256 ", el("span", { class: "mono" }, m.record_sha256.slice(0, 12) + "…")] : null),
    opts.saveLine || null,
    probs.length || cons.length ? el("div", { class: "alert bad", role: "alert" }, el("strong", {}, "一致性检查没有通过"),
      [...probs, ...cons].join("；") + "。请下载完整记录核对；在问题解决之前，不要依赖这个页面的结论。") : null);
  const bar = el("div", { class: "res-bar" }, el("div", { class: "wrap res-bar-in" }, opts.top || null, el("span", { class: "res-bar-name" }, m.title || ""),
    m.ctx === "real" ? el("span", { class: "flag flag-real" }, el("span", { "aria-hidden": "true" }, "●"), m.data_label) : null, el("span", { class: "sp" }), toggle));
  paint();
  return [bar, el("div", { class: "wrap" }, head, summaryBlock(m), body, opts.plans ? plansSection(m, opts) : null, opts.actions || null)];
}

// ---------------------------------------------------------------- full report (page, print, download): BOTH versions of the same run
export function buildReport(m, meta) {
  meta = meta || {};
  const d = m.decision, s = m.views.simple, p = m.views.pro, c = m.views.charts || {};
  const oe = d.operations_evaluation, ij = d.investment_judgement;
  const ul = (xs) => el("ul", { class: "plain" }, (xs || []).map((t) => el("li", {}, t)));
  const ev = (xs) => el("ol", { class: "ritems" }, (xs || []).map((r) => el("li", {}, r.text, el("div", { class: "rev" }, `${DIM_ZH[r.dimension] || r.dimension} · ${STRENGTH_ZH[r.strength] || r.strength} · 规则 ${r.rule} · ${(r.source || []).map(srcLine).join("；")}`))));
  const wor = uniq([...(s.key_risks || []), ...(s.key_counter_evidence || []), ...(p.conflicts || [])]);
  return el("article", { class: "report" },
    el("p", { class: "kicker" }, `股票研究工作台 · 研究记录 · ${m.data_label}`),
    el("h1", {}, m.title || ""),
    el("p", { class: "kicker" }, "实验原型，未经金融验证；不是买入、持有或卖出建议。"),
    el("div", { class: "rep-sum" },
      el("div", {}, el("b", {}, "经营评价"), el("strong", {}, oe.label), ` ${oe.basis ? "依据" + oe.basis : "没有依据"}`, el("p", {}, oe.why || "")),
      el("div", {}, el("b", {}, "投资研究判断"), el("strong", {}, ij.label), ` 依据${ij.basis}`, el("p", {}, ij.why || ""))),
    (ij.missing || []).length ? [el("h3", {}, ij.label === "无法判断" ? "为什么还不能判断" : "依据还缺"), ul(ij.missing)] : null,
    el("h2", {}, "运行信息"),
    el("dl", { class: "kv" },
      el("dt", {}, "分析对象"), el("dd", {}, `${m.title || ""}${m.code ? `（代码 ${m.code}）` : ""}${m.industry ? ` · ${m.industry}` : ""}`),
      el("dt", {}, "数据类型"), el("dd", {}, m.data_label),
      el("dt", {}, "数据截止日"), el("dd", {}, str(m.as_of)),
      el("dt", {}, "运行编号"), el("dd", { class: "mono" }, m.run_id || "—"),
      el("dt", {}, "判断指纹"), el("dd", { class: "mono" }, d.core_fingerprint || "—"),
      m.record_sha256 ? [el("dt", {}, "记录校验值"), el("dd", { class: "mono" }, `SHA-256 ${m.record_sha256}`)] : null,
      el("dt", {}, "判断层"), el("dd", { class: "mono" }, `${d.decision_layer_version || "—"} · ${d.contract_version || "—"}`),
      meta.site ? [el("dt", {}, "网站版本"), el("dd", { class: "mono" }, meta.site)] : null),
    el("h2", {}, "四项检查"),
    ul([`价格：${(d.checks.price || {}).status}${((d.checks.price || {}).why || []).length ? "（" + d.checks.price.why.join("；") + "）" : ""}`,
      `估值比较：${(d.checks.valuation_comparison || {}).status}（${(d.checks.valuation_comparison || {}).level || ""}${(d.checks.valuation_comparison || {}).judgment ? "，" + d.checks.valuation_comparison.judgment : ""}）`,
      `硬性风险检查：${(d.checks.risk_checks || {}).status}——${(d.checks.risk_checks || {}).statement || ""}`,
      `公告检查：${(d.checks.events || {}).status}（${(d.checks.events || {}).scope || ""}）`]),
    el("h2", {}, "主要担忧与反面证据"), wor.length ? ul(wor) : el("p", {}, `没有列出反面理由。${(d.checks.risk_checks || {}).statement || ""}；这不等于没有风险。`),
    el("h2", {}, "还不知道的"), (s.unknowns || []).length ? ul(s.unknowns) : el("p", {}, "没有列出缺项；检查范围仍有限。"),
    el("h2", {}, "简单版：四个问题"),
    (s.questions || []).map((q, i) => [el("h3", {}, `${i + 1}. ${q.q}`), el("p", {}, q.answer), el("p", { class: "kicker" }, `为什么重要：${q.why_it_matters}`),
      el("ul", { class: "plain" }, (q.points || []).map((x) => el("li", {}, `【${x.kind}】${x.text}`)))]),
    el("h2", {}, "专业版：图表"), figFinancial(c.financial_trend), figPrice(c.price, m.meta && m.meta.price_source, m.ctx), figValuation(c.valuation), figTimeline(c.events_timeline, m.as_of),
    el("h2", {}, "专业版：指标"),
    table(["指标", "数值", "期间", "单位", "来源"], (p.metrics || []).map((x) => [x.name, numTd(x.display || fmt(x.value, 4)), x.period || "—", x.unit || "—", srcTd(x.source)])),
    el("h2", {}, "专业版：证据"), el("h3", {}, "支持"), ev((p.evidence || {}).supporting), el("h3", {}, "反对"), ev((p.evidence || {}).opposing), el("h3", {}, "只描述、不判断"), ev((p.evidence || {}).neutral),
    el("h2", {}, "硬性风险检查"), ul((p.risk_checks || []).map((r) => `${r.id} ${r.name}：${r.status_zh || r.status}`)),
    el("h2", {}, "冲突、条件与失效"), el("h3", {}, "未解决的冲突"), (p.conflicts || []).length ? ul(p.conflicts) : el("p", {}, "没有。"),
    el("h3", {}, "会改变投资研究判断的变化"), ul((p.invalidation || {}).investment_judgement), el("h3", {}, "会改变经营评价的变化"), ul((p.invalidation || {}).operations_evaluation),
    el("h3", {}, "继续研究之前需要满足的条件（不是买入条件）"), ul((p.conditions || {}).to_meet),
    el("h2", {}, "阈值与来源"), ul((p.thresholds || []).map((t) => `${t.id}：${typeof t.value === "object" && t.value ? Object.entries(t.value).map(([k, x]) => `${k} ${x}`).join("；") : str(t.value)}${t.unit ? " " + t.unit : ""}——${t.source || ""}；${t.basis || ""}`)),
    el("h2", {}, "回答不了的问题与不包含的内容"), ul([...(p.unanswerable || []), ...(p.not_included || []).map((t) => `不包含：${t}`)]),
    el("h2", {}, "技术详情"), el("p", { class: "rev" }, `规则：${((p.details || {}).rules_fired || []).join(" → ")}；问题标签：${((p.details || {}).issue_tags || []).join("、") || "—"}；结构化错误 ${((p.details || {}).errors || []).length} 条`),
    el("p", { class: "kicker" }, `${meta.footer || ""}生成时间 ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC。`));
}
export const REPORT_CSS = `:root{--ink:#16191d;--muted:#565d66;--line:#d8d1c2;--surface:#fff;--raise:#fbfaf6;--brand:#0c4c47;--chart-bar:#9fc3bd;--chart-bar-line:#0c4c47;--chart-line:#7a4300;--chart-grid:#ddd6c8;--chart-area:#dcebe8;--chart-range:#c9d9ec;--chart-range-line:#1f4f8c;--syn:#6b3f00;--bad:#982a20;--unk:#5a3d8f;--fact:#1f4f8c}
body{margin:0;background:#fff;color:#16191d;font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.report{max-width:860px;margin:0 auto;padding:28px 20px 48px}.report h1,.report h2{font-family:"Songti SC","Noto Serif SC",Georgia,serif}
.report h1{font-size:28px;margin:6px 0}.report h2{font-size:19px;margin:28px 0 8px;padding-top:10px;border-top:2px solid #16191d}.report h3{font-size:15px;margin:14px 0 4px}
.kicker{font-size:13px;color:#565d66;margin:0}.rep-sum{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.rep-sum div{border:1px solid #d8d1c2;border-radius:10px;padding:10px 12px}
.rep-sum b{display:block;font-size:13px;color:#565d66}.rep-sum strong{font-family:"Songti SC",Georgia,serif;font-size:24px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:8px 0}.kv dt{color:#565d66}.kv dd{margin:0;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;overflow-wrap:anywhere}.ritems{padding-left:22px}.ritems>li{margin:0 0 10px;overflow-wrap:anywhere}
.rev{font-size:12px;font-family:ui-monospace,Menlo,monospace;color:#565d66;overflow-wrap:anywhere}.plain{padding-left:20px}.plain li{overflow-wrap:anywhere}
.tbl-wrap{overflow-x:auto}table.t{width:100%;border-collapse:collapse;font-size:13px}.t th,.t td{text-align:left;padding:6px 8px;border-bottom:1px solid #d8d1c2;vertical-align:top}.t th{background:#ebe6da}
.t .src{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#565d66;overflow-wrap:anywhere}.t td.n{white-space:nowrap}
.fig{margin:12px 0;border:1px solid #d8d1c2;border-radius:10px;padding:10px 12px}.fig svg{display:block;width:100%;height:auto}.fig figcaption{font-size:14px}
.fig .legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;padding:0;list-style:none}.fig-alt{font-size:12px;color:#565d66}.ev-list{font-size:13px}
.sw{width:14px;height:10px;display:inline-block;border:1px solid #0c4c47;background:#9fc3bd;margin-right:4px}.sw-line{height:3px;border:0;background:#7a4300}.sw-range{background:#c9d9ec;border-color:#1f4f8c}.sw-dia{width:9px;height:9px;transform:rotate(45deg);background:#16191d;border:0}
.ch-grid{stroke:#ddd6c8}.ch-axis{fill:#565d66;font-size:12px}.ch-val{fill:#353b43;font-size:12px;font-weight:600}.ch-bar{fill:#9fc3bd;stroke:#0c4c47}.ch-line{fill:none;stroke:#7a4300;stroke-width:2.5}
.ch-dot{fill:#fff;stroke:#7a4300;stroke-width:2.5}.ch-price{fill:none;stroke:#0c4c47;stroke-width:2}.ch-area{fill:#dcebe8}.ch-end{fill:#0c4c47}.ch-range{fill:#c9d9ec;stroke:#1f4f8c;stroke-width:1.5}
.ch-obs{fill:#16191d}.ch-ref{stroke:#16191d;stroke-dasharray:4 3}.ch-tl{stroke:#bdb39e;stroke-width:2}.ch-ev-mat{fill:#982a20}.ch-ev-unc{fill:#5a3d8f}.ch-ev-oth{fill:#fff;stroke:#1f4f8c;stroke-width:2}.ch-syn{fill:#6b3f00;font-size:12px;font-weight:700}
@media print{.report{padding:0}.ritems>li,.fig{break-inside:avoid}}`;
