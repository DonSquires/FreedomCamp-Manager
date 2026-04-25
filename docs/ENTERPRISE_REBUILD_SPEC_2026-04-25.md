# Enterprise Rebuild Spec (2026-04-25)

## Goal

Produce a grounded enterprise-grade restructure plan for:

1. Backend structure
2. Frontend structure
3. UX/UI and information architecture
4. Wiring harness and integration contracts
5. Delivery pipelines and release governance

The plan must stay on the current stack and deployment topology:

- React 18 + TypeScript + Vite
- Supabase Postgres + RLS + Edge Functions
- Railway proxy services
- RunPod serverless inference
- Vercel web hosting
- hPanel/VPS for PTT runtime
- GitHub Actions CI/CD
- User-specified DNS/domain provider context: iwantmyname.com

## Grounding Inputs

1. `system_state.json`
2. `docs/STACK_ACCESS_MAP.md`
3. `docs/LIVE_SCHEMA.md`
4. `docs/LIVE_FUNCTIONS.md`
5. Latest migrations, including:
   - `supabase/migrations/20260613000001_organizations_payment_config.sql`
   - `supabase/migrations/20260612000003_zone_legal_fields_and_seasonal.sql`
   - `supabase/migrations/20260612000002_ptt_clips_org_isolation.sql`
   - `supabase/migrations/20260612000001_ptt_channel_acl.sql`
6. Existing enterprise tracker and redesign docs:
   - `docs/APP_ENTERPRISE_EXECUTION_TRACKER_2026-04-25.md`
   - `docs/APP_ENTERPRISE_REDESIGN_PLAN_2026-04-25.md`

## Non-Goals

1. Replacing the stack with ungrounded frameworks.
2. Immediate migration deletion or destructive schema teardown.
3. Introducing architecture elements that are not verifiable from repo state or explicit user direction.

## Acceptance Criteria

1. Two independent plans are produced:
   - Copilot-authored plan
   - Bob-generated independent plan
2. Both plans are reviewed with Dr Bob.
3. Human test engine run is executed for validation evidence.
4. A merged final plan is produced from best grounded components.

## Self-Critique (Required)

1. Risk: plan-only output can over-index on structure and under-index on measurable implementation effort.
   - Mitigation: include ticketized milestones and explicit validation gates.

2. Risk: Bob output may contain partial hallucinations even with constrained prompts.
   - Mitigation: isolate Bob suggestions and only merge grounded, stack-compatible items.

3. Risk: environment auth drift can block Dr Bob or runtime checks.
   - Mitigation: document any gate blocker explicitly and preserve auditable evidence from commands.
