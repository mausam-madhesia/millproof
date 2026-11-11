import express, { Router, Request, Response } from "express";
import { checkCredentials, clearSession, currentUser, displayName, isAdmin, requireAdmin, requireLogin, setSession } from "../auth.js";
import { config } from "../config.js";
import { getValue, labelFor } from "../fields.js";
import { allScorecards, decide, deleteCertificate, recheckAll, resetAll, getByShareToken, getCertificate, getEvents, listCertificates, supplierScorecard, updateField } from "../repo.js";
import { Verdict } from "../checker.js";
import * as V from "./views.js";
import { seed } from "../seed.js";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export function webRouter(): Router {
  const r = Router();
  r.use(express.urlencoded({ extended: false }));

  r.get("/login", (req, res) => {
    if (currentUser(req)) return res.redirect("/");
    res.send(V.loginPage(null, safeNext(req.query.next)));
  });
  r.post("/login", (req, res) => {
    const { username = "", password = "", next } = req.body ?? {};
    const account = checkCredentials(String(username), String(password));
    if (!account) {
      return res.status(401).send(V.loginPage("That email and password don't match the test account.", safeNext(next)));
    }
    setSession(res, account);
    res.redirect(safeNext(next));
  });
  r.get("/logout", (_req, res) => {
    clearSession(res);
    res.redirect("/login");
  });

  // Public, read-only verification page. No login.
  r.get("/v/:token", async (req, res) => {
    const c = await getByShareToken(req.params.token);
    if (!c) return res.status(404).send(V.notFoundPage(null, "Verification record"));
    const events = await getEvents(c.id);
    res.setHeader("X-Robots-Tag", "noindex");
    res.send(V.sharePage(c, events));
  });

  // "/" is the public landing page for visitors; logged-in users get the dashboard.
  r.get("/", (req, res, next) => {
    if (currentUser(req)) return next();
    res.send(V.landingPage());
  });

  // Everything below needs a login.
  r.use(requireLogin);
  const user = (req: Request) => currentUser(req)!;

  r.get("/", async (req, res) => {
    const f = { supplier: str(req.query.supplier), verdict: str(req.query.verdict) as Verdict | undefined, status: str(req.query.status) as "pending" | undefined, q: str(req.query.q) };
    const all = await listCertificates({ limit: 500 });
    const shown = f.supplier || f.verdict || f.status || f.q ? await listCertificates(f) : all;
    const suppliers = [...new Set(all.map((c) => c.data.supplier))].sort();
    res.send(V.layout("Certificates", V.dashboardPage(all, shown, suppliers, f), { user: user(req), active: "certs" }));
  });

  r.get("/certificates/:id", async (req, res) => {
    const c = await getCertificate(req.params.id);
    if (!c || (c.status === "deleted" && !isAdmin(user(req)))) return res.status(404).send(V.notFoundPage(user(req), "Certificate"));
    if (c.id !== req.params.id) return res.redirect(`/certificates/${c.id}`);
    res.send(V.layout(`Heat ${c.data.heat_number}`, V.recordPage(c, await getEvents(c.id), isAdmin(user(req))), { user: user(req), active: "certs", scripts: ["/static/record.js"] }));
  });

  // Debit-note draft for a rejected batch: printable page, or a downloadable .html file.
  r.get("/certificates/:id/debit-note", async (req, res) => {
    const c = await getCertificate(String(req.params.id));
    if (!c || c.id !== String(req.params.id).toUpperCase() || c.status === "deleted") return res.status(404).send(V.notFoundPage(user(req), "Certificate"));
    if (c.status !== "rejected") return res.status(409).send(V.layout("No debit note", `<div class="card"><div class="empty"><h2 style="color:var(--ink)">No debit note for this batch</h2><p>A debit-note draft is generated when QA rejects a batch. This one is ${c.status === "approved" ? "approved (cleared for payment)" : "awaiting QA"}.</p><a class="btn" href="/certificates/${c.id}">Back to the record</a></div></div>`, { user: user(req) }));
    if (req.query.download) {
      res.setHeader("Content-Disposition", `attachment; filename="debit-note-${c.data.heat_number.replace(/[^A-Za-z0-9_-]/g, "_")}-${c.id}.html"`);
      return res.type("html").send(V.debitNotePage(c, true));
    }
    res.send(V.debitNotePage(c));
  });

  r.get("/finance", async (req, res) => {
    res.send(V.layout("Finance export", V.financePage(await listCertificates({ limit: 500 })), { user: user(req), active: "finance" }));
  });
  r.get("/finance/export.csv", async (_req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="millproof-finance-${stamp}.csv"`);
    res.type("text/csv; charset=utf-8").send(V.financeCsv(await listCertificates({ limit: 500 })));
  });

  r.get("/suppliers", async (req, res) => {
    res.send(V.layout("Suppliers", V.suppliersPage(await allScorecards()), { user: user(req), active: "suppliers" }));
  });
  r.get("/suppliers/:name", async (req, res) => {
    const s = await supplierScorecard(req.params.name);
    if (!s) return res.status(404).send(V.notFoundPage(user(req), "Supplier"));
    res.send(V.layout(s.supplier, V.supplierPage(s), { user: user(req), active: "suppliers" }));
  });

  r.get("/connect", (req, res) => {
    res.send(V.layout("Connect Claude", V.connectPage(isAdmin(user(req))), { user: user(req), active: "connect" }));
  });

  // Wipe and reload exactly the sample set (handy between demo takes; Render's free tier has no shell).
  r.post("/admin/reset-demo", requireAdmin, async (_req, res) => {
    await resetAll();
    await seed();
    await recheckAll(); // cross-record checks (duplicate heats) need every sample present
    res.redirect("/");
  });

  // Admin only: delete one record (e.g. test data). Hidden everywhere; the audit trail records who, when and why.
  r.post("/certificates/:id/delete", requireAdmin, async (req, res) => {
    await deleteCertificate(String(req.params.id), displayName(user(req)), str(req.body?.reason) ?? null);
    res.redirect("/");
  });

  // JSON API used by the record page.
  r.post("/api/certificates/:id/fields", express.json(), async (req: Request, res: Response) => {
    try {
      const { field, value, reason } = req.body ?? {};
      const { cert, changed, before } = await updateField(String(req.params.id), String(field), value, displayName(user(req)), str(reason) ?? null);
      const after = cert.check.verdict;
      const message = !changed
        ? `No change. Re-checked: ${after}.`
        : before !== after
          ? `${labelFor(field)} saved. Verdict ${before} → ${after}.`
          : `${labelFor(field)} saved. Re-checked: still ${after}.`;
      const v = getValue(cert.data, String(field));
      res.json({ message, verdict: after, value: v === null || v === undefined ? "" : String(v), ...V.recordUpdate(cert, await getEvents(cert.id), field) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.post("/api/certificates/:id/decision", express.json(), async (req: Request, res: Response) => {
    try {
      const { decision, note } = req.body ?? {};
      if (decision !== "approved" && decision !== "rejected") throw new Error("Decision must be approved or rejected.");
      const cert = await decide(String(req.params.id), decision, displayName(user(req)), note);
      res.json({ message: decision === "approved" ? "Batch approved" : "Batch rejected", ...V.recordUpdate(cert, await getEvents(cert.id)) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return r;
}
