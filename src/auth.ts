// Login for the single test account (signed cookie) and the access token that guards /mcp.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

const COOKIE = "mp_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

const sign = (payload: string) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function checkCredentials(user: string, password: string): boolean {
  return safeEqual(user.trim().toLowerCase(), config.demoUser.toLowerCase()) && safeEqual(password, config.demoPassword);
}

export function setSession(res: Response, user: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const payload = Buffer.from(JSON.stringify({ u: user, exp })).toString("base64url");
  const secure = config.publicUrl.startsWith("https://");
  res.setHeader("Set-Cookie", `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? "; Secure" : ""}`);
}

export function clearSession(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function currentUser(req: Request): string | null {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return exp > Date.now() / 1000 ? String(u) : null;
  } catch {
    return null;
  }
}

export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (currentUser(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Please log in again." });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/** Token from /mcp/<token>, ?token=..., or "Authorization: Bearer ...". */
export function requireMcpToken(req: Request, res: Response, next: NextFunction) {
  const fromPath = (req.params as Record<string, string | undefined>).token;
  const fromQuery = typeof req.query.token === "string" ? req.query.token : undefined;
  const auth = req.headers.authorization;
  const fromHeader = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const token = fromPath ?? fromQuery ?? fromHeader ?? "";
  if (token && safeEqual(token, config.mcpToken)) return next();
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or wrong MillProof access token. Use the full connector URL from the MillProof 'Connect Claude' page." }, id: null });
}
