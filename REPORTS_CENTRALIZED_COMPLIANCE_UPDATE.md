# REPORTS UPDATE - USE CENTRALIZED COMPLIANCE CALCULATION

## Problem Statement

All reports are currently reading from **stored values** (`is_compliant` column in `vehicle_records` table) which are **outdated**. They need to use the **centralized compliance calculation** as the single source of truth.

## Single Source of Truth

**Database Function**: `calculate_vehicle_compliance(p_plate_number, p_zone_id, p_check_date)`
**Edge Function**: `get-compliance-statistics` (calls the database function for all vehicles)
**React Hook**: `useVehicleCompliance.ts` (wraps the database function for individual vehicles)

## Reports Requiring Updates

1. ✅ **ComplianceDashboard.tsx** - ALREADY UPDATED
2. ❌ **Reports.tsx (Global Reports)** - NEEDS UPDATE
3. ❌ **BreachManagement.tsx** - NEEDS UPDATE
4. ❌ **VehicleHeatMap.tsx** - NEEDS UPDATE
5. ❌ **PatrolSessionSummary.tsx** - NEEDS UPDATE
6. ❌ **OfficerScanReport.tsx** - NEEDS UPDATE
7. ❌ **ActivityDashboard.tsx** - NEEDS UPDATE
8. ❌ **LivePatrolMonitor.tsx** - NEEDS UPDATE
9. ❌ **HomelessAnalytics.tsx** - CHECK (may already be accurate)

---

## Update Pattern for Each Report

### Pattern 1: Use `get-compliance-statistics` Edge Function

**For reports showing AGGREGATE STATISTICS (totals, counts, percentages):**

```typescript
import { FunctionsHttpError } from '@supabase/supabase-js';

// Add state
const [realTimeStats, setRealTimeStats] = useState<any>(null);
const [isLoadingStats, setIsLoadingStats] = useState(false);

// Add function to load stats
const loadRealTimeStats = async () => {
  setIsLoadingStats(true);
  try {
    const { data, error } = await supabase.functions.invoke('get-compliance-statistics', {
      body: {
        organizationId: selectedOrganizationId || 'all',
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      },
    });

    if (error) {
      let errorMessage = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const statusCode = error.context?.status ?? 500;
          const textContent = await error.context?.text();
          errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
        } catch {
          errorMessage = `${error.message || 'Failed to read response'}`;
        }
      }
      toast.error(`Statistics load failed: ${errorMessage}`);
      return;
    }

    if (data && data.success) {
      setRealTimeStats(data.stats);
      console.log('✅ Real-time statistics loaded:', data.stats);
    }
  } catch (error: any) {
    console.error('Statistics load error:', error);
    toast.error(error.message || 'Failed to load statistics');
  } finally {
    setIsLoadingStats(false);
  }
};

// Call on mount and when filters change
useEffect(() => {
  loadRealTimeStats();
}, [selectedOrganizationId, startDate, endDate]);

// Use stats in UI
const totalVehicles = realTimeStats?.totalVehicles || 0;
const compliantVehicles = realTimeStats?.compliantVehicles || 0;
const nonCompliantVehicles = realTimeStats?.nonCompliantVehicles || 0;
const criticalBreaches = realTimeStats?.criticalBreaches || 0;
const averageComplianceRate = realTimeStats?.averageComplianceRate || 0;
```

**Statistics Available from Edge Function:**

```typescript
interface ComplianceStats {
  totalVehicles: number;
  compliantVehicles: number;
  nonCompliantVehicles: number;
  criticalBreaches: number;
  warnings: number;
  homelessClaimed: number;
  homelessConfirmed: number;
  averageComplianceRate: number;
  breachTypes: Record<string, number>;  // Count by breach type
  zoneBreakdown: Array<{
    zoneId: string;
    zoneName: string;
    totalVehicles: number;
    compliantVehicles: number;
    complianceRate: number;
    breaches: number;
  }>;
}
```

### Pattern 2: Use `useVehicleCompliance` Hook

**For reports showing INDIVIDUAL VEHICLE compliance:**

```typescript
import { useVehicleCompliance } from '@/hooks/useVehicleCompliance';

// Inside your component:
const VehicleCard = ({ plateNumber, zoneId }: { plateNumber: string; zoneId: string }) => {
  const { data: compliance, isLoading } = useVehicleCompliance(plateNumber, zoneId);

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div>
      <p>Plate: {plateNumber}</p>
      <Badge variant={compliance.is_compliant ? "success" : "destructive"}>
        {compliance.is_compliant ? 'Compliant' : 'Non-Compliant'}
      </Badge>
      {compliance.violation_message && (
        <Alert>
          <AlertDescription>{compliance.violation_message}</AlertDescription>
        </Alert>
      )}
      {compliance.fine_amount > 0 && (
        <p className="font-semibold">Fine: ${compliance.fine_amount}</p>
      )}
    </div>
  );
};
```

---

## Specific Update Instructions

### 1. Reports.tsx (Global Reports)

**Current Issue**: Uses `filteredBreaches.length` (counts from `breach_alerts` table)
**Fix**: Call `get-compliance-statistics` Edge Function

```typescript
// BEFORE
const totalBreaches = filteredBreaches.length;

// AFTER
const totalBreaches = realTimeStats?.nonCompliantVehicles || 0;
const criticalBreaches = realTimeStats?.criticalBreaches || 0;
const warnings = realTimeStats?.warnings || 0;
```

**Breach Type Distribution**:
```typescript
// BEFORE
const breachTypeData = filteredBreaches.reduce((acc: any[], breach) => {
  // ... manual counting
}, []);

// AFTER
const breachTypeData = realTimeStats?.breachTypes
  ? Object.entries(realTimeStats.breachTypes).map(([type, count]) => ({
      name: type.replace(/_/g, ' '),
      value: count,
    }))
  : [];
```

**Zone Violation Comparison**:
```typescript
// BEFORE
const zoneViolations = zones.map(zone => ({
  name: zone.name,
  violations: filteredBreaches.filter(b => b.zone_id === zone.id).length,
  // ...
}));

// AFTER
const zoneViolations = realTimeStats?.zoneBreakdown || [];
```

### 2. BreachManagement.tsx

**Current Issue**: Uses `useBreaches()` hook which reads from `breach_alerts` table
**Fix**: Add real-time scanning using centralized function

```typescript
const handleScanBreaches = async () => {
  // This Edge Function already calls calculate_vehicle_compliance()
  // But we should also refresh the statistics after scanning
  
  const { data, error } = await supabase.functions.invoke('scan-breaches', {
    body: { autoCreate: true },
  });
  
  // After successful scan, refresh real-time stats
  if (data?.success) {
    await loadRealTimeStats();
  }
};
```

**Display Real-Time Counts**:
```typescript
// Add real-time statistics display
<Card className="border-green-500 bg-green-500/5">
  <CardContent className="p-4">
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
      <span className="text-sm font-semibold text-green-700">
        Real-Time Compliance: {realTimeStats?.compliantVehicles} compliant, 
        {realTimeStats?.nonCompliantVehicles} breaches detected
      </span>
    </div>
  </CardContent>
</Card>
```

### 3. VehicleHeatMap.tsx

**Current Issue**: Map markers colored based on `is_compliant` column
**Fix**: Calculate compliance on-the-fly for each vehicle

```typescript
// BEFORE
const isCompliant = vehicle.is_compliant;

// AFTER
const { data: compliance } = await supabase.rpc('calculate_vehicle_compliance', {
  p_plate_number: vehicle.plate_number,
  p_zone_id: vehicle.zone_id,
  p_check_date: new Date().toISOString().split('T')[0],
});

const isCompliant = compliance?.[0]?.is_compliant;
const violationSeverity = compliance?.[0]?.violation_severity;
```

**Marker Color Logic**:
```typescript
let color = '#22c55e'; // Default: compliant (green)

if (vehicle.has_incident) {
  color = '#ef4444'; // Red for incidents
} else if (violationSeverity === 'critical') {
  color = '#dc2626'; // Dark red for critical breaches
} else if (violationSeverity === 'moderate' || violationSeverity === 'warning') {
  color = '#f97316'; // Orange for warnings
} else if (vehicle.homeless_confirmed || vehicle.homeless_claimed) {
  color = '#f59e0b'; // Amber for homeless
}
```

### 4. PatrolSessionSummary.tsx

**Current Issue**: Calculates `complianceRate` from stored `is_compliant` values
**Fix**: Call `get-compliance-statistics` for the patrol date range

```typescript
// BEFORE
const compliantVehicles = vehicleRecords.filter(r => r.is_compliant).length;
const complianceRate = (compliantVehicles / totalVehicles) * 100;

// AFTER
const processRecords = async (vehicleRecords: VehicleRecord[]) => {
  setRecords(vehicleRecords);

  // Get real-time compliance stats for this patrol session
  const { data, error } = await supabase.functions.invoke('get-compliance-statistics', {
    body: {
      organizationId: user?.organization_id || 'all',
      startDate: opDayStart.toISOString().split('T')[0],
      endDate: opDayEnd.toISOString().split('T')[0],
    },
  });

  const stats = data?.stats;
  
  setSessionStats({
    totalVehicles: stats?.totalVehicles || vehicleRecords.length,
    compliantVehicles: stats?.compliantVehicles || 0,
    nonCompliantVehicles: stats?.nonCompliantVehicles || 0,
    complianceRate: stats?.averageComplianceRate || 0,
    // ... other stats
  });
};
```

---

## Summary of Changes Required

| Report | Current Data Source | New Data Source | Priority |
|--------|-------------------|----------------|----------|
| ComplianceDashboard.tsx | ✅ Already uses `get-compliance-statistics` | N/A | Done |
| Reports.tsx | `breach_alerts` table counts | `get-compliance-statistics` Edge Function | HIGH |
| BreachManagement.tsx | `breach_alerts` table | `scan-breaches` + `get-compliance-statistics` | HIGH |
| VehicleHeatMap.tsx | `vehicle_records.is_compliant` column | `calculate_vehicle_compliance()` per vehicle | MEDIUM |
| PatrolSessionSummary.tsx | Stored `is_compliant` values | `get-compliance-statistics` for date range | MEDIUM |
| OfficerScanReport.tsx | Stored values | `useVehicleCompliance` hook or Edge Function | LOW |

---

## Testing After Updates

1. **Open each report page**
2. **Check breach counts** - Should match actual violations, not 0
3. **Verify compliance rates** - Should be realistic (not 100%)
4. **Test date filters** - Statistics should update based on date range
5. **Check zone breakdowns** - Each zone should show accurate breach counts
6. **Verify breach types** - Should show monthly_limit_exceeded, consecutive_nights_exceeded, etc.

---

## Expected Results After Updates

✅ **Before Fix:**
- Total Breaches: **0**
- Avg Compliance: **100%**
- All zones showing 0 violations

✅ **After Fix:**
- Total Breaches: **Actual count** (10-30+)
- Avg Compliance: **Realistic** (85-95%)
- Zones showing actual violation counts
- Breach types properly categorized

---

## Key Principle

**NEVER read from `vehicle_records.is_compliant` or `breach_alerts` table directly**

**ALWAYS:**
- Use `get-compliance-statistics` Edge Function for aggregate stats
- Use `useVehicleCompliance` hook for individual vehicle checks
- Use `calculate_vehicle_compliance()` database function directly if needed

This ensures **all reports show identical, current compliance data** calculated from the single source of truth.
