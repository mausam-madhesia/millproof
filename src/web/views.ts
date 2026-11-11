// Server-rendered HTML. No front-end framework: template strings plus one small script for inline editing.

import { Certificate, AuditEvent, Scorecard, Status, paymentStatus } from "../repo.js";
import { FieldResult, CheckResult } from "../checker.js";
import { CHEM_ELEMENTS, GAUGES, IDENTITY_FIELDS, IDENTITY_LABELS, MECH_FIELDS, getValue, labelFor } from "../fields.js";
import { config, recordUrl, shareUrl } from "../config.js";
import { EDITION_WARNING, SPECS } from "../specs.js";
import { displayName } from "../auth.js";

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
  `<span class="badge ${s}${lg ? " lg" : ""}">${s === "pending" ? "QA pending" : s === "approved" ? "Approved" : s === "rejected" ? "Rejected" : "Deleted"}</span>`;
const PAY_CLASS: Record<string, string> = { approved: "pay-cleared", rejected: "pay-hold", pending: "pay-wait", deleted: "pay-void" };
export const paymentBadge = (s: string) => `<span class="badge ${PAY_CLASS[s] ?? "pay-wait"}">${paymentStatus(s as Status)}</span>`;
const FIELD_TEXT: Record<string, string> = { pass: "Pass", fail: "Fail", missing: "Missing", review: "Review" };
const fieldBadge = (s: string) => (s === "info" ? `<span class="small muted">Recorded</span>` : `<span class="badge ${s}">${FIELD_TEXT[s] ?? esc(s)}</span>`);
const countsText = (k: { pass: number; fail: number; missing: number; review?: number }) =>
  `${k.pass} pass, ${k.fail} fail, ${k.missing} missing${k.review ? `, ${k.review} to review` : ""}`;
const sourceTag = (c: Certificate) => (c.source === "claude" ? `<span class="src-tag">via Claude</span>` : c.source === "seed" ? `<span class="src-tag" style="background:#f1f5f9;color:#475569">sample</span>` : "");

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`;

function head(title: string, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · MillProof</title>${FONTS}<link rel="stylesheet" href="/static/app.css"><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO.replace('width="26" height="26" ', ""))}">${extra}</head>`;
}

export function layout(title: string, body: string, opts: { user: string; active?: string; scripts?: string[] }) {
  const nav = [["/", "Certificates", "certs"], ["/suppliers", "Suppliers", "suppliers"], ["/finance", "Finance", "finance"], ["/connect", "Connect Claude", "connect"]]
    .map(([href, label, key]) => `<a href="${href}" class="${opts.active === key ? "active" : ""}">${label}</a>`)
    .join("");
  return `${head(title)}<body>
<header class="topbar"><div class="wrap"><a class="brand" href="/">${LOGO} MillProof</a><nav class="nav">${nav}</nav>
<div class="who"><span>${esc(displayName(opts.user))}</span><a href="/logout">Log out</a></div></div></header>
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
<select class="input" name="status" onchange="this.form.submit()">${opt("", "Any QA status", f.status)}${opt("pending", "QA pending", f.status)}${opt("approved", "Approved", f.status)}${opt("rejected", "Rejected", f.status)}</select>
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
<td>${paymentBadge(c.status)}</td>
<td class="small muted">${fmtDateTime(c.created_at)}<div>${sourceTag(c)}</div></td></tr>`,
    )
    .join("");

  return `<div class="page-head"><div><h1>Certificates</h1><div class="meta">Every mill test certificate Claude has sent in, checked against the spec table.</div></div>
<a class="btn primary" href="/connect">+ Add from Claude</a></div>
${tiles}
<div class="card">${filters}
${shown.length ? `<table><thead><tr><th>Heat no.</th><th>Supplier / mill</th><th>Grade</th><th>Cert date</th><th>Verdict</th><th>QA</th><th>Payment</th><th>Received</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No certificates match. Ask Claude to read an MTC and it will appear here.</div>`}
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
</div><div class="verdict-box">${verdictBadge(ck.verdict, true)}<div class="btn-row" style="justify-content:flex-end;gap:6px">${statusBadge(c.status)}${paymentBadge(c.status)}</div>
<div class="counts"><span><b>${ck.counts.pass}</b> pass</span><span><b>${ck.counts.fail}</b> fail</span><span><b>${ck.counts.missing}</b> missing</span>${ck.counts.review ? `<span><b>${ck.counts.review}</b> to review</span>` : ""}</div></div></div>`;
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
  const pay = paymentStatus(c.status);
  const payLine =
    c.status === "rejected"
      ? `<div class="pay-box hold"><div><b>Payment on hold.</b> A debit-note draft for the supplier is ready.</div><div class="btn-row" style="margin-top:8px"><a class="btn" href="/certificates/${c.id}/debit-note" target="_blank" rel="noopener">View debit note</a><a class="btn" href="/certificates/${c.id}/debit-note?download=1">Download</a></div></div>`
      : c.status === "approved"
        ? `<div class="pay-box cleared"><b>Cleared for payment.</b> This batch shows as cleared in the finance export.</div>`
        : `<div class="pay-box"><b>${pay}.</b> Approve to clear payment; reject to put it on hold and draft a debit note.</div>`;
  return `<section class="card" id="frag-decision"><div class="card-head"><h2>QA decision &amp; payment</h2>${c.decision ? "" : `<span class="small muted">Batch awaiting review</span>`}</div>
<div class="card-body">${decided}${payLine}
<textarea id="decision-note" class="note" style="margin-top:12px" placeholder="Reason for the decision (kept on the audit trail), e.g. 'Matches bundle tags, 12 plates'"></textarea>
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
  created: "Record created", field_updated: "Value changed", approved: "Approved batch", rejected: "Rejected batch",
  decision_reset: "Decision reset", rechecked: "Re-checked against spec table", deleted: "Record deleted",
};

/** Role shown on the public page instead of a person's name or email. */
export function roleOf(actor: string): string {
  if (/claude/i.test(actor)) return "Claude (via MCP)";
  if (actor === "MillProof") return "MillProof (automatic)";
  if (actor === "Sample data") return "Sample data";
  if (actor === "Admin") return "Admin";
  return "QA engineer";
}

function auditRows(events: AuditEvent[], publicView: boolean) {
  return events
    .map((e) => {
      const what = ACTION_TEXT[e.action] ?? esc(e.action);
      const fieldTxt = e.action === "field_updated" ? esc(labelFor(e.field ?? "")) : e.action === "rechecked" ? "Verdict" : e.action === "approved" || e.action === "rejected" || e.action === "decision_reset" || e.action === "deleted" ? "QA status" : "—";
      const change =
        e.action === "created" || (e.old_value == null && e.new_value == null)
          ? `<span class="muted">—</span>`
          : `<span class="diff"><s>${esc(e.old_value ?? "blank")}</s> → <ins>${esc(e.new_value ?? "blank")}</ins></span>`;
      const who = publicView ? roleOf(e.actor) : e.actor;
      const reason = e.reason ? `“${esc(e.reason)}”` : `<span class="muted">—</span>`;
      return `<tr><td class="small nowrap">${fmtDateTime(e.at)}</td><td class="small">${esc(who)}</td><td><b>${what}</b>${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ""}</td><td class="small">${fieldTxt}</td><td>${change}</td><td class="small">${reason}</td></tr>`;
    })
    .join("");
}
const auditTable = (events: AuditEvent[], publicView: boolean) =>
  `<div style="overflow-x:auto"><table class="audit-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Field</th><th>Old → new</th><th>Reason</th></tr></thead><tbody>${auditRows(events, publicView)}</tbody></table></div>`;

export function auditFragment(events: AuditEvent[]) {
  return `<section class="card" id="frag-audit"><div class="card-head"><h2>Audit trail</h2><span class="small muted">${events.length} event${events.length === 1 ? "" : "s"} · newest first</span></div>${auditTable(events, false)}</section>`;
}

export function recordPage(c: Certificate, events: AuditEvent[], admin = false) {
  const idRows = IDENTITY_FIELDS.map((f) => {
    const kind = f === "thickness_mm" ? "num" : f === "elongation_gauge" ? "gauge" : "text";
    return `<tr><td>${IDENTITY_LABELS[f]}</td><td>${inputFor(c, f, kind)}</td></tr>`;
  }).join("");
  const spec = SPECS.find((s) => s.id === c.check.specId);
  if (c.status === "deleted") {
    return `<div class="flags" style="border-color:#f1b8b2;background:var(--fail-bg)"><h3 style="color:var(--fail)">Deleted record</h3>This record was deleted by ${esc(c.decision?.by ?? "an admin")} on ${c.decision ? fmtDateTime(c.decision.at) : "—"}${c.decision?.note ? ` (“${esc(c.decision.note)}”)` : ""}. It no longer appears in lists, scorecards or the finance export. Only admins can see this page.</div>
${headFragment(c)}${auditFragment(events)}`;
  }
  return `<div data-cert-id="${c.id}">
${headFragment(c)}
${flagsFragment(c)}
<div class="grid-2" style="margin-top:0">
<section class="card"><div class="card-head"><h2>Certificate details</h2><span class="small muted">Click any value to correct it. The check re-runs on save.</span></div>
<div class="card-body" style="padding-bottom:4px"><label class="small muted" for="edit-reason">Reason for corrections (saved with each change on the audit trail)</label>
<input class="input" id="edit-reason" style="width:100%;margin-top:6px" placeholder="e.g. Lab retest report LR-118"></div>
<table class="kv"><tbody>${idRows}</tbody></table></section>
${decisionFragment(c)}
</div>
<section class="card" style="margin-top:20px"><div class="card-head"><h2>Chemical composition <span class="muted" style="font-weight:400">· heat analysis, wt %</span></h2><span class="small muted">${esc(spec?.standard ?? "")}</span></div>
${resultsTable(c, "chemistry.", true)}</section>
<section class="card"><div class="card-head"><h2>Mechanical properties</h2>${spec?.note ? `<span class="small muted" style="max-width:60%;text-align:right">${esc(spec.note)}</span>` : ""}</div>
${resultsTable(c, "mechanical.", true)}</section>
${auditFragment(events)}
${admin ? `<section class="card" style="border-color:#f1b8b2"><div class="card-head"><h2>Delete record</h2><span class="small muted">Admin only</span></div>
<div class="card-body"><p style="margin:0 0 12px">Removes this certificate from every list, scorecard and the finance export. The audit trail is kept and records who deleted it and why. Use it for test data, not to hide a failed batch.</p>
<form method="post" action="/certificates/${c.id}/delete" onsubmit="return confirm('Delete heat ${esc(c.data.heat_number)} (${c.id})? It will disappear from all lists and exports.')">
<input class="input" name="reason" placeholder="Reason, e.g. test data" style="width:100%;margin-bottom:10px" required>
<button class="btn reject" type="submit">Delete record</button></form></div></section>` : ""}
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

export function sharePage(c: Certificate, events: AuditEvent[]) {
  const ck: CheckResult = c.check;
  const v = ck.verdict.toLowerCase();
  const editCount = events.filter((e) => e.action === "field_updated").length;
  const qa = c.status === "deleted"
    ? `Withdrawn by the buyer on ${c.decision ? fmtDate(c.decision.at) : "—"}`
    : c.decision
      ? `${c.status === "approved" ? "Accepted" : "Rejected"} by the buyer's QA on ${fmtDate(c.decision.at)}`
      : "Awaiting the buyer's QA decision";
  const id = (label: string, val: unknown) => `<tr><td>${label}</td><td>${val === null || val === undefined || val === "" ? `<span class="muted">—</span>` : esc(val)}</td></tr>`;
  return `${head(`Heat ${c.data.heat_number} verification`, '<meta name="robots" content="noindex">')}<body>
<header class="public-top"><div class="wrap"><a class="brand" href="/">${LOGO} MillProof</a><span class="tag">Mill test certificate verification</span></div></header>
<main class="wrap" style="max-width:960px">
${c.status === "deleted" ? `<div class="flags" style="border-color:#f1b8b2;background:var(--fail-bg)"><h3 style="color:var(--fail)">Record withdrawn</h3>The buyer deleted this record. The values and change history below are kept for reference only.</div>` : ""}
<div class="card" style="overflow:hidden"><div class="seal ${v}"><div><div class="small muted">Rule check against ${esc(ck.specLabel)}</div><div class="big">${ck.verdict}</div></div>
<div style="margin-left:auto;text-align:right">${statusBadge(c.status, true)}<div class="small muted" style="margin-top:6px">${esc(qa)}</div></div></div>
<table class="kv"><tbody>
${id("Heat number", c.data.heat_number)}${id("Supplier", c.data.supplier)}${id("Mill", c.data.mill_name)}${id("Standard / grade", `${c.data.standard} · ${c.data.grade}`)}
${id("Certificate no. / date", [c.data.certificate_no, c.data.cert_date ? fmtDate(c.data.cert_date) : null].filter(Boolean).join(" · "))}${id("Product", c.data.product)}
${id("Result", countsText(ck.counts))}
${id("Record", `${c.id} · last checked ${fmtDateTime(ck.checkedAt)} · ${editCount} correction${editCount === 1 ? "" : "s"} in the change history`)}
</tbody></table></div>
${ck.flags.length ? `<div class="flags" style="margin-top:20px"><h3>Red flags</h3><ul>${ck.flags.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul></div>` : ""}
<section class="card" style="margin-top:20px"><div class="card-head"><h2>Chemical composition · wt %</h2></div>${resultsTable(c, "chemistry.", false)}</section>
<section class="card"><div class="card-head"><h2>Mechanical properties</h2></div>${resultsTable(c, "mechanical.", false)}</section>
<section class="card"><div class="card-head"><h2>Change history</h2><span class="small muted">Read-only · roles shown, not names</span></div>${auditTable(events, true)}</section>
<p class="footer-note">This page shows the values printed on the mill test certificate, as recorded by the buyer, checked with fixed rules from MillProof's spec table. It is not a substitute for independent testing. Limits marked “verify” are pending confirmation against the licensed standard.</p>
</main></body></html>`;
}

/* ---------- Debit note (draft) ---------- */

export function debitNotePage(c: Certificate, forDownload = false) {
  const bad = c.check.results.filter((r) => r.status === "fail" || r.status === "missing" || r.status === "review");
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const rows = bad
    .map((r) => `<tr><td>${esc(r.label)}</td><td class="mono">${r.value ?? "not reported"}</td><td class="mono">${esc(r.limitText)}</td><td>${r.status === "fail" ? "Outside limit" : r.status === "missing" ? "Not reported" : "Needs review"}</td><td class="src">${esc(r.source ?? "")}${r.verify ? " (limit pending verification)" : ""}</td></tr>`)
    .join("");
  const flags = c.check.flags.length ? `<p><b>Also noted:</b></p><ul>${c.check.flags.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul>` : "";
  return `${head(`Debit note draft · ${c.data.heat_number}`, '<meta name="robots" content="noindex"><style>@media print{.no-print{display:none}body{background:#fff}.dn{border:0;box-shadow:none}}.dn{max-width:860px;margin:24px auto;background:#fff;border:1px solid var(--line);border-radius:10px;padding:40px}.dn h1{font-size:24px}.dn table td,.dn table th{padding:8px 10px}.draft{display:inline-block;border:2px solid var(--accent);color:var(--accent);font-weight:700;padding:2px 10px;border-radius:6px;letter-spacing:.08em}.blank{border-bottom:1px solid #999;display:inline-block;min-width:160px}</style>')}<body>
${forDownload ? "" : `<div class="no-print" style="text-align:center;padding:16px"><button class="btn primary" onclick="window.print()">Print / Save as PDF</button> <a class="btn" href="/certificates/${c.id}/debit-note?download=1">Download</a> <a class="btn" href="/certificates/${c.id}">Back to record</a></div>`}
<div class="dn">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px"><div><span class="draft">DRAFT</span><h1 style="margin-top:12px">Debit note</h1><div class="muted">Ref. DN-${c.id} · ${today}</div></div><div style="text-align:right" class="small muted">Generated by MillProof from the QA rejection.<br>Review and complete before sending.</div></div>
<hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
<table class="kv"><tbody>
<tr><td>To (supplier)</td><td><b>${esc(c.data.supplier)}</b></td></tr>
<tr><td>Mill</td><td>${esc(c.data.mill_name ?? "—")}</td></tr>
<tr><td>Mill test certificate no.</td><td>${esc(c.data.certificate_no ?? "—")}${c.data.cert_date ? ` dated ${fmtDate(c.data.cert_date)}` : ""}</td></tr>
<tr><td>Heat number</td><td class="mono">${esc(c.data.heat_number)}</td></tr>
<tr><td>Grade / standard</td><td>${esc(c.check.specLabel)} · ${esc(c.data.standard)}</td></tr>
<tr><td>Product</td><td>${esc(c.data.product ?? "—")}</td></tr>
</tbody></table>
<p style="margin-top:24px">The material supplied under the certificate above was <b>rejected</b> on inspection${c.decision ? ` on ${fmtDate(c.decision.at)}` : ""}. Payment against this batch is <b>on hold</b>. The following values do not meet ${esc(c.check.specLabel)}:</p>
<table><thead><tr><th>Property</th><th>Reported</th><th>Limit</th><th>Finding</th><th>Spec clause</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted">No failing values recorded; see the QA reason below.</td></tr>`}</tbody></table>
${flags}
${c.decision?.note ? `<p><b>QA reason:</b> “${esc(c.decision.note)}”</p>` : ""}
<p style="margin-top:20px">We request a credit note or replacement material for this batch.</p>
<table class="kv"><tbody>
<tr><td>Quantity</td><td><span class="blank">&nbsp;</span></td></tr>
<tr><td>Amount (₹, excl. GST)</td><td><span class="blank">&nbsp;</span></td></tr>
<tr><td>GST</td><td><span class="blank">&nbsp;</span></td></tr>
<tr><td>Purchase order / invoice ref.</td><td><span class="blank">&nbsp;</span></td></tr>
</tbody></table>
<p class="small muted" style="margin-top:28px">Verification record: ${esc(shareUrl(c.share_token))}</p>
</div></body></html>`;
}

/* ---------- Finance ---------- */

export function financePage(certs: Certificate[]) {
  const n = (s: string) => certs.filter((c) => c.status === s).length;
  const rows = certs
    .map((c) => `<tr class="link-row" onclick="location.href='/certificates/${c.id}'"><td>${esc(c.data.supplier)}</td><td class="small">${esc(c.data.certificate_no ?? "—")}</td><td class="mono nowrap"><a href="/certificates/${c.id}">${esc(c.data.heat_number)}</a></td><td class="small">${esc(c.check.specLabel)}</td><td>${verdictBadge(c.check.verdict)}</td><td>${statusBadge(c.status)}</td><td>${paymentBadge(c.status)}${c.status === "rejected" ? ` <a class="small" href="/certificates/${c.id}/debit-note" onclick="event.stopPropagation()">debit note</a>` : ""}</td><td class="small">${esc(c.decision?.by ?? "—")}</td><td class="small nowrap">${c.decision ? fmtDate(c.decision.at) : "—"}</td></tr>`)
    .join("");
  return `<div class="page-head"><div><h1>Finance export</h1><div class="meta">Payment status follows the QA decision: approved → cleared for payment, rejected → on hold with a debit-note draft.</div></div>
<a class="btn primary" href="/finance/export.csv">Download CSV</a></div>
<div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile pass"><div class="k">Cleared for payment</div><div class="v">${n("approved")}</div></div><div class="tile fail"><div class="k">Payment on hold</div><div class="v">${n("rejected")}</div></div><div class="tile"><div class="k">Awaiting QA</div><div class="v">${n("pending")}</div></div></div>
<div class="card" style="overflow-x:auto">${certs.length ? `<table><thead><tr><th>Supplier</th><th>Cert no.</th><th>Heat</th><th>Grade</th><th>Verdict</th><th>QA</th><th>Payment</th><th>Decided by</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No certificates yet.</div>`}</div>`;
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function financeCsv(certs: Certificate[]): string {
  const header = ["supplier", "certificate_no", "heat_number", "grade", "verdict", "qa_status", "payment_status", "decided_by", "decision_date", "record_id"];
  const lines = certs.map((c) =>
    [c.data.supplier, c.data.certificate_no, c.data.heat_number, c.check.specLabel, c.check.verdict, c.status, paymentStatus(c.status), c.decision?.by ?? "", c.decision ? c.decision.at.slice(0, 10) : "", c.id].map(csvCell).join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
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

export function connectPage(admin = false) {
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
${admin ? `<section class="card" style="margin-top:20px"><div class="card-head"><h2>Demo data</h2><span class="small muted">Wipes every record and reloads the 7 samples</span></div>
<div class="card-body"><form method="post" action="/admin/reset-demo" onsubmit="return confirm('Delete all certificates and reload the 7 samples?')"><button class="btn reject" type="submit">Reset demo data</button></form></div></section>` : ""}
<script>document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{const t=document.getElementById(b.dataset.copy);try{await navigator.clipboard.writeText(t.value);b.textContent="Copied";}catch{t.select();}setTimeout(()=>b.textContent="Copy",1500);}));</script>`;
}


/* ---------- Public landing page ---------- */

export function landingPage() {
  const mcp = `${config.publicUrl}/mcp?token=…`;
  const step = (n: number, title: string, body: string) => `<div class="lp-step"><div class="lp-num">${n}</div><h3>${title}</h3><p>${body}</p></div>`;
  const plan = (name: string, price: string, per: string, items: string[], cta: string, featured = false) =>
    `<div class="lp-plan${featured ? " featured" : ""}"><div class="lp-plan-name">${name}</div><div class="lp-price">${price}<span>${per}</span></div><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul><a class="btn ${featured ? "primary" : ""}" href="${"/login"}">${cta}</a></div>`;
  return `${head("Stop paying for steel that fails its spec")}<body class="lp">
<header class="lp-top"><div class="wrap lp-bar"><a class="brand" href="/">${LOGO} MillProof</a><nav class="lp-nav"><a href="#how">How it works</a><a href="#connect">Connect Claude</a><a href="#pricing">Pricing</a><a class="btn primary" href="/login">Try the demo</a></nav></div></header>
<section class="lp-hero"><div class="wrap">
<div class="lp-eyebrow">Mill test certificate checks for Indian steel buyers</div>
<h1>Stop paying for steel that fails its spec.</h1>
<p class="lp-sub">Every delivery comes with a mill test certificate. MillProof checks every value on it against IS 2062 or ASTM A36 before your QA team accepts the batch, and before finance pays for it.</p>
<div class="lp-cta"><a class="btn primary lg" href="/login">Try the demo</a><a class="btn lg" href="#connect">Connect to Claude</a></div>
<div class="lp-demo"><span>Demo login</span><code>${esc(config.demoUser)}</code><span>/</span><code>${esc(config.demoPassword)}</code></div>
</div></section>
<section class="lp-section" id="how"><div class="wrap">
<h2>From certificate to payment in three steps</h2>
<div class="lp-steps">
${step(1, "Claude reads the MTC", "Share the certificate PDF or a phone photo with your own Claude. It pulls out the heat number, grade, chemistry and tensile results.")}
${step(2, "MillProof checks every value against the standard", "Fixed, written-down rules (no AI) give pass, fail, missing or review for each value, with the clause it came from, plus red flags such as a reused heat number.")}
${step(3, "QA approves, finance pays", "QA corrects any value and approves or rejects the batch. Approved is cleared for payment; rejected is put on hold with a debit-note draft for the supplier.")}
</div></div></section>
<section class="lp-section alt" id="connect"><div class="wrap lp-two">
<div><h2>Connect to Claude in 3 steps</h2>
<ol class="steps" style="margin-top:20px">
<li>In Claude, open <b>Settings → Connectors</b> and click <b>Add custom connector</b>.</li>
<li>Name it <b>MillProof</b> and paste your MillProof connector URL.</li>
<li>Start a new chat, attach a mill test certificate and ask Claude to add it to MillProof.</li>
</ol></div>
<div class="lp-code-card"><div class="small muted">Your connector URL</div><code class="lp-url">${esc(mcp)}</code>
<p class="small muted" style="margin:10px 0 0">The access token is private to each account. Log in to the demo and open <b>Connect Claude</b> to copy the full URL.</p>
<pre class="prompt">Read this mill test certificate and add it to MillProof. Tell me the verdict and anything that failed or is missing.</pre></div>
</div></section>
<section class="lp-section" id="pricing"><div class="wrap">
<h2>Simple pricing in INR</h2><p class="lp-sub" style="margin-top:6px">No AI charges from us: your own Claude does the reading.</p>
<div class="lp-plans">
${plan("Starter", "₹1,999", "/month", ["1 site", "100 certificates a month", "Share links and supplier scorecards", "Finance export"], "Try the demo")}
${plan("Pro", "₹4,999", "/month", ["3 sites", "Unlimited certificates", "Debit-note drafts", "Priority support"], "Try the demo", true)}
${plan("Enterprise", "Custom", "", ["Unlimited sites", "Custom spec tables", "ERP export", "SSO and audit exports"], "Try the demo")}
</div><p class="small muted" style="margin-top:14px">Prices exclude GST.</p></div></section>
<footer class="lp-foot"><div class="wrap">MillProof · Checks use fixed rules from a published spec table; limits marked “verify” are pending confirmation against the licensed standard. Sample companies in the demo are fictitious.</div></footer>
</body></html>`;
}

export function notFoundPage(user: string | null, what = "Page") {
  const body = `<div class="card"><div class="empty"><h2 style="color:var(--ink)">${esc(what)} not found</h2><p>It may have been removed, or the link is wrong.</p><a class="btn" href="/">Back to certificates</a></div></div>`;
  return user ? layout("Not found", body, { user }) : `${head("Not found")}<body><main class="wrap" style="padding-top:60px">${body}</main></body></html>`;
}

export { recordUrl };
