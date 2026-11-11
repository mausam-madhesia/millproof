import { randomBytes } from "node:crypto";

const port = Number(process.env.PORT ?? 3000);

function publicUrl(): string {
  const u = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  return u.replace(/\/+$/, "");
}

const devFallback = (name: string, value: string) => {
  if (process.env.NODE_ENV === "production") {
    console.warn(`[config] ${name} is not set. Using a ${name === "SESSION_SECRET" ? "random" : "default"} value; set it in your host's environment.`);
  }
  return value;
};

export const config = {
  port,
  publicUrl: publicUrl(),
  databaseUrl: process.env.DATABASE_URL || "",
  sqlitePath: process.env.SQLITE_PATH || "./data/millproof.db",
  mcpToken: process.env.MCP_TOKEN || devFallback("MCP_TOKEN", "dev-token-change-me"),
  demoUser: process.env.DEMO_USER || "qa@millproof.demo",
  demoPassword: process.env.DEMO_PASSWORD || "MillProof@2026",
  demoName: process.env.DEMO_NAME || "Demo QA Engineer",
  sessionSecret: process.env.SESSION_SECRET || devFallback("SESSION_SECRET", randomBytes(32).toString("hex")),
  seedOnEmpty: (process.env.SEED_ON_EMPTY ?? "true") !== "false",
};

export const recordUrl = (id: string) => `${config.publicUrl}/certificates/${id}`;
export const shareUrl = (token: string) => `${config.publicUrl}/v/${token}`;
