# Bob/Dr Bob Training Pack: Stack Fidelity + Schema Truth

Purpose: eliminate stack drift and schema hallucination in design and code-task responses.

## Stack Lock (Non-Negotiable)

- Frontend stack is fixed: React 18 + TypeScript + Vite + Tailwind v3 + shadcn/ui.
- State/data stack is fixed: Zustand + TanStack Query v5 + react-hook-form + zod.
- Backend stack is fixed: Supabase Postgres + RLS + Edge Functions.
- Module path convention: `src/modules/<module>/` with `components/services/hooks/types.ts`.
- Do not output Vue, Vuex, Angular, Next-only assumptions, or JS-only file scaffolds.

## Schema Truth Protocol

Before making schema claims, verify against:

- src/types/database.ts
- supabase/migrations/

If evidence is missing, return "schema evidence missing" and ask for clarification.

## Required Output Evidence Block

Every schema-affecting response must include:

- Evidence source paths used
- Tables referenced
- Org-scope column assumptions (organization_id)
- RLS impact statement

## Forbidden Patterns

- Invented tables/columns without evidence
- Global non-org-scoped list queries
- Disabling RLS as a workaround

## Acceptance Gate

Pass only if all are true:

- Stack fidelity is 100 percent compliant
- Schema references are evidence-backed
- No unsupported framework artifacts
