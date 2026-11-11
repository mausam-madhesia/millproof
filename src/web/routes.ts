import express, { Router, Request, Response } from "express";
import { checkCredentials, clearSession, currentUser, requireLogin, setSession } from "../auth.js";
import { config } from "../config.js";
import { getValue, labelFor } from "../fields.js";
import { allScorecards, decide, resetAll, getByShareToken, getCertificate, getEvents, listCertificates, supplierScorecard, updateField } from "../repo.js";
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
    if (!checkCredentials(String(username), String(password))) {
      return res.status(401).send(V.loginPage("That email and password don't match the test account.", safeNext(next)));
    }
    setSession(res, config.demoUser);
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
    res.send(V.sharePage(c, events.filter((e) => e.action === "field_updated").length));
  });

  // Everything below needs the test login.
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
    if (!c) return res.status(404).send(V.notFoundPage(user(req), "Certificate"));
    if (c.id !== req.params.id) return res.redirect(`/certificates/${c.id}`);
    res.send(V.layout(`Heat ${c.data.heat_number}`, V.recordPage(c, await getEvents(c.id)), { user: user(req), active: "certs", scripts: ["/static/record.js"] }));
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
    res.send(V.layout("Connect Claude", V.connectPage(), { user: user(req), active: "connect" }));
  });

  // Wipe and reload the 6 sample certificates (handy between demo takes; Render's free tier has no shell).
  r.post("/admin/reset-demo", async (_req, res) => {
    await resetAll();
    await seed();
    res.redirect("/");
  });

  // JSON API used by the record page.
  r.post("/api/certificates/:id/fields", express.json(), async (req: Request, res: Response) => {
    try {
      const { field, value } = req.body ?? {};
      const { cert, changed, before } = await updateField(String(req.params.id), String(field), value, config.demoName);
      const after = cert.check.verdict;
      const message = !changed
        ? "No change"
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
      const cert = await decide(String(req.params.id), decision, config.demoName, note);
      res.json({ message: decision === "approved" ? "Batch approved" : "Batch rejected", ...V.recordUpdate(cert, await getEvents(cert.id)) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return r;
}
