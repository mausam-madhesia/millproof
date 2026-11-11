# MillProof

**Mill test certificates, checked before the steel is accepted.**

Every steel delivery in India comes with a mill test certificate (MTC) listing the heat number, grade, chemistry and mechanical properties. Today a QA engineer checks each one against the standard by hand. That is slow and error-prone, it leaves no searchable record, and fake or mismatched certificates get through.

With MillProof, **your own Claude reads the certificate** (a PDF or a phone photo) and sends every value to MillProof through MCP. **MillProof then checks each value against the grade's limits using fixed, written-down rules.** There is no AI inside the app. A QA engineer reviews the record, corrects any value (the check re-runs instantly), and approves or rejects the batch. Each record gets a public verification link for clients and inspectors, and every supplier builds up a pass-rate scorecard.

Why an app and not just Claude: Claude forgets after the chat. MillProof keeps an audit trail per heat number and a supplier history, provides share links, and runs the same check every time.

## Try it

| | |
|---|---|
| Live app | `https://millproof.onrender.com` |
| Test login | `qa@millproof.demo` / `MillProof@2026` |
| MCP link | `https://millproof.onrender.com/mcp?token=<MCP_TOKEN>` (token sent privately with the submission; also shown on the app's **Connect Claude** page after login) |

The first load after 15 idle minutes takes about a minute, because Render's free tier sleeps.

## Connect it to Claude in 3 steps

1. In Claude, go to **Settings → Connectors → Add custom connector**.
2. Name it **MillProof**, paste the MCP link above, and click **Add**.
3. In a new chat, check that MillProof is switched on in the tools menu. Attach an MTC (try `sample/SAMPLE_MTC_RK24-3561_photo.jpg`) and type:
   *"Read this mill test certificate and add it to MillProof. The supplier is Vardhan Steel Traders. Tell me the verdict and anything that failed or is missing."*

## What's inside

- **One Node/TypeScript service** that hosts the web app and the MCP server (`/mcp`, Streamable HTTP, official `@modelcontextprotocol/sdk`).
- **MCP tools:** `create_certificate`, `list_certificates`, `get_certificate`, `update_certificate_field`, `supplier_scorecard`.
- **Spec table:** `spec/specs.json` covers IS 2062 E250 (A, BR), E350 and ASTM A36 plates. Every limit names its standard and clause. Limits the author isn't fully sure of are marked `"verify": true` and show a *verify* tag in the app.
- **Rules engine:** `src/checker.ts`, with unit tests in `src/tests/` (`npm test`). Each field gets pass, fail, missing or review (a value that can't be compared, e.g. elongation on the wrong gauge length), and the certificate gets an overall verdict of PASS, FAIL or INCOMPLETE. Limits depend on thickness (IS 2062: below 20 mm, 20–40 mm inclusive, over 40 mm), and ASTM A36 phosphorus and sulphur limits depend on the edition printed (A36-19 or later vs A36-14 or earlier). CE is calculated; if it differs from the reported CE by more than 0.02, the higher value is judged. The checker also raises red flags: yield ≥ tensile, a reported CE that doesn't match the chemistry, and a heat number already seen with different chemistry.
- **Storage:** SQLite on a laptop, Postgres on Render (same code).
- **No AI:** `npm run check:no-ai` scans the code and every installed package for AI SDKs, hosts and keys.

All company names in the sample data and the sample certificate are fictitious.

Setup, deployment and testing: see [`docs/RUN_AND_DEPLOY.md`](docs/RUN_AND_DEPLOY.md).
