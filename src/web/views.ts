// Server-rendered HTML. No front-end framework: template strings plus one small script for inline editing.

import { Certificate, AuditEvent, Scorecard } from "../repo.js";
import { FieldResult, CheckResult } from "../checker.js";
import { CHEM_ELEMENTS, GAUGES, IDENTITY_FIELDS, IDENTITY_LABELS, MECH_FIELDS, getValue, labelFor } from "../fields.js";
import { config, recordUrl, shareUrl } from "../config.js";
import { EDITION_WARNING, SPECS } from "../specs.js";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
};
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="6" fill="#c2410c"/><path d="M7 7h12M7 19h12M13 7v12" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const VERDICT_TEXT: Record<string, string> = { PASS: "Pass", FAIL: "Fail", INCOMPLETE: "Incomplete" };
export const verdictBadge = (v: string, lg = false) => `<span class="badge ${v.toLowerCase()}${lg ? " lg" : ""}">${VERDICT_TEXT[v] ?? esc(v)}</span>`;
export const statusBadge = (s: string, lg = false) =>
  `<span class="badge ${s}${lg ? " lg" : ""}">${s === "pending" ? "Awaiting QA" : s === "approved" ? "Approved" : "Rejected"}</span>`;
const fieldBadge = (s: string) => (s === "info" ? `<span class="small muted">Recorded</span>` : `<span class="badge ${s}">${s === "missing" ? "Missing" : s === "pass" ? "Pass" : "Fail"}</span>`);
const sourceTag = (c: Certificate) => (c.source === "claude" ? `<span class="src-tag">via Claude</span>` : c.source === "seed" ? `<span class="src-tag" style="background:#f1f5f9;color:#475569">sample</span>` : "");

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`;

function head(title: string, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · MillProof</title>${FONTS}<link rel="stylesheet" href="/static/app.css"><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO.replace('width="26" height="26" ', ""))}">${extra}</head>`;
}

export function layout(title: string, body: string, opts: { user: string; active?: string; scripts?: string[] }) {
  const nav = [["/", "Certificates", "certs"], ["/suppliers", "Suppliers", "suppliers"], ["/connect", "Connect Claude", "connect"]]
    .map(([href, label, key]) => `<a href="${href}" class="${opts.active === key ? "active" : ""}">${label}</a>`)
    .join("");
  return `${head(title)}<body>
<header class="topbar"><div class="wrap"><a class="brand" href="/">${LOGO} MillProof</a><nav class="nav">${nav}</nav>
<div class="who"><span>${esc(config.demoName)}</span><a href="/logout">Log out</a></div></div></header>
<main class="wrap">${body}</main><div id="toast" class="toast"></div>
${(opts.scripts ?? []).map((s) => `<script src="${s}" defer></script>`).join("")}
</body></html>`;
}

export function loginPage(error: string | null, next: string) {
  return `${head("Log in")}<body><div class="login-page"><form class="login-card" method="post" action="/login">
<div class="brand" style="color:var(--ink)">${LOGO} MillProof</div>
<h1>Sign in</h1><div class="muted">Mill test certificate checks for steel buyers.</div>
${error ? `<div class="error-box">${esc(error)}</div>` : ""}
<input type="hidden" name="next" value="${esc(next)}">
<label for="u">Email</label><input class="input" id="u" name="username" autocomplete="username" required>
<label for="p">Password</label><input class="input" id="p" name="password" type="password" autocomplete="current-password" required>
<button class="btn primary" type="submit">Sign in</button>
<div class="hint">Test account: <b class="mono">${esc(config.demoUser)}</b> / <b class="mono">${esc(config.demoPassword)}</b></div>
</form></div></body></html>`;
}

/* ---------- Dashboard ---------- */

export function dashboardPage(all: Certificate[], shown: Certificate[], suppliers: string[], f: { supplier?: string; verdict?: string; status?: string; q?: string }) {
  const n = (fn: (c: Certificate) => boolean) => all.filter(fn).length;
  const tiles = `<div class="tiles">
<div class="tile"><div class="k">Certificates</div><div class="v">${all.length}</div></div>
<div class="tile pass"><div class="k">Pass</div><div class="v">${n((c) => c.check.verdict === "PASS")}</div></div>
<div class="tile fail"><div class="k">Fail</div><div class="v">${n((c) => c.check.verdict === "FAIL")}</div></div>
<div class="tile miss"><div class="k">Incomplete</div><div class="v">${n((c) => c.check.verdict === "INCOMPLETE")}</div></div>
<div class="tile"><div class="k">Awaiting QA</div><div class="v">${n((c) => c.status === "pending")}</div></div></div>`;

  const opt = (v: string, label: string, cur?: string) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(label)}</option>`;
  const filters = `<form class="filters" method="get" action="/">
<input class="input" name="q" placeholder="Search heat no., supplier, id" value="${esc(f.q ?? "")}" style="width:240px">
<select class="input" name="supplier" onchange="this.form.submit()">${opt("", "All suppliers", f.supplier)}${suppliers.map((s) => opt(s, s, f.supplier)).join("")}</select>
<select class="input" name="verdict" onchange="this.form.submit()">${opt("", "Any verdict", f.verdict)}${opt("PASS", "Pass", f.verdict)}${opt("FAIL", "Fail", f.verdict)}${opt("INCOMPLETE", "Incomplete", f.verdict)}</select>
<select class="input" name="status" onchange="this.form.submit()">${opt("", "Any QA status", f.status)}${opt("pending", "Awaiting QA", f.status)}${opt("approved", "Approved", f.status)}${opt("rejected", "Rejected", f.status)}</select>
<button class="btn" type="submit">Filter</button>${f.q || f.supplier || f.verdict || f.status ? `<a href="/" class="small">Clear</a>` : ""}</form>`;

  const rows = shown
    .map(
      (c) => `<tr class="link-row" onclick="location.href='/certificates/${c.id}'">
<td class="nowrap"><a href="/certificates/${c.id}" class="mono"><b>${esc(c.data.heat_number)}</b></a><div class="small muted mono">${c.id}</div></td>
<td>${esc(c.data.supplier)}<div class="small muted">${esc(c.data.mill_name ?? "")}</div></td>
<td>${esc(c.check.specLabel)}</td>
<td>${fmtDate(c.data.cert_date)}</td>
<td>${verdictBadge(c.check.verdict)}${c.check.flags.length ? ` <span class="chip" title="${esc(c.check.flags.map((x) => x.message).join("\n"))}">${c.check.flags.length} flag${c.check.flags.length > 1 ? "s" : ""}</span>` : ""}</td>
<td>${statusBadge(c.status)}</td>
<td class="small muted">${fmtDateTime(c.created_at)}<div>${sourceTag(c)}</div></td></tr>`,
    )
    .join("");

  return `<div class="page-head"><div><h1>Certificates</h1><div class="meta">Every mill test certificate Claude has sent in, checked against the spec table.</div></div>
<a class="btn primary" href="/connect">+ Add from Claude</a></div>
${tiles}
<div class="card">${filters}
${shown.length ? `<table><thead><tr><th>Heat no.</th><th>Supplier / mill</th><th>Grade</th><th>Cert date</th><th>Verdict</th><th>QA</th><th>Received</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No certificates match. Ask Claude to read an MTC and it will appear here.</div>`}
</div>`;
}

/* ---------- Record page ---------- */

function inputFor(c: Certificate, field: string, kind: "num" | "text" | "gauge") {
  const v = getValue(c.data, field);
  const val = v === null || v === undefined ? "" : String(v);
  if (kind === "gauge") {
    return `<select class="cell-input text" data-field="${field}"><option value="">Not stated</option>${GAUGES.map((g) => `<option value="${g}"${val === g ? " selected" : ""}>${g === "proportional" ? "5.65√So (proportional)" : g}</option>`).join("")}</select>`;
  }
  return `<input class="cell-input${kind === "text" ? " text" : ""}" data-field="${field}" value="${esc(val)}" placeholder="not given" ${kind === "num" ? 'inputmode="decimal"' : ""} aria-label="${esc(labelFor(field))}">`;
}

export const limitCell = (r: FieldResult) =>
  (r.min == null && r.max == null ? `<span class="small muted">No limit</span>` : `<span class="mono nowrap">${esc(r.limitText)}</span>`) + `${r.verify ? `<span class="chip" title="This limit is flagged in the spec table for checking against the standard">verify</span>` : ""}`;
export const statusCell = (r: FieldResult) => `${fieldBadge(r.status)}${r.note ? `<div class="small muted" style="margin-top:4px">${esc(r.note)}</div>` : ""}`;

function resultRow(c: Certificate, r: FieldResult, editable: boolean) {
  const valueCell =
    r.field === "CE_calc"
      ? `<span id="val-CE_calc" class="mono" style="padding-left:9px">${r.value == null ? "—" : r.value.toFixed(3)}</span>`
      : editable
        ? inputFor(c, r.field, "num")
        : `<span class="mono">${r.value ?? `<span class="muted">not given</span>`}</span>`;
  return `<tr><td>${esc(r.label)}</td><td>${valueCell}</td><td id="lim-${r.field}">${limitCell(r)}</td><td id="st-${r.field}">${statusCell(r)}</td><td class="src">${esc(r.field === "CE_calc" ? `${r.limitText}. ${r.source}` : r.source ?? "")}</td></tr>`;
}

function resultsTable(c: Certificate, prefix: string, editable: boolean) {
  const rows = c.check.results.filter((r) => r.field.startsWith(prefix) || (prefix === "chemistry." && r.field === "CE_calc"));
  return `<table><thead><tr><th style="width:26%">Property</th><th style="width:16%">Reported</th><th style="width:15%">Limit</th><th style="width:15%">Result</th><th>Source in spec table</th></tr></thead>
<tbody>${rows.map((r) => resultRow(c, r, editable)).join("")}</tbody></table>`;
}

export function headFragment(c: Certificate) {
  const ck = c.check;
  return `<div class="page-head" id="frag-head"><div>
<div class="crumbs"><a href="/">Certificates</a> / <span class="mono">${c.id}</span></div>
<h1>Heat <span class="mono">${esc(c.data.heat_number)}</span> <span class="muted" style="font-weight:400">· ${esc(ck.specLabel)}</span></h1>
<div class="meta">${esc(c.data.supplier)}${c.data.mill_name ? ` · ${esc(c.data.mill_name)}` : ""} · ${c.source === "claude" ? "Sent in by Claude" : c.source === "seed" ? "Sample record" : "Added"} on ${fmtDateTime(c.created_at)} ${sourceTag(c)}</div>
</div><div class="verdict-box">${verdictBadge(ck.verdict, true)}${statusBadge(c.status)}
<div class="counts"><span><b>${ck.counts.pass}</b> pass</span><span><b>${ck.counts.fail}</b> fail</span><span><b>${ck.counts.missing}</b> missing</span></div></div></div>`;
}

export function flagsFragment(c: Certificate) {
  if (!c.check.flags.length) return `<div id="frag-flags"></div>`;
  return `<div class="flags" id="frag-flags"><h3>Red flags</h3><ul>${c.check.flags.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul></div>`;
}

export function decisionFragment(c: Certificate) {
  const canApprove = c.check.verdict === "PASS";
  const decided = c.decision
    ? `<div style="margin-bottom:14px">${statusBadge(c.status, true)}<div class="small muted" style="margin-top:6px">by ${esc(c.decision.by)} on ${fmtDateTime(c.decision.at)}</div>${c.decision.note ? `<div style="margin-top:6px">“${esc(c.decision.note)}”</div>` : ""}</div>`
    : "";
  return `<section class="card" id="frag-decision"><div class="card-head"><h2>QA decision</h2>${c.decision ? "" : `<span class="small muted">Batch awaiting review</span>`}</div>
<div class="card-body">${decided}
<textarea id="decision-note" class="note" placeholder="Note for the record (optional), e.g. 'Matches bundle tags, 12 plates'"></textarea>
<div class="btn-row" style="margin-top:10px">
<button class="btn approve" data-decision="approved" ${canApprove && c.status !== "approved" ? "" : "disabled"} title="${canApprove ? "Approve this batch" : "Only PASS certificates can be approved"}">Approve batch</button>
<button class="btn reject" data-decision="rejected" ${c.status !== "rejected" ? "" : "disabled"}>Reject batch</button></div>
${canApprove ? "" : `<div class="small muted" style="margin-top:8px">Approve is available only when every checked value passes.</div>`}
</div>
<div class="card-head" style="border-top:1px solid var(--line-2)"><h2>Share verification</h2><span class="small muted">Read-only, no login</span></div>
<div class="card-body"><div class="copy"><input class="input" id="share-url" value="${esc(shareUrl(c.share_token))}" readonly><button class="btn" data-copy="share-url">Copy</button><a class="btn" href="${esc(shareUrl(c.share_token))}" target="_blank" rel="noopener">Open</a></div>
<div class="small muted" style="margin-top:8px">Send this to your client or third-party inspector.</div></div></section>`;
}

const ACTION_TEXT: Record<string, string> = {
  created: "Record created", field_updated: "Changed", approved: "Approved batch", rejected: "Rejected batch", decision_reset: "Decision reset",
};
export function auditFragment(events: AuditEvent[]) {
  const items = events
    .map((e) => {
      const diff =
        e.action === "field_updated"
          ? ` <b>${esc(labelFor(e.field ?? ""))}</b> <span class="diff"><s>${esc(e.old_value ?? "blank")}</s> → <ins>${esc(e.new_value ?? "blank")}</ins></span>`
          : "";
      return `<li><div class="when">${fmtDateTime(e.at)}<div>${esc(e.actor)}</div></div><div class="what"><b>${ACTION_TEXT[e.action] ?? esc(e.action)}</b>${diff}${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ""}</div></li>`;
    })
    .join("");
  return `<section class="card" id="frag-audit"><div class="card-head"><h2>Audit trail</h2><span class="small muted">${events.length} event${events.length === 1 ? "" : "s"}</span></div><ul class="audit">${items}</ul></section>`;
}

export function recordPage(c: Certificate, events: AuditEvent[]) {
  const idRows = IDENTITY_FIELDS.map((f) => {
    const kind = f === "thickness_mm" ? "num" : f === "elongation_gauge" ? "gauge" : "text";
    return `<tr><td>${IDENTITY_LABELS[f]}</td><td>${inputFor(c, f, kind)}</td></tr>`;
  }).join("");
  const spec = SPECS.find((s) => s.id === c.check.specId);
  return `<div data-cert-id="${c.id}">
${headFragment(c)}
${flagsFragment(c)}
<div class="grid-2" style="margin-top:0">
<section class="card"><div class="card-head"><h2>Certificate details</h2><span class="small muted">Click any value to correct it. The check re-runs on save.</span></div>
<table class="kv"><tbody>${idRows}</tbody></table></section>
${decisionFragment(c)}
</div>
<section class="card" style="margin-top:20px"><div class="card-head"><h2>Chemical composition <span class="muted" style="font-weight:400">· heat analysis, wt %</span></h2><span class="small muted">${esc(spec?.standard ?? "")}</span></div>
${resultsTable(c, "chemistry.", true)}</section>
<section class="card"><div class="card-head"><h2>Mechanical properties</h2>${spec?.note ? `<span class="small muted" style="max-width:60%;text-align:right">${esc(spec.note)}</span>` : ""}</div>
${resultsTable(c, "mechanical.", true)}</section>
${auditFragment(events)}
<p class="footer-note">Checks use fixed rules from the MillProof spec table. Limits tagged <span class="chip" style="margin:0">verify</span> are not yet confirmed against the licensed standard. ${esc(EDITION_WARNING)}</p>
</div>`;
}

/** Fragments + cells returned to the browser after an edit or decision. */
export function recordUpdate(c: Certificate, events: AuditEvent[], changedField?: string) {
  const cells: Record<string, { limit: string; status: string; value?: string; changed?: boolean }> = {};
  for (const r of c.check.results) {
    cells[r.field] = { limit: limitCell(r), status: statusCell(r), changed: r.field === changedField };
    if (r.field === "CE_calc") cells[r.field].value = r.value == null ? "—" : r.value.toFixed(3);
  }
  return {
    fragments: { head: headFragment(c), flags: flagsFragment(c), decision: decisionFragment(c), audit: auditFragment(events) },
    cells,
  };
}

/* ---------- Public verification page ---------- */

export function sharePage(c: Certificate, editCount: number) {
  const ck: CheckResult = c.check;
  const v = ck.verdict.toLowerCase();
  const qa = c.decision
    ? `${c.status === "approved" ? "Accepted" : "Rejected"} by the buyer's QA on ${fmtDate(c.decision.at)}`
    : "Awaiting the buyer's QA decision";
  const id = (label: string, val: unknown) => `<tr><td>${label}</td><td>${val === null || val === undefined || val === "" ? `<span class="muted">—</span>` : esc(val)}</td></tr>`;
  return `${head(`Heat ${c.data.heat_number} verification`, '<meta name="robots" content="noindex">')}<body>
<header class="public-top"><div class="wrap"><span class="brand">${LOGO} MillProof</span><span class="tag">Mill test certificate verification</span></div></header>
<main class="wrap" style="max-width:920px">
<div class="card" style="overflow:hidden"><div class="seal ${v}"><div><div class="small muted">Rule check against ${esc(ck.specLabel)}</div><div class="big">${ck.verdict}</div></div>
<div style="margin-left:auto;text-align:right">${statusBadge(c.status, true)}<div class="small muted" style="margin-top:6px">${esc(qa)}</div></div></div>
<table class="kv"><tbody>
${id("Heat number", c.data.heat_number)}${id("Supplier", c.data.supplier)}${id("Mill", c.data.mill_name)}${id("Standard / grade", `${c.data.standard} · ${c.data.grade}`)}
${id("Certificate no. / date", [c.data.certificate_no, c.data.cert_date ? fmtDate(c.data.cert_date) : null].filter(Boolean).join(" · "))}${id("Product", c.data.product)}
${id("Result", `${ck.counts.pass} pass, ${ck.counts.fail} fail, ${ck.counts.missing} missing`)}
${id("Record", `${c.id} · last checked ${fmtDateTime(ck.checkedAt)} · ${editCount} correction${editCount === 1 ? "" : "s"} on the audit trail`)}
</tbody></table></div>
${ck.flags.length ? `<div class="flags" style="margin-top:20px"><h3>Red flags</h3><ul>${ck.flags.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul></div>` : ""}
<section class="card" style="margin-top:20px"><div class="card-head"><h2>Chemical composition · wt %</h2></div>${resultsTable(c, "chemistry.", false)}</section>
<section class="card"><div class="card-head"><h2>Mechanical properties</h2></div>${resultsTable(c, "mechanical.", false)}</section>
<p class="footer-note">This page shows the values printed on the mill test certificate, as recorded by the buyer, checked with fixed rules from MillProof's spec table. It is not a substitute for independent testing. Limits marked “verify” are pending confirmation against the licensed standard.</p>
</main></body></html>`;
}

/* ---------- Suppliers ---------- */

const rateBar = (r: number) => `<span class="bar ${r >= 0.8 ? "" : r >= 0.5 ? "mid" : "low"}"><span style="width:${Math.round(r * 100)}%"></span></span><b>${Math.round(r * 100)}%</b>`;

export function suppliersPage(cards: Scorecard[]) {
  const rows = cards
    .map(
      (s) => `<tr class="link-row" onclick="location.href='/suppliers/${encodeURIComponent(s.supplier)}'"><td><a href="/suppliers/${encodeURIComponent(s.supplier)}"><b>${esc(s.supplier)}</b></a></td>
<td class="num">${s.total}</td><td class="nowrap">${rateBar(s.passRate)}</td><td class="num">${s.fail}</td><td class="num">${s.incomplete}</td><td class="num">${s.rejected}</td>
<td class="small">${s.topFailures.length ? esc(s.topFailures.map((f) => `${f.label} (${f.count})`).join(", ")) : `<span class="muted">—</span>`}</td><td class="small muted">${fmtDate(s.lastCertificateAt)}</td></tr>`,
    )
    .join("");
  return `<div class="page-head"><div><h1>Supplier scorecard</h1><div class="meta">Pass rate = share of a supplier's certificates that pass every checked value.</div></div></div>
<div class="card">${cards.length ? `<table><thead><tr><th>Supplier</th><th>Certs</th><th>Pass rate</th><th>Fail</th><th>Incomplete</th><th>Rejected</th><th>Most frequent failures</th><th>Last cert</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No suppliers yet.</div>`}</div>`;
}

export function supplierPage(s: Scorecard) {
  const rows = s.certificates
    .map(
      (c) => `<tr class="link-row" onclick="location.href='/certificates/${c.id}'"><td><a class="mono" href="/certificates/${c.id}"><b>${esc(c.data.heat_number)}</b></a></td><td>${esc(c.data.mill_name ?? "—")}</td><td>${esc(c.check.specLabel)}</td>
<td>${fmtDate(c.data.cert_date)}</td><td>${verdictBadge(c.check.verdict)}</td><td>${statusBadge(c.status)}</td></tr>`,
    )
    .join("");
  return `<div class="page-head"><div><div class="crumbs"><a href="/suppliers">Suppliers</a> / ${esc(s.supplier)}</div><h1>${esc(s.supplier)}</h1>
<div class="meta">${s.total} certificate${s.total === 1 ? "" : "s"} · last received ${fmtDate(s.lastCertificateAt)}</div></div></div>
<div class="tiles"><div class="tile"><div class="k">Pass rate</div><div class="v">${Math.round(s.passRate * 100)}%</div></div>
<div class="tile pass"><div class="k">Pass</div><div class="v">${s.pass}</div></div><div class="tile fail"><div class="k">Fail</div><div class="v">${s.fail}</div></div>
<div class="tile miss"><div class="k">Incomplete</div><div class="v">${s.incomplete}</div></div><div class="tile"><div class="k">Rejected by QA</div><div class="v">${s.rejected}</div></div></div>
${s.topFailures.length ? `<div class="card"><div class="card-head"><h2>Most frequent failures</h2></div><div class="card-body">${s.topFailures.map((f) => `<div style="margin:4px 0">${esc(f.label)}: <b>${f.count}</b> certificate${f.count === 1 ? "" : "s"}</div>`).join("")}</div></div>` : ""}
<div class="card"><table><thead><tr><th>Heat no.</th><th>Mill</th><th>Grade</th><th>Cert date</th><th>Verdict</th><th>QA</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- Connect Claude ---------- */

export function connectPage() {
  const url = `${config.publicUrl}/mcp?token=${config.mcpToken}`;
  const prompt = `Read the attached mill test certificate and add it to MillProof. The supplier is Vardhan Steel Traders. Tell me the verdict and anything that failed or is missing.`;
  return `<div class="page-head"><div><h1>Connect Claude</h1><div class="meta">Claude reads your certificates. MillProof stores, checks and shares them.</div></div></div>
<div class="grid-2" style="margin-top:0"><section class="card"><div class="card-head"><h2>Add MillProof to Claude</h2></div><div class="card-body">
<ol class="steps">
<li>In Claude, open <b>Settings → Connectors</b> and click <b>Add custom connector</b>.</li>
<li>Name it <b>MillProof</b> and paste this URL:
<div class="copy" style="margin-top:8px"><input class="input" id="mcp-url" value="${esc(url)}" readonly><button class="btn" data-copy="mcp-url">Copy</button></div>
<div class="small muted" style="margin-top:6px">The token in the link is your access key. Treat it like a password.</div></li>
<li>Click <b>Add</b>. In a new chat, open the tools menu and make sure MillProof is switched on.</li>
<li>Attach an MTC (PDF or photo) and ask:<pre class="prompt">${esc(prompt)}</pre></li>
</ol></div></section>
<section class="card"><div class="card-head"><h2>What Claude can do here</h2></div><table class="kv"><tbody>
<tr><td class="mono">create_certificate</td><td>Store a certificate Claude has read and check it</td></tr>
<tr><td class="mono">list_certificates</td><td>Find records by supplier, verdict or QA status</td></tr>
<tr><td class="mono">get_certificate</td><td>Full record by id or heat number</td></tr>
<tr><td class="mono">update_certificate_field</td><td>Correct one value; the check re-runs</td></tr>
<tr><td class="mono">supplier_scorecard</td><td>A supplier's pass rate and history</td></tr>
</tbody></table><div class="card-body small muted">No AI runs inside MillProof. Claude, on your own Claude plan, reads the document; MillProof applies fixed rules from its spec table.</div></section></div>
<section class="card" style="margin-top:20px"><div class="card-head"><h2>Demo data</h2><span class="small muted">Wipes every record and reloads the 6 samples</span></div>
<div class="card-body"><form method="post" action="/admin/reset-demo" onsubmit="return confirm('Delete all certificates and reload the 6 samples?')"><button class="btn reject" type="submit">Reset demo data</button></form></div></section>
<script>document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{const t=document.getElementById(b.dataset.copy);try{await navigator.clipboard.writeText(t.value);b.textContent="Copied";}catch{t.select();}setTimeout(()=>b.textContent="Copy",1500);}));</script>`;
}

export function notFoundPage(user: string | null, what = "Page") {
  const body = `<div class="card"><div class="empty"><h2 style="color:var(--ink)">${esc(what)} not found</h2><p>It may have been removed, or the link is wrong.</p><a class="btn" href="/">Back to certificates</a></div></div>`;
  return user ? layout("Not found", body, { user }) : `${head("Not found")}<body><main class="wrap" style="padding-top:60px">${body}</main></body></html>`;
}

export { recordUrl };
