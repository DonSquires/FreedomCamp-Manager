# NZ Council Enforcement Enterprise Research (2026-04-25)

## Scope

This brief captures what the product should provide to:

1. Service providers
2. Councils and client organisations
3. Field officers and supervisors
4. Procurement, security, and governance reviewers

It is grounded in repository sources plus a small set of official NZ public-sector references.

## Repo-Grounded Sources

1. `docs/CAPABILITY_OVERVIEW.md`
2. `docs/BUILD_PLAN.md`
3. `docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md`
4. `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`
5. `docs/REBUILD_CROSSOVER_VERCEL_EXPO_SECURITY_CHECKLIST.md`
6. `docs/USER_SYSTEM_REDESIGN_2026.md`
7. `docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md`
8. `docs/PHASE4_TENANT_ISOLATION_CERTIFICATION_REPORT_2026-04-25.md`

## Official External Anchors

1. NZ Government Procurement portal (`procurement.govt.nz`)
   - confirms formal public-sector procurement expectations and RealMe-gated procurement service posture.
2. NZ Digital Government standards (`digital.govt.nz/standards-and-guidance`)
   - confirms accessibility, privacy, security, identity, governance, UX, and technology architecture expectations for public digital services.
3. NZISM (`nzism.gcsb.govt.nz`)
   - confirms security baseline expectations for information assurance and systems security.
4. Office of the Privacy Commissioner (`privacy.org.nz/privacy-act-2020`)
   - confirms agency obligations under Privacy Act 2020.

## What NZ Councils and Clients Need

### 1. Operational Enforcement Outcomes

From `docs/BUILD_PLAN.md`, `docs/CAPABILITY_OVERVIEW.md`, and `docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md`, the platform must support:

1. Scanning vehicles and rapidly determining compliance.
2. Issuing warning notices, infringement notices, and notices to vacate.
3. Maintaining court-defensible evidence with timestamp, GPS, photo, and action lineage.
4. Tracking patrols, welfare, and checkpoint compliance.
5. Producing reports for council contract managers and operational leadership.

### 2. Service Provider Operating Model

Grounded in `docs/CAPABILITY_OVERVIEW.md`, service-provider access pages, and multi-org migrations, the product must support:

1. One service provider serving multiple councils or clients without data crossover.
2. Officers working in client jurisdictions selected per shift.
3. Client-controlled visibility into provider activity where allowed.
4. Service-type routing per client (freedom camping, guarding, parking, noise, biosecurity, smoke).

### 3. Client and Council Visibility Model

Grounded in client-site, client-viewer, and reporting docs/migrations, councils and clients need:

1. Visibility into their own sites, incidents, breaches, and patrol coverage.
2. Leadership packs, scheduled reports, and export-ready evidence bundles.
3. SLA-style transparency for response, breach handling, and patrol performance.
4. OIA/Public Records readiness through strong audit, export, and retention patterns.

## Procurement and Buyer Expectations

Grounded in `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md` plus official NZ procurement and digital guidance, this product should present:

1. Clear service model: software platform, managed service, or hybrid.
2. Multi-tenant isolation proof and open data portability assurances.
3. Support and uptime commitments suitable for contracted enforcement operations.
4. Auditability, retention support, and export capability for OIA/privacy/governance needs.
5. Pilot-first adoption path for smaller councils, then multi-council scale-up.

## Security and Compliance Requirements

Grounded in repo security docs plus NZISM/Privacy guidance, the app should provide:

1. Strong tenant isolation via RLS, org-scoped queries, and proof suites.
2. Audit logging for sensitive operations and privileged actions.
3. Privacy-aware handling of officer, complainant, and client data.
4. Secure public endpoints with TLS, HSTS, CORS control, and secret rotation discipline.
5. Runbooks for incidents, rollback, restore drills, and operational handover.

## Product Capability Implications

The product should be presented not just as a scan-and-breach app, but as an enterprise enforcement operating system with:

1. Field execution
2. Client/council visibility
3. Governance and procurement readiness
4. Multi-org service-provider controls
5. Security and evidence defensibility

## Research Verdict

FreedomCamp Manager should provide a combined service-delivery and governance platform for NZ councils and contracted providers: operational enforcement tooling, client visibility, evidence defensibility, tenancy guarantees, and public-sector procurement/security readiness.
