# FieldOps Manager – Copilot Coding Agent Instructions

## Project Summary

**FieldOps Manager** is a web-based admin control centre for freedom camping enforcement in New Zealand, operated by Iron Eagle Security / OnSpace AI. It provides live patrol monitoring, breach management, zone geofencing, compliance reporting, vehicle scanning (ALPR), officer welfare tracking, and multi-organisation support.

**Size / type**: ~80 page components, 45+ Supabase Edge Functions, 70+ database migrations. Large TypeScript SPA backed by Supabase.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui (Radix UI) |
| State | Zustand (`src/stores/`), TanStack Query v5 |
| Forms | react-hook-form + zod |
| Charts | recharts |
| Routing | react-router-dom v6 |
| Backend | Supabase (PostgreSQL + Edge Functions + Row Level Security) |
| Services | `proxy-server/` (NZSCV, Node/Express), `inference-service/` (ONNX AI, Node) |
| Package manager | **npm** (`package-lock.json` at root) |

---

## Project Layout

```
/
├── src/
│   ├── App.tsx               # Main router (Login → PortalSelection → Field/Admin)
│   ├── main.tsx              # Entry point
│   ├── pages/                # 80+ page components (AdminPortal, FieldOfficerPortal, …)
│   ├── components/
│   │   ├── ui/               # shadcn/ui primitives (button, dialog, form, …)
│   │   ├── features/         # App-specific feature components
│   │   └── layout/           # Navigation, sidebar, containers
│   ├── hooks/                # Custom React hooks (useVehicles, usePatrols, useCompliance, …)
│   ├── stores/               # Zustand stores: authStore.ts, globalFiltersStore.ts
│   ├── lib/                  # supabase.ts client, fileUpload.ts, geocoding.ts, …
│   └── types/                # database.ts (generated Supabase types), index.ts
├── supabase/
│   ├── functions/            # 45 Edge Functions (TypeScript/Deno), _shared/ for CORS helpers
│   └── migrations/           # SQL migrations (70+ files, prefix YYYYMMDD_*)
├── proxy-server/             # NZSCV proxy (Node/Express, own package.json)
├── inference-service/        # ORC AI ONNX inference (Node, own package.json)
├── docs/                     # Architecture docs, feature flags
├── index.html                # Vite HTML entry
├── tailwind.config.ts
├── tsconfig.json             # References tsconfig.app.json + tsconfig.node.json
└── package-lock.json                  # npm lockfile
```

Path alias: **`@/*`** → `./src/*` (defined in `tsconfig.json` and Vite config).

---

## Build & Development

> **Important**: Ensure the root `package.json` exists before running npm commands.

A standard root `package.json` for this project:

```json
{
  "name": "vite_react_shadcn_ts",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
```

```bash
# Install dependencies (run first after cloning or after package.json changes)
npm install

# Start dev server (http://localhost:5173 by default)
npm run dev

# Type-check + production build (output in dist/)
npm run build

# Lint (ESLint 9 flat config)
npm run lint

# Preview production build
npm run preview
```

**Environment**: copy `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

**Sub-services** (each has its own `package.json`):
```bash
cd proxy-server && npm install && npm run dev    # NZSCV proxy
cd inference-service && npm install && npm run dev  # AI inference
```

---

## Key Patterns & Conventions

### Supabase Client
Always import from `@/lib/supabase`: `import { supabase } from '@/lib/supabase'`. The client is typed with `Database` from `@/types/database`.

### Database Types
Types are in `src/types/database.ts`. Use `Database['public']['Tables']['table_name']['Row']` for row types.

### Edge Functions
- Located in `supabase/functions/<name>/index.ts` (Deno TypeScript)
- Always import CORS headers from `../_shared/cors.ts`
- Always handle `OPTIONS` preflight: `if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })`

### Components
- UI primitives: use shadcn/ui components from `src/components/ui/` (never re-implement them)
- Import with `@/components/ui/button` etc.
- Feature components go in `src/components/features/`

### User Roles
Four roles: `admin`, `master`, `officer`, `admin_officer`. Logic in `authStore.ts` and route guards in `App.tsx`.

### TypeScript Config
Lenient settings: `noImplicitAny: false`, `strictNullChecks: false`, `skipLibCheck: true`. Do not tighten these settings when making changes.

### Timezone
All datetimes are NZ timezone (`Pacific/Auckland`). The Supabase client sends `X-Client-Timezone: Pacific/Auckland`.

### Bob Service Context
- Bob is a service-provider AI assistant for compliance workflows (biosecurity, smoke/noise assessment, PTT diagnostics, and operational triage).
- In multi-container development, prefer `OLLAMA_BASE_URL=http://ollama:11434` (service name), not unstable container IPs.
- For Bob background/admin tasks (non-user interactive), use service-role authorization where required (`SUPABASE_SERVICE_ROLE_KEY`) and never hardcode secrets.
- For tenant-aware Bob requests, include org context headers (`x-org-id`) using `BOB_ORG_ID` / `ORG_ID` / `DEFAULT_ORG_ID`.

## AMBIENT INTERACTION PROTOCOLS

- **VOICE-FIRST DESIGN:** Always prioritize Voice-to-Action (STT) over manual form entry for the Mobile/Expo module.
- **WAKE WORD:** Implement 'Hey Bob' using Picovoice for hands-free patrol updates.
- **INTENT MAPPING:** Use Semantic Extraction to turn PTT audio into structured JSON before saving to the `incidents` table.
- **PROACTIVE ALERTS:** If a 'Missed Patrol' occurs, Bob should trigger a TTS (Text-to-Speech) call to the supervisor using ElevenLabs.
- **HAPTIC FEEDBACK:** Every AI-confirmed action must trigger a 'success' haptic vibration on the mobile device.

---


## Validation

After making changes, always verify:
1. `npm run build` succeeds (TypeScript + Vite)
2. `npm run lint` has no new errors
3. Any modified Supabase Edge Function follows the CORS + OPTIONS pattern
4. New database columns match the types in `src/types/database.ts`

## Testing Guidelines

### Cloud Simulator Verification (Bob)

- Enforce the use of the new comment-triggered verification workflow (`ops-bob-e2e-validation.yml`).
- If local browser environments crash due to system linker/Chromium errors, the AI must pivot to fetch-native endpoint tests or trigger the cloud simulator instead of trying to force local browser executions.
- Code must only be merged after Bob delivers a green behavioral report directly inside the PR thread.

## Bob Truth Protocol

- Treat `system_state.json` as the first source of truth for redesigns, new modules, package-manager choices, and repo topology.
- If a module, service, or package manager is not grounded in `system_state.json`, existing files, or explicit user instruction, state that it cannot be verified instead of inventing it.
- Before actioning any Bob task, verify the live schema and the relevant source documents first; do not rely on stale summaries when the repo has changed.
- When a customer proposal or contract excerpt names facilities, treat those named locations as CRM site/LOI records for the owning organization unless the live schema says otherwise.
- For major architecture work, follow this order: `spec.md` → self-critique with at least 3 flaws → `plan.md` → implementation ticket by ticket → validation → final completion claim.
- If an artifact references module paths or features that are not grounded in the repo or `system_state.json`, treat that as a blocker.
- Read `docs/DECISIONS.md` when a pattern seems ambiguous or historically driven.
- Before making any change, run an intent validation gate and state the answers explicitly in your working notes:
  - Should this item exist in this area of the product and codebase?
  - How should it work from a user and role perspective?
  - What exact result should be visible after the change?
  - Where should the flow navigate or persist data next?
  - What should happen immediately after success and after failure?
- If any answer is unclear or contradicted by existing routes/components/policies, stop and resolve the mismatch before editing code.

## Final Ecosystem Checklist

| Phase | Action | Tool/Script |
| --- | --- | --- |
| Identity | Set the Truth Protocol | `.github/copilot-instructions.md` |
| Logic | Enable Multi-Org context | `useOrganization()` hook template in `docs/BOB_USER_MANAGEMENT_GOLD_STANDARD.md` |
| Memory | Automate ingestion | `scripts/auto-ingest.mjs` |
| Safety | Adversarial Review | `scripts/dr-bob-review.mjs` |
| Growth | Score the responses | `data/bob-response-scores.jsonl` |

## Self-Ingesting Architecture

- `scripts/auto-ingest.mjs` builds `docs/BOB_BRAIN_DUMP.md` from the repo's living architecture sources. Prefer refreshing that file over manually pasting the same context repeatedly.
- The ingestor should prioritize: `docs/architecture*`, `docs/DECISIONS.md`, `docs/LESSONS_LEARNED.md`, `docs/BOB_FAILURE_SUMMARY.md`, `docs/BOB_TRAINING_TRUTH_PROTOCOL.md`, `docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md`, `src/pages`, `src/components`, `src/hooks`, `src/stores`, `supabase/functions`, `scripts`, `package.json`, `system_state.json`, and this instruction manifest.
- Include `docs/adr/` in the ingestion set so finalized architecture decisions become part of Bob's permanent memory.
- If `docs/BOB_BRAIN_DUMP.md` exists, treat it as a summary context file, but defer to live files when the dump and repo differ.
- On Codespaces or VPS automation, use `node scripts/auto-ingest.mjs` on a schedule or before major Bob sessions.

## Architectural Decision Records

- Every finalized module or architecture decision should create a new ADR in `docs/adr/00X-name.md`.
- ADRs are Bob's permanent design memory. Use the template in `docs/adr/000-template.md`.
- Read ADRs before proposing contradictory redesigns.

## Visual Reasoning

- For complex UX, multi-org, or cross-service flows, generate Mermaid diagrams in Markdown before implementation.
- Prefer sequence diagrams or flowcharts that show active org resolution, authorization boundaries, and mutation paths.
- Use diagrams to verify multi-org behavior before writing React or Supabase code.

## Autonomous Learning Mode

- Daily system discovery: start sessions by running `bash scripts/system-check.sh` or `node scripts/broadcast-truth-protocol.mjs` so runtime facts are grounded before advice.
- Fail-fast feedback loop: once per session, run `node scripts/summarize-failures.mjs`, review `data/bob-failure-summary.json`, and name the top 3 failure or hallucination patterns before continuing major architecture work.
- Never Use Until Verified rule: if `scripts/summarize-failures.mjs` reports any repeated hallucination pattern with count >= 3, treat it as session-blocked until the repo or `system_state.json` proves it exists.
- Adversarial self-review: do not present major architecture or new feature plans until they pass `node scripts/dr-bob-review.mjs --file <artifact>` or `node scripts/review-architecture-artifacts.mjs`.
- Lessons learned memory: when Dr Bob finds a real blocker or security flaw, append the resolved lesson to `docs/LESSONS_LEARNED.md`.
- Historical memory: use `docs/DECISIONS.md` for durable architecture choices; do not invent a parallel `docs/architecture-drivers/DECISIONS.md` path unless that folder is created in the repo.
- Self-healing monitor: use `bash scripts/monitor-bob.sh` to detect 500-error spikes and append a `critical_warning` into `system_state.json` when Bob's runtime health degrades.
- Change intent discipline: before any code edit, verify route-to-component mapping, role access, expected UI result, and post-action flow; treat assumptions as blockers until verified in files.

## External Learning References

- Model Context Protocol (MCP): use MCP-style live retrieval when the environment exposes MCP tools instead of relying on stale pasted context.
- RAG guidance: prefer searching the repo and training docs over guessing; ground answers with live files and generated context artifacts.
- Greptile-style codebase indexing is useful in principle for large-repo understanding, but do not claim it is configured here unless a real integration exists.
- LangSmith-style evaluation concepts apply to `data/bob-response-scores.jsonl`; use them to refine local scoring heuristics without claiming LangSmith is wired into this repo.
- UI polish references like UX Collective are inspiration only; follow the established product language unless a redesign is explicitly requested.
- Backend/VPS safety guidance should follow Twelve-Factor App principles when shaping deployable services.
- Multi-tenancy guidance should align with the repo's organization-scoping rules and tenant isolation proof requirements.

## Session Prompt

- Autonomous Learning Mode prompt:
  Bob, you are now in Autonomous Learning Mode. Follow these steps to stay updated without my intervention: Context Sync: every 10 messages, verify the current repo shape with a grounded file-tree check such as `find src -maxdepth 2 -type f`. Review the Scorecard: once per session, read `data/bob-response-scores.jsonl` through `node scripts/summarize-failures.mjs`, identify your top 3 hallucination patterns, and state how you will avoid them. Update the Brain: if we solve a complex bug together, you are authorized to append a summary to `docs/DECISIONS.md`. Adversarial Check: do not submit major code or architecture work without first passing it through `scripts/dr-bob-review.mjs`.

## MCP Guidance

- Prefer live workspace and MCP-backed context over memory when the environment exposes it.
- For database or live Python context, use the available MCP tools rather than guessing from stale documentation.
- MCP is the preferred way to inspect current local files, schemas, and services in real time; do not claim MCP-backed state unless it was actually queried.

## Normal Chat Training Tools

| Tool | File Path | Training Function |
|---|---|---|
| Response Logger | `scripts/bob-response-log.mjs` | Records Bob's successes and hallucinations. |
| Adversarial Review | `scripts/dr-bob-review.mjs` | Uses Dr. Bob to find "Blockers" in plans. |
| Truth Broadcaster | `scripts/broadcast-truth-protocol.mjs` | Syncs current VPS state to Bob's brain. |
| Instruction Manifest | `.github/copilot-instructions.md` | Bob's "Permanent Memory" for rules. |

Trust these instructions. Only search the codebase if information here is incomplete or appears incorrect.
