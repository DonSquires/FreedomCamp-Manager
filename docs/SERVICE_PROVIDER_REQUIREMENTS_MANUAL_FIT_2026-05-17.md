# Service Provider Requirements vs Instruction Manual Fit (2026-05-17)

## Purpose
This assessment measures the live service-provider documentation corpus against the canonical instruction manual and the current app surface.

It answers three operational questions:
- can the platform run the contracted service-provider workflows described in the live documents
- can the client organisation consume the platform as a full module set when needed
- can the client instead be limited to a lighter transparency surface for stats, reports, and finance

Sources used:
- docs/INSTRUCTION_MANUAL.md
- docs/BUCKET_DOCUMENT_GROUNDED_IMPLEMENTATION_PLAN_2026-05-17.md
- tmp/docs/storage-review/requirements-summary.md
- src/App.tsx
- src/pages/ClientOrganisationPortal.tsx
- src/pages/Reports.tsx
- src/pages/InvoicingPage.tsx
- src/hooks/usePermissions.ts

## Executive Result
The product direction is valid, but the platform is only partially aligned.

At the service-provider level, the app already has a strong module footprint across patrols, dispatch, parking, noise, smoke, biosecurity, enforcement, reporting, invoicing, and service agreements.

At the contract-delivery level, the main missing layer is not raw module count. The main missing layer is contract execution fidelity:
- service-obligation clocks
- facility-frequency matrices
- monthly council report packs
- evidence standards per service
- bylaw-grade freedom-camping overlays and exception workflows

At the client-access level, there is a clear manual-to-code drift. The manual describes a client portal that supports operational transparency, reporting, incident submission, disputes, and optional invoice download. The current client implementation is mostly a read-only patrol/compliance dashboard and does not yet deliver the manual's reporting and finance access model.

## What the Live Service Documents Require

### Service provider obligations present in the corpus
The reviewed documents require the service provider to deliver:
- freedom-camping compliance and infringement support
- parking enforcement with evidence discipline and appeal-ready records
- noise control response and enforcement proof
- smoke complaint after-hours assessment and dispatch
- biosecurity inspections with strict timing obligations
- security patrols, lock and unlock, alarm response, and static guarding
- monthly client and council reporting packs
- pricing, variations, and invoice-grade contract controls
- location-aware service delivery across facilities, reserves, sites, and zones

### Nelson bylaw obligations now in scope
The Nelson Responsible Camping Bylaw adds material product requirements:
- prohibited and restricted area enforcement
- NZTA land treated as local-authority area when declared
- self-contained versus non-self-contained rule handling
- repeat-stay detection within a 500m location rule
- prior consent workflow with revocation
- temporary closure and restriction handling

## What the Instruction Manual Says the App Must Be

### Service-provider side
The instruction manual defines the platform as a multi-service operational command centre with:
- compliance and enforcement
- live patrol monitoring and GPS activity
- specialist modules for noise, parking, biosecurity, and smoke
- CRM, invoicing, reporting, and audit logging

For the `admin` service-provider role, the manual expects a broad Admin Hub and full operational module access across operations, compliance, dispatch, reports, CRM, and specialist workflows.

### Client side
The manual defines the client organisation portal as:
- dashboard and live activity transparency
- sites overview and guard activity
- infringement and notice visibility
- records visibility
- report generation and export
- client-officer incident logging
- client-admin dispute visibility and optional invoice download

This means the manual already supports two client operating modes:
- full client portal module access for contracted customers that need deeper operational visibility
- a narrower transparency mode centered on stats, reports, disputes, and invoices

## Current App Fit Assessment

### 1. Service-provider module footprint
Status: strong but incomplete at contract-governance level.

What exists now:
- admin and operational routing across many pages in src/App.tsx
- reporting page in src/pages/Reports.tsx
- invoicing workspace in src/pages/InvoicingPage.tsx
- service agreement management in src/pages/ServiceAgreements.tsx
- specialist portals for parking, noise, smoke, biosecurity, and field operations
- dispatch, alarms, patrol logs, evidence packages, and enforcement pages

Assessment:
- the app is already shaped like a service-provider system
- the app is not yet fully shaped like a contract-performance system

Root gap:
- contract documents specify measurable obligations and proof outputs, while much of the current app remains module-centric rather than obligation-centric

### 2. Service-provider requirements coverage by domain

| Domain | Manual + live-doc expectation | Current fit |
|---|---|---|
| Patrols, alarms, lock/unlock, static guards | Full operational workflow with SLA proof and facility standards | Partial |
| Parking | End-to-end enforcement plus evidence standard and appeal proof | Partial |
| Noise | Specialist workflow with response and enforcement evidence | Partial |
| Smoke | Specialist out-of-hours workflow | Partial |
| Biosecurity | Specialist workflow with strict contractual timers | Partial |
| Freedom camping | Enforcement plus bylaw-grade geofencing, consent, closures, repeat-stay logic | Partial |
| Reporting | Standard reports plus council monthly packs and scheduled outputs | Partial |
| Finance | Contract-backed invoicing and pricing | Present for provider |
| CRM / contract controls | Contracts, variations, service agreements, pricing logic | Partial |
| Historical proof / KPI baselines | Backfill from legacy patrol, alarm, noise, and workforce data | Partial |

### 3. Client-access model
Status: materially out of alignment with the manual.

What the code currently does:
- `/client-portal` is available to client roles
- the current portal shows patrols, breaches, enforcement, zones, and sites
- client permissions include `view_reports` in src/hooks/usePermissions.ts

What the code does not currently do:
- no report-generation surface inside the client portal
- no invoice surface inside the client portal
- no dispute-management surface inside the client portal
- no client-officer incident logging action in the client portal
- `/reports` is restricted to admin, admin_officer, and master roles
- `/invoicing` is restricted to admin, admin_officer, master, and grand_master roles

Conclusion:
- the permission model suggests client reporting was intended
- the route model and client portal implementation do not yet honor the manual's client role design

## Required Product Operating Model

### Mode A: Full service-provider operations
For the service provider, the app should operate as the primary system of record for:
- dispatch and task execution
- field evidence collection
- contract SLA monitoring
- monthly service reporting
- enforcement and dispute history
- billing and pricing administration

### Mode B: Client operational portal
For clients that need deeper visibility, the app should expose a controlled module set based on contract and role:
- dashboard
- sites and live activity
- incidents
- enforcement records relevant to their sites
- contracted service reports
- disputes
- invoice download when enabled

### Mode C: Client transparency portal
For clients that only need light access, the app should support a reduced shell with:
- live stats and KPI cards
- downloadable reports
- invoice and payment visibility
- limited dispute and support messaging

This mode should be configuration-driven, not a separate code fork.

## Key Gaps To Close

### Gap 1: Contract obligation engine
The live documents are written around response times, service frequencies, proof artifacts, report formats, and contractual exceptions. The app still needs a first-class contract-obligation layer.

### Gap 2: Monthly council report automation
The corpus clearly expects formal monthly report packs by facility category and service type. Current reporting is useful but not yet contract-template aware.

### Gap 3: Client portal drift from the manual
The manual promises reports, client incident logging, disputes, and optional invoice access. The current portal does not yet deliver those surfaces.

### Gap 4: Freedom-camping bylaw hardening
Nelson's bylaw requires geospatial and exception workflows beyond ordinary zone checks.

### Gap 5: Evidence standardization across specialist services
Parking, noise, smoke, and biosecurity all need service-specific proof rules, not just general activity records.

## Recommendation
Do not treat this as a new product direction. Treat it as alignment work.

The platform already has enough module breadth to support the service-provider business model. The next step is to finish the contract-delivery layer and then expose client access in two configurable modes:
- full client operations portal
- limited stats, reports, and finance portal

That approach matches both the instruction manual and the live service-provider documentation while staying reusable for Nelson, Marlborough, and future councils.

## Priority Decision
The next implementation phase should prioritize these in order:
1. contract obligation schema and SLA execution layer
2. monthly report pack generation
3. client portal reporting and finance alignment
4. Nelson freedom-camping bylaw workflows
5. service-specific evidence and exception handling