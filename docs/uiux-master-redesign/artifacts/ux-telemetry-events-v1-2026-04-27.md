# UX Telemetry Event Set v1

Date: 2026-04-27
Scope: Phase 0 instrumentation baseline

## Events

- nav_click
  - Required fields: user_role, organization_id, from_path, to_path, nav_surface, label
- route_entry
  - Required fields: user_role, organization_id, path, section, load_ms
- route_backtrack
  - Required fields: user_role, organization_id, from_path, to_path, elapsed_ms
- time_to_first_action
  - Required fields: user_role, organization_id, path, action_id, elapsed_ms
- portal_switch
  - Required fields: user_role, organization_id, from_portal, to_portal, trigger

## Acceptance

- Events emitted in admin, admin_officer, officer journeys
- Payload keys present for 95%+ samples in QA traces
