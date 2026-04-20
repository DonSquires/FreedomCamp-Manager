# Edge Function Archive

> This directory documents the Phase 2 edge function consolidation plan.
> Functions listed here are **scheduled for deletion** once their caller references
> in `src/lib/edgeFunctions.ts` and any page files are updated to use the
> consolidated replacements.
>
> **Do NOT delete function directories yet** — delete only after the corresponding
> `callEdgeFunction(...)` wrapper in `edgeFunctions.ts` is removed or re-pointed.
>
> Source plan: `docs/CLEAN_REBUILD_DESIGN.md` §5 · `docs/REBUILD_TODO.md` Phase 2
>
> Last updated: 2026-04-20

---

## Current State

| | Count |
|---|---|
| Functions deployed today | 93 |
| Target (clean rebuild) | 17 |
| To archive/delete | ~55 |
| Actively used, keep | 17 |
| In-use but phase-2 scope | ~21 |

---

## ✅ Functions to KEEP — the 17 clean targets

These are complete and production-ready. All other functions should route through these.

| Function | Purpose | Replaces |
|---|---|---|
| `process-officer-scan` | Core scan pipeline (1788 lines, all-in-one) | `alpr-process`, `alpr-retry`, `orc-ingest`, `plate-scanner-photo-first`, `check-nzscv-status`, `analyze-vehicle-photo`, `vehicle-ingest`, `stream-webhook`, `select-best-vehicle-photo`, `link-evidence-photos` |
| `cleanup-and-recalculate` | Nightly batch correction (zone, dedup, compliance) | `recalculate-compliance-v3`, `scan-breaches`, `correct-zone-assignments`, `zone-correction`, `check-zone-corrections`, `duplicate-detection`, `check-almost-breaches`, `sync-spatial-layers` |
| `generate-notice-to-vacate` | NTV PDF generation | — |
| `generate-infringement` | Infringement notice PDF | `render-infringement-notice` |
| `sync-scv-list` | SCV registry sync from NZSCV | (was also a cleanup-and-recalculate phase) |
| `create-user` | User provisioning | `create_auth_and_profiles` |
| `monitor-officer-welfare` | Welfare check-in scheduler | `send-welfare-reminders` |
| `send-report-email` | Email delivery for reports | — |
| `export-data` | Data export (observations CSV) | `observations-export` |
| `import-data` | Historical + standard data import | `import-historical-data` |
| `submit-dispute-intake` | Public dispute submission | — |
| `public-case-lookup` | Public notice lookup | — |
| `hotspot-data` | Heatmap data for admin | — |
| `process-homeless-data` | Homeless data import | — |
| `nightly-privacy-cleanup` | Privacy compliance cleanup | — |
| `manage-user` | Consolidated user management (create/update/set_password/deactivate) | `set-user-password`, `update-user-password` |
| `photo-maintenance` | Photo reconcile/reingest/recover | `photo-recovery`, `daily-photo-reconciler`, `reingest-photos` |

---

## 🗑️ ARCHIVE — Functions to delete (dead or fully superseded)

Caller wrappers in `src/lib/edgeFunctions.ts` must be removed before deletion.
Pages that call these directly must be updated.

### Already superseded by `process-officer-scan`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `alpr-process` | l.380 | Remove wrapper, route scan through `process-officer-scan` |
| `alpr-retry` | l.398 | Remove wrapper (error retry is internal to `process-officer-scan`) |
| `orc-ingest` | — (not in edgeFunctions.ts) | Delete directory |
| `plate-scanner-photo-first` | — | Delete directory |
| `check-nzscv-status` | l.1120 | Remove wrapper |
| `analyze-vehicle-photo` | l.773 | Remove wrapper |
| `vehicle-ingest` | l.715 | Remove wrapper |
| `stream-webhook` | l.1156 | Remove wrapper |
| `select-best-vehicle-photo` | l.791 | Remove wrapper |
| `link-evidence-photos` | l.828 | Remove wrapper |

### Already superseded by `cleanup-and-recalculate`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `recalculate-compliance` | l.442 | Remove wrapper |
| `recalculate-compliance-v2` | — (not in edgeFunctions.ts) | Delete directory |
| `recalculate-compliance-v3` | l.467, 517, 541 | Re-point to `cleanup-and-recalculate` |
| `scan-breaches` | l.418 | Remove wrapper |
| `correct-zone-assignments` | l.884 | Remove wrapper |
| `zone-correction` | l.893 | Remove wrapper |
| `check-zone-corrections` | l.874 | Remove wrapper |
| `duplicate-detection` | l.670 | Remove wrapper |
| `check-almost-breaches` | l.408 | Remove wrapper |
| `sync-spatial-layers` | l.858 | Remove wrapper |
| `enrich-from-motorweb` | l.1129 | Remove wrapper |

### Already superseded by `photo-maintenance`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `photo-recovery` | l.655 | Remove wrapper |
| `daily-photo-reconciler` | — (not in edgeFunctions.ts) | Delete directory |
| `reingest-photos` | l.811 | Remove wrapper |

### Already superseded by `manage-user`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `set-user-password` | l.1229 | Remove wrapper, use `manage-user` with `action: 'set_password'` |
| `update-user-password` | — (not in edgeFunctions.ts) | Delete directory |

### Already superseded by `export-data`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `observations-export` | l.756 | Remove wrapper |

### Already superseded by `import-data`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `import-historical-data` | l.937 | Remove wrapper |

### Already superseded by `generate-infringement`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `render-infringement-notice` | l.1520 | Remove wrapper |

### Already superseded by `create-user`

| Function | edgeFunctions.ts line | Action |
|---|---|---|
| `create_auth_and_profiles` | — | Delete directory |

### Developer/internal tools — not production

| Function | edgeFunctions.ts line | Called from | Action |
|---|---|---|---|
| `test-compliance-matrix` | l.592 | `DataCleanupUtility.tsx` (route already redirected) | Delete |
| `check-data-integrity` | l.841 | `Platform.tsx`, `GrandmasterCodingStudio.tsx` (route redirected) | Remove from Platform page |
| `check-railway-health` | l.865 | `Platform.tsx`, `GrandmasterCodingStudio.tsx` | Remove (Railway is proxy-only) |
| `grandmaster-studio` | l.1450 | `GrandmasterCodingStudio.tsx` (route redirected) | Delete |
| `bob-code-change-task` | l.1383 | `GrandmasterCodingStudio.tsx` (route redirected) | Delete |
| `auto-analyse-report` | l.1463 | `GrandmasterCodingStudio.tsx` | Delete or move to CI script |

---

## 🔍 AUDIT — Functions to investigate before keeping/archiving

These are called from `edgeFunctions.ts` but their purpose needs verification before archiving.
May be phase-2 scope or legitimately needed by active portals.

| Function | edgeFunctions.ts line | Called from | Notes |
|---|---|---|---|
| `get-weather` | l.1139 | Unconfirmed | Check if any active page uses weather. If only dispatch, gate behind dispatch feature. |
| `parkpow-sync` | l.636 | Unconfirmed | ParkPow integration — check if active. If no active contract, archive. |
| `parkpow-photo-sync` | l.628 | Unconfirmed | Same as above. |
| `scrape-vehicle-photos` | l.949 | Unconfirmed | Vehicle photo scraping — check if still needed or superseded by photo-maintenance. |
| `generate-dashboard-report` | l.988 | Unconfirmed | May overlap with `generate-leadership-pack`. Check callers. |
| `generate-leadership-pack` | l.1001 | Unconfirmed | May be used by Reports page. Verify before archiving. |
| `suggest-new-zone` | l.1149 | Unconfirmed | Bob-assisted zone suggestion — keep if used in ZoneManagement. |
| `update-compliance-policy` | l.1239 | Unconfirmed | Check if used in ZoneManagement/Compliance settings. |
| `process-credential-document` | l.1253 | Unconfirmed | Identity verification — flag for phase 2 (FaceRecognition route was redirected). |
| `process-investigation-document` | l.1271 | `InvestigationJobsPage.tsx` | Investigation workflow — may be active. Check. |
| `process-face-scan` | l.1606 | Unconfirmed | Face recognition — route redirected, but check edgeFunctions.ts still wired. |
| `transcribe-audio` | l.1724 | Unconfirmed | Audio transcription for PTT/Bob. Check if active. |
| `synthesize-speech` | l.1737 | Unconfirmed | TTS — check if used by PTT voice or Bob. Keep if active. |
| `observations-in-bounds` | Unconfirmed | LiveMap likely | Check if LiveMap calls this for geofenced observations. |
| `observations-list` | Unconfirmed | Unconfirmed | Check if any page uses this vs direct DB query. |
| `get-compliance-statistics` | Unconfirmed | Dashboard likely | Likely needed for admin dashboard KPIs. |
| `generate-vehicle-report` | Unconfirmed | VehicleDetailPage? | Check caller. |
| `generate-seizure-receipt` | Unconfirmed | Enforcement | May be active if seizure workflow is used. |
| `generate-warning-notice` | Unconfirmed | Enforcement | May be active. |
| `generate-incident-pdf` | Unconfirmed | IncidentManagement? | Check if used by incident workflow. |
| `admin-incident-ops` | l.1198 | Platform.tsx | Check what it does; may be admin utility. |
| `bob-learning-feedback-sync` | — | Unknown | Sync Bob learning data. Check if active. |
| `send-push-notification` | — | Unknown | Push notifications — may be used for welfare alerts. |
| `send-invite-email` | — | Unknown | User invitations — may be used by UserManagement. |
| `upload-file` | — | Unknown | Generic file upload — check callers. |
| `ingest-reference-material` | — | TenderWorkspace | Tender workflow — KEEP (active feature). |

### Tender workflow — KEEP all

| Function | Notes |
|---|---|
| `generate-tender-sections` | Active tender AI feature |
| `process-tender-document` | Active tender AI feature |
| `process-reference-material` | Active tender AI feature |
| `ingest-reference-material` | Active tender AI feature |

### Multi-tenant service portals — gate behind `grand_master` (Phase 2)

| Function | Notes |
|---|---|
| `biosecurity-assess` | Biosecurity portal (non-core, gate) |
| `biosecurity-notice` | Biosecurity portal |
| `noise-audio-assess` | Noise portal |
| `generate-noise-notice` | Noise portal |
| `smoke-assess` | Smoke portal |
| `smoke-notice` | Smoke portal |

### PTT & Bob — KEEP

| Function | Notes |
|---|---|
| `onspace-ai-chat` | Bob chat gateway — actively used by all portals |
| `ptt-signaling-token` | PTT WebRTC auth — actively used |
| `translate-message` | PTT message translation — actively used |

---

## Deletion Order (when ready)

1. Remove edgeFunctions.ts wrappers for all ARCHIVE functions
2. Confirm no other file calls these functions directly
3. Move function directories here: `mv supabase/functions/<name> supabase/functions/_archive/<name>`
4. Deploy `supabase functions delete <name>` to remove from production
5. Run TypeScript + build check after each batch

**Safe first batch to delete** (not called from any active page):
- `orc-ingest`, `plate-scanner-photo-first`, `create_auth_and_profiles`, `daily-photo-reconciler`, `update-user-password`, `recalculate-compliance-v2`

**Second batch** (called only from redirected dev-tool pages):
- `test-compliance-matrix`, `grandmaster-studio`, `bob-code-change-task`, `auto-analyse-report`

**Third batch** (called from edgeFunctions.ts only, no page calls them directly):
- All remaining ARCHIVE functions after their wrappers are removed from edgeFunctions.ts
