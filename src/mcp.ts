// MCP server: the tools Claude calls. Claude reads the certificate; these tools store and check it.
// Stateless Streamable HTTP: a fresh server + transport per request (no sessions to lose on restart).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHEM_ELEMENTS, EDITABLE_PATHS, GAUGES, labelFor } from "./fields.js";
import { createCertificate, getCertificate, listCertificates, supplierScorecard, updateField, Certificate } from "./repo.js";
import { recordUrl, shareUrl } from "./config.js";
import { supportedGradesText } from "./specs.js";
import { CheckResult } from "./checker.js";

const ACTOR = "Claude (via MCP)";
const num = (d: string) => z.number().nullable().optional().describe(d);

const chemistryShape = Object.fromEntries(
  CHEM_ELEMENTS.map((e) => [
    e,
    num(
      e === "CE"
        ? "Carbon equivalent exactly as PRINTED on the certificate (often 'CE', 'CEV' or 'C.E.'). Omit if not printed; MillProof calculates its own CE."
        : `${e} in weight %, from the heat (ladle) analysis row. Convert ppm to % (ppm / 10000). If the MTC prints 'x1000' or 'x100' column headers, divide accordingly (e.g. C '18' under 'x100' = 0.18).`,
    ),
  ]),
) as Record<(typeof CHEM_ELEMENTS)[number], ReturnType<typeof num>>;

const CREATE_DESCRIPTION = `Create a checked record for ONE steel mill test certificate (MTC, also called test certificate / TC / inspection certificate 3.1).

Use this after reading an MTC (PDF, scan or phone photo) the user shares. Extract every value yourself, then call this tool once per HEAT NUMBER (if an MTC lists several heats, call it once for each heat).

What to extract:
- supplier: the company that DELIVERED the steel to the user (trader/stockist). Often printed as 'Customer' on the mill's MTC is the buyer, not the supplier; if the user names the supplier, use that. If the mill delivered directly, use the mill name.
- mill_name: the steel plant that produced it (the letterhead).
- heat_number: 'Heat No.' / 'Cast No.' / 'Melt No.', exactly as printed.
- standard + grade: e.g. standard "IS 2062:2011", grade "E250BR"; or standard "ASTM A36/A36M", grade "A36". Keep the quality suffix (A, BR, B0, C). Supported: ${supportedGradesText()}.
- certificate_no, cert_date (YYYY-MM-DD), product (e.g. 'HR plate 16 x 2000 x 6300 mm'), thickness_mm (number; drives thickness-dependent limits).
- chemistry: heat/ladle analysis in weight %. Use null for elements not printed. Never guess or fill in typical values.
- mechanical: yield_strength_mpa (YS / ReH / Rp0.2 / yield point), tensile_strength_mpa (UTS / Rm), elongation_pct (A% / El%). Strength must be in MPa (N/mm²); convert ksi x 6.895, psi x 0.006895. If several test pieces are listed, use the LOWEST yield and tensile values and the LOWEST elongation.
- elongation_gauge: "proportional" (5.65√So, usual for IS 2062), "50mm" (2 in) or "200mm" (8 in).

If a value is unreadable, send null and tell the user which one; a QA engineer can fill it in the MillProof web app.

MillProof then checks every value against the spec table with fixed rules (no AI) and returns pass / fail / missing per field, an overall verdict (PASS, FAIL or INCOMPLETE), red flags (e.g. reported CE doesn't match the chemistry, repeated heat number), a link to the record for QA review and a public verification link. Report the verdict and any failing or missing fields to the user, and give them the record link.`;

function summarise(c: Certificate): string {
  const ck: CheckResult = c.check;
  const bad = ck.results.filter((r) => r.status === "fail" || r.status === "missing");
  const lines = [
    `${c.id}: heat ${c.data.heat_number}, ${ck.specLabel}, supplier ${c.data.supplier}`,
    `Verdict: ${ck.verdict} (${ck.counts.pass} pass, ${ck.counts.fail} fail, ${ck.counts.missing} missing). QA status: ${c.status}.`,
    ...bad.map((r) => `- ${r.status.toUpperCase()}: ${r.label} = ${r.value ?? "not given"} (limit ${r.limitText})${r.note ? `. ${r.note}` : ""}`),
    ...ck.flags.map((f) => `- RED FLAG: ${f.message}`),
    `Record (QA review and edit): ${recordUrl(c.id)}`,
    `Public verification link: ${shareUrl(c.share_token)}`,
  ];
  return lines.join("\n");
}

function payload(c: Certificate) {
  return {
    id: c.id,
    verdict: c.check.verdict,
    qa_status: c.status,
    spec: c.check.specLabel,
    counts: c.check.counts,
    record_url: recordUrl(c.id),
    share_url: shareUrl(c.share_token),
    certificate: c.data,
    results: c.check.results.map((r) => ({ field: r.field, value: r.value, status: r.status, limit: r.limitText, source: r.source, limit_needs_verification: r.verify, note: r.note })),
    flags: c.check.flags,
    decision: c.decision,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

const ok = (text: string, data: unknown) => ({ content: [{ type: "text" as const, text: `${text}\n\n${JSON.stringify(data, null, 2)}` }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "millproof", version: "1.0.0" },
    {
      instructions:
        "MillProof stores and checks steel mill test certificates (MTCs). When the user shares an MTC, read it carefully, then call create_certificate once per heat number with every value you can read. Never invent values; use null when unreadable. Use update_certificate_field to correct one value. Use supplier_scorecard to answer questions about a supplier's quality history.",
    },
  );

  server.registerTool(
    "create_certificate",
    {
      title: "Create MTC record",
      description: CREATE_DESCRIPTION,
      inputSchema: {
        supplier: z.string().min(1).describe("Company that delivered the steel to the user (trader/stockist), or the mill if delivered direct."),
        mill_name: z.string().nullable().optional().describe("Producing steel mill, from the certificate letterhead."),
        heat_number: z.string().min(1).describe("Heat / cast / melt number exactly as printed."),
        standard: z.string().min(1).describe('Standard as printed, e.g. "IS 2062:2011" or "ASTM A36/A36M-19".'),
        grade: z.string().min(1).describe('Grade with quality suffix, e.g. "E250BR", "E250A", "E350", "A36".'),
        certificate_no: z.string().nullable().optional().describe("Test certificate number."),
        cert_date: z.string().nullable().optional().describe("Certificate date, YYYY-MM-DD."),
        product: z.string().nullable().optional().describe("Product and size, e.g. 'HR plate 16 x 2000 x 6300 mm'."),
        thickness_mm: z.number().nullable().optional().describe("Product thickness in mm. Needed for thickness-dependent limits."),
        elongation_gauge: z.enum(GAUGES).nullable().optional().describe('Gauge length of the elongation test: "proportional" (5.65√So), "50mm" or "200mm".'),
        chemistry: z.object(chemistryShape).describe("Heat analysis, weight %. null for elements not printed."),
        mechanical: z
          .object({
            yield_strength_mpa: num("Yield strength in MPa (lowest if several test pieces)."),
            tensile_strength_mpa: num("Ultimate tensile strength in MPa (lowest if several test pieces)."),
            elongation_pct: num("Elongation in % (lowest if several test pieces)."),
          })
          .describe("Tensile test results, converted to MPa."),
      },
    },
    async (args) => {
      try {
        const c = await createCertificate(args as Record<string, unknown>, "claude", ACTOR);
        return ok(`Created ${summarise(c)}`, payload(c));
      } catch (e) {
        return fail(`Could not create the certificate: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_certificates",
    {
      title: "List MTC records",
      description: "List certificate records, newest first. Optionally filter by supplier (partial name match), verdict (PASS / FAIL / INCOMPLETE) or QA status (pending / approved / rejected).",
      inputSchema: {
        supplier: z.string().optional().describe("Supplier name or part of it."),
        verdict: z.enum(["PASS", "FAIL", "INCOMPLETE"]).optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Max records (default 25)."),
      },
    },
    async ({ supplier, verdict, status, limit }) => {
      const list = await listCertificates({ supplier, verdict, status, limit: limit ?? 25 });
      const rows = list.map((c) => ({
        id: c.id, heat_number: c.data.heat_number, supplier: c.data.supplier, mill: c.data.mill_name, grade: c.check.specLabel,
        verdict: c.check.verdict, qa_status: c.status, cert_date: c.data.cert_date, record_url: recordUrl(c.id),
      }));
      const text = rows.length
        ? `${rows.length} certificate(s):\n` + rows.map((r) => `- ${r.id} | heat ${r.heat_number} | ${r.supplier} | ${r.grade} | ${r.verdict} | ${r.qa_status}`).join("\n")
        : "No certificates match that filter.";
      return ok(text, rows);
    },
  );

  server.registerTool(
    "get_certificate",
    {
      title: "Get MTC record",
      description: "Get one certificate record with every value, its pass/fail/missing result, the limit and source clause used, red flags and QA decision. Accepts the record id (e.g. MTC-7QK2XA) or a heat number (returns the newest record for that heat).",
      inputSchema: { id: z.string().min(1).describe("Record id like MTC-7QK2XA, or a heat number.") },
    },
    async ({ id }) => {
      const c = await getCertificate(id);
      return c ? ok(summarise(c), payload(c)) : fail(`No certificate found for "${id}". Use list_certificates to see ids.`);
    },
  );

  server.registerTool(
    "update_certificate_field",
    {
      title: "Correct one MTC value",
      description: `Change ONE field on a certificate record, for example when a value was misread or a lab retest gives a new value. MillProof re-runs the check immediately and returns the new verdict. If the batch was already approved or rejected, the decision is reset to pending and the change is written to the audit trail. Field names: ${EDITABLE_PATHS.join(", ")}. Chemistry in weight %, strengths in MPa. Send null to clear a value.`,
      inputSchema: {
        id: z.string().min(1).describe("Record id like MTC-7QK2XA (or heat number)."),
        field: z.enum(EDITABLE_PATHS).describe('Field path, e.g. "chemistry.S", "mechanical.yield_strength_mpa", "thickness_mm", "grade".'),
        value: z.union([z.number(), z.string(), z.null()]).describe("New value."),
        reason: z.string().optional().describe("Why the value changed (kept in the audit trail), e.g. 'Lab retest report LR-118'."),
      },
    },
    async ({ id, field, value, reason }) => {
      try {
        const found = await getCertificate(id);
        if (!found) return fail(`No certificate found for "${id}".`);
        const { cert, changed, before } = await updateField(found.id, field, value, ACTOR, reason ?? null);
        const head = changed
          ? `Updated ${labelFor(field)} on ${cert.id}. Verdict ${before === cert.check.verdict ? `stays ${cert.check.verdict}` : `changed ${before} → ${cert.check.verdict}`}.`
          : `No change: ${labelFor(field)} already had that value.`;
        return ok(`${head}\n${summarise(cert)}`, payload(cert));
      } catch (e) {
        return fail(`Could not update: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "supplier_scorecard",
    {
      title: "Supplier scorecard",
      description: "One supplier's certificate history: total certificates, pass rate (share of certificates with a PASS verdict), fails, incompletes, QA approvals/rejections, the fields that fail most often, and every certificate. Partial names match.",
      inputSchema: { supplier: z.string().min(1).describe("Supplier name or part of it.") },
    },
    async ({ supplier }) => {
      const s = await supplierScorecard(supplier);
      if (!s) return fail(`No certificates found for supplier "${supplier}".`);
      const text = [
        `${s.supplier}: ${s.total} certificate(s), pass rate ${(s.passRate * 100).toFixed(0)}% (${s.pass} pass, ${s.fail} fail, ${s.incomplete} incomplete).`,
        `QA decisions: ${s.approved} approved, ${s.rejected} rejected, ${s.pending} pending.`,
        s.topFailures.length ? `Most frequent failures: ${s.topFailures.map((f) => `${f.label} (${f.count})`).join(", ")}.` : "No failing fields on record.",
      ].join("\n");
      return ok(text, {
        ...s,
        certificates: s.certificates.map((c) => ({ id: c.id, heat_number: c.data.heat_number, grade: c.check.specLabel, verdict: c.check.verdict, qa_status: c.status, record_url: recordUrl(c.id) })),
      });
    },
  );

  return server;
}
