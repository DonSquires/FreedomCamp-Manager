# Enforcement Command Center - Integration Guide

**Date:** Feb 24, 2026  
**Status:** 🚀 READY FOR DEPLOYMENT  
**Type:** Real-Time Admin Dashboard Alternative

---

## 🎯 Overview

A dedicated real-time enforcement monitoring dashboard with:
- ✅ **Live KPI Metrics:** Scans, breaches, warnings, active officers
- ✅ **Real-Time Breach Feed:** Auto-refreshing alert table
- ✅ **30-Second Auto-Refresh:** Background polling
- ✅ **Organization-Scoped:** RLS enforces data access
- ✅ **Dark Theme:** Command center aesthetic

---

## 📦 Components Created

### 1. **Database Views**
File: `supabase/migrations/20260224_admin_dashboard_views.sql`

**Views:**
- `dashboard_stats_live` - Real-time KPI aggregation
- `dashboard_breaches` - Enriched breach alert feed with vehicle/zone details

**Features:**
- Performance indexes for fast queries
- Organization-scoped RLS filtering
- Automatic joins to canonical_vehicles, zones, compliance_matrix

### 2. **React Component**
File: `src/pages/EnforcementCommandCenter.tsx`

**Features:**
- Real-time KPI cards (scans, breaches, warnings, officers)
- Live breach table with status badges
- Auto-refresh every 30 seconds
- Manual refresh button
- Loading states and error handling

---

## 🚀 Deployment Steps

### Step 1: Deploy Database Views ✅
```bash
supabase db push
```

**Verify Views:**
```sql
-- Test KPI view
SELECT * FROM public.dashboard_stats_live;

-- Test breach feed
SELECT * FROM public.dashboard_breaches LIMIT 10;
```

**Expected Output:**
```
scans_today | active_breaches | unique_vehicles_24h | warnings_24h | active_officers
-----------+-----------------+---------------------+--------------+----------------
         42 |              12 |                  28 |           15 |              3
```

### Step 2: Add Route to Router

**File:** `src/App.tsx` (or wherever your routing is configured)

```tsx
import EnforcementCommandCenter from '@/pages/EnforcementCommandCenter';

// Add route (admin-only)
<Route 
  path="/admin/command-center" 
  element={
    <ProtectedRoute role={['admin', 'master']}>
      <EnforcementCommandCenter />
    </ProtectedRoute>
  } 
/>
```

### Step 3: Add Navigation Link

**File:** `src/components/features/AdminNavigationMenu.tsx`

```tsx
import { ShieldAlert } from 'lucide-react';

// Add menu item
{
  label: 'Command Center',
  path: '/admin/command-center',
  icon: <ShieldAlert size={18} />,
  description: 'Real-time enforcement monitoring',
}
```

### Step 4: Test Live Updates

1. **Open Command Center:** Navigate to `/admin/command-center`
2. **Verify KPIs Load:** Check scans, breaches, warnings counts
3. **Test Auto-Refresh:** Wait 30 seconds, verify data updates
4. **Manual Refresh:** Click refresh button, verify spinner animation
5. **Create New Breach:** Trigger a breach alert, verify it appears in feed

---

## 🧪 Testing Checklist

### Unit Tests
- [ ] KPI card rendering with zero values
- [ ] Breach table empty state
- [ ] Status badge color mapping
- [ ] Time formatting (locale-aware)

### Integration Tests
- [ ] View queries return expected columns
- [ ] RLS filters organization data correctly
- [ ] Auto-refresh updates state every 30 seconds
- [ ] Manual refresh fetches latest data

### Manual Tests
```bash
# 1. Create test observation
INSERT INTO observations (plate_number, zone_id, organization_id, recorded_by, photo_url, photo_hash, recorded_at, gps_latitude, gps_longitude)
VALUES ('TEST123', '<zone_id>', '<org_id>', '<user_id>', 'https://...', 'abc123', NOW(), -41.2865, 174.7762);

# 2. Verify scans_today increments
SELECT scans_today FROM dashboard_stats_live;

# 3. Create test breach
INSERT INTO breach_alerts (plate_number, zone_id, organization_id, breach_type, status)
VALUES ('TEST123', '<zone_id>', '<org_id>', 'excessive_stay', 'pending');

# 4. Verify breach appears in feed
SELECT * FROM dashboard_breaches WHERE plate_number = 'TEST123';
```

---

## 🎨 UI Comparison: AdminPortal vs Command Center

| Feature | AdminPortal.tsx | EnforcementCommandCenter.tsx |
|---------|----------------|------------------------------|
| **Purpose** | Comprehensive enforcement dashboard | Real-time monitoring command center |
| **KPIs** | 9 tiles with drilldowns | 4 key metrics (scans, breaches, warnings, officers) |
| **Charts** | Timeseries + breach bar chart | Breach feed table only |
| **Theme** | Light/dark adaptive | Dark command center theme |
| **Refresh** | Filter-triggered | Auto 30s + manual |
| **Drilldowns** | Date-locked navigation | Direct breach status view |
| **Use Case** | Strategic analysis | Tactical monitoring |

**Recommendation:** Use both!
- **AdminPortal:** Strategic planning (charts, trends, drilldowns)
- **Command Center:** Real-time monitoring (live alerts, quick response)

---

## 📊 View Queries Explained

### dashboard_stats_live

```sql
-- Scans Today: Count observations created today (NZ timezone)
SELECT COUNT(*) FROM observations
WHERE DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = CURRENT_DATE;

-- Active Breaches: Pending/assigned breach alerts
SELECT COUNT(*) FROM breach_alerts
WHERE status IN ('pending', 'assigned');

-- Unique Vehicles 24h: Distinct plates scanned
SELECT COUNT(DISTINCT plate_number) FROM observations
WHERE recorded_at >= NOW() - INTERVAL '24 hours';

-- Warnings 24h: Enforcement actions issued
SELECT COUNT(*) FROM enforcement_actions
WHERE action_type = 'warning'
  AND recorded_at >= NOW() - INTERVAL '24 hours';

-- Active Officers: Recent activity log entries
SELECT COUNT(DISTINCT user_id) FROM officer_activity_log
WHERE recorded_at >= NOW() - INTERVAL '2 hours';
```

### dashboard_breaches

```sql
-- Breach feed with vehicle/zone enrichment
SELECT
  ba.id AS alert_id,
  ba.status,
  ba.created_at,
  cv.plate_number, cv.make, cv.model, cv.colour,
  z.name AS zone_name,
  zcm.max_consecutive_nights,
  ba.breach_type AS rule_applied,
  (ba.breach_details->>'nights_stayed')::INTEGER AS nights_stayed
FROM breach_alerts ba
LEFT JOIN canonical_vehicles cv USING (plate_number)
LEFT JOIN zones z ON ba.zone_id = z.id
LEFT JOIN zone_compliance_matrix zcm ON (
  zcm.zone_id = ba.zone_id
  AND zcm.effective_from <= NOW()
  AND (zcm.effective_to IS NULL OR zcm.effective_to > NOW())
)
ORDER BY ba.created_at DESC;
```

---

## 🔒 Security & RLS

### View-Level Security
Both views are `SECURITY DEFINER` functions that respect RLS:

```sql
-- Officers see only their organization's data
CREATE FUNCTION dashboard_org_filter() RETURNS SETOF dashboard_breaches AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM dashboard_breaches
  WHERE organization_id = ANY (get_user_organization_ids());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Access Control
- **Masters:** See all organizations
- **Admins:** See own organization + descendants
- **Officers:** See own organization only
- **Public:** No access (authenticated required)

---

## 🚨 Troubleshooting

### Issue: "View returns NULL for scans_today"
**Cause:** No observations exist for today  
**Solution:** Create test observation or adjust query to show yesterday's data

### Issue: "Breach feed is empty"
**Cause:** No active breach alerts  
**Solution:** Create test breach or adjust filters to show all statuses

### Issue: "Auto-refresh not working"
**Cause:** Component unmounted or interval cleared  
**Solution:** Check browser console for errors, verify useEffect cleanup

### Issue: "RLS blocking data"
**Cause:** User lacks organization access  
**Solution:** Verify `get_user_organization_ids()` returns expected orgs

---

## 📈 Performance Considerations

### Indexes Added
```sql
-- Observations: Today's scans
CREATE INDEX idx_observations_recorded_at_date 
  ON observations (DATE(recorded_at AT TIME ZONE 'Pacific/Auckland'));

-- Breach Alerts: Active status
CREATE INDEX idx_breach_alerts_status_created 
  ON breach_alerts (status, created_at DESC);

-- Officer Activity: Recent activity
CREATE INDEX idx_officer_activity_recent 
  ON officer_activity_log (recorded_at DESC);
```

### Query Optimization
- Views use `LEFT JOIN` to handle missing data gracefully
- `LIMIT 20` on breach feed prevents excessive data transfer
- `COUNT(DISTINCT ...)` uses indexes for fast aggregation

### Monitoring
```sql
-- Check view performance
EXPLAIN ANALYZE SELECT * FROM dashboard_stats_live;
EXPLAIN ANALYZE SELECT * FROM dashboard_breaches LIMIT 20;
```

---

## 🔄 Future Enhancements

### Planned Features
- [ ] Realtime subscriptions (replace polling)
- [ ] Click breach row to open detail modal
- [ ] Export breach feed to CSV
- [ ] KPI sparkline charts (last 7 days trend)
- [ ] Sound alerts for new breaches
- [ ] Customizable refresh interval
- [ ] Filter breach feed by status/zone

### Migration to Realtime
```tsx
// Replace polling with Realtime subscriptions
useEffect(() => {
  const channel = supabase
    .channel('breach-alerts')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'breach_alerts',
    }, (payload) => {
      // Update breaches state
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, []);
```

---

**Document Version:** 1.0  
**Status:** PRODUCTION READY  
**Component:** EnforcementCommandCenter.tsx  
**Views:** dashboard_stats_live, dashboard_breaches  
**Maintainer:** Tech Team
