// End-to-end check of the MCP endpoint, using the official MCP client.
// Usage: start the server, then `npm run smoke` (optionally BASE_URL=https://your-app.onrender.com).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.env.BASE_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
const token = process.env.MCP_TOKEN || "dev-token-change-me";

const client = new Client({ name: "millproof-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?token=${encodeURIComponent(token)}`)));

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");
const json = (r: unknown) => JSON.parse(text(r).slice(text(r).indexOf("\n\n") + 2));
let failures = 0;
const expect = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
expect(JSON.stringify(names) === JSON.stringify(["create_certificate", "get_certificate", "list_certificates", "supplier_scorecard", "update_certificate_field"]), `tools listed: ${names.join(", ")}`);

const heat = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
const created = await client.callTool({
  name: "create_certificate",
  arguments: {
    supplier: "Smoke Test Supplier", mill_name: "Test Mill", heat_number: heat, standard: "IS 2062:2011", grade: "E250BR",
    cert_date: "2026-11-06", product: "HR plate 16 mm", thickness_mm: 16, elongation_gauge: "proportional",
    chemistry: { C: 0.18, Mn: 0.82, Si: 0.21, S: 0.024, P: 0.028, CE: 0.33, Cr: 0.03, Ni: 0.02, Cu: 0.03, Mo: 0.01 },
    mechanical: { yield_strength_mpa: 298, tensile_strength_mpa: 452, elongation_pct: 27 },
  },
});
const c = json(created);
expect(!created.isError && c.verdict === "PASS", `create_certificate -> ${c.id} verdict ${c.verdict}`);
expect(typeof c.record_url === "string" && c.record_url.includes(`/certificates/${c.id}`), `record link returned: ${c.record_url}`);

const listed = json(await client.callTool({ name: "list_certificates", arguments: { supplier: "smoke test" } }));
expect(listed.some((r: { id: string }) => r.id === c.id), `list_certificates (supplier filter) finds ${c.id}`);
const failing = json(await client.callTool({ name: "list_certificates", arguments: { verdict: "FAIL" } }));
expect(failing.every((r: { verdict: string }) => r.verdict === "FAIL"), `list_certificates (verdict=FAIL) returns ${failing.length} FAIL record(s) only`);

const got = json(await client.callTool({ name: "get_certificate", arguments: { id: c.id } }));
expect(got.id === c.id && got.results.length > 5, `get_certificate by id returns ${got.results.length} checked fields`);
const byHeat = json(await client.callTool({ name: "get_certificate", arguments: { id: heat } }));
expect(byHeat.id === c.id, "get_certificate by heat number works");

const upd = json(await client.callTool({ name: "update_certificate_field", arguments: { id: c.id, field: "chemistry.S", value: 0.052, reason: "Smoke test retest" } }));
const s = upd.results.find((r: { field: string }) => r.field === "chemistry.S");
expect(upd.verdict === "FAIL" && s.status === "fail", `update_certificate_field S=0.052 re-ran the check -> ${upd.verdict}`);
const back = json(await client.callTool({ name: "update_certificate_field", arguments: { id: c.id, field: "chemistry.S", value: 0.024 } }));
expect(back.verdict === "PASS", `update back to 0.024 -> ${back.verdict}`);
const miss = json(await client.callTool({ name: "update_certificate_field", arguments: { id: c.id, field: "mechanical.elongation_pct", value: null } }));
expect(miss.verdict === "INCOMPLETE", `clearing elongation -> ${miss.verdict}`);

const sc = json(await client.callTool({ name: "supplier_scorecard", arguments: { supplier: "Smoke Test" } }));
expect(sc.total >= 1 && typeof sc.passRate === "number", `supplier_scorecard -> ${sc.total} cert(s), pass rate ${(sc.passRate * 100).toFixed(0)}%`);

const bad = await client.callTool({ name: "create_certificate", arguments: { supplier: "X", heat_number: "Y", standard: "EN 10025", grade: "S355JR", chemistry: {}, mechanical: {} } });
expect(!!bad.isError, "unsupported grade is refused with a helpful error");

const share = await fetch(c.share_url);
expect(share.status === 200 && (await share.text()).includes(heat), `share link opens without login (${share.status})`);
const noTok = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
expect(noTok.status === 401, `MCP without token is refused (${noTok.status})`);

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll MCP checks passed.");
process.exit(failures ? 1 : 0);
