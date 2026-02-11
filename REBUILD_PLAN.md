# FreedomCamp Manager - Unified Frontend Rebuild

## Architecture Overview

### ✅ Decisions Locked In

1. **Single Responsive Codebase** - One app that adapts to mobile and desktop
2. **Device-Specific Optimizations** - Preemptive handling of iOS Safari, PWA, camera issues
3. **Manual Drift Remediation** - Phase 1 keeps admin approval for all recalculations
4. **XLSX Exports Postponed** - CSV works fine, XLSX can wait for Phase 2

---

## New Structure

```
src/
├── lib/
│   ├── design-system.ts          ✅ CREATED - Shared tokens, breakpoints, utilities
│   └── pwa.ts                     ✅ EXISTS - Offline queue, service worker
├── components/
│   ├── layout/
│   │   ├── ResponsiveContainer.tsx  ✅ CREATED - Adaptive layout wrapper
│   │   ├── AppHeader.tsx           ✅ EXISTS - Responsive header
│   │   └── Sidebar.tsx             ✅ EXISTS - Desktop navigation
│   ├── features/
│   │   ├── PlateCapture/          🔄 TO CREATE - Modular camera component
│   │   ├── ComplianceCard/        🔄 TO CREATE - Responsive compliance display
│   │   └── EvidenceGallery/       🔄 TO CREATE - Photo management
│   └── ui/                        ✅ EXISTS - shadcn/ui components
├── pages/
│   ├── FieldOfficerPortal.tsx    ✅ CREATED - Mobile-first dashboard
│   ├── AdminPortal.tsx           🔄 TO CREATE - Desktop-optimized dashboard
│   ├── PlateScanning/            🔄 TO CREATE - Split camera/manual/upload modes
│   ├── DriftDashboard.tsx        🔄 TO CREATE - Responsive drift management
│   └── ComplianceBackfill.tsx    ✅ EXISTS - Backfill UI
└── App.tsx                       🔄 TO UPDATE - Smart routing by role + device
```

---

## Implementation Phases

### **Phase 1: Foundation (Week 1-2)** ⏰ CURRENT

**✅ Completed:**
- Design system tokens and breakpoints
- ResponsiveContainer component
- FieldOfficerPortal mobile dashboard

**🔄 Next Steps:**

1. **Split VehicleVerification into Modular Components**
   - `PlateCapture.tsx` - Reusable camera component
   - `PlateInput.tsx` - Manual entry with auto-complete
   - `ComplianceChecker.tsx` - Real-time validation
   - `EvidenceCollection.tsx` - Photo gallery with crop/hash

2. **Create AdminPortal Entry Point**
   - Desktop-optimized layout with sidebar
   - Data tables with sorting/filtering
   - Multi-column dashboards
   - Keyboard shortcuts (Cmd+K search, etc.)

3. **Update App.tsx Routing**
   - Detect user role (officer vs admin)
   - Route to appropriate portal
   - Shared components between portals
   - Responsive navigation (bottom nav on mobile, sidebar on desktop)

4. **Implement DriftDashboard.tsx**
   - Filter by zone, org, date range, severity
   - Drift cards with:
     - Version comparison (old → new)
     - Affected observations count
     - Severity badge (CRITICAL, WARNING, INFO)
     - Remediation actions (Review, Re-run, Acknowledge)
   - Real-time updates via Supabase Realtime
   - Responsive layout (cards on mobile, table on desktop)

5. **Enhanced PDF Generation**
   - Update `generate-incident-pdf` Edge Function
   - Add "Matrix Snapshot" section to court packs
   - Include: version, criteria keys, effective dates, readable summary
   - Embed full JSON behind secure link for forensic analysis

---

### **Phase 2: Advanced Features (Week 3-4)**

1. **Leadership Reports**
   - Generate `leadership-pack` PDFs with drift trends
   - Version history visualization
   - Zone performance analytics
   - Export to CSV/PDF

2. **Notifications System**
   - Email/push for recalculation completions
   - Drift event alerts
   - Breach notifications
   - Configurable notification preferences

3. **Offline-First Enhancements**
   - IndexedDB queue UI (show queued scans)
   - Background sync progress indicator
   - Retry failed uploads automatically
   - Conflict resolution for offline edits

4. **Accessibility & Performance**
   - WCAG 2.1 AA compliance
   - Keyboard navigation for all features
   - Screen reader optimization
   - Performance monitoring (Web Vitals)

---

### **Phase 3: Polish & Governance (Ongoing)**

1. **Governance Workflows**
   - Matrix change approval process
   - Multi-step review for sensitive changes
   - Audit log enhancements
   - Version rollback capability

2. **QA & Testing**
   - End-to-end testing (Playwright)
   - Mobile device testing (iOS/Android)
   - Load testing for Edge Functions
   - Security audit

3. **Documentation**
   - User guides for officers and admins
   - API documentation
   - Deployment runbooks
   - Training materials

---

## Design Principles

### **Mobile-First (Field Officers)**

✅ **Touch-Friendly:**
- Minimum 44px tap targets
- Large buttons with clear labels
- Swipe gestures for navigation
- Bottom navigation for easy thumb reach

✅ **Offline-First:**
- Local IndexedDB queue
- Background sync when online
- Visual indicators for sync status
- Graceful degradation without internet

✅ **Performance:**
- Lazy-load heavy components
- Optimize camera preview
- Compress images before upload
- Service worker caching

### **Desktop-Optimized (Admins)**

✅ **Productivity:**
- Keyboard shortcuts (Cmd+K, arrow keys)
- Multi-column layouts
- Bulk actions (select multiple rows)
- Inline editing where appropriate

✅ **Data-Dense:**
- Tables with sorting/filtering
- Charts and visualizations
- Drill-down capabilities
- Export to CSV/PDF

✅ **Responsive:**
- Works on tablets (iPad, Surface)
- Adapts to different screen sizes
- Supports external monitors

---

## Technical Standards

### **Browser Support**
- ✅ Chrome 90+ (desktop & mobile)
- ✅ Safari 14+ (iOS & macOS)
- ✅ Firefox 88+
- ✅ Edge 90+

### **Device-Specific Handling**

**iOS Safari:**
- Camera permissions require user gesture
- No fullscreen API support (use viewport meta tag)
- Service worker limitations (handle gracefully)
- IndexedDB quota restrictions (monitor usage)

**Android Chrome:**
- Camera API works well
- Full service worker support
- Better PWA integration
- Push notification support

**Desktop:**
- Full feature parity
- Keyboard shortcuts
- Drag-and-drop file upload
- Multi-tab support

---

## API Surface (Backend Integration)

### **Field Officer Endpoints**
```
POST /functions/process-driving-scan  # Fast ALPR + compliance check
POST /functions/recognize-plate        # Plate Recognizer API
POST /functions/extract-plate          # OnSpace AI fallback
GET  /vehicle_records                  # Today's scans for zone
POST /vehicle_records                  # Create new scan
```

### **Admin Endpoints**
```
POST /functions/recalculate-compliance       # Multi-scope recalc
POST /functions/recalculate-all-compliance   # Build-wide recalc
GET  /drift_events                           # Drift event list
GET  /functions/get-compliance-statistics    # Analytics
POST /functions/generate-incident-pdf        # Court-ready PDFs
POST /functions/generate-leadership-pack     # Executive reports
```

### **Real-Time Subscriptions**
```
supabase
  .channel('admin_recalculation_actions')
  .on('postgres_changes', { event: 'UPDATE' }, handleProgress)
  .subscribe()
```

---

## Next Actions

### **Immediate (You Can Start Now):**
1. ✅ Review the design system tokens - adjust colors/spacing if needed
2. ✅ Test FieldOfficerPortal on mobile device - report any UX issues
3. 🔄 Approve the modular component split plan (PlateCapture, ComplianceCard, etc.)
4. 🔄 Confirm PDF matrix snapshot format (I'll provide mockup)

### **Next Session (I'll Implement):**
1. Split large components into modules
2. Create AdminPortal entry point
3. Implement DriftDashboard with real-time updates
4. Update App.tsx routing logic
5. Add PDF matrix snapshot generation

---

## Questions Remaining

1. **Color Scheme:** Keep current primary color (blue) or change for Field/Admin portals?
2. **Navigation:** Bottom nav on mobile, sidebar on desktop - correct?
3. **Camera Defaults:** Should we prefer USB cameras over built-in cameras when available?
4. **Offline Limit:** Max number of queued scans before forcing sync (suggest 50)?
5. **Session Timeout:** How long should officers stay logged in on mobile (suggest 12 hours)?

---

## Success Metrics

### **Phase 1 Complete When:**
- ✅ Field officers can scan plates on mobile without issues
- ✅ Admins can view drift events and re-run recalculations
- ✅ PDFs include matrix snapshot section
- ✅ Real-time progress updates work (no polling)
- ✅ Offline queue works and syncs when online
- ✅ No critical UX issues on iOS or Android

### **Phase 2 Complete When:**
- ✅ Notifications work (email/push)
- ✅ Leadership reports generate correctly
- ✅ Accessibility audit passes
- ✅ Performance meets targets (LCP < 2.5s, FID < 100ms)

### **Phase 3 Complete When:**
- ✅ Full QA passed
- ✅ Documentation complete
- ✅ Training conducted
- ✅ Production deployment successful

---

**Status:** Foundation laid ✅  
**Next:** Modular component split + AdminPortal creation 🚀
