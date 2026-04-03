# Rebuild Crossover Checklist (Vercel + Expo + Security)

Date: 2026-04-02
Scope: Clean rebuild crossover planning and implementation checks for web, mobile, and security posture.

## 1. Sectioned Delivery Gates

### Gate A: Schema + Migration Readiness

- Confirm clean-schema migration order is approved.
- Confirm data map exists for live -> clean tables.
- Run staging migration dry run and capture output.
- Regenerate `src/types/database.ts` after migration changes.
- Run `bun run build` and ensure no typed query regressions.

Evidence:

- Dry-run log artifact.
- Migration order document.
- Build log artifact.

### Gate B: Rebuild UI Crossover

- Confirm rebuild pages compile and route contracts align with current schema.
- Validate role-scoped access for officer/admin/master/grand_master.
- Confirm old route variants are mapped to canonical replacements.

Evidence:

- Route mapping matrix.
- Role-test checklist.
- Build artifact list.

### Gate C: Vercel Web Crossover

Required configuration:

- `vercel.json` contains SPA rewrite for deep links.
- Security headers include HSTS, CSP, X-Frame-Options, and no-sniff.
- GitHub Actions secrets set: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- Build env values set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Validation steps:

1. Deploy PR preview.
2. Test direct deep links to protected routes.
3. Verify response headers in browser/network inspection.
4. Verify auth login and API calls in deployed preview.

Evidence:

- Preview deployment URL.
- Header capture screenshot.
- Smoke test checklist signed.

### Gate D: Expo Mobile Crossover

Required configuration:

- `mobile-app/app.json` includes valid EAS `projectId` and `updates.url`.
- `mobile-app/eas.json` includes `development`, `preview`, `production` profiles.
- EAS env includes `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

Validation steps:

1. Build Android preview profile.
2. Build iOS preview profile.
3. Verify login and token persistence.
4. Verify scan workflow and observation creation.
5. Verify breach alerts and acknowledgment actions.

Evidence:

- EAS build IDs for iOS and Android.
- Mobile smoke test report.

### Gate E: Security and Defense Procurement Readiness

Minimum transport and platform controls:

- TLS 1.2+ enforced by hosting providers.
- HSTS enabled on web and service endpoints.
- Strict origin allowlists for CORS.
- Service-to-service secret authentication enabled.
- Sensitive action auditing enabled.

Operational controls:

- Incident response runbook and escalation contacts.
- Backup and restore drill evidence.
- Rollback plan tested in staging.
- Access review completed for admin-level accounts.

Evidence bundle for procurement:

- Architecture and data-flow diagram.
- Security control matrix (implemented / evidence / owner).
- Pen-test or vulnerability scan summary.
- Privacy and retention policy references.

## 2. Implementation Status Snapshot

Current confirmed status:

- Rebuild pages in `src/rebuild/pages` were aligned to current auth and schema contracts for:
  - `DataImport.tsx`
  - `Disputes.tsx`
  - `LiveMap.tsx`
  - `Patrols.tsx`
  - `Platform.tsx`
  - `Profile.tsx`
  - `Settings.tsx`
- Full build passes with `bun run build`.
- Service entry points now reject downgraded HTTP protocol headers in production when forwarded protocol metadata is present.

## 3. Final Cutover Criteria

Cutover is approved only when all statements are true:

- Schema migration dry run and apply pass in staging and production.
- Web deployment passes Vercel preview + production smoke tests.
- Mobile deployment passes Expo preview smoke tests for core workflows.
- Security evidence pack is complete and reviewed.
- Rollback drill has a successful test result in the current release cycle.
