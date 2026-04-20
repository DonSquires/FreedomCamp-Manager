# FieldOps Manager — System Guide

> **Audience**: Developers, DevOps engineers, and operators maintaining this platform.  
> **Last updated**: 2026-04-18

---

## 1. What This System Is

**FieldOps Manager** is a web-based admin control centre for freedom camping enforcement in New Zealand, operated by Iron Eagle Security / OnSpace AI.

Core capabilities:
- Live patrol monitoring and zone geofencing
- Breach management and compliance reporting
- Automatic Licence Plate Recognition (ALPR / NZSCV)
- Vehicle scanning via AI inference
- Officer welfare tracking and on-call rostering
- Multi-organisation (multi-tenant) support
- **Bob** — an embedded AI assistant powered by RunPod Serverless inference

---

## 2. Architecture Overview

```
Browser / Mobile
      │
      ▼
┌─────────────────┐     ┌───────────────────┐
│  Frontend (SPA) │────▶│  Supabase (PG+RLS)│
│  React / Vite   │     │  Edge Functions   │
└────────┬────────┘     └───────────────────┘
         │
         ├──▶  proxy-server  ──▶  NZSCV NZ plate lookup
         │
         ├──▶  Bob/Ollama inference ──▶  RunPod Serverless endpoint
         │
         └──▶  ptt-server (Push-To-Talk, Voice VPS 72.61.123.97)
```

### Services at a Glance

| Service | Location | Platform | Purpose |
|---------|----------|----------|---------|
| **Frontend** | `src/` | Vercel | React SPA — all admin / officer UI pages |
| **Bob/Ollama inference** | RunPod endpoint config (`INFERENCE_API_URL`) | RunPod Serverless | AI assistant — chat, translation, image analysis, pre-training |
| **proxy-server** | `proxy-server/` | Railway | Authenticated proxy for NZSCV NZ plate lookup API |
| **ptt-server** | `ptt-server/` | Voice VPS (`72.61.123.97`) | WebSocket push-to-talk relay between officers |
| **runpod-gateway** | `runpod-gateway/` | RunPod (Docker) | Optional authenticated gateway in front of RunPod inference |
| **Supabase** | `supabase/` | Supabase Cloud | PostgreSQL DB, Row Level Security, 45+ Edge Functions, Auth |
| **inference-service (Ollama)** | RunPod | RunPod Serverless | LLM inference for Bob workloads |

> **Current deployment baseline (2026-04):**
> - Bob/Ollama inference runs on **RunPod Serverless**.
> - PTT signaling runs on the **Voice VPS** (`72.61.123.97`).
> - **Railway is proxy-only** (`proxy-server` for IP-address-hosted integrations).

---

## 3. Platform Accounts & Credentials

### 3.1 GitHub Secrets (required by workflows)

All CI/CD secrets live in **GitHub → Settings → Secrets and variables → Actions**.

| Secret | Used by | Notes |
|--------|---------|-------|
| `RAILWAY_TOKEN` | Various | Fallback Railway token |
| `RAILWAY_PROXY_SERVICE_ID` | proxy deploy | Railway service ID for proxy-server |
| `BOB_SERVICE_URL` | Smoke tests, ops workflows | Live URL for inference-service on RunPod (e.g. `https://xxx.proxy.runpod.net`) |
| `BOB_GATEWAY_KEY` | Bob model workflows | Bearer token for RunPod Ollama gateway |
| `RUNPOD_GATEWAY_URL` | ops-upgrade-bob-model | Public URL for RunPod gate e.g. `https://xxx-8080.proxy.runpod.net` |
| `RUNPOD_ALLOW_DIRECT_OLLAMA` | Bob ops workflows | Optional safety flag (`true` only during incident bypass to direct `11434` URL). Default is gateway-only. |
| `RUNPOD_API_KEY` | RunPod SSH / API calls | RunPod API key |
| `RUNPOD_POD_SSH_KEY` | ops-upgrade-bob-model (SSH step) | Private key for SSH into RunPod pod |
| `RUNPOD_POD_HOST` | SSH steps | RunPod pod hostname or IP |
| `INFERENCE_API_KEY` | Smoke tests, frontend CI | Shared key to authenticate against Bob |
| `BOB_INFERENCE_API_KEY` | Alternate Bob auth | Alias of INFERENCE_API_KEY |
| `SUPABASE_ACCESS_TOKEN` | Edge function deploy | Supabase Management API token |
| `SUPABASE_PROJECT_REF` | Edge function / migration workflows | Project ref `kxwjcupuxnnbnzcgmkoi` |
| `SUPABASE_DB_URL` | DB migration workflows | `postgresql://...` connection string |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions calling admin API | Service role key (not anon) |
| `VITE_SUPABASE_URL` | Frontend build | Public Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend build | Supabase anon/public key |
| `VITE_INFERENCE_SERVICE_URL` | Frontend build | Bob endpoint URL |
| `VITE_PROXY_SERVER_URL` | Frontend build | Proxy-server endpoint URL |
| `GH_TOKEN` | Various ops scripts | GitHub PAT with `actions:write` |
| `GH_PAT` | Workflow triggers | GitHub PAT for cross-workflow dispatch |
| `NZSCV_API_KEY` | proxy-server runtime | NZSCV NZ plate lookup API key |
| `RAILWAY_PROXY_TOKEN` | deploy-proxy-railway | Railway token for proxy project |

> **Important**: Production secrets (`VITE_SUPABASE_URL_PRODUCTION`, etc.) must be stored separately if you use environment-specific builds.

### 3.2 RunPod Serverless Variables (Bob / Ollama)

Set via Supabase/hosted runtime environment and RunPod endpoint configuration:

| Variable | Purpose |
|----------|---------|
| `OPERATING_MODE` | `self-contained` — Bob manages its own inference connection |
| `CHAT_PROVIDER` | `ollama` |
| `INFERENCE_API_URL` | RunPod Serverless endpoint URL for Bob/Ollama inference |
| `OLLAMA_HOST` | URL to the runpod-gateway, e.g. `https://xxx-8080.proxy.runpod.net` |
| `OLLAMA_GATEWAY_KEY` | Bearer token for runpod-gateway |
| `OLLAMA_MODEL` | Active chat model, e.g. `llama3.1:8b`, `llama3.3:70b` |
| `OLLAMA_VISION_MODEL` | Vision model, e.g. `llava:7b`, `llava:13b` |
| `OLLAMA_MODEL_WRITING` | Model for report writing |
| `TRANSLATION_MODEL` | Model for real-time translation |
| `INFERENCE_API_KEY` | API key clients send to Bob |
| `NODE_ENV` | `production` |

### 3.3 Supabase

- **Project ref**: `kxwjcupuxnnbnzcgmkoi`
- **Dashboard**: https://supabase.com/dashboard/project/kxwjcupuxnnbnzcgmkoi
- **Edge functions** are in `supabase/functions/` and deployed via `deploy-edge-functions.yml`
- **Migrations** are in `supabase/migrations/` (70+ files, prefix `YYYYMMDD_*`)
- Row Level Security is enforced on all tables — do not disable without careful audit

### 3.4 RunPod

- Runs Bob/Ollama inference in Serverless mode
- The `runpod-gateway/` service acts as an authenticated reverse proxy in front of Ollama
- Bobby bears a `BOB_GATEWAY_KEY` to authenticate to the proxy
- Deploy gateway: `deploy-runpod-gateway.yml`
- Upgrade model: `ops-upgrade-bob-model.yml`

Stability-first posture:
- Prefer gateway route on port `8080` as default and keep direct `11434` disabled.
- Use `RUNPOD_ALLOW_DIRECT_OLLAMA=true` only for temporary incident bypass.
- If host health warning appears in RunPod dashboard, back up `/workspace` and migrate to a new pod/machine.
- Keep Ollama model storage on the network volume (`/workspace/ollama/models`).
- For stability under CUDA pressure, set `OLLAMA_NUM_PARALLEL=1` on the pod/template and only raise after stable operation.

### 3.5 Vercel

- Hosts the compiled frontend SPA (`dist/`)
- Deployment triggered by `deploy-frontend.yml` on push to `main`
- `vercel.json` contains SPA rewrite rules (all routes → `index.html`)

---

## 4. Development Setup

```bash
# 1. Clone and install dependencies
git clone <repo>
cd FreedomCamp-Manager
bun install

# 2. Set up environment
cp .env.example .env      # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY

# 3. Start dev server
bun run dev               # http://localhost:5173

# 4. Build for production
bun run build             # type-check + Vite bundle → dist/

# 5. Lint
bun run lint
```

**Sub-services** each have their own `package.json`:
```bash
cd inference-service && npm install && npm run dev
cd proxy-server       && npm install && npm run dev
cd ptt-server         && npm install && npm run dev
cd runpod-gateway     && npm install && npm start
```

**Required Node.js**: `>=24.0.0` for GitHub Actions JS actions/workflows and `runpod-gateway`; local dev remains compatible with current project constraints.

---

## 4.1 2026-04 Operational Hardening Updates

- **Workflow runtime baseline**: all Node-based workflows now use `actions/setup-node@v5` with Node 24.
- **Bob model upgrade verification**: `ops-upgrade-bob-model.yml` now normalizes gateway/Bob URLs and fails if deployed `OLLAMA_MODEL` / `OLLAMA_VISION_MODEL` do not match selected targets.
- **RunPod gateway runtime**: `runpod-gateway/package.json` now declares `"engines": { "node": ">=24" }`.
- **Edge AI egress policy guard**: selected Supabase edge functions now block direct `api.openai.com` calls by default.
      - To permit direct OpenAI calls temporarily, set `ALLOW_EDGE_OPENAI_DIRECT=true`.
      - Recommended production posture is to keep this unset/false and route AI through approved internal services.
- **Safety adapters in Bob**: inference service now exposes feature-flagged safety endpoints:
      - `GET /infer/safety/capabilities`
      - `POST /infer/audio/classify-nuisance`
      - `POST /infer/video/analyze-action`
      - `POST /infer/welfare/man-down`
      - `POST /safety/emergency/hot-mic/trigger`

- **Bob-assisted testing (enforced)**:
      - Root and inference-service `test*` scripts now route through `scripts/run-test-with-bob-assist.mjs`.
      - The wrapper calls Bob `/chat` before and after each test run for context + triage.
      - Required env vars for strict mode:
            - `BOB_SERVICE_URL` or `INFERENCE_SERVICE_URL` or `DR_BOB_URL` (HTTP endpoint only)
            - `BOB_INFERENCE_API_KEY` or `INFERENCE_API_KEY` (service-role fallback also accepted)
      - Default policy: tests fail if Bob assist is unavailable (`REQUIRE_BOB_TEST_ASSIST=true`).

---

## 5. Deploying Changes

### Frontend
```bash
git push origin main   # triggers deploy-frontend.yml → Vercel
```

### Bob (RunPod Serverless-backed)
```bash
# Bob/Ollama inference runs on RunPod Serverless.
# Update endpoint/config secrets and redeploy dependent services as needed.
```

### Edge Functions
```bash
# Automatic on push to main (changes in supabase/functions/)
# OR manual via GitHub Actions → deploy-edge-functions
```

### Database Migrations
1. Create migration: `supabase migration new <description>`
2. Write SQL in `supabase/migrations/<timestamp>_<description>.sql`
3. Push: `supabase db push` (or trigger `ops-migrate-db.yml`)

### Proxy-server / PTT-server
```bash
# Proxy: deploy-proxy-railway (Railway)
# PTT: deploy-voice-server (Voice VPS)
```

---

## 6. How Bob Works

```
User message
      │
Frontend (React)
      │  POST /chat
      ▼
Bob service runtime
      │
      │  OPERATING_MODE=self-contained
      │  CHAT_PROVIDER=ollama
      │
      │  POST /api/chat
      ▼
runpod-gateway (RunPod)
      │  validates Bearer → BOB_GATEWAY_KEY
      │  forwards to Ollama
      ▼
Ollama (RunPod GPU)
      │  runs OLLAMA_MODEL (e.g. llama3.3:70b)
      ▼
response bubbles back up
```

Bob also supports:
- **Vision** — send images for ALPR or scene analysis (`OLLAMA_VISION_MODEL`)
- **Translation** — real-time officer chat translation (`TRANSLATION_MODEL`)
- **Pre-training** — ingests incident reports to improve responses (`ops-bob-pretrain-on-push.yml`)
- **Self-learning** — nightly training on accumulated data (`ops-nightly-self-learning-pretrain.yml`)

### Upgrading Bob's Model

Run workflow: **`ops-upgrade-bob-model.yml`** (GitHub Actions → Actions tab)

The workflow:
1. SSHes into RunPod pod
2. Detects available VRAM via `nvidia-smi`
3. Pulls the largest model that fits: `qwen2.5:72b` → `llama3.3:70b` → `qwen2.5:32b` → `mistral:22b` → `llama3.1:8b`
4. Updates Railway env vars (`OLLAMA_MODEL`, `OLLAMA_VISION_MODEL`, etc.)
5. Redeploys Bob and smoke-tests the new model

> **Tip**: The `RUNPOD_GATEWAY_URL` and `RUNPOD_POD_HOST` secrets must be set for this workflow to succeed.

---

## 7. CI/CD Workflows Reference

### Active Deploy Workflows
| Workflow | Trigger | Does |
|----------|---------|------|
| `deploy-frontend.yml` | push to main | Builds + deploys to Vercel |
| `deploy-edge-functions.yml` | push to main | Deploys all Supabase Edge Functions |
| `deploy-proxy-railway.yml` | push to main / manual | Deploys proxy-server to Railway |
| `deploy-runpod-gateway.yml` | manual | Builds + pushes runpod-gateway Docker image |
| `deploy-voice-server.yml` | manual | Deploys ptt-server to the Voice VPS (`72.61.123.97`) |
| `deploy-mobile.yml` | manual | Builds Expo mobile app (EAS) |

### Ops / Maintenance Workflows
| Workflow | Trigger | Does |
|----------|---------|------|
| `ops-upgrade-bob-model.yml` | manual | Detect GPU, pull best Ollama model, redeploy Bob |
| `ops-railway-wiring-audit.yml` | manual | Verifies all Railway env vars are correctly set |
| `ops-bob-human-interaction-smoke.yml` | schedule / push | Chat smoke test against Bob |
| `ops-bob-pretrain-on-push.yml` | push (incident data) | Sends new incidents to Bob for pre-training |
| `ops-nightly-self-learning-pretrain.yml` | schedule (nightly) | Nightly Bob self-improvement training |
| `ops-migrate-db.yml` | manual | Runs pending Supabase migrations |
| `ops-geofence-review.yml` | schedule (monthly) | Reviews zone/geofence boundaries |
| `ops-parkpow-sync.yml` | schedule | Syncs ParkPow plate data |
| `ops-data-migration.yml` | manual | One-off data migration runner |
| `ops-intel-feed-sync.yml` | schedule | Pulls intelligence feed updates |
| `ops-generate-keystore.yml` | manual | Generates Android keystore for mobile builds |
| `ops-set-bob-gateway-key.yml` | manual | Rotates BOB gateway credentials for RunPod access |
| `ops-bob-ask-copilot.yml` | manual | Asks Copilot to generate code / answers |
| `ops-bob-code-task.yml` | manual | Runs a Bob-driven code task |
| `ops-bob-assess-failed-actions.yml` | on workflow_run failure | Triage failed workflow runs |
| `ops-triage-bug-reports.yml` | on issue open | Auto-triages GitHub issues |
| `ops-close-resolved-bugs.yml` | schedule | Closes resolved bug reports |
| `bug-report-escalator.yml` | on issue label | Escalates critical bugs |
| `synthetic-monitor.yml` | schedule | End-to-end synthetic health check |
| `build-plan-crossover-gates.yml` | push / PR | Build plan gate checks |
| `db-migration-check.yml` | PR | Validates migration files |
| `db-push.yml` | manual | Direct db push (staging only) |
| `db-run-migrations.yml` | push to main | Auto-run migrations post-deploy |
| `db-schema-extract.yml` | manual | Extracts current live schema to file |
| `playwright-deep-functional-cross-browser.yml` | schedule / manual | Full E2E cross-browser test suite |

### Dead / Removed Workflows (do not recreate)
| Workflow | Reason removed |
|----------|---------------|
| `deploy-railway.yml` | Legacy ONNX Railway deploy removed |
| `deploy-bob-railway.yml` | Bob/Ollama moved to RunPod Serverless |
| `deploy-ollama-railway.yml` | Bob/Ollama moved to RunPod Serverless |
| `deploy-ptt-railway.yml` | PTT moved to Voice VPS (`72.61.123.97`) |
| `ops-fix-inference-vars.yml` | One-shot purpose fulfilled |
| `set-ptt-secret.yml` | One-shot purpose fulfilled |

### Workflows Requiring Missing Secrets (will silently fail)
| Workflow | Missing secret |
|----------|---------------|
| `sync-bob-repo.yml` | `BOB_SYNC_PAT` |
| `ops-bob-feedback-sync.yml` | `BOB_FEEDBACK_SYNC_URL`, `BOB_FEEDBACK_SYNC_KEY` |
| `ops-import-maps.yml` | `STATSNZ_API_KEY` |

---

## 8. Supabase Edge Functions Reference

All 45+ functions live in `supabase/functions/`. Key groups:

### Auth / User Management
- `manage-user` — create/update/delete users
- `get-user-organizations` — fetch orgs for a user
- `assign-officer` — link officer to a site/org

### Patrol & Compliance
- `recalculate-compliance` / `recalculate-compliance-v3` — compliance scoring
- `cleanup-and-recalculate` — purge old data and recompute
- `duplicate-detection` — finds duplicate patrol records
- `observations-list` / `observations-in-bounds` — incident observation queries
- `zone-correction` — corrects observations to nearest zone

### AI / Inference
- `analyze-vehicle-photo` — ALPR analysis via inference-service
- `select-best-vehicle-photo` — picks best image from a set
- `process-investigation-document` — extracts info from documents
- `process-credential-document` — credential OCR/parsing
- `process-homeless-data` — process welfare check data

> ⚠️ **Known issue**: Several edge functions above call `api.openai.com` directly. These should be re-routed through `inference-service` for consistency with the self-hosted LLM architecture. This is logged as a future refactor.

### Reporting
- `generate-dashboard-report` — aggregate patrol dashboard data
- `generate-incident-pdf` / `generate-leadership-pack` / `generate-vehicle-report` — PDF reports
- `export-data` — data export endpoint

### Comms
- `send-invite-email` / `send-report-email` — transactional email
- `translate-message` — real-time language translation via Bob
- `orc-ingest` — ingest data from ORC (Otago Regional Council)

### Photos / Files
- `photo-maintenance` — cleanup old photos
- `upload-file` — presigned file upload
- `alpr-retry` — retry failed ALPR scans

---

## 9. Database Conventions

- All tables have Row Level Security enabled
- Tenant isolation: every table has an `organization_id` column scoped by RLS policy
- Migrations live in `supabase/migrations/` with prefix `YYYYMMDD_<desc>.sql`
- Generated TypeScript types are in `src/types/database.ts` — regenerate after schema changes:
  ```bash
  supabase gen types typescript --project-id kxwjcupuxnnbnzcgmkoi > src/types/database.ts
  ```

---

## 10. User Roles

| Role | Access |
|------|--------|
| `master` | Full system access, all organizations |
| `admin` | Full access within their organization |
| `admin_officer` | Admin + field officer combined access |
| `officer` | Field officer portal only |

Role logic is enforced in `src/stores/authStore.ts` and route guards in `src/App.tsx`.

---

## 11. Routine Operations Checklists

### Weekly
- [ ] Check `synthetic-monitor.yml` run results in GitHub Actions
- [ ] Review `ops-bob-human-interaction-smoke.yml` pass/fail
- [ ] Check RunPod endpoint health in the RunPod dashboard

### Monthly
- [ ] Run `ops-geofence-review.yml` — validate zone boundaries
- [ ] Review RunPod model/version posture before upgrades
- [ ] Check for unmaintained package updates in `package.json`

### As Needed
- **Bob model upgrade**: GitHub Actions → `ops-upgrade-bob-model` → Run workflow
- **DB schema change**: `supabase migration new <name>` → edit → `db-run-migrations.yml`
- **New edge function**: Create `supabase/functions/<name>/index.ts`, follow `_shared/withCors.ts` pattern, deploy via `deploy-edge-functions.yml`
- **Rotate gateway key**: Run `ops-set-bob-gateway-key.yml` → update `BOB_GATEWAY_KEY` secret, update RunPod-facing runtime config

---

## 12. Troubleshooting

### Bob not responding
1. Check RunPod endpoint health — is Bob/Ollama inference up?
2. `GET https://<BOB_URL>/health` — circuit breaker state should be `closed`
3. Check RunPod pod is running — `OLLAMA_HOST` must be reachable
4. Validate RunPod endpoint and gateway env vars (`INFERENCE_API_URL`, `OLLAMA_HOST`, `BOB_GATEWAY_KEY`)
5. Run `ops-bob-human-interaction-smoke.yml` for a full chat probe

### Plate lookup not working
1. Check proxy-server is running on Railway
2. Verify `NZSCV_API_KEY` is set in Railway env
3. Check `VITE_PROXY_SERVER_URL` is set in frontend env

### Edge function errors
1. Check Supabase dashboard → Edge Functions → Logs
2. Ensure function follows CORS pattern — all functions must handle `OPTIONS` + use `withCors.ts`
3. Ensure function uses `Deno.serve()` (not legacy `serve()` from std/http/server)

### Migration drift / type mismatch
1. Run `db-schema-extract.yml` to get live schema
2. Compare against `src/types/database.ts`
3. Regenerate types: `supabase gen types typescript --project-id kxwjcupuxnnbnzcgmkoi`

### GitHub Actions authentication failures
- All Railway workflows use `scripts/load-railway-secrets-from-github-env.sh` to normalize token aliases (`RAILWAY_BOB_TOKEN` / `RAILWAY_TOKEN` → single effective token)
- If a workflow silently fails authentication, check that at least one of `RAILWAY_BOB_TOKEN` or `RAILWAY_TOKEN` is set as a GitHub secret

---

## 13. Technology Decisions & Rationale

| Decision | Why |
|----------|-----|
| Supabase over custom backend | RLS, auth, realtime, edge functions — minimal infra overhead |
| Railway for Node services | Auto-deploy from GitHub, simple env var management |
| RunPod for LLM | GPU-on-demand — cheaper than dedicated GPU server at this scale |
| Ollama on RunPod | Run open-source LLMs locally — no OpenAI dependency for Bob |
| `runpod-gateway` | Adds auth + rate limiting in front of Ollama (RunPod pods are publicly reachable by URL) |
| Bun over npm/pnpm | Faster installs and builds for the frontend monorepo |
| shadcn/ui components | Unstyled Radix UI primitives + Tailwind — full control, accessible by default |
