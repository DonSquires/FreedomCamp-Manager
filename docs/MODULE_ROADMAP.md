# Module Roadmap (Operator Navigation Map)

Date: 2026-05-02
Source of truth for routes: src/App.tsx and docs/uiux-master-redesign/artifacts/route-inventory-2026-04-27.md

## How To Use

1. Start from a capability family below.
2. Navigate via the primary route.
3. Use the related routes for adjacent operations.

## Core Operations

1. CRM and account operations
   - Primary: /crm
   - Related: /crm/client/:orgId, /crm/contractor/:orgId, /client-sites, /access-control, /client-master-list

2. Compliance and enforcement
   - Primary: /compliance
   - Related: /breaches, /infringements, /notice-to-vacate, /enforcement-actions, /enforcement-command-center, /compliance-recalculation

3. Patrol and dispatch
   - Primary: /live-patrol
   - Related: /dispatch, /dispatch-wizard, /dispatch-monitor, /dispatched-jobs, /job-map, /roster

4. Field officer workflows
   - Primary: /field and /field-officer
   - Related: /observations, /observations-report, /patrol-checkpoints, /patrol-schedule

## Specialist Portals

1. Parking
   - Primary: /parking
   - Related: /parking-officer

2. Noise
   - Primary: /noise-control
   - Related: /noise-officer

3. Biosecurity
   - Primary: /biosecurity-control
   - Related: /biosecurity-officer

4. Smoke
   - Primary: /smoke-control
   - Related: /smoke-officer

## AI, Intelligence, and Review Surfaces

1. Bob assistant and orchestration
   - Primary: /bob-assistant
   - Related: /bob-intake-queue, /live-plan-reviews, /bob-ui-review, /ai-analysis

2. Intelligence and approvals
   - Primary: /intel-approvals
   - Related: /investigations, /incident-reports

3. Tender and analysis workspace
   - Primary: /tender-workspace
   - Related: /tender-workspace/:id, /tender-reference-library

## Data, Diagnostics, and Recovery

1. Data management
   - Primary: /admin/data-hub
   - Related: /data, /admin/data-cleanup, /admin/data-integrity, /import-data, /import-historical

2. Recovery and maintenance
   - Primary: /admin/cleanup-recalculate
   - Related: /photo-reingest, /evidence-photo-linker, /diagnostics

3. Spatial and zone administration
   - Primary: /spatial-compliance
   - Related: /zones, /site-risk-assessment, /points-of-interest

## Identity, Access, and Communications

1. Identity and records
   - Primary: /identity-verification
   - Related: /face-recognition, /person-records, /vehicles, /vehicles/:id

2. Access governance
   - Primary: /access-control
   - Related: /users, /organizations, /admin/site-permissions, /admin/service-provider-access

3. Comms and PTT
   - Primary: /radio
   - Related: /radio/log, /messages, /team-chat

## Executive and Governance Views

1. Platform and admin views
   - Primary: /platform
   - Related: /admin, /admin/dashboard, /reports, /custom-reports, /audit-log

2. Client-facing visibility
   - Primary: /client-portal
   - Related: /organization-profile, /reports-hub, /disputes

## Maintenance Rule

Update this roadmap when any route is added, removed, renamed, or re-gated in src/App.tsx.
