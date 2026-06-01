# Entity Onboarding Requirements Gate (2026-05-17)

## Purpose

This gate enforces baseline production requirements whenever new entities are introduced:
- CRM organizations (`owner`, `service_provider`, `client`, `contractor`)
- client sites
- zones
- locations of interest (LOI)

The intent is to stop partially configured entities from entering live workflows.

## Enforced Checks

### Organization Checks (CRM organizations)

Required:
- organization is active
- active `crm` module subscription exists (`org_module_subscriptions`)
- service providers must have `parent_organization_id` set to their app owner or platform owner
- if `parent_organization_id` is set, the referenced parent organization must exist

Required for client/operator organizations:
- active `reporting` module subscription exists (`org_module_subscriptions`)
- signed active service agreement exists (`service_agreements.is_signed = true`)

Hard activation rule:
- client/operator organizations cannot transition from inactive -> active unless a signed active service agreement exists.
- enforced by migration trigger: `supabase/migrations/20260517183000_client_activation_requires_signed_service_agreement.sql`

Historical data handling:
- legacy organizations imported from older datasets may not have signed agreements recorded.
- onboarding validation marks these as admin warnings (`ORG_SIGNED_ACTIVE_AGREEMENT_LEGACY_GAP`) instead of blockers.
- when signed-agreement columns are not yet present in schema, warnings are emitted as `ORG_SERVICE_AGREEMENT_LEGACY_GAP`.
- warning action: admin should find an existing signed agreement artifact or obtain/sign and register a new agreement.

Closure rule for legacy agreement gaps:
- A legacy agreement gap can only be closed when both are true:
  - signed active agreement is present in `service_agreements`
  - signed service agreement document is loaded and passes Bob validation checks
- Bob monitoring command:
  - `bun run onboarding:monitor:agreements`
- Bob monitor outputs:
  - `tmp/docs/storage-review/onboarding-readiness/bob-service-agreement-gap-monitor.json`
  - `tmp/docs/storage-review/onboarding-readiness/bob-service-agreement-gap-monitor.md`

Agreement expiry countdown behavior:
- long-running agreements (over 6 months): Bob tracks a 3-month expiry window countdown (days).
- short-term agreements (1 to 6 months): Bob tracks weekly countdown to expiry.
- month-by-month rollover: Bob emits `monthly_rollover_status` and `next_monthly_review_date` to support monthly renewal checks.

Strict expiry SLA thresholds:
- Long-running agreements:
  - warning when within 90 days of expiry
  - critical when within 30 days of expiry (or already expired)
- Short-term agreements:
  - warning when <= 4 weeks remaining
  - critical when <= 2 weeks remaining (or already expired)

Recommended:
- at least one active service agreement (`service_agreements`)

### Client Site Checks

Required:
- `site_type` is set
- `zone_id` is set
- `loi_id` is set
- referenced `zone_id` exists
- site organization matches zone organization
- referenced `loi_id` exists
- site organization matches LOI organization

Recommended:
- GPS (`gps_lat`,`gps_lng`) or address context (`address`/`city`) is present

### Zone Checks

Required:
- zone has name
- `loi_id` is set
- referenced `loi_id` exists
- LOI organization matches zone organization

Recommended:
- geometry or point coordinates are present (`geometry` or `location_lat`,`location_lng`)

### LOI Checks

Required:
- every `geo_zone_ids[]` entry resolves to an existing zone
- each referenced zone organization matches LOI organization

Recommended:
- spatial context (`gps_lat`,`gps_lng` or `geofence_geometry`) or address context (`address_full`/`city`) is present

## Runtime Commands

- Validate newly introduced entities (last 30 days):
  - `bun run onboarding:validate:new`
- Validate all active entities:
  - `bun run onboarding:validate:all`
- Remediate missing client/operator module subscriptions (`crm` + `reporting`):
  - `bun run onboarding:remediate:modules`
- Apply remediation:
  - `bun run onboarding:remediate:modules:apply`
- Preview signed-agreement remediation:
  - `bun run onboarding:remediate:agreements`
- Apply signed-agreement remediation:
  - `bun run onboarding:remediate:agreements:apply`
- Run Bob agreement-gap monitor/closure eligibility:
  - `bun run onboarding:monitor:agreements`

Direct script:
- `node scripts/validate-entity-onboarding-readiness.mjs --scope new --sinceDays 30`
- `node scripts/validate-entity-onboarding-readiness.mjs --scope all`

Output artifacts:
- `tmp/docs/storage-review/onboarding-readiness/entity-onboarding-readiness.json`
- `tmp/docs/storage-review/onboarding-readiness/entity-onboarding-readiness.md`

## Current Baseline (Scope: new)

From latest run after remediation:
- organizations_checked: 18
- sites_checked: 11
- zones_checked: 3
- lois_checked: 3
- blockers: 0
- warnings: 4

Gate status:
- pass: true

Residual warnings are active-agreement recommendations for:
- ORIKAN
- Port Marlborough
- Marlborough District Council
- Tasman District Council

## Operational Policy

For any new client/site/zone/location rollout:
1. Run `bun run onboarding:validate:new`.
2. If blockers exist, stop promotion and remediate first.
3. Re-run validation until blocker count is 0.
4. Attach the generated readiness artifact to staging/release evidence.
