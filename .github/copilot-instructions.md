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
| Package manager | **bun** (`bun.lock` at root) |

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
└── bun.lock                  # Bun lockfile (no root package.json is committed)
```

Path alias: **`@/*`** → `./src/*` (defined in `tsconfig.json` and Vite config).

---

## Build & Development

> **Important**: There is **no committed root `package.json`**. If one is missing, create it before running bun commands.

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
bun install

# Start dev server (http://localhost:5173 by default)
bun run dev

# Type-check + production build (output in dist/)
bun run build

# Lint (ESLint 9 flat config)
bun run lint

# Preview production build
bun run preview
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

---

## Validation

After making changes, always verify:
1. `bun run build` succeeds (TypeScript + Vite)
2. `bun run lint` has no new errors
3. Any modified Supabase Edge Function follows the CORS + OPTIONS pattern
4. New database columns match the types in `src/types/database.ts`

Trust these instructions. Only search the codebase if information here is incomplete or appears incorrect.
