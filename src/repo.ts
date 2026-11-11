// Certificate storage and every state change (create, edit, approve, reject), each written to the audit trail.

import { randomBytes } from "node:crypto";
import { getDb, Db } from "./db.js";
import { CertData, getValue, labelFor, parseFieldValue, setValue } from "./fields.js";
import { checkCertificate, CheckResult, Verdict } from "./checker.js";
import { resolveSpec, supportedGradesText } from "./specs.js";

export type Status = "pending" | "approved" | "rejected";
export interface Decision {
  by: string;
  at: string;
  note: string | null;
}
export interface Certificate {
  id: string;
  share_token: string;
  data: CertData;
  check: CheckResult;
  status: Status;
  decision: Decision | null;
  source: string;
  created_at: string;
  updated_at: string;
}
export interface AuditEvent {
  id: number;
  cert_id: string;
  at: string;
  actor: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newId(): string {
  const b = randomBytes(6);
  return "MTC-" + Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}
const newShareToken = () => randomBytes(15).toString("base64url");
export const keyOf = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const now = () => new Date().toISOString();
const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

interface Row {
  id: string;
  share_token: string;
  status: Status;
  source: string;
  data: string;
  check_json: string;
  decision_json: string | null;
  created_at: string;
  updated_at: string;
}
const fromRow = (r: Row): Certificate => ({
  id: r.id,
  share_token: r.share_token,
  data: JSON.parse(r.data),
  check: JSON.parse(r.check_json),
  status: r.status,
  decision: r.decision_json ? JSON.parse(r.decision_json) : null,
  source: r.source,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

async function findDuplicates(db: Db, d: CertData, excludeId: string | null) {
  const rows = await db.all<Row>("SELECT * FROM certificates WHERE heat_key = ?", [keyOf(d.heat_number)]);
  const keys = ["C", "Mn", "Si", "S", "P"] as const;
  return rows
    .filter((r) => r.id !== excludeId)
    .map(fromRow)
    .filter((c) => !d.mill_name || !c.data.mill_name || keyOf(c.data.mill_name) === keyOf(d.mill_name))
    .map((c) => ({ id: c.id, sameChemistry: keys.every((k) => (c.data.chemistry[k] ?? null) === (d.chemistry[k] ?? null)) }));
}

async function addEvent(db: Db, e: Omit<AuditEvent, "id" | "at"> & { at?: string }) {
  await db.run(
    "INSERT INTO events (cert_id, at, actor, action, field, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [e.cert_id, e.at ?? now(), e.actor, e.action, e.field, e.old_value, e.new_value, e.note],
  );
}

async function save(db: Db, c: Certificate, insert: boolean) {
  const cols = [
    c.data.supplier, keyOf(c.data.supplier), c.data.heat_number, keyOf(c.data.heat_number), c.check.specId, c.check.verdict,
    c.status, c.source, JSON.stringify(c.data), JSON.stringify(c.check), c.decision ? JSON.stringify(c.decision) : null, c.updated_at,
  ];
  if (insert) {
    await db.run(
      `INSERT INTO certificates (supplier, supplier_key, heat_number, heat_key, spec_id, verdict, status, source, data, check_json, decision_json, updated_at, id, share_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...cols, c.id, c.share_token, c.created_at],
    );
  } else {
    await db.run(
      `UPDATE certificates SET supplier = ?, supplier_key = ?, heat_number = ?, heat_key = ?, spec_id = ?, verdict = ?, status = ?, source = ?,
       data = ?, check_json = ?, decision_json = ?, updated_at = ? WHERE id = ?`,
      [...cols, c.id],
    );
  }
}

/** Normalise loose input into a CertData, validating each value with the same rules as the editor. */
export function normaliseInput(input: Record<string, unknown>): CertData {
  const d: CertData = {
    supplier: "", mill_name: null, heat_number: "", standard: "", grade: "", certificate_no: null, cert_date: null,
    product: null, thickness_mm: null, elongation_gauge: null, chemistry: {}, mechanical: {},
  };
  const top = ["supplier", "mill_name", "heat_number", "standard", "grade", "certificate_no", "cert_date", "product", "thickness_mm", "elongation_gauge"];
  for (const k of top) setValue(d, k, parseFieldValue(k, input[k]));
  const chem = (input.chemistry ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(chem)) setValue(d, `chemistry.${k}`, parseFieldValue(`chemistry.${k}`, v));
  const mech = (input.mechanical ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(mech)) setValue(d, `mechanical.${k}`, parseFieldValue(`mechanical.${k}`, v));
  if (!resolveSpec(d.standard, d.grade)) {
    throw new Error(`MillProof has no spec for standard "${d.standard}", grade "${d.grade}". Supported: ${supportedGradesText()}.`);
  }
  return d;
}

export async function createCertificate(input: Record<string, unknown>, source: string, actor: string, opts: { createdAt?: string } = {}): Promise<Certificate> {
  const db = await getDb();
  const data = normaliseInput(input);
  const dups = await findDuplicates(db, data, null);
  const ts = opts.createdAt ?? now();
  const cert: Certificate = {
    id: newId(), share_token: newShareToken(), data, check: checkCertificate(data, dups),
    status: "pending", decision: null, source, created_at: ts, updated_at: ts,
  };
  await db.tx(async (t) => {
    await save(t, cert, true);
    await addEvent(t, {
      cert_id: cert.id, at: ts, actor, action: "created", field: null, old_value: null, new_value: null,
      note: `Checked against ${cert.check.specLabel}: ${cert.check.verdict} (${cert.check.counts.pass} pass, ${cert.check.counts.fail} fail, ${cert.check.counts.missing} missing).`,
    });
  });
  return cert;
}

export async function getCertificate(idOrHeat: string): Promise<Certificate | null> {
  const db = await getDb();
  const id = idOrHeat.trim();
  let row = await db.get<Row>("SELECT * FROM certificates WHERE id = ?", [id.toUpperCase()]);
  if (!row) row = await db.get<Row>("SELECT * FROM certificates WHERE heat_key = ? ORDER BY created_at DESC", [keyOf(id)]);
  return row ? fromRow(row) : null;
}

export async function getByShareToken(token: string): Promise<Certificate | null> {
  const db = await getDb();
  const row = await db.get<Row>("SELECT * FROM certificates WHERE share_token = ?", [token]);
  return row ? fromRow(row) : null;
}

export interface ListFilter {
  supplier?: string;
  verdict?: Verdict;
  status?: Status;
  q?: string;
  limit?: number;
}
export async function listCertificates(f: ListFilter = {}): Promise<Certificate[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.supplier) { where.push("supplier_key LIKE ?"); params.push(`%${keyOf(f.supplier)}%`); }
  if (f.verdict) { where.push("verdict = ?"); params.push(f.verdict); }
  if (f.status) { where.push("status = ?"); params.push(f.status); }
  if (f.q) { where.push("(heat_key LIKE ? OR supplier_key LIKE ? OR id LIKE ?)"); params.push(`%${keyOf(f.q)}%`, `%${keyOf(f.q)}%`, `%${f.q.toUpperCase()}%`); }
  const sql = `SELECT * FROM certificates ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${Math.min(Math.max(f.limit ?? 200, 1), 500)}`;
  return (await db.all<Row>(sql, params)).map(fromRow);
}

export async function getEvents(certId: string): Promise<AuditEvent[]> {
  const db = await getDb();
  return db.all<AuditEvent>("SELECT * FROM events WHERE cert_id = ? ORDER BY id DESC", [certId]);
}

/** Change one field, re-run the check, record the change. Resets an earlier approve/reject decision. */
export async function updateField(id: string, path: string, raw: unknown, actor: string, note?: string | null): Promise<{ cert: Certificate; changed: boolean; before: Verdict }> {
  const db = await getDb();
  const cert = await getCertificate(id);
  if (!cert) throw new Error(`Certificate ${id} not found.`);
  const value = parseFieldValue(path, raw);
  const oldValue = getValue(cert.data, path);
  const before = cert.check.verdict;
  if (show(oldValue) === show(value)) return { cert, changed: false, before };

  const data: CertData = JSON.parse(JSON.stringify(cert.data));
  setValue(data, path, value);
  if ((path === "standard" || path === "grade") && !resolveSpec(data.standard, data.grade)) {
    throw new Error(`No spec for standard "${data.standard}", grade "${data.grade}". Supported: ${supportedGradesText()}.`);
  }
  const dups = await findDuplicates(db, data, cert.id);
  const updated: Certificate = { ...cert, data, check: checkCertificate(data, dups), updated_at: now() };
  const hadDecision = cert.status !== "pending";
  if (hadDecision) { updated.status = "pending"; updated.decision = null; }

  await db.tx(async (t) => {
    await save(t, updated, false);
    await addEvent(t, {
      cert_id: id, actor, action: "field_updated", field: path, old_value: show(oldValue), new_value: show(value),
      note: [note, before !== updated.check.verdict ? `Verdict ${before} → ${updated.check.verdict}.` : `Verdict stays ${updated.check.verdict}.`].filter(Boolean).join(" "),
    });
    if (hadDecision) {
      await addEvent(t, { cert_id: id, actor: "MillProof", action: "decision_reset", field: null, old_value: cert.status, new_value: "pending", note: `${labelFor(path)} changed after the batch was ${cert.status}; it needs a fresh decision.` });
    }
  });
  return { cert: updated, changed: true, before };
}

export async function decide(id: string, decision: "approved" | "rejected", actor: string, note?: string | null, opts: { at?: string } = {}): Promise<Certificate> {
  const db = await getDb();
  const cert = await getCertificate(id);
  if (!cert) throw new Error(`Certificate ${id} not found.`);
  if (decision === "approved" && cert.check.verdict !== "PASS") {
    throw new Error(`Only certificates with a PASS verdict can be approved. This one is ${cert.check.verdict}: fix the values or reject the batch.`);
  }
  const at = opts.at ?? now();
  const updated: Certificate = { ...cert, status: decision, decision: { by: actor, at, note: note?.trim() || null }, updated_at: at };
  await db.tx(async (t) => {
    await save(t, updated, false);
    await addEvent(t, { cert_id: id, at, actor, action: decision, field: null, old_value: cert.status, new_value: decision, note: note?.trim() || null });
  });
  return updated;
}

export interface Scorecard {
  supplier: string;
  key: string;
  total: number;
  pass: number;
  fail: number;
  incomplete: number;
  approved: number;
  rejected: number;
  pending: number;
  passRate: number; // 0..1, PASS verdicts / total
  topFailures: { field: string; label: string; count: number }[];
  lastCertificateAt: string | null;
  certificates: Certificate[];
}

function buildScorecard(certs: Certificate[]): Scorecard {
  const failures = new Map<string, { label: string; count: number }>();
  for (const c of certs) {
    for (const r of c.check.results) {
      if (r.status === "fail") {
        const f = failures.get(r.field) ?? { label: r.label, count: 0 };
        f.count++;
        failures.set(r.field, f);
      }
    }
  }
  const count = (fn: (c: Certificate) => boolean) => certs.filter(fn).length;
  const total = certs.length;
  const pass = count((c) => c.check.verdict === "PASS");
  return {
    supplier: certs[0]?.data.supplier ?? "",
    key: keyOf(certs[0]?.data.supplier),
    total,
    pass,
    fail: count((c) => c.check.verdict === "FAIL"),
    incomplete: count((c) => c.check.verdict === "INCOMPLETE"),
    approved: count((c) => c.status === "approved"),
    rejected: count((c) => c.status === "rejected"),
    pending: count((c) => c.status === "pending"),
    passRate: total ? pass / total : 0,
    topFailures: [...failures.entries()].map(([field, v]) => ({ field, ...v })).sort((a, b) => b.count - a.count).slice(0, 5),
    lastCertificateAt: certs.map((c) => c.created_at).sort().at(-1) ?? null,
    certificates: certs,
  };
}

export async function allScorecards(): Promise<Scorecard[]> {
  const certs = await listCertificates({ limit: 500 });
  const groups = new Map<string, Certificate[]>();
  for (const c of certs) {
    const k = keyOf(c.data.supplier);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.values()].map(buildScorecard).sort((a, b) => b.total - a.total || a.supplier.localeCompare(b.supplier));
}

export async function supplierScorecard(name: string): Promise<Scorecard | null> {
  const k = keyOf(name);
  if (!k) return null;
  const cards = await allScorecards();
  return cards.find((c) => c.key === k) ?? cards.find((c) => c.key.includes(k) || k.includes(c.key)) ?? null;
}

/** Permanently delete a record and its audit trail. Returns false if it did not exist. */
export async function deleteCertificate(id: string): Promise<boolean> {
  const db = await getDb();
  const found = await db.get<{ id: string }>("SELECT id FROM certificates WHERE id = ?", [id]);
  if (!found) return false;
  await db.tx(async (t) => {
    await t.run("DELETE FROM events WHERE cert_id = ?", [id]);
    await t.run("DELETE FROM certificates WHERE id = ?", [id]);
  });
  return true;
}

export async function countCertificates(): Promise<number> {
  const db = await getDb();
  const r = await db.get<{ n: number | string }>("SELECT COUNT(*) AS n FROM certificates");
  return Number(r?.n ?? 0);
}

export async function resetAll(): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM events");
  await db.run("DELETE FROM certificates");
}
