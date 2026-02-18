# Plate Scanner Integration

## ✅ Created Files

1. **src/components/features/PlateScanner.tsx** - Brand new Plate Scanner component
   - Auto-zone detection from GPS geofence
   - Auto-start/resume patrol
   - Continuous rapid scanning (non-blocking)
   - Results queue with auto-dismiss
   - Photo retention in observations_v2
   - Watermarking with zone/GPS/time
   - Vertical zoom slider, torch, overlays

## ⚠️ Manual Integration Needed

The PlateScanner component has been created, but needs to be manually integrated into `src/pages/FieldOfficerPortal.tsx`:

### Integration Steps:

1. **Already completed:**
   - Import added: `import { PlateScanner } from '@/components/features/PlateScanner';`
   - View mode updated: `type ViewMode = 'dashboard' | 'scanning' | 'zoom_scan' | 'plate_scanner' | 'reports' | 'history' | 'settings';`
   - Render content updated with `plate_scanner` view that renders `<PlateScanner onExit={() => setCurrentView('dashboard')} />`
   - Sidebar menu updated with "Plate Scanner 🆕" button (purple/pink gradient)
   - Bottom nav updated with "Scanner" button (replacing "Zoom")

2. **Remaining (manual edits needed):**

Find the TWO instances of this line:
```typescript
{currentView !== 'scanning' && currentView !== 'zoom_scan' && (
```

Replace with:
```typescript
{currentView !== 'scanning' && currentView !== 'zoom_scan' && currentView !== 'plate_scanner' && (
```

Find this line:
```typescript
<KeepScreenAwake isActive={currentView === 'scanning' || currentView === 'zoom_scan'} />
```

Replace with:
```typescript
<KeepScreenAwake isActive={currentView === 'scanning' || currentView === 'zoom_scan' || currentView === 'plate_scanner'} />
```

## 🎯 What Plate Scanner Does

### Workflow:
1. **Auto-detect zone** from GPS geofence (or fallback to "Other Location")
2. **Auto-start/resume patrol** when zone is detected
3. **Capture photo** from camera
4. **Watermark photo** with zone name, GPS coords, date/time, patrol shift
5. **Upload to storage** (RETAIN BEFORE ALPR)
6. **ALPR recognition** via recognize-plate Edge Function
7. **Process field scan** via process-field-scan Edge Function (creates observation in vehicle_observations_v2)
8. **Display result** in queue with status badge:
   - 🟢 Compliant → Auto-dismiss after 5s
   - 🔴 Breach → Manual dismiss
   - 🟡 At Risk → Manual dismiss
   - 🏕️ FC Exempt (Homeless) → Auto-dismiss after 5s
   - ❌ Failed → Auto-dismiss after 10s

### Features:
- **Non-blocking scanning** - Officer can scan continuously, processing happens in background
- **Processing counter** - Shows how many scans are currently being analyzed
- **Vertical zoom slider** (1-5x) on right side
- **Torch toggle** on left side
- **Zone/GPS/Time overlay** on top left (50% opacity)
- **Large capture button** with processing badge
- **Queue display** at top 1/4 of screen

## 🚀 Access

Once integrated, access via:
- **Bottom Nav Bar** - Purple/pink gradient "Scanner" button (middle position)
- **Sidebar Menu** - "Plate Scanner 🆕" button with gradient styling

## 📝 Differences from Zoom Scan

| Feature | Old Zoom Scan | New Plate Scanner |
|---------|---------------|-------------------|
| Zone Selection | Manual | **Auto-detect from GPS** |
| Patrol Start | Manual | **Auto-start/resume** |
| Photo Retention | ✅ | ✅ |
| Watermarking | ✅ | ✅ (includes patrol shift) |
| Continuous Scanning | ✅ | ✅ |
| Auto-dismiss | ✅ | ✅ |
| GPS Integration | Basic | **Full geofence detection** |
| Patrol Integration | None | **Auto-create/resume** |

## ✅ Backend Readiness

- ✅ Breach alerts migration ready (20260218_rebuild_breach_alerts_system.sql)
- ✅ process-field-scan Edge Function ready
- ✅ recognize-plate Edge Function ready
- ✅ RLS policies configured
- ✅ Triggers configured (auto-create compliance_results, breach_alerts)
- ✅ Geofence functions ready (find_all_matching_zones)

## 🎨 UI Design

- **Split-screen layout:** Queue (top 25%) + Camera (bottom 75%)
- **Queue items:** Color-coded borders (green/red/amber/cyan)
- **Camera controls:** 50% opacity overlays, no interference with capture
- **Gradient styling:** Purple-pink gradient for Plate Scanner branding
- **Mobile-first:** Touch targets, large buttons, readable text

## 🔧 Testing Checklist

- [ ] Auto-zone detection works
- [ ] Auto-patrol creation works
- [ ] Photo capture with watermark works
- [ ] ALPR recognition works
- [ ] Observation creation works
- [ ] Compliance evaluation works
- [ ] Breach alerts auto-create (for non-compliant, non-homeless)
- [ ] Queue displays correctly
- [ ] Auto-dismiss timing correct (5s compliant/homeless, manual breach/at-risk)
- [ ] Continuous scanning (non-blocking) works
- [ ] Zoom slider works
- [ ] Torch toggle works
- [ ] GPS overlay shows correctly
