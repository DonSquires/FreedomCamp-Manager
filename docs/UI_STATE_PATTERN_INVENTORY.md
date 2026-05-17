# FieldOps Manager UI State Pattern Inventory

**Date**: May 17, 2026  
**Scope**: Loading, Error, Empty state patterns across main portal shells and supporting pages  
**Thoroughness**: Medium (main data-fetching surfaces, core UI flows)

---

## Executive Summary

| Pattern | Current Implementation | Health |
|---------|------------------------|--------|
| **Loading States** | Mixed: Skeletons + Text + Animations | ⚠️ Inconsistent |
| **Error States** | Toast + Retry in admin pages; silent failure in public | ⚠️ Inconsistent |
| **Empty States** | Mostly absent; some zero-filled KPI cards | ❌ Poor |
| **Recovery Mechanisms** | Manual retry buttons; no auto-retry | ⚠️ Limited |
| **User Feedback** | Toast notifications (sonner) as primary feedback | ✅ Good |

---

## Pattern Inventory by Page

### 1. ADMIN PORTAL (`src/pages/AdminPortal.tsx`) — **1273 lines**

#### Loading State Pattern
- **Implementation**: Full-page skeleton grid + grid of `<Skeleton>` cards
- **Line Range**: [984-1009]
- **Health**: ✅ **GOOD** — Matches content structure

```tsx
// GOOD EXAMPLE (AdminPortal.tsx, line 984-1009)
if (isLoading && !data) {
  return (
    <AppLayout
      title="Command Centre"
      description="Loading…"
    >
      <div className="space-y-4 p-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
```

#### Error State Pattern
- **Implementation**: Full-page error card with AlertTriangle icon + descriptive message + retry button
- **Line Range**: [970-983]
- **Health**: ✅ **EXCELLENT** — Actionable with clear retry path

```tsx
// EXCELLENT EXAMPLE (AdminPortal.tsx, line 970-983)
if (isError) {
  return (
    <AppLayout
      title="Command Centre"
      description="Dashboard KPI query failed"
    >
      <div className="max-w-2xl mx-auto mt-16 px-4">
        <Card className="border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20">
          <CardHeader>
            <CardTitle className="text-red-800 dark:text-red-200 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Dashboard failed to load
            </CardTitle>
            <CardDescription className="text-red-700 dark:text-red-300">
              {(error as any)?.message ?? 'Live KPI and queue data could not be loaded right now. Retry the dashboard or fall back to the patrol map while data recovers.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-primary-dashboard'] })}>
              Retry dashboard
            </Button>
            <Button variant="ghost" onClick={() => navigate('/live-patrol')}>
              Open patrol map
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
```

#### Empty State Pattern
- **Implementation**: Zero-filled KPI cards + warning toast on zero-filtered results
- **Line Range**: [402-427]
- **Health**: ⚠️ **PARTIAL** — Shows zero values, but doesn't guide user to action

```tsx
// PARTIAL EXAMPLE (AdminPortal.tsx, line 402-427)
// Warns once per filter key when a scoped query returns all-zero KPIs
if (hasScopedFilters && totalObservations === 0 && activeBreaches === 0 && activeVehicles === 0) {
  const key = [effectiveOrganizationId ?? 'all-orgs', zoneId ?? 'all-zones', ...].join('|')
  if (key !== lastZeroToastKey) {
    toast.warning('Dashboard returned zero results for the selected filters', {
      description: hasDiagnostics
        ? 'Open the diagnostics panel on this page for exact query errors.'
        : 'Try Clear All, then re-apply filters. If this persists, it may be an access-policy scope issue.',
      duration: 8000,
    })
    setLastZeroToastKey(key)
  }
}

// KPI cards always show value (including zero)
const primaryKPIs = [
  {
    title: 'Active Breaches',
    value: isLoading ? '...' : metrics.activeBreaches,  // Shows '0' if zero
    subtitle: isLoading ? undefined : `${metrics.totalBreaches} total in period`,
    // ...
  },
  // ... more KPI cards
]
```

**Issues**:
- Shows `0` without distinguishing between "no data" and "genuinely zero breaches"
- Zero-filled dashboard may mislead users on filter effectiveness

---

### 2. BREACH ALERTS PAGE (`src/pages/BreachAlerts.tsx`) — **1000+ lines**

#### Loading State Pattern
- **Implementation**: No visible loading state during initial fetch
- **Health**: ❌ **POOR** — Silent loading, no user feedback

#### Error State Pattern
- **Implementation**: Toast notification on error + manual query invalidation
- **Line Range**: [230-235]
- **Health**: ⚠️ **ADEQUATE** — Toast appears but error details limited

```tsx
// ADEQUATE EXAMPLE (BreachAlerts.tsx, line 230-235)
const { data: breaches, isLoading, isError: breachesIsError, error: breachesError } = useBreachAlertQueue({
  // ...
})

useEffect(() => {
  if (!breachesIsError) return
  toast.error('Failed to load breaches', {
    description: (breachesError as any)?.message || 'Unknown error loading breach queue',
  })
}, [breachesIsError, breachesError])
```

**Issues**:
- No visual feedback during load (spinner or skeleton)
- Error toast might be missed if user is scrolling
- No retry mechanism visible to user

#### Empty State Pattern
- **Implementation**: None — silently shows empty list
- **Health**: ❌ **POOR** — No messaging or actionable CTA

```tsx
// If breaches.length === 0, nothing is shown except blank list
// No empty state card, no "Create a breach" CTA, no search help
```

---

### 3. COMPLIANCE DASHBOARD (`src/pages/ComplianceDashboard.tsx`) — **280+ lines**

#### Loading State Pattern
- **Implementation**: `PaperworkSearchAnimation` custom animation component
- **Line Range**: [193-195]
- **Health**: ✅ **GOOD** — Branded, visual feedback with text

```tsx
// GOOD EXAMPLE (ComplianceDashboard.tsx, line 193-195)
return (
  <AppLayout title="Compliance Dashboard" description="Real-time compliance monitoring and analytics" showBackButton>
    <GlobalFilterRibbon />

    {isLoading ? (
      <PaperworkSearchAnimation text="Loading compliance data…" />
    ) : (
      <>
        {/* KPI Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {/* ... */}
        </div>
      </>
    )}
  </AppLayout>
)
```

#### Error State Pattern
- **Implementation**: None — silent fail or unhandled promise rejection
- **Health**: ❌ **POOR** — No error handling visible

#### Empty State Pattern
- **Implementation**: KPI cards show `0` or `0%` with no explanation
- **Health**: ❌ **POOR** — Confusing when all metrics are zero

```tsx
// KPI cards render regardless of zero values
<Card>
  <CardHeader className="pb-2">
    <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" />
      Active Breaches
    </CardTitle>
  </CardHeader>
  <CardContent>
    <div className="text-3xl font-bold text-red-600">
      {stats?.active_breaches || 0}  {/* Renders 0 without context */}
    </div>
    <p className="text-xs text-gray-500 mt-1">Pending action</p>
  </CardContent>
</Card>
```

---

### 4. FIELD OFFICER PORTAL (`src/pages/FieldOfficerPortal.tsx`) — **1800+ lines**

#### Loading State Pattern
- **Implementation**: None for main content; specific features load in background
- **Health**: ❌ **POOR** — Page appears ready while data loads

#### Error State Pattern
- **Implementation**: Toast notifications for specific mutations; global errors silent
- **Line Range**: [728, 776]
- **Health**: ⚠️ **PARTIAL** — Only captures mutation errors

```tsx
// PARTIAL EXAMPLE (FieldOfficerPortal.tsx, line 728, 776)
const updateRouteStopStatus = useMutation({
  mutationFn: async (params) => { /* ... */ },
  onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
})

// But main data queries have no error handling:
const { data: activeRoute, isLoading: activeRouteLoading, isError: activeRouteIsError, error: activeRouteError } = useOfficerActiveRouteInstance()
// ^ Error state not handled in JSX
```

#### Empty State Pattern
- **Implementation**: None — blank UI if no route is active
- **Health**: ❌ **POOR** — No message like "No active patrol route"

**Special Note**: Officer portal is highly complex; loading/error handling is deferred to individual feature components (camera, scanner, etc.)

---

### 5. PATROL KPI DASHBOARD (`src/pages/PatrolKPIDashboard.tsx`) — **150+ lines**

#### Loading State Pattern
- **Implementation**: Text-only loading message
- **Line Range**: [67-68]
- **Health**: ⚠️ **MINIMAL** — Text-only, no visual indicator

```tsx
// MINIMAL EXAMPLE (PatrolKPIDashboard.tsx, line 67-68)
{isLoading && (
  <p className="text-muted-foreground py-8 text-center">Loading KPI data…</p>
)}
```

#### Error State Pattern
- **Implementation**: None — error silently fails
- **Health**: ❌ **NONE**

#### Empty State Pattern
- **Implementation**: None — no KPI cards render if data is empty
- **Health**: ❌ **POOR** — User sees blank space

**Issues**:
- No skeleton or shimmer effect during load
- No error boundary or fallback UI
- If `kpis` is `null`, entire section disappears

---

### 6. DISPATCH MONITOR (`src/pages/DispatchMonitor.tsx`) — **400+ lines**

#### Loading State Pattern
- **Implementation**: Uses `AsyncStateWrapper` component (reusable pattern)
- **Line Range**: [160+]
- **Health**: ✅ **GOOD** — Composable, consistent

#### Error State Pattern
- **Implementation**: `AsyncStateWrapper` handles error state + retry button
- **Health**: ✅ **GOOD** — Built into wrapper component

#### Empty State Pattern
- **Implementation**: `AsyncStateWrapper` customizable empty state
- **Health**: ⚠️ **UNDERUTILIZED** — Props exist but not commonly used

```tsx
// REUSABLE PATTERN (DispatchMonitor.tsx)
<AsyncStateWrapper 
  isLoading={isLoading} 
  isError={isError} 
  isEmpty={isEmpty}
  error={error}
  onRetry={refetch}
>
  {/* Content rendered only when loaded and has data */}
</AsyncStateWrapper>
```

---

### 7. LIVE PATROL MONITOR (`src/pages/LivePatrolMonitor.tsx`) — **300+ lines**

#### Loading State Pattern
- **Implementation**: Uses `AsyncStateWrapper`
- **Health**: ✅ **GOOD**

#### Error State Pattern
- **Implementation**: `AsyncStateWrapper` + toast fallback
- **Health**: ✅ **GOOD**

#### Empty State Pattern
- **Implementation**: `AsyncStateWrapper` with custom empty message
- **Health**: ✅ **GOOD** — Provides context-aware messaging

---

### 8. OBSERVATION RECORDS (`src/pages/ObservationRecords.tsx`) — **500+ lines**

#### Loading State Pattern
- **Implementation**: Query `isLoading` flag; UI state unclear
- **Health**: ⚠️ **UNCLEAR** — Depends on child components

#### Error State Pattern
- **Implementation**: Toast notification on query error + refetch button
- **Line Range**: [180+]
- **Health**: ⚠️ **ADEQUATE**

```tsx
// ADEQUATE EXAMPLE (ObservationRecords.tsx)
const {
  data: rawObservations = [],
  isLoading: observationsLoading,
  isError: observationsIsError,
  error: observationsError,
  refetch,
} = useQuery({
  queryKey: ['observation-records-observations', ...],
  queryFn: async () => { /* ... */ },
})
```

#### Empty State Pattern
- **Implementation**: Shows search field; silent if no results
- **Health**: ⚠️ **PARTIAL** — Relies on search UX to indicate empty

---

### 9. REPORTS HUB (`src/pages/ReportsHub.tsx`) — **140+ lines**

#### Loading State Pattern
- **Implementation**: None — form wizard only (no async load phase)
- **Health**: N/A (form-based, not data-fetching)

#### Error State Pattern
- **Implementation**: None visible in header; handled within wizard
- **Health**: ⚠️ **PARTIAL**

#### Empty State Pattern
- **Implementation**: Static report cards always visible
- **Health**: ✅ **GOOD** — Clear navigation options always available

---

### 10. PUBLIC PARKING APPEAL PORTAL (`src/pages/PublicParkingAppealPortal.tsx`) — **200+ lines**

#### Loading State Pattern
- **Implementation**: Loading state variable; no visual feedback during `looking` phase
- **Line Range**: [100+]
- **Health**: ❌ **POOR** — Silent loading, button only shows state

```tsx
// POOR EXAMPLE (PublicParkingAppealPortal.tsx)
const [looking, setLooking] = useState(false)

const handleLookup = async () => {
  setLooking(true)
  try {
    // async work
  } finally {
    setLooking(false)
  }
}

// Button shows loading state but no spinner or text feedback
<Button onClick={handleLookup} disabled={looking}>
  <Search className="h-4 w-4" />
</Button>
```

#### Error State Pattern
- **Implementation**: Toast error on lookup failure
- **Health**: ⚠️ **ADEQUATE** — Toast only, no inline validation

#### Empty State Pattern
- **Implementation**: Form resets on invalid lookup; no "not found" CTA
- **Health**: ⚠️ **PARTIAL** — Requires user to retry manually

---

## Component Patterns: AsyncStateWrapper

**Location**: `src/components/features/AsyncStateWrapper.tsx`

**Status**: ✅ **Exists but underutilized** — Available as reusable pattern but only used in ~2 pages

### Features Available

```tsx
export interface AsyncStateWrapperProps {
  isLoading?: boolean
  isError?: boolean
  isEmpty?: boolean
  error?: Error | string | null | unknown
  onRetry?: () => void
  isOffline?: boolean
  loadingText?: string
  loadingSize?: 'sm' | 'md' | 'lg'
  errorTitle?: string
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: ReactNode
  emptyActionLabel?: string
  onEmptyAction?: () => void
  children: ReactNode
  className?: string
}
```

**Recommendation**: This pattern should be adopted across all data-fetching pages.

---

## Summary Table: State Handling Across Pages

| Page | Loading State | Error State | Empty State | Overall Health |
|------|---------------|-------------|-------------|-----------------|
| AdminPortal | Skeleton Grid ✅ | Error Card + Retry ✅ | Toast Warning ⚠️ | 🟡 **Good** |
| BreachAlerts | None ❌ | Toast ⚠️ | Silent ❌ | 🔴 **Poor** |
| ComplianceDashboard | Animation ✅ | None ❌ | Zero-Filled ❌ | 🔴 **Poor** |
| FieldOfficerPortal | None ❌ | Mutation Toast ⚠️ | None ❌ | 🔴 **Poor** |
| PatrolKPIDashboard | Text Only ⚠️ | None ❌ | None ❌ | 🔴 **Poor** |
| DispatchMonitor | AsyncWrapper ✅ | AsyncWrapper ✅ | AsyncWrapper ⚠️ | 🟢 **Good** |
| LivePatrolMonitor | AsyncWrapper ✅ | AsyncWrapper ✅ | AsyncWrapper ✅ | 🟢 **Good** |
| ObservationRecords | Query Flag ⚠️ | Toast ⚠️ | Silent ❌ | 🟡 **Partial** |
| ReportsHub | N/A | Partial ⚠️ | Static ✅ | 🟡 **Form-Based** |
| PublicParkingAppeal | Silent ❌ | Toast ⚠️ | Silent ❌ | 🔴 **Poor** |

---

## Key Issues & Recommendations

### Issue 1: Inconsistent Loading States
- **Current**: Mix of skeletons, text, animations, and nothing
- **Impact**: Users confused about whether page is responding
- **Recommendation**: Standardize on skeleton screens matching content height

### Issue 2: Silent Failures in Data-Heavy Pages
- **Current**: BreachAlerts, ComplianceDashboard, FieldOfficerPortal have no error UI
- **Impact**: Users unaware data failed to load; think the dashboard is empty
- **Recommendation**: Adopt `AsyncStateWrapper` or equivalent error card pattern

### Issue 3: Empty States Absent
- **Current**: Pages show zero-filled cards or blank space
- **Impact**: Users can't distinguish "no data" from "query error" from "legitimate zero"
- **Recommendation**: Implement contextual empty state messaging with CTAs (e.g., "No breaches in the last 7 days. Try widening your date range" with action button)

### Issue 4: No Auto-Retry Mechanisms
- **Current**: Retry requires manual button click
- **Impact**: Transient network errors require user intervention
- **Recommendation**: Consider exponential backoff retry with user-visible attempt counter

### Issue 5: Zero-Filled KPI Cards
- **Current**: KPI cards display `0` or `0%` without context
- **Impact**: Misleading when filters are overly restrictive or data is genuinely zero
- **Recommendation**: Add conditional "Check your filters" message or highlight the KPI in muted color

---

## Code Snippets: Good vs Bad Examples

### ✅ GOOD: Full Error Handling (AdminPortal.tsx)

```tsx
const { data, isLoading, isError, error } = useAdminPrimaryDashboard({
  // query params
})

// Full page error state
if (isError) {
  return (
    <AppLayout title="Command Centre" description="Dashboard KPI query failed">
      <div className="max-w-2xl mx-auto mt-16 px-4">
        <Card className="border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20">
          <CardHeader>
            <CardTitle className="text-red-800 dark:text-red-200 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Dashboard failed to load
            </CardTitle>
            <CardDescription className="text-red-700 dark:text-red-300">
              {(error as any)?.message ?? 'Live KPI and queue data could not be loaded right now.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-primary-dashboard'] })}>
              Retry dashboard
            </Button>
            <Button variant="ghost" onClick={() => navigate('/live-patrol')}>
              Open patrol map
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

// Full page loading state
if (isLoading && !data) {
  return (
    <AppLayout title="Command Centre" description="Loading…">
      <div className="space-y-4 p-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    </AppLayout>
  )
}

// Content only renders if loaded and no error
return <AppLayout>{ /* ... content ... */ }</AppLayout>
```

### ❌ BAD: Silent Failures (ComplianceDashboard.tsx)

```tsx
const { data: stats, isLoading } = useQuery({
  queryKey: ['dashboard-stats', /* ... */],
  queryFn: async () => {
    const { data, error } = await supabase.rpc(/* ... */)
    if (error) throw error  // Error is thrown but not caught in component
    return data
  },
})

// No error handling
// No isError check

return (
  <AppLayout title="Compliance Dashboard" description="Real-time compliance monitoring">
    <GlobalFilterRibbon />

    {isLoading ? (
      <PaperworkSearchAnimation text="Loading compliance data…" />
    ) : (
      <>
        {/* KPI cards always render, even if stats is undefined */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardContent>
              <div className="text-3xl font-bold">
                {stats?.compliance_rate.toFixed(1)}%  {/* crashes if stats is null */}
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    )}
  </AppLayout>
)
```

### ⚠️ PARTIAL: AsyncWrapper Pattern (DispatchMonitor.tsx)

```tsx
// UNDERUTILIZED but available
<AsyncStateWrapper 
  isLoading={isLoading} 
  isError={isError} 
  isEmpty={breachCount === 0}
  error={error}
  onRetry={() => refetch()}
  emptyTitle="No breaches in queue"
  emptyDescription="Check your filters or wait for new breaches to be detected"
  emptyActionLabel="Reset filters"
  onEmptyAction={() => resetFilters()}
  loadingText="Loading breach queue…"
  loadingSize="lg"
>
  {/* Breach list rendered only when loaded, no error, and has data */}
  <BreachList breaches={breaches} />
</AsyncStateWrapper>
```

---

## Recommendations for Next Steps

### Phase 1: Standardize (2-3 sprints)
1. **Adopt `AsyncStateWrapper` across all query-based pages**
   - BreachAlerts.tsx
   - ComplianceDashboard.tsx
   - ObservationRecords.tsx
   - PatrolKPIDashboard.tsx
   - FieldOfficerPortal.tsx (key sections)

2. **Define skeleton screen heights matching content** (Figma specs or standard grid)
   - KPI cards: 100px
   - Data tables: 200px
   - Charts: 300px

3. **Add empty state messaging templates**
   - "No data for the selected filters. Try [action]."
   - "No observations recorded today."
   - "Waiting for officers to check in."

### Phase 2: Enhanced Error Recovery (1-2 sprints)
1. Implement exponential backoff retry for transient errors
2. Add offline detection (navigator.onLine)
3. Surface error details in diagnostics panel
4. Add breadcrumb trail showing what failed

### Phase 3: User Experience Polish (1 sprint)
1. Add micro-interactions (fade-in animations on data load)
2. Progressively reveal data (critical KPIs first, then details)
3. Add helpful CTAs in empty states with link previews

---

## Files to Review for Implementation

| File | Purpose | Priority |
|------|---------|----------|
| `src/components/features/AsyncStateWrapper.tsx` | Reusable pattern | HIGH |
| `src/pages/AdminPortal.tsx` | Reference implementation (good) | HIGH |
| `src/pages/DispatchMonitor.tsx` | AsyncWrapper usage example | HIGH |
| `src/components/features/PaperworkSearchAnimation.tsx` | Loading animation | MEDIUM |
| `src/pages/BreachAlerts.tsx` | Needs refactoring | HIGH |
| `src/pages/ComplianceDashboard.tsx` | Needs error handling | HIGH |

---

**Next Action**: Review this inventory with your design team and prioritize which pages to refactor first based on user impact (likely BreachAlerts and ComplianceDashboard are highest traffic).
