# Run, test and deploy MillProof

## 1. Run on your laptop

You need Node.js 20 or newer (`node -v`). Node 22 is recommended.

```bash
cd millproof
npm install
cp .env.example .env          # defaults work as-is for local use
npm run dev                   # builds, then starts on http://localhost:3000
```

- Open http://localhost:3000 and log in with `qa@millproof.demo` / `MillProof@2026`.
- On first start the 7 sample certificates load automatically into a local SQLite file at `./data/millproof.db`.
- Reset the sample data at any time with `npm run seed -- --reset`, or (logged in as admin) the **Reset demo data** button on the Connect Claude page.

### Unit tests for the rules engine

```bash
npm test                     # expected: "# pass 49" and "# fail 0"
```

### Admin account

A second login, `admin@millproof.demo`, can **delete records** (a "Delete record" card at the bottom of each record) and **reset demo data**. The test account cannot. Locally its password is `admin-dev-only` (or whatever you set as `ADMIN_PASSWORD` in `.env`). On Render the Blueprint generates `ADMIN_PASSWORD`: find it under web service → **Environment**. Without `ADMIN_PASSWORD` in production, the admin login is switched off.

### Prove every MCP tool works (no Claude needed)

With the server running, in a second terminal:

```bash
npm run smoke
```

This uses the official MCP client to call all five tools. It creates a record, lists it, fetches it by id and by heat number, and edits sulphur to 0.052 to check the verdict flips to FAIL. It then edits sulphur back (PASS), clears elongation (INCOMPLETE), reads the supplier scorecard, confirms an unsupported grade is refused, and opens the share link without logging in. It also checks that `/mcp` refuses a missing token. Expected last line: `All MCP checks passed.`

```bash
npm run check:no-ai          # expected: "No AI SDKs, AI API hosts or AI keys: ..."
```

### Optional: click through the tools by hand

```bash
npx @modelcontextprotocol/inspector
```
In the Inspector, choose transport **Streamable HTTP** and URL `http://localhost:3000/mcp?token=dev-token-change-me`, then click **Connect** and open **Tools**.

### Optional: test from Claude while running locally

Claude.ai connects to your server from the internet, so it cannot reach `localhost`. You have two options:

- **Claude Code** (runs on your machine):
  `claude mcp add --transport http millproof "http://localhost:3000/mcp?token=dev-token-change-me"`
- **Claude.ai through a temporary tunnel:**
  `npx cloudflared tunnel --url http://localhost:3000` prints an `https://….trycloudflare.com` URL. Put that URL in `.env` as `PUBLIC_URL` (so record links point to it), restart `npm run dev`, and add `https://….trycloudflare.com/mcp?token=dev-token-change-me` as a custom connector (see section 3).

## 2. Deploy on Render's free tier

### Why SQLite locally and Postgres on Render

Render's free web services have an **ephemeral filesystem**: a local SQLite file is wiped every time the service redeploys, restarts or spins down after 15 idle minutes. Render's **free Postgres** keeps data across those restarts. It is 1 GB, and it expires 30 days after creation, which covers an assignment review (upgrade it, or recreate it, after that). The app picks the database automatically: Postgres when `DATABASE_URL` is set, otherwise SQLite. The included `render.yaml` creates both services in one click.

### Step by step

**A. Put the code on GitHub**

1. Go to https://github.com/new, name the repo `millproof`, choose **Private** or **Public**, and leave every box unticked. Click **Create repository**.
2. In the `millproof` folder:
   ```bash
   git init
   git add .
   git commit -m "MillProof v1"
   git branch -M main
   git remote add origin https://github.com/<your-username>/millproof.git
   git push -u origin main
   ```
   (`.gitignore` already keeps `node_modules`, `dist`, `data` and `.env` out of the repo.)

**B. Create the services from the Blueprint**

3. Go to https://dashboard.render.com and sign in with GitHub.
4. Click **New +** (top right) → **Blueprint**.
5. Under *Connect a repository*, click **Connect** next to `millproof`. If it isn't listed, click **Configure GitHub App**, give Render access to the repo, and come back.
6. **Blueprint Name:** `millproof`. Render reads `render.yaml` and shows two resources: web service **millproof** (Free) and database **millproof-db** (Free). Click **Apply** (or **Deploy Blueprint**).
7. Wait for the database to show **Available** and the web service to show **Live**. The first build takes about 3–6 minutes. You can watch progress under the web service's **Logs**. Look for `MillProof running at https://millproof-xxxx.onrender.com`.

**C. Get your links**

8. Open the **millproof** web service. The live URL is at the top, e.g. `https://millproof-xxxx.onrender.com`.
9. Open the URL, log in with `qa@millproof.demo` / `MillProof@2026`, and click **Connect Claude**. The full MCP link is shown there with a **Copy** button:
   `https://millproof-xxxx.onrender.com/mcp?token=<MCP_TOKEN>`
   (You can also find the token in Render: web service → **Environment** → `MCP_TOKEN` → reveal.)

**Database:** the Blueprint creates a free Render Postgres database and connects it through `DATABASE_URL`, so records survive restarts and redeploys. The startup log line `[db] using Postgres (DATABASE_URL)` confirms it. Render's free Postgres expires 30 days after creation; upgrade it (Basic, $6/month) or create a new one before then.

On every start, MillProof re-checks every stored certificate against the current spec table (log line `[recheck] …`), so a spec-table change takes effect on old records too. A changed verdict is written to the audit trail, and an approval that no longer passes goes back to QA.

**Environment variables (set by the Blueprint)**

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | from millproof-db | Internal connection string, wired automatically |
| `MCP_TOKEN` | generated | The access key in the MCP link |
| `SESSION_SECRET` | generated | Signs the login cookie |
| `DEMO_USER` / `DEMO_PASSWORD` / `DEMO_NAME` | `qa@millproof.demo` / `MillProof@2026` / `Demo QA Engineer` | The test login |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin@millproof.demo` / generated | Admin login (delete records, reset demo data) |
| `NODE_VERSION` | `22` | |
| `NODE_ENV` | `production` | |
| `RENDER_EXTERNAL_URL` | set by Render | Used for record and share links, no action needed |

**If you'd rather not use the Blueprint (manual setup)**

1. **New + → Postgres**: Name `millproof-db`, Region Singapore, Plan **Free** → **Create Database**. When it's ready, copy the **Internal Database URL**.
2. **New + → Web Service** → pick the `millproof` repo. Set Language **Node**, Branch `main`, Region Singapore (same as the database), Build Command `npm install --include=dev && npm run build`, Start Command `npm start`, Instance Type **Free**.
3. Under **Environment Variables**, add `DATABASE_URL` (the internal URL), `MCP_TOKEN` (a long random string: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`), `SESSION_SECRET` (another random string), `DEMO_USER`, `DEMO_PASSWORD`, `NODE_VERSION=22`, `NODE_ENV=production`. Then click **Deploy Web Service**.

**D. Check the live deployment**

```bash
BASE_URL=https://millproof-xxxx.onrender.com MCP_TOKEN=<token> npm run smoke
```
After that, log in as admin and click **Reset demo data** on the Connect Claude page so the smoke-test record doesn't show up in your video.

## 2b. Keep it awake (no 50-second cold start)

Render's free web service sleeps after 15 minutes without traffic, and the next visitor waits about a minute. MillProof has a lightweight `GET /health` endpoint (no database query) for an uptime monitor to hit.

**Free option: UptimeRobot, every 5 minutes**
1. Go to https://uptimerobot.com and sign up (free plan).
2. Click **+ New monitor**.
3. **Monitor type:** HTTP(s). **URL:** `https://millproof.onrender.com/health`. **Friendly name:** MillProof.
4. **Monitoring interval:** 5 minutes (the free-plan default).
5. Leave alerting on your email, then click **Create monitor**. It should show **Up** within a minute.

The monitor pings every 5 minutes, inside Render's 15-minute idle window, so the service never sleeps. One always-on free service uses about 720 of Render's 750 free instance hours a month, so it fits, but only for one service.

**Paid option: Render Starter ($7/month)**
Web service → **Settings → Instance type → Starter**. Starter never spins down, so no monitor is needed. Pick this once real customers use the app. For a review lasting a week or two, the free monitor is enough.

## 3. Connect the live app to Claude

1. In Claude (claude.ai or the desktop app), open **Settings → Connectors**.
2. Click **Add custom connector**. Name: `MillProof`. URL: your full MCP link (`…/mcp?token=…`). Click **Add**.
3. Start a new chat, open the tools menu (the sliders icon under the message box), and make sure **MillProof** is switched on.
4. Attach `sample/SAMPLE_MTC_RK24-3561_photo.jpg` and send:
   > Read this mill test certificate and add it to MillProof. The supplier is Vardhan Steel Traders. Tell me the verdict and anything that failed or is missing.

   Claude calls `create_certificate` and replies with the verdict (PASS) and the record link.

**Troubleshooting**

- *"Couldn't connect" in Claude:* open `https://…onrender.com/health` first to wake the service (free tier sleeps), then retry. Check the URL includes `?token=`.
- *401 in the logs:* the token in the URL doesn't match `MCP_TOKEN`. Copy the link again from the Connect Claude page.
- *Your Claude client drops query strings:* use the path form instead: `https://…onrender.com/mcp/<MCP_TOKEN>`. Both forms work.
