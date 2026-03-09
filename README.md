# FreedomCamp Manager

Web-based admin control centre for freedom camping enforcement in New Zealand.
Provides live patrol monitoring, breach management, zone geofencing, compliance
reporting, vehicle scanning (ALPR), officer welfare tracking, and
multi-organisation support.

**Tech stack:** React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui ·
Supabase (PostgreSQL + Edge Functions) · Bun

---

## Quick start

```bash
cp .env.example .env          # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
bun install
bun run dev                   # http://localhost:5173
```

For a full deployment walkthrough see [`ONLINE_DEPLOYMENT_GUIDE.md`](ONLINE_DEPLOYMENT_GUIDE.md).

---

## Deployment with Vercel — CI/CD Secret Setup

The repository ships a GitHub Actions workflow
(`.github/workflows/deploy-vercel.yml`) that builds and deploys the web admin
portal to Vercel on every push to `main`.  The workflow requires **three
repository secrets** to authenticate with the Vercel CLI.  Without them the
deployment step is skipped and you will see errors such as:

```
Error: No existing credentials found. Please run `vercel login` or pass
       --token
```

or

```
::warning::Vercel secrets not configured (VERCEL_TOKEN VERCEL_ORG_ID
VERCEL_PROJECT_ID) — deployment skipped.
```

### Required secrets

| Secret name | Description |
|---|---|
| `VERCEL_TOKEN` | Personal access token that authenticates the Vercel CLI |
| `VERCEL_ORG_ID` | Your Vercel team/personal account ID |
| `VERCEL_PROJECT_ID` | The ID of the linked Vercel project |

### Step 1 — Create a Vercel personal access token

1. Log in to Vercel and open **[Account → Tokens](https://vercel.com/account/tokens)**.
2. Click **Create** and give the token a descriptive name (e.g. `github-actions`).
3. Set the scope to your team (or personal account) and choose an expiry that
   suits your security policy.
4. Click **Create Token** and **copy the value immediately** — it is shown only
   once.

### Step 2 — Find your Org ID and Project ID

**VERCEL_ORG_ID**
- Open **Vercel Dashboard → Settings → General**.
- Copy the value labelled **Team ID** (teams) or **Personal Account ID**
  (personal accounts).  It looks like `team_xxxxxxxxxxxx`.

**VERCEL_PROJECT_ID**
- Open your project in the Vercel Dashboard.
- Go to **Settings → General** and copy the **Project ID**.
  It looks like `prj_xxxxxxxxxxxx`.

> **Tip:** Running `vercel link` locally inside the repository also writes both
> IDs to `.vercel/project.json` (`orgId` and `projectId`).

### Step 3 — Add the secrets to GitHub

1. Navigate to your GitHub repository.
2. Click **Settings** (top navigation bar).
3. In the left sidebar choose **Secrets and variables → Actions**.
4. Click **New repository secret** for each of the three secrets:
   - **Name:** `VERCEL_TOKEN` — **Value:** the token you created in Step 1.
   - **Name:** `VERCEL_ORG_ID` — **Value:** your team/account ID from Step 2.
   - **Name:** `VERCEL_PROJECT_ID` — **Value:** your project ID from Step 2.

After saving all three secrets, push a commit to `main` (or manually trigger
the workflow from **Actions → Deploy to Vercel → Run workflow**) to verify
that the deployment succeeds.

### Step 4 — Set build environment variables (optional)

The build step requires the Supabase connection details to embed the correct
API URL into the bundle.  Add these as **repository secrets** (or as Vercel
environment variables in the project dashboard):

| Secret name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your project's `anon` / public key |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `No existing credentials found` / deployment skipped | `VERCEL_TOKEN` is missing or empty | Re-add the secret (Step 3) |
| `Invalid token` or `403 Forbidden` | Token was deleted or has expired | Generate a new token (Step 1) and update the secret |
| `Project not found` | `VERCEL_PROJECT_ID` is wrong | Re-copy the Project ID from Vercel Dashboard → Project → Settings → General |
| `Team not found` | `VERCEL_ORG_ID` is wrong | Re-copy the Team/Account ID from Vercel Dashboard → Settings → General |
| Build succeeds but app shows blank page | `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing | Add the missing secret (Step 4) |
| Workflow is skipped entirely on push to `main` | All three Vercel secrets are absent | The workflow intentionally skips to avoid failing on forks; add the secrets (Step 3) |

If you are relying on **Vercel's native GitHub integration** (i.e. Vercel
auto-deploys via its own GitHub App rather than the CLI workflow), you can
ignore the `VERCEL_TOKEN` warning — the workflow safely skips itself and
Vercel's integration handles the deployment independently.

---

## Further reading

- [`ONLINE_DEPLOYMENT_GUIDE.md`](ONLINE_DEPLOYMENT_GUIDE.md) — complete
  browser-only deployment walkthrough (Supabase + Vercel + Railway)
- [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) — detailed deployment
  options including Railway and manual hosting
- [`docs/NEW_PROJECT_SETUP.md`](docs/NEW_PROJECT_SETUP.md) — full new-project
  setup guide
- [`docs/JURISDICTION_BOUNDARY_SETUP.md`](docs/JURISDICTION_BOUNDARY_SETUP.md) —
  bulk setup for NZ jurisdiction boundaries (GeoBoundaries/Stats NZ source)
- [Vercel token management](https://vercel.com/account/tokens)
- [GitHub encrypted secrets docs](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
