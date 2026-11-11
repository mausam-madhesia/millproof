// Tests for storage-level behaviour: payment status, startup re-check, no-op updates, delete, reset.
// Uses a throwaway SQLite file, so it never touches real data.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "millproof-test-")), "test.db");
process.env.SQLITE_PATH = dbFile;
delete process.env.DATABASE_URL;

type Repo = typeof import("../repo.js");
let R: Repo;
let getDb: typeof import("../db.js").getDb;
let seedMod: typeof import("../seed.js");

const input = (over: Record<string, unknown> = {}) => ({
  supplier: "Test Supplier", mill_name: "Test Mill", heat_number: `T-${Math.random().toString(36).slice(2, 8)}`,
  standard: "IS 2062:2011", grade: "E250BR", thickness_mm: 16, elongation_gauge: "proportional",
  chemistry: { C: 0.18, Mn: 0.82, Si: 0.21, S: 0.024, P: 0.028, CE: 0.33, Cr: 0.03, Ni: 0.02, Cu: 0.03, Mo: 0.01 },
  mechanical: { yield_strength_mpa: 298, tensile_strength_mpa: 452, elongation_pct: 27 },
  ...over,
});

before(async () => {
  R = await import("../repo.js");
  getDb = (await import("../db.js")).getDb;
  seedMod = await import("../seed.js");
});

describe("Payment status follows the QA decision", () => {
  test("mapping", () => {
    assert.equal(R.paymentStatus("pending"), "Awaiting QA");
    assert.equal(R.paymentStatus("approved"), "Cleared for payment");
    assert.equal(R.paymentStatus("rejected"), "Payment on hold");
    assert.equal(R.paymentStatus("deleted"), "Void (record deleted)");
  });
  test("new → Awaiting QA; approve → Cleared; edit → back to Awaiting QA; reject → On hold", async () => {
    const c = await R.createCertificate(input(), "test", "Tester");
    assert.equal(R.paymentStatus(c.status), "Awaiting QA");
    const a = await R.decide(c.id, "approved", "QA", "ok");
    assert.equal(R.paymentStatus(a.status), "Cleared for payment");
    const { cert: e } = await R.updateField(c.id, "chemistry.S", 0.052, "QA", "Lab retest LR-118");
    assert.equal(R.paymentStatus(e.status), "Awaiting QA");
    const r = await R.decide(c.id, "rejected", "QA", "S above limit");
    assert.equal(R.paymentStatus(r.status), "Payment on hold");
  });
  test("a failing batch cannot be cleared for payment", async () => {
    const c = await R.createCertificate(input({ chemistry: { ...input().chemistry, S: 0.06 } }), "test", "Tester");
    await assert.rejects(() => R.decide(c.id, "approved", "QA"), /Only certificates with a PASS verdict/);
  });
  test("scorecard counts payment statuses", async () => {
    const sc = await R.supplierScorecard("Test Supplier");
    assert.ok(sc);
    assert.equal(sc!.payment.cleared + sc!.payment.onHold + sc!.payment.awaitingQa, sc!.total);
  });
});

describe("Audit trail keeps who, field, old → new and reason", () => {
  test("field edit and decision reasons are stored", async () => {
    const c = await R.createCertificate(input(), "test", "Tester");
    await R.updateField(c.id, "chemistry.S", 0.052, "Demo QA Engineer", "Lab retest LR-118");
    await R.decide(c.id, "rejected", "Demo QA Engineer", "S above 0.045");
    const ev = await R.getEvents(c.id);
    const edit = ev.find((e) => e.action === "field_updated")!;
    assert.deepEqual([edit.actor, edit.field, edit.old_value, edit.new_value, edit.reason], ["Demo QA Engineer", "chemistry.S", "0.024", "0.052", "Lab retest LR-118"]);
    const rej = ev.find((e) => e.action === "rejected")!;
    assert.equal(rej.reason, "S above 0.045");
    assert.match(rej.note ?? "", /Payment on hold/);
  });
});

describe("Update with an unchanged value still returns fresh results", () => {
  test("stale stored check is replaced by a fresh one", async () => {
    const c = await R.createCertificate(input(), "test", "Tester");
    const db = await getDb();
    const stale = { ...c.check, verdict: "FAIL", counts: { ...c.check.counts, fail: 9 } };
    await db.run("UPDATE certificates SET check_json = ?, verdict = ? WHERE id = ?", [JSON.stringify(stale), "FAIL", c.id]);
    const { cert, changed } = await R.updateField(c.id, "chemistry.S", 0.024, "QA");
    assert.equal(changed, false);
    assert.equal(cert.check.verdict, "PASS");
    assert.equal((await R.getCertificate(c.id))!.check.verdict, "PASS", "fresh result is saved");
    assert.equal((await R.getEvents(c.id)).filter((e) => e.action === "field_updated").length, 0, "no audit entry for a no-op");
  });
});

describe("Startup re-check", () => {
  test("re-checks every record, fixes stale results, logs verdict changes, withdraws invalid approvals", async () => {
    const c = await R.createCertificate(input(), "test", "Tester");
    await R.decide(c.id, "approved", "QA", "ok");
    const db = await getDb();
    // Simulate a record checked under an older spec table: stored as PASS although the data now fails.
    const data = { ...c.data, chemistry: { ...c.data.chemistry, S: 0.06 } };
    await db.run("UPDATE certificates SET data = ? WHERE id = ?", [JSON.stringify(data), c.id]);
    const out = await R.recheckAll();
    assert.ok(out.checked >= 1 && out.updated >= 1 && out.verdictChanged >= 1 && out.decisionsReset >= 1);
    const after = (await R.getCertificate(c.id))!;
    assert.equal(after.check.verdict, "FAIL");
    assert.equal(after.status, "pending");
    assert.equal(R.paymentStatus(after.status), "Awaiting QA");
    const actions = (await R.getEvents(c.id)).map((e) => e.action);
    assert.ok(actions.includes("rechecked") && actions.includes("decision_reset"));
  });
  test("a second run changes nothing", async () => {
    const out = await R.recheckAll();
    assert.equal(out.updated, 0);
  });
});

describe("Delete keeps the audit trail", () => {
  test("deleted records leave lists and scorecards but keep history", async () => {
    const c = await R.createCertificate(input({ supplier: "Delete Me Ltd" }), "test", "Tester");
    assert.equal(await R.deleteCertificate(c.id, "Admin", "test data"), true);
    assert.equal((await R.listCertificates({ supplier: "Delete Me" })).length, 0);
    assert.equal(await R.supplierScorecard("Delete Me Ltd"), null);
    const kept = (await R.getCertificate(c.id))!;
    assert.equal(kept.status, "deleted");
    const del = (await R.getEvents(c.id)).find((e) => e.action === "deleted")!;
    assert.deepEqual([del.actor, del.reason], ["Admin", "test data"]);
    assert.equal(await R.deleteCertificate(c.id, "Admin"), false, "second delete is a no-op");
    await assert.rejects(() => R.updateField(c.id, "chemistry.S", 0.03, "QA"), /not found/);
  });
});

describe("Reset demo data restores exactly the sample set", () => {
  test("7 samples, 4 suppliers, duplicate-heat red flag present", async () => {
    await R.resetAll();
    await seedMod.seed();
    await R.recheckAll();
    const all = await R.listCertificates({ includeDeleted: true });
    assert.equal(all.length, seedMod.SAMPLE_COUNT);
    assert.equal(all.length, 7);
    assert.deepEqual(all.map((c) => `${c.data.supplier}|${c.data.heat_number}`).sort(), [...seedMod.SAMPLE_HEATS].sort());
    assert.equal(new Set(all.map((c) => c.data.supplier)).size, 4);
    const dup = all.filter((c) => c.data.heat_number === "RK24-3318");
    assert.equal(dup.length, 2);
    for (const c of dup) assert.ok(c.check.flags.some((f) => f.code === "DUP_HEAT" && /DIFFERENT chemistry/.test(f.message)), `${c.data.supplier} flagged`);
    const verdicts = all.map((c) => c.check.verdict).sort();
    assert.deepEqual(verdicts, ["FAIL", "FAIL", "INCOMPLETE", "PASS", "PASS", "PASS", "PASS"]);
  });
});
