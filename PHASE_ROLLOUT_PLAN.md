# Phase Rollout Plan — Align with BUILD_PLAN

> **Current Completion**: 72%  
> **Target**: 100% BUILD_PLAN alignment  
> **Critical Note**: `vehicle_observations_v2` is **backup only** — never query, never reference

---

## Phase Status Summary

| Phase | BUILD_PLAN Section | Status | Completion |
|-------|-------------------|--------|------------|
| **Phase 1** | Project Scaffolding | ✅ Complete | 100% |
| **Phase 2** | Supabase Backend | ✅ Complete | 100% |
| **Phase 3** | Frontend Core | ✅ Complete | 100% |
| **Phase 4** | Frontend Pages (Tier 1-4) | ⏳ Partial | 30% |
| **Phase 5** | Custom Hooks (25 hooks) | ⏳ Partial | 36% (9/25) |
| **Phase 6** | Feature Components (63) | ⏳ Partial | 19% (12/63) |
| **Phase 7** | Railway Integration | ⏳ Partial | 20% (1/6 pages) |
| **Phase 8** | Integration Testing | ❌ Not Started | 0% |

---

## PHASE 4: Frontend Pages (Remaining Work)

### BUILD_PLAN Priority Tiers

#### ✅ Tier 1 — COMPLETE (7/7)
- Login, FieldOfficerPortal, AdminPortal, VehicleManagement, ZoneManagement, ComplianceDashboard, BreachAlerts

#### ⏳ Tier 2 — BUILD NOW (5 pages)
1. **EnforcementCommandCenter.tsx** — Real-time enforcement dashboard
2. **EnforcementActions.tsx** — Enforcement workflow (warnings → notices → escalation)
3. **LivePatrolMonitor.tsx** — Active patrol tracking with GPS
4. **LiveOfficerTracking.tsx** — Officer GPS monitoring
5. **Update UserManagement.tsx** — Add role assignment, COA/Warrant verification

#### ⏳ Tier 3 — BUILD NEXT (6 pages)
6. **ReportsHub.tsx** — Report generation center
7. **IncidentReports.tsx** — Incident management with legal holds
8. **ComplianceAnalytics.tsx** — Deep compliance analysis with charts
9. **HotspotsMap.tsx** — GPS heatmap visualization
10. **AuditLog.tsx** — System audit trail
11. **Update Reports.tsx** — Add PDF generation buttons

#### ⏳ Tier 4 — BUILD LAST (3 pages)
12. **DataManagementHub.tsx** — Data tools landing page
13. **DataCleanupUtility.tsx** — Data cleanup tools
14. **DataIntegrityDashboard.tsx** — Integrity monitoring
15. **Update DataManagement.tsx** — Add integrity checks, duplicate detection

**Remaining**: 14 pages

---

## PHASE 5: Custom Hooks (Remaining Work)

### ✅ Built (9/25)
useVehicles, usePatrols, useBreaches, useZones, useUsers, useOrganizations, useDashboardStats, useRealtime, useRailwayServices

### ⏳ Build Now (16 hooks)

#### Priority 1 — Core Operations (5 hooks)
1. **useIncidents** — Incident CRUD with legal holds
2. **useEnforcementActions** — Enforcement workflow
3. **useVehicleCompliance** — Real-time compliance checks
4. **usePlateScans** — ALPR scan results
5. **useFlaggedVehicles** — Watchlist vehicles

#### Priority 2 — Analysis & Monitoring (5 hooks)
6. **useVehicleAnalysis** — AI vehicle analysis
7. **useVehicleProfilePhoto** — Profile photo management
8. **useHealthSafety** — H&S report management
9. **useAuditLogs** — Audit trail queries
10. **useOfficerWelfareMonitor** — Welfare monitoring

#### Priority 3 — Notifications & Permissions (4 hooks)
11. **useNotifications** — Notification management
12. **useOfficerNotifications** — Officer-specific alerts
13. **usePermissions** — Role-based permissions
14. **usePersonRecords** — Person observation records

#### Priority 4 — Utilities (2 hooks)
15. **useImportHistory** — Data import tracking
16. **useOfflineQueue** — Offline-first queue

---

## PHASE 6: Feature Components (Remaining Work)

### ✅ Built (12/63)
AppLayout, GlobalFilterRibbon, PlateScanner, VehicleCard, VehicleDetailsModal, BreachAdvisoryModal, ConfirmDialog, LoadingSkeleton, StatCard, NetworkStatusBar, PWAInstallPrompt, KeepScreenAwake

### ⏳ Build Now (51 components)

#### Priority 1 — Scanning & Capture (6 components)
1. **ZoomScan** — Alternative plate scanner
2. **PlateCapture** — Manual plate entry
3. **ScanResultModal** — Post-scan result display
4. **MultiPhotoUpload** — Multi-photo evidence upload
5. **ManualEntryModal** — Manual observation entry
6. **DrivingModeToggle** — Mobile driving mode

#### Priority 2 — Vehicle Management (5 components)
7. **VehicleEditDrawer** — Vehicle editing sidebar
8. **VehiclePhotoGallery** — Evidence photo gallery
9. **VehicleProfilePhoto** — AI-selected profile photo
10. **VehicleSearchBar** — Smart vehicle search
11. **VehicleStatusBadge** — Compliance status indicator

#### Priority 3 — Enforcement & Compliance (8 components)
12. **ComplianceBlockingModal** — Login compliance gate
13. **ComplianceCredentialsUpload** — COA/Warrant upload
14. **EnforcementGuardModal** — Enforcement confirmation
15. **IncidentCreationForm** — New incident form
16. **IncidentEvidenceUpload** — Incident photo upload
17. **NoticeToVacateForm** — Legal notice generation
18. **BreachActionButtons** — Breach action toolbar
19. **ComplianceTimeline** — Visual compliance history

#### Priority 4 — Alerts & Notifications (6 components)
20. **UnifiedAlertQueue** — Real-time alert feed
21. **NotificationCenter** — Notification management
22. **OfficerWelfareWarningModal** — Welfare alert display
23. **BreachNotificationBanner** — Breach alert banner
24. **PushNotificationPrompt** — Push permission prompt
25. **AlertPriorityBadge** — Alert severity indicator

#### Priority 5 — Admin & Management (8 components)
26. **PatrolCard** — Patrol status display
27. **OrganizationSelector** — Org hierarchy picker
28. **PermissionsEditor** — Role permission management
29. **PersonRecordsManager** — Person record CRUD
30. **UserRoleBadge** — Role display badge
31. **SessionList** — Active session management
32. **AuditLogViewer** — Audit trail viewer
33. **DataExportButton** — CSV export button

#### Priority 6 — Maps & Visualization (5 components)
34. **ZoneMapEditor** — Geofence polygon editor
35. **HeatmapLayer** — GPS heatmap overlay
36. **PatrolRouteDisplay** — Patrol route visualization
37. **OfficerLocationMarker** — Live GPS marker
38. **ZoneBoundaryDisplay** — Zone boundary overlay

#### Priority 7 — Utilities & UX (13 components)
39. **OfflineQueueView** — Offline queue management
40. **PWAUpdateNotification** — PWA update notification
41. **BugReportButton** — Bug report trigger
42. **BugReportModal** — In-app bug reporting
43. **DarkModeToggle** — Theme switch
44. **LoadingSpinner** — Loading indicator
45. **EmptyState** — No data display
46. **ErrorBoundary** — Error boundary component
47. **ConfirmationDialog** — Reusable confirmation
48. **DateRangePicker** — Date range selector
49. **FilterChips** — Active filter display
50. **SearchBar** — Global search component
51. **Pagination** — Table pagination

---

## PHASE 7: Railway Integration (Remaining Work)

### ✅ Wired (1/6)
- PlateScanner.tsx — Full ALPR + ORC/AI + NZSCV + MotorWeb pipeline

### ⏳ Wire Now (5 pages)

1. **VehicleManagement.tsx**
   - Add "Enrich from MotorWeb" button → `railwayServices.enrichVehicleFromMotorWeb()`
   - Add "Check NZSCV" button → `railwayServices.checkNZSCVCertification()`
   - Add realtime updates → `useRealtimeObservations()`
   - Add CSV export → `csvExport.exportVehicles()`

2. **BreachAlerts.tsx**
   - Add "Generate Notice" button → `edgeFunctions.generateNoticeToVacate()`
   - Add realtime alerts → `useRealtimeBreachAlerts()`
   - Add CSV export → `csvExport.exportBreaches()`

3. **ComplianceDashboard.tsx**
   - Add "Recalculate Compliance" button → `edgeFunctions.recalculateCompliance()`
   - Add "Generate Leadership Pack" button → `edgeFunctions.generateLeadershipPack()`
   - Add realtime stats → `useRealtimeDashboard()`

4. **SystemDiagnostics.tsx**
   - Replace `checkRailwayServicesHealth()` with:
     - `railwayServices.checkProxyHealth()`
     - `railwayServices.checkInferenceHealth()`
   - Add latency metrics display
   - Add service status badges

5. **FieldOfficerPortal.tsx**
   - Wire PlateScanner component into scanning view
   - Add scan button that opens PlateScanner modal

---

## PHASE 8: Integration Testing

### Critical Test Scenarios (from BUILD_PLAN Section 13)

1. **End-to-End Scan Flow**
   - Officer login → scan plate → observation created → compliance evaluated → breach alert (if non-compliant)

2. **NZSCV Integration**
   - Scan plate → check self-contained status via proxy → verify result stored

3. **MotorWeb Integration**
   - Scan plate → enrich with make/model/year → verify data stored

4. **ORC/AI Embedding**
   - Photo → inference service → 384-D embedding → verify stored in observations.embedding_384

5. **Compliance Recalculation**
   - Trigger bulk recalc → verify all observations re-evaluated → verify matrix version tracking

6. **Report Generation**
   - Generate incident PDF → verify content + photos → verify download

7. **Multi-Org RLS**
   - Login as org A → verify can't see org B data
   - Login as master → verify can see all data

8. **Realtime Updates**
   - Create breach alert → verify appears in admin portal without refresh
   - Officer checks in to patrol → verify appears in LivePatrolMonitor

9. **Offline Queue**
   - Disable network → scan vehicle → enable network → verify auto-sync

10. **PWA Features**
    - Install prompt appears → install → verify works offline
    - Update available → prompt appears → reload → verify new version

---

## Execution Sequence

### Week 1: Phase 4 + Phase 5 Core
**Days 1-3**: Build Tier 2 pages (5 pages)  
**Days 4-5**: Build Priority 1 hooks (5 hooks)  
**Day 6**: Test Tier 2 pages + hooks integration  
**Day 7**: Build Tier 3 pages (6 pages)

### Week 2: Phase 5 + Phase 6 Core
**Days 1-2**: Build Priority 2-3 hooks (9 hooks)  
**Days 3-5**: Build Priority 1-3 components (19 components)  
**Day 6**: Wire components into pages  
**Day 7**: Build Priority 4 hooks + components

### Week 3: Phase 6 + Phase 7
**Days 1-3**: Build Priority 4-7 components (32 components)  
**Days 4-5**: Complete Phase 7 integration (5 pages)  
**Day 6**: Verify all Railway services working  
**Day 7**: Build Tier 4 pages + utilities

### Week 4: Phase 8 Testing
**Days 1-2**: Execute test scenarios 1-5  
**Days 3-4**: Execute test scenarios 6-10  
**Day 5**: Fix critical bugs  
**Day 6**: Re-test all scenarios  
**Day 7**: Final QA + deployment readiness check

---

## Success Criteria

### Phase 4 Complete
- ✅ All 14 remaining pages built
- ✅ All pages use AppLayout + GlobalFilterRibbon
- ✅ All pages respect RLS + organization scoping
- ✅ All CRUD operations functional

### Phase 5 Complete
- ✅ All 16 remaining hooks built
- ✅ All hooks use TanStack Query
- ✅ All hooks handle errors with toast notifications
- ✅ All mutations invalidate relevant queries

### Phase 6 Complete
- ✅ All 51 remaining components built
- ✅ All components use shadcn/ui primitives
- ✅ All components have TypeScript props
- ✅ All components handle loading/error states

### Phase 7 Complete
- ✅ All 5 pages wired to Railway services
- ✅ All Edge Functions connected
- ✅ All realtime subscriptions active
- ✅ All CSV exports working

### Phase 8 Complete
- ✅ All 10 test scenarios pass
- ✅ No RLS violations detected
- ✅ No TypeScript errors
- ✅ PWA works offline
- ✅ Build size < 2 MB gzipped

---

## Critical Constraints

1. **NEVER query vehicle_observations_v2** — backup table only
2. **ALWAYS query observations table** — single source of truth
3. **TypeScript stays lenient** — strict: false, noImplicitAny: false
4. **NZ timezone everywhere** — Pacific/Auckland
5. **RLS helper functions** — use get_user_organization_ids()
6. **CORS on all Edge Functions** — handle OPTIONS preflight
7. **Photo evidence mandatory** — no observation without photo_hash
8. **Compliance matrix versioned** — track matrix_version in results
9. **Session management** — prevent duplicate logins
10. **Railway services already deployed** — just connect to them

---

## Next Action

**Start Phase 4: Build Tier 2 Pages** (5 pages)

Should I proceed with building the first Tier 2 page (EnforcementCommandCenter.tsx)?
