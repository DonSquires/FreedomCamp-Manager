# 🛠️ **Portal Fixes - Implementation Guide**

## **Fix 1: Enforcement Route (5 minutes)**

### **Add Missing Route to App.tsx**

```tsx
// Add import at top
import EnforcementActions from '@/pages/EnforcementActions'

// Add route in Routes section
<Route
  path="/enforcement"
  element={
    <ProtectedRoute>
      <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
        <EnforcementActions />
      </RoleRoute>
    </ProtectedRoute>
  }
/>
```

### **Update AdminPortal.tsx**

Change the Enforcement card button:

```tsx
<CardHeader>
  <CardTitle className="flex items-center gap-2">
    <Shield className="h-5 w-5" />
    Enforcement Actions
  </CardTitle>
  <CardDescription>
    Warnings, notices, and enforcement workflow
  </CardDescription>
</CardHeader>
<CardContent>
  <Button className="w-full" variant="outline" onClick={() => navigate('/enforcement')}>
    View Enforcement
  </Button>
</CardContent>
```

---

## **Fix 2: Reports Error Handling (15 minutes)**

### **Update Reports.tsx generateReportMutation**

```tsx
const generateReportMutation = useMutation({
  mutationFn: async (reportType: string) => {
    setGeneratingReport(reportType)
    
    const { data, error } = await supabase.functions.invoke('generate-dashboard-report', {
      body: {
        report_type: reportType,
        organization_id: organizationId || user?.organization_id,
        zone_id: zoneId,
        start_date: dateFrom,
        end_date: dateTo,
      },
    })

    // ✅ NEW: Better error handling
    if (error) {
      // Check if it's a FunctionsHttpError
      if (error instanceof FunctionsHttpError) {
        try {
          const statusCode = error.context?.status ?? 500
          const textContent = await error.context?.text()
          throw new Error(`[${statusCode}] ${textContent || error.message}`)
        } catch {
          throw new Error(error.message || 'Edge Function failed')
        }
      }
      throw error
    }
    
    return data
  },
  onSuccess: (data, reportType) => {
    toast.success(`${reportType} report generated successfully`)
    
    if (data?.url) {
      window.open(data.url, '_blank')
    } else if (data?.pdf) {
      // Download as PDF
      const blob = new Blob([Buffer.from(data.pdf, 'base64')], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${reportType}-report-${new Date().toISOString()}.pdf`
      a.click()
    }
    
    setGeneratingReport(null)
  },
  onError: (error: any, reportType) => {
    console.error('Report generation error:', error)
    toast.error(`Failed to generate ${reportType} report: ${error.message}`)
    setGeneratingReport(null)
  },
})
```

---

## **Fix 3: System Diagnostics JSON Display (10 minutes)**

### **Create IntegrityResultsFormatter Component**

```tsx
// Add to SystemDiagnostics.tsx

interface IntegrityResults {
  processed: number
  duplicates_deleted: number
  invalid_plates_marked: number
  issues: Array<{
    table: string
    issue_type: string
    severity: string
    record_id: string
    plate_number?: string
    description: string
    action_taken?: string
  }>
}

function IntegrityResultsDisplay({ results }: { results: IntegrityResults }) {
  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{results.processed}</div>
          <div className="text-sm text-gray-600">Records Processed</div>
        </div>
        
        <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-green-600">{results.duplicates_deleted}</div>
          <div className="text-sm text-gray-600">Duplicates Removed</div>
        </div>
        
        <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-orange-600">{results.invalid_plates_marked}</div>
          <div className="text-sm text-gray-600">Invalid Plates</div>
        </div>
      </div>

      {/* Issues Table */}
      {results.issues && results.issues.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 font-semibold">
            Issues Found ({results.issues.length})
          </div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {results.issues.map((issue, idx) => (
              <div key={idx} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={issue.severity === 'critical' ? 'destructive' : 'secondary'}>
                    {issue.severity}
                  </Badge>
                  <span className="text-sm font-medium">{issue.table}</span>
                  <span className="text-xs text-gray-500">• {issue.issue_type}</span>
                </div>
                {issue.plate_number && (
                  <div className="text-sm font-mono text-blue-600">{issue.plate_number}</div>
                )}
                <div className="text-sm text-gray-600">{issue.description}</div>
                {issue.action_taken && (
                  <div className="text-xs text-green-600 mt-1">✓ {issue.action_taken}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

### **Update Display Logic**

```tsx
// Replace the raw JSON display with:
{testResults ? (
  <IntegrityResultsDisplay results={testResults} />
) : (
  <div className="text-center py-8 text-gray-600">
    Click "Run Check" to verify data integrity
  </div>
)}
```

---

## **Fix 4: Vehicle Management Pagination (20 minutes)**

### **Add Pagination State**

```tsx
// Add to VehicleManagement.tsx
const [pageSize, setPageSize] = useState(100)
const [currentPage, setCurrentPage] = useState(0)
const [totalCount, setTotalCount] = useState(0)

// Separate count query
const { data: countData } = useQuery({
  queryKey: ['vehicles-count', organizationId, statusFilter, searchQuery],
  queryFn: async () => {
    let query = supabase
      .from('canonical_vehicles')
      .select('id', { count: 'exact', head: true })

    // Apply same filters as main query
    if (searchQuery) {
      query = query.or(`plate_number.ilike.%${searchQuery}%,make.ilike.%${searchQuery}%`)
    }

    if (statusFilter === 'compliant') {
      query = query.eq('total_breaches', 0)
    } else if (statusFilter === 'breaches') {
      query = query.gt('total_breaches', 0)
    }

    const { count, error } = await query
    if (error) throw error
    
    return count || 0
  },
})

// Update total count when countData changes
useEffect(() => {
  if (countData !== undefined) {
    setTotalCount(countData)
  }
}, [countData])

// Update main query with pagination
const { data: vehicles, isLoading } = useQuery({
  queryKey: ['vehicles', organizationId, statusFilter, searchQuery, pageSize, currentPage],
  queryFn: async () => {
    let query = supabase
      .from('canonical_vehicles')
      .select('*')
      .order('plate_number', { ascending: true })
      .range(currentPage * pageSize, (currentPage + 1) * pageSize - 1) // ✅ Pagination

    // ... rest of query filters
  },
})
```

### **Add Pagination Controls**

```tsx
// Add after stats grid, before search filters
<Card>
  <CardContent className="py-4">
    <div className="flex items-center justify-between">
      <div className="text-sm text-gray-600">
        Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, totalCount)} of {totalCount} vehicles
      </div>
      
      <div className="flex items-center gap-4">
        {/* Page Size Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Show:</span>
          <Select value={pageSize.toString()} onValueChange={(val) => {
            setPageSize(parseInt(val))
            setCurrentPage(0) // Reset to first page
          }}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
              <SelectItem value="300">300</SelectItem>
              <SelectItem value="500">500</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Pagination Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            Previous
          </Button>
          
          <span className="text-sm text-gray-600">
            Page {currentPage + 1} of {Math.ceil(totalCount / pageSize)}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => p + 1)}
            disabled={(currentPage + 1) * pageSize >= totalCount}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  </CardContent>
</Card>
```

---

## **Validation Checklist**

After implementing each fix:

- [ ] Fix 1: Can navigate to `/enforcement` and see EnforcementActions page
- [ ] Fix 2: Reports show detailed error message (not generic "non-2xx")
- [ ] Fix 3: Data Integrity results display as formatted cards, not JSON
- [ ] Fix 4: Vehicle count shows total records, not just current page
- [ ] Fix 4: Can change page size and navigate between pages
- [ ] No console errors or warnings
- [ ] All role-based access controls still working

---

## **Testing Script**

```bash
# 1. Test Enforcement Route
- Login as admin
- Click "Enforcement Actions" from Admin Portal
- Should see enforcement workflow page (not incidents)

# 2. Test Reports
- Navigate to /reports
- Click "Generate PDF" on any report
- Error message should show specific Edge Function error (not generic)

# 3. Test System Diagnostics
- Navigate to /diagnostics (Master only)
- Click "Run Check" for Data Integrity
- Results should show formatted cards, not raw JSON

# 4. Test Vehicle Management
- Navigate to /vehicles
- Total should show actual vehicle count (e.g., 457), not 100
- Should see page size selector (100/200/300/500)
- Previous/Next buttons should work
- Stats should reflect total vehicles, not just current page
```
