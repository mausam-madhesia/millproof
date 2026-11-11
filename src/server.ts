// One service: the MillProof web app and the MCP endpoint Claude connects to.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { requireMcpToken } from "./auth.js";
import { buildMcpServer } from "./mcp.js";
import { webRouter } from "./web/routes.js";
import { getDb } from "./db.js";
import { countCertificates } from "./repo.js";
import { seed } from "./seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/static", express.static(path.resolve(here, "..", "public"), { maxAge: "1h" }));

// ---- MCP (Streamable HTTP, stateless) ----
async function handleMcp(req: express.Request, res: express.Response) {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[mcp] error", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
}
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This MCP server is stateless; use POST." }, id: null });

const mcpJson = express.json({ limit: "1mb" });
app.post("/mcp", mcpJson, requireMcpToken, handleMcp);
app.post("/mcp/:token", mcpJson, requireMcpToken, handleMcp);
app.get(["/mcp", "/mcp/:token"], methodNotAllowed);
app.delete(["/mcp", "/mcp/:token"], methodNotAllowed);

// ---- Web app ----
app.use(webRouter());

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).send("Something went wrong. Please try again.");
});

async function main() {
  await getDb();
  if (config.seedOnEmpty && (await countCertificates()) === 0) {
    await seed();
    console.log("[seed] database was empty, loaded 6 sample certificates");
  }
  app.listen(config.port, () => {
    console.log(`MillProof running at ${config.publicUrl}`);
    console.log(`MCP endpoint:        ${config.publicUrl}/mcp?token=<MCP_TOKEN>`);
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
