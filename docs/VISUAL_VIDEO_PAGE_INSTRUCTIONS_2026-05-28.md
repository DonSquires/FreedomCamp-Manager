# Visual and Video Instructions Per Page (SES)

Date: 2026-05-28
Owner: UX + QA + Product
Source of truth for page inventory: `src/navigation/routeManifest.ts` (`visibilityMode: 'production'`)

## Purpose

This runbook defines how to validate every production page for:

- visual quality and UX consistency
- accessibility and responsive behavior
- video evidence capture for release confidence

The checklist below covers every production route in the manifest and is designed to be completed per release cycle.

## Requirement Baseline

Use these standards when validating each page:

- `docs/UI_UX_ACCESSIBILITY_CHECKLIST.md`
- `docs/uiux-master-redesign/spec.md` (WCAG 2.2 and multi-theme requirements)
- `docs/VERCEL_EMULATOR_BIBLE.md` (UX contract validation posture)
- `docs/VIDEO_GENERATION_POLICY.md` (policy for generated video artifacts)
- `docs/VIDEO_CREATION_REVIEW.md` (current implementation scope and blockers)

## Visual Validation Instructions (Apply to Every Page)

For each route in the checklist:

1. Open page in desktop viewport (1440x900).
2. Confirm layout shell correctness (`admin`, `officer`, `master`, `shared`).
3. Verify one clear primary action and readable section hierarchy.
4. Check keyboard path for all primary/secondary actions.
5. Validate focus visibility and no hidden focus states.
6. Confirm labels/aria names for input, select, textarea, icon-only buttons.
7. Validate table/list interactions are not mouse-only.
8. Validate empty/loading/error/offline states are explicit and actionable.
9. Validate contrast and readability in themes:
- light
- dark
- high-contrast
- night-patrol
10. Repeat a quick pass in mobile viewport (390x844):
- no clipped actions
- no overlapping controls
- target sizes remain usable

Mark `Visual Pass` only when all applicable checks pass.

## Video Evidence Instructions (Apply to Every Page)

Record a short walkthrough video per page (20-60s) with this sequence:

1. Start on route URL and show page title/context.
2. Demonstrate top navigation/wayfinding for that page.
3. Demonstrate one primary workflow action end-to-end.
4. Demonstrate one state transition:
- loading to data
- empty to populated
- error/retry (if reproducible)
5. Demonstrate keyboard interaction (tab + activate one control).
6. Demonstrate responsive behavior by resizing desktop to mobile width.

Required metadata to log next to each video artifact:

- `route_id`
- `path`
- `role_profile` used
- `recorded_at` (UTC)
- `tester`
- `build_or_commit`
- `result` (`pass` or `needs-fix`)
- `notes`

Suggested artifact naming:

`<date>-<route-id>-<role>-visual-video.mp4`

Mark `Video Recorded` only when the file is uploaded and metadata is attached.

## Optional Automation Hints

When local Node tooling is available, prefer Playwright capture with traces/videos enabled.

Example pattern:

```bash
npm run e2e:profile:admin:org1 -- --grep "<route-or-feature>" --trace on --video on
```

If browser execution is unstable in local containers, pivot to cloud/CI evidence capture and store links in the checklist notes.

## Per-Page Checklist (Production Routes)

Columns:

- `Visual Pass`: mark `[x]` when visual/accessibility/responsive checks pass
- `Video Recorded`: mark `[x]` when evidence video is captured and logged

| Route ID | Path | Shell | Visual Pass | Video Recorded |
|---|---|---|---|---|
| auth.login | /login | shared | [ ] | [ ] |
| root.admin-hub | / | admin | [ ] | [ ] |
| portal.selection | /portal-selection | shared | [ ] | [ ] |
| officer.home | /officer-home | officer | [ ] | [ ] |
| officer.field | /field-officer | officer | [ ] | [ ] |
| admin.dashboard | /admin/dashboard | admin | [ ] | [ ] |
| admin.compliance | /compliance | admin | [ ] | [ ] |
| admin.observation-records | /observation-records | admin | [ ] | [ ] |
| admin.observations-report | /observations-report | admin | [ ] | [ ] |
| admin.breaches | /breaches | admin | [ ] | [ ] |
| admin.breach-notices | /breach-notices | admin | [ ] | [ ] |
| admin.enforcement-actions | /enforcement-actions | admin | [ ] | [ ] |
| admin.enforcement-review | /enforcement-review | admin | [ ] | [ ] |
| admin.enforcement-command-center | /enforcement-command-center | admin | [ ] | [ ] |
| admin.disputes | /disputes | admin | [ ] | [ ] |
| admin.notice-to-vacate | /notice-to-vacate | admin | [ ] | [ ] |
| admin.infringements | /infringements | admin | [ ] | [ ] |
| admin.compliance-analytics | /compliance-analytics | admin | [ ] | [ ] |
| admin.patrol-checkpoints | /patrol-checkpoints | admin | [ ] | [ ] |
| admin.patrol-schedule | /patrol-schedule | admin | [ ] | [ ] |
| admin.patrol-kpis | /patrol-kpis | admin | [ ] | [ ] |
| admin.vehicles | /vehicles | admin | [ ] | [ ] |
| admin.vehicle-registry | /vehicle-registry | admin | [ ] | [ ] |
| admin.nzscv-monitor | /admin/nzscv | admin | [ ] | [ ] |
| admin.canonical-records | /admin/canonical-records | admin | [ ] | [ ] |
| admin.zones | /zones | admin | [ ] | [ ] |
| admin.client-master-list | /client-master-list | admin | [ ] | [ ] |
| admin.client-sites | /client-sites | admin | [ ] | [ ] |
| admin.site-permissions | /site-permissions | admin | [ ] | [ ] |
| admin.crm | /crm | admin | [ ] | [ ] |
| admin.tender-workspace | /tender-workspace | admin | [ ] | [ ] |
| admin.tender-reference-library | /tender-reference-library | admin | [ ] | [ ] |
| admin.pricing | /pricing | admin | [ ] | [ ] |
| admin.invoicing | /invoicing | admin | [ ] | [ ] |
| admin.users | /users | admin | [ ] | [ ] |
| admin.organization-profile | /organization-profile | admin | [ ] | [ ] |
| master.organizations | /organizations | master | [ ] | [ ] |
| admin.hotspots | /hotspots | admin | [ ] | [ ] |
| admin.reports | /reports | admin | [ ] | [ ] |
| admin.incidents | /incidents | admin | [ ] | [ ] |
| admin.incident-reports | /incident-reports | admin | [ ] | [ ] |
| admin.investigations | /investigations | admin | [ ] | [ ] |
| admin.person-records | /person-records | admin | [ ] | [ ] |
| admin.reports-hub | /reports-hub | admin | [ ] | [ ] |
| admin.audit-log | /audit-log | admin | [ ] | [ ] |
| admin.privacy-curtain | /privacy-curtain | admin | [ ] | [ ] |
| admin.observations-map | /observations | admin | [ ] | [ ] |
| admin.ai-analysis | /ai-analysis | admin | [ ] | [ ] |
| admin.live-tracking | /live-tracking | admin | [ ] | [ ] |
| admin.live-patrol | /live-patrol | admin | [ ] | [ ] |
| admin.operations-map | /operations-map | admin | [ ] | [ ] |
| admin.dispatch | /dispatch | admin | [ ] | [ ] |
| admin.dispatch-monitor | /dispatch-monitor | admin | [ ] | [ ] |
| admin.dispatch-wizard | /dispatch-wizard | admin | [ ] | [ ] |
| admin.dispatched-jobs | /dispatched-jobs | admin | [ ] | [ ] |
| admin.team-chat | /team-chat | admin | [ ] | [ ] |
| admin.radio | /radio | admin | [ ] | [ ] |
| admin.noise-control | /noise-control | admin | [ ] | [ ] |
| admin.biosecurity-control | /biosecurity-control | admin | [ ] | [ ] |
| admin.smoke-control | /smoke-control | admin | [ ] | [ ] |
| admin.parking | /parking | admin | [ ] | [ ] |
| admin.officer-welfare | /officer-welfare | admin | [ ] | [ ] |
| admin.identity-verification | /identity-verification | admin | [ ] | [ ] |
| admin.parking-officer | /parking-officer | admin | [ ] | [ ] |
| admin.noise-officer | /noise-officer | admin | [ ] | [ ] |
| admin.compliance-dashboard | /compliance-dashboard | admin | [ ] | [ ] |
| admin.face-recognition | /face-recognition | admin | [ ] | [ ] |
| admin.points-of-interest | /points-of-interest | admin | [ ] | [ ] |
| admin.site-risk-assessment | /site-risk-assessment | admin | [ ] | [ ] |
| admin.roster | /roster | admin | [ ] | [ ] |
| admin.open-shifts | /open-shifts | admin | [ ] | [ ] |
| admin.availability | /availability | admin | [ ] | [ ] |
| admin.officer-skills | /officer-skills | admin | [ ] | [ ] |
| admin.timesheets | /timesheets | admin | [ ] | [ ] |
| admin.bob-assistant | /bob-assistant | admin | [ ] | [ ] |
| admin.bob-intake-queue | /bob-intake-queue | admin | [ ] | [ ] |
| admin.live-plan-reviews | /live-plan-reviews | admin | [ ] | [ ] |
| admin.spatial-compliance | /spatial-compliance | admin | [ ] | [ ] |
| admin.data | /data | admin | [ ] | [ ] |
| master.intel-approvals | /intel-approvals | master | [ ] | [ ] |
| admin.import-historical | /import-historical | admin | [ ] | [ ] |
| user.profile | /profile | shared | [ ] | [ ] |
| user.notifications | /notifications | shared | [ ] | [ ] |
| user.settings | /settings | shared | [ ] | [ ] |
| master.platform | /platform | master | [ ] | [ ] |
| master.access-control | /access-control | master | [ ] | [ ] |
| admin.custom-reports | /custom-reports | admin | [ ] | [ ] |
| roster.on-call-periods | /on-call-periods | admin | [ ] | [ ] |
| roster.callout-shifts | /callout-shifts | admin | [ ] | [ ] |
| roster.officer-allowances | /officer-allowances | admin | [ ] | [ ] |
| roster.travel-allowances | /travel-allowances | admin | [ ] | [ ] |
| enforcement.parking-appeals | /parking-appeals | admin | [ ] | [ ] |
| operations.camper-registrations | /camper-registrations | admin | [ ] | [ ] |
| management.zone-amenities | /zone-amenities | admin | [ ] | [ ] |
| noise.noise-complaints | /noise-complaints | admin | [ ] | [ ] |
| patrols.patrol-events | /patrol-events | admin | [ ] | [ ] |
| enforcement.breach-escalation | /breach-escalation | admin | [ ] | [ ] |
| patrols.officer-performance | /officer-performance | admin | [ ] | [ ] |
| records.site-risk-trends | /site-risk-trends | admin | [ ] | [ ] |
| enforcement.incident-heatmap | /incident-heatmap | admin | [ ] | [ ] |
| operations.health-safety-reports | /health-safety-reports | admin | [ ] | [ ] |
| operations.welfare-checkins | /welfare-checkins | admin | [ ] | [ ] |
| management.parking-permits | /parking-permits | admin | [ ] | [ ] |

## Release Gate Rule

A release is not UX-complete until all production routes have:

- `[x]` in `Visual Pass`
- `[x]` in `Video Recorded`
- evidence artifacts linked in the release notes or QA handoff

## Maintenance Rule

When `src/navigation/routeManifest.ts` changes:

1. Regenerate the route table in this file.
2. Add rows for new production routes.
3. Remove or archive rows for retired production routes.
4. Re-run visual/video checks for changed pages.
