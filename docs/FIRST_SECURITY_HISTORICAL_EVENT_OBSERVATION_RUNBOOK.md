# First Security Historical Event Observation Runbook

Date: 2026-05-21
Owner: Platform Engineering
Scope: First Security branch historical imports that must persist site events into the observation graph.

---

## Purpose

This runbook defines the required behavior for historical event ingestion in First Security branches:

1. Every valid event row must become an observation record.
2. Every observation must be linked to organization, zone, and LOI where available.
3. Vehicle identity must resolve through canonical vehicle records.
4. Imports must be idempotent and replay-safe.

Do not assume table shape, field names, or route behavior. Check the instruction manual and live schema before execution.

---

## Quick-Start Operator Card

Use this sequence for historical ingestion runs where event rows must land in observations.

1. Preflight

```bash
# from repository root
pwd
test -f .env && echo "env present" || echo "missing .env"
```

2. Dry run

```bash
node scripts/import-first-security-nelson-historical.mjs --dry-run
```

3. Apply run

```bash
node scripts/import-first-security-nelson-historical.mjs --apply
```

4. Post-run verification

```bash
# observations inserted by the Nelson event ingestion path
node -e "import('dotenv/config');import('@supabase/supabase-js').then(async ({createClient})=>{const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const {count,error}=await s.from('observations').select('*',{count:'exact',head:true}).like('idempotency_key','import:wilsar-nelson:obs:%');if(error) throw error; console.log({obs_count:count});process.exit(0);}).catch(e=>{console.error(e);process.exit(1);});"
```

```bash
# latest imported rows with zone/loi linkage
node -e "import('dotenv/config');import('@supabase/supabase-js').then(async ({createClient})=>{const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const {data,error}=await s.from('observations').select('recorded_at,zone_id,loi_id,idempotency_key').like('idempotency_key','import:wilsar-nelson:obs:%').order('recorded_at',{ascending:false}).limit(10);if(error) throw error; console.table(data||[]);process.exit(0);}).catch(e=>{console.error(e);process.exit(1);});"
```

```bash
# timestamp sanity check (flag unexpected future years)
node -e "import('dotenv/config');import('@supabase/supabase-js').then(async ({createClient})=>{const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const {data,error}=await s.from('observations').select('id,recorded_at').like('idempotency_key','import:wilsar-nelson:obs:%').gte('recorded_at','2100-01-01T00:00:00Z').limit(20);if(error) throw error; console.log({future_rows:(data||[]).length}); if((data||[]).length) console.table(data);process.exit(0);}).catch(e=>{console.error(e);process.exit(1);});"
```

5. Replay safety check

```bash
# run apply again; inserted count should remain zero or unchanged for existing keys
node scripts/import-first-security-nelson-historical.mjs --apply
```

---

## Canonical Rules

1. Tenant routing:
   - Nelson historical datasets route through First Security - Nelson provider context.
   - Client ownership for the Nelson Wilsar datasets is Nelson City Council unless explicit source evidence requires override.
2. Event normalization:
   - Patrol and alarm/noise source rows are event inputs, not direct UI models.
   - Each event emits one observation row with a deterministic idempotency key.
3. Observation linkage:
   - `organization_id` must be client org.
   - `zone_id` must resolve from dispatch/site mapping (auto-create allowed when missing and policy permits).
   - `loi_id` must be attached when the resolved zone carries LOI linkage.
4. Canonical entities:
   - Upsert canonical vehicle records before observation insert when plate values are present.
   - If a source row has no usable plate, generate deterministic synthetic event plate seed for observability without breaking uniqueness.
5. Replay safety:
   - Re-running the same import must not duplicate observations.
   - Duplicate handling is by idempotency key, not by loose timestamp matching.

---

## Execution Checklist

1. Preflight (required):
   - Read docs/INSTRUCTION_MANUAL.md sections for Data Management and Technical Reference.
   - Confirm source file names and bucket paths are correct.
   - Confirm branch and client organizations exist and are parented correctly.
2. Schema guard:
   - Confirm `observations`, `zones`, and canonical vehicle table availability in runtime.
   - If optional tables (for example alarm_events in partial deployments) are missing, continue with observation-path ingest and record skip reason.
3. Dry run:
   - Run importer in dry-run mode.
   - Verify candidate counts, zone mapping coverage, and pending idempotency set size.
4. Apply run:
   - Run importer in apply mode.
   - Capture summary metrics (inserted, failed, skipped, existing matches).
5. Post-run verification:
   - Validate observation count by idempotency prefix.
   - Validate latest rows include expected zone and LOI linkage.
   - Validate no malformed future timestamps.

---

## Validation Queries (Expected Outcomes)

1. Observation integrity:
   - Count by idempotency prefix returns expected total for the dataset.
   - Latest observations show valid `zone_id` and non-null timestamps.
2. LOI linkage:
   - Observation rows for mapped zones carry expected `loi_id` where available.
3. Canonical vehicle linkage:
   - Canonical vehicle records exist for new imported event plates.
4. Timestamp quality:
   - No imported rows should have impossible years (for example >= 2100 unless source evidence explicitly supports it).

---

## Failure Handling

1. If date parsing produces malformed years:
   - Stop apply sequence.
   - Patch parser for actual source format.
   - Remove only bad imported rows by scoped idempotency/date filter.
   - Re-run apply and verification.
2. If zone creation fails:
   - Capture failing check constraint.
   - Update bootstrap payload to satisfy mandatory zone fields.
   - Re-run dry-run then apply.
3. If table is not available in deployment:
   - Record as environment/schema blocker.
   - Continue with canonical observation path when possible.
   - Do not invent fallback schema.

---

## Manual-First Rule

Before changing importer behavior or adding a new branch mapping, consult docs/INSTRUCTION_MANUAL.md and this runbook.
If either conflicts with live product behavior, treat as drift and update documentation in the same change set.
