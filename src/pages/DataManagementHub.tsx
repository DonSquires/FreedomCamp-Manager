import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { StatCard } from '@/components/features/StatCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { getEffectiveOrgId } from '@/lib/orgUtils'
import { toast } from 'sonner'
import {
  loadScvCurrentEntries,
  mergeScvResults,
  EMPTY_SCV_RESULT,
  SCV_BATCH_SIZE,
  type ScvSyncResult,
  type ScvSyncBatch,
  type ScvSyncResponse,
  type ScvSyncProgress,
} from '@/lib/scvUtils'
import {
  Database,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Download,
  Upload,
  BarChart3,
  Shield,
  RefreshCw,
  Archive,
  ShieldCheck,
} from 'lucide-react'

// Type for import history records mapped from import_batches table
// NOTE: The `import_history` table never existed; `import_batches` is the canonical table.
interface ImportHistoryRecord {
  id: string
  organization_id: string
  import_type: string
  file_name: string | null
  status: string
  records_imported: number
  duplicates_skipped: number
  failed_records: number
  created_at: string
}

// Raw row from import_batches (not in generated types)
interface ImportBatchRow {
  id: string
  organization_id: string
  import_config: Record<string, string> | null
  file_name: string | null
  status: string
  successful_records: number
  failed_records: number
  created_at: string
}

interface BobAutomationStatus {
  ok: boolean
  checkedAt: string
  inference?: {
    baseUrl?: string
    health?: {
      ok?: boolean
      status?: number
    }
    doctor?: {
      ok?: boolean
      status?: number
      data?: {
        checks?: Array<{ status?: string }>
      }
    }
  }
  runpodDollars?: {
    available?: boolean
    formatted?: string
    usdRemaining?: number
    reason?: string
  }
  runpodEndpoint?: {
    endpointId?: string
    endpointLabel?: string
    workerProfile?: string
    targetWorkers?: number
    activeWorkers?: number
    balanceHintUsd?: number
    balanceHintFormatted?: string
  }
}

// Map an import_batches row to ImportHistoryRecord
function mapBatchRow(row: ImportBatchRow): ImportHistoryRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    import_type: row.import_config?.import_type || 'historical',
    file_name: row.file_name,
    status: row.status,
    records_imported: row.successful_records || 0,
    duplicates_skipped: 0,
    failed_records: row.failed_records || 0,
    created_at: row.created_at,
  }
}

export default function DataManagementHub() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const hasBobAutomationAccess = user?.role === 'master' || user?.role === 'grand_master'
  const [isExporting, setIsExporting] = useState(false)
  const [isSyncingScv, setIsSyncingScv] = useState(false)
  const [scvDryRun, setScvDryRun] = useState(false)
  const [scvLastRunDryRun, setScvLastRunDryRun] = useState(false)
  const [scvProgress, setScvProgress] = useState<ScvSyncProgress | null>(null)
  const [scvResult, setScvResult] = useState<ScvSyncResult | null>(null)

  const {
    data: bobAutomationStatus,
    isLoading: bobAutomationLoading,
    isFetching: bobAutomationFetching,
    error: bobAutomationError,
    refetch: refetchBobAutomation,
  } = useQuery({
    queryKey: ['bob-automation-status', user?.id],
    queryFn: async () => {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'bob_automation_status' })
      if (error) throw new Error(String(error))
      return data as BobAutomationStatus
    },
    enabled: !!user && hasBobAutomationAccess,
    retry: false,
    refetchInterval: 120000,
  })

  // Fetch data statistics
  const { data: stats, isLoading } = useQuery({
    queryKey: ['data-stats', organizationId, user?.organization_id, user?.role],
    queryFn: async () => {
      const orgFilter = getEffectiveOrgId(user, organizationId)

      // Total observations
      let obsQuery = supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
      
      if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter)
      const { count: totalObservations } = await obsQuery

      // Total vehicles
      const { count: totalVehicles } = await supabase
        .from('canonical_vehicles')
        .select('id', { count: 'exact', head: true })

      // Total zones
      let zoneQuery = supabase
        .from('zones')
        .select('id', { count: 'exact', head: true })
      
      if (orgFilter) zoneQuery = zoneQuery.eq('organization_id', orgFilter)
      const { count: totalZones } = await zoneQuery

      // Total breaches
      let breachQuery = supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      
      if (orgFilter) breachQuery = breachQuery.eq('organization_id', orgFilter)
      const { count: activeBreaches } = await breachQuery

      // Storage usage estimate
      const { count: totalPhotos } = await supabase
        .from('photo_metadata')
        .select('id', { count: 'exact', head: true })

      return {
        totalObservations: totalObservations || 0,
        totalVehicles: totalVehicles || 0,
        totalZones: totalZones || 0,
        activeBreaches: activeBreaches || 0,
        totalPhotos: totalPhotos || 0,
        estimatedStorageGB: ((totalPhotos || 0) * 2) / 1024, // Rough estimate: 2MB per photo
      }
    },
    enabled: !!user,
  })

  // Fetch import history from import_batches (import_history table does not exist)
  const { data: importHistory } = useQuery({
    queryKey: ['import-history', organizationId, user?.organization_id, user?.role],
    queryFn: async () => {
      const orgFilter = getEffectiveOrgId(user, organizationId)
      let query = (supabase.from('import_batches') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      if (orgFilter) {
        query = query.eq('organization_id', orgFilter)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to fetch import history:', error)
        throw error
      }

      return (data as ImportBatchRow[] || []).map(mapBatchRow)
    },
    enabled: !!user,
  })

  const handleSyncScvList = async (dryRun: boolean) => {
    setIsSyncingScv(true)
    setScvLastRunDryRun(dryRun)
    setScvResult(null)
    setScvProgress(null)
    try {
      const scvCurrentEntries = await loadScvCurrentEntries()
      if (scvCurrentEntries.length === 0) {
        toast.error('SCV list contains no current entries')
        return
      }

      let offset = 0
      let aggregate = { ...EMPTY_SCV_RESULT }
      let hasMore = true

      while (hasMore) {
        const { data, error } = await edgeFunctions.syncScvList({
          dry_run: dryRun,
          offset,
          batch_size: SCV_BATCH_SIZE,
          include_related_updates: true,
          scv_total_in_list: scvCurrentEntries.length,
          scv_current_entries: scvCurrentEntries,
        })

        if (error) {
          toast.error(`SCV sync failed: ${error}`)
          return
        }

        const response = data as ScvSyncResponse | null
        if (!response?.result || !response.batch) {
          toast.error('SCV sync returned an invalid response')
          return
        }

        aggregate = mergeScvResults(aggregate, response.result)
        setScvProgress({
          processed: response.batch.processed,
          total: response.batch.total_canonical_vehicles,
          batchNumber: response.batch.batch_number,
          totalBatches: response.batch.total_batches,
        })

        hasMore = response.batch.has_more
        offset = response.batch.next_offset ?? 0
      }

      setScvResult(aggregate)
      if (dryRun) {
        toast.info(
          `Dry run complete — ${aggregate.set_to_current} to set current, ${aggregate.set_to_not_current} to clear`,
        )
      } else {
        toast.success(
          `SCV sync complete — ${aggregate.set_to_current} vehicles updated, ${aggregate.breach_alerts_resolved} breach alerts resolved`,
        )
      }
    } catch (err: any) {
      toast.error(`SCV sync error: ${err.message}`)
    } finally {
      setScvProgress(null)
      setIsSyncingScv(false)
    }
  }

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const dateTo = new Date().toISOString().slice(0, 10)
      const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      // Call export edge function via shared auth wrapper (refresh/retry on JWT expiry)
      const { data, error } = await edgeFunctions.generateDashboardReport({
        organization_id: organizationId || user?.organization_id || undefined,
        date_from: dateFrom,
        date_to: dateTo,
      })

      if (error) throw new Error(error)

      toast.success('Export started - check your downloads')
    } catch (error: any) {
      console.error('Export failed:', error)
      toast.error(`Export failed: ${error.message}`)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Data Management Hub</h1>
          <p className="text-muted-foreground mt-1">
            Monitor data quality, run cleanup operations, and manage data integrity
          </p>
        </div>

        {/* Statistics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Observations"
            value={isLoading ? '...' : (stats?.totalObservations || 0)}
            icon={Database}
          />
          <StatCard
            title="Unique Vehicles"
            value={isLoading ? '...' : (stats?.totalVehicles || 0)}
            icon={CheckCircle2}
          />
          <StatCard
            title="Active Zones"
            value={isLoading ? '...' : (stats?.totalZones || 0)}
            icon={BarChart3}
          />
          <StatCard
            title="Active Breaches"
            value={isLoading ? '...' : (stats?.activeBreaches || 0)}
            icon={AlertTriangle}
            variant={stats?.activeBreaches ? 'danger' : 'default'}
          />
        </div>

        {/* Storage Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Storage Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Total Photos</span>
                <span className="font-medium">{stats?.totalPhotos?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Estimated Storage</span>
                <span className="font-medium">{stats?.estimatedStorageGB?.toFixed(2) || 0} GB</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Bob Automation Health
            </CardTitle>
            <CardDescription>
              Read-only status for Bob runtime health and RunPod dollars remaining.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasBobAutomationAccess && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                Requires Master or Grand Master role.
              </div>
            )}

            {hasBobAutomationAccess && bobAutomationError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {(bobAutomationError as Error).message || 'Failed to load Bob automation status'}
              </div>
            )}

            {hasBobAutomationAccess && !bobAutomationError && (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Overall</div>
                  <div className="mt-1">
                    <Badge variant={bobAutomationStatus?.ok ? 'default' : 'destructive'}>
                      {bobAutomationLoading ? 'Checking...' : bobAutomationStatus?.ok ? 'Healthy' : 'Degraded'}
                    </Badge>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Inference Health</div>
                  <div className="mt-1">
                    <Badge variant={bobAutomationStatus?.inference?.health?.ok ? 'default' : 'destructive'}>
                      {bobAutomationStatus?.inference?.health?.ok ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Doctor Checks</div>
                  <div className="mt-1 text-sm font-medium">
                    {(() => {
                      const checks = bobAutomationStatus?.inference?.doctor?.data?.checks || []
                      const failing = checks.filter((item) => item?.status !== 'ok').length
                      if (checks.length === 0) return 'No checks returned'
                      return failing === 0 ? 'All checks passed' : `${failing} check(s) failing`
                    })()}
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">RunPod $ Remaining</div>
                  <div className="mt-1 text-sm font-medium">
                    {bobAutomationStatus?.runpodDollars?.available
                      ? (bobAutomationStatus.runpodDollars.formatted || `$${Number(bobAutomationStatus.runpodDollars.usdRemaining || 0).toFixed(2)}`)
                      : bobAutomationStatus?.runpodEndpoint?.balanceHintFormatted
                        ? bobAutomationStatus.runpodEndpoint.balanceHintFormatted
                      : 'Unavailable'}
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">RunPod Endpoint</div>
                  <div className="mt-1 text-sm font-medium">
                    {bobAutomationStatus?.runpodEndpoint?.endpointLabel || bobAutomationStatus?.runpodEndpoint?.endpointId || 'Not set'}
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Worker Profile / Active</div>
                  <div className="mt-1 text-sm font-medium">
                    {`${bobAutomationStatus?.runpodEndpoint?.workerProfile || 'Unknown'} | ${bobAutomationStatus?.runpodEndpoint?.activeWorkers ?? 0}/${bobAutomationStatus?.runpodEndpoint?.targetWorkers ?? 0}`}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void refetchBobAutomation()}
                disabled={!hasBobAutomationAccess || bobAutomationFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${bobAutomationFetching ? 'animate-spin' : ''}`} />
                Refresh Bob Status
              </Button>
              <Link to="/grandmaster-code-studio">
                <Button variant="outline" disabled={!hasBobAutomationAccess}>
                  Open Grand Master Controls
                </Button>
              </Link>
              {hasBobAutomationAccess && bobAutomationStatus?.checkedAt && (
                <span className="text-xs text-muted-foreground">
                  Last checked: {formatDateTime(bobAutomationStatus.checkedAt)}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Data Cleanup */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <Link to="/admin/data-cleanup">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5" />
                  Data Cleanup
                </CardTitle>
                <CardDescription>
                  Remove duplicates, orphaned records, and expired data
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  Open Cleanup Utility
                </Button>
              </CardContent>
            </Link>
          </Card>

          {/* Data Integrity */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <Link to="/admin/data-integrity">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Data Integrity
                </CardTitle>
                <CardDescription>
                  Monitor data quality, validation errors, and consistency
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  View Integrity Dashboard
                </Button>
              </CardContent>
            </Link>
          </Card>

          {/* Data Export */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Data Export
              </CardTitle>
              <CardDescription>
                Export observations, vehicles, and compliance data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                onClick={handleExportData}
                disabled={isExporting}
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  'Export All Data'
                )}
              </Button>
            </CardContent>
          </Card>

          {user?.role === 'grand_master' && (
            <Card className="hover:shadow-lg transition-shadow border-amber-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-amber-600" />
                  Raw Data Browser
                </CardTitle>
                <CardDescription>
                  Access-style raw table browser for direct view/edit/delete operations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/admin/raw-data-browser">
                  <Button className="w-full" variant="outline">
                    Open Raw Data Browser
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Import History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Recent Data Imports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {importHistory && importHistory.length > 0 ? (
              <div className="space-y-3">
                {importHistory.map((item) => (
                  <div key={item.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{item.import_type}</span>
                        <Badge variant={item.status === 'completed' ? 'default' : 'destructive'}>
                          {item.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {item.file_name} • {item.records_imported} records • {formatDateTime(item.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-green-600">
                        {item.records_imported} imported
                      </div>
                      {item.duplicates_skipped > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {item.duplicates_skipped} duplicates skipped
                        </div>
                      )}
                      {item.failed_records > 0 && (
                        <div className="text-xs text-red-600">
                          {item.failed_records} failed
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Upload className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No import history</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SCV List Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Self-Contained Vehicle (SCV) List Sync
            </CardTitle>
            <CardDescription>
              Check canonical vehicle records against the NZSCV SCV list and update
              self-contained status, expiry dates, and resolve incorrect CSC breach alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="scv-dry-run"
                checked={scvDryRun}
                onChange={(e) => setScvDryRun(e.target.checked)}
                className="h-4 w-4"
                disabled={isSyncingScv}
              />
              <label htmlFor="scv-dry-run" className="text-sm text-muted-foreground select-none cursor-pointer">
                Dry run (preview changes only, no database writes)
              </label>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => handleSyncScvList(scvDryRun)}
                disabled={isSyncingScv}
                variant={scvDryRun ? 'outline' : 'default'}
              >
                {isSyncingScv ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {scvDryRun ? 'Checking...' : 'Syncing...'}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    {scvDryRun ? 'Preview Changes' : 'Sync SCV List'}
                  </>
                )}
              </Button>
            </div>

            {isSyncingScv && scvProgress && (
              <div className="rounded-md border p-4 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {scvDryRun ? 'Previewing SCV sync batches' : 'Running SCV sync batches'}
                  </span>
                  <span className="text-muted-foreground">
                    Batch {scvProgress.batchNumber}
                    {scvProgress.totalBatches ? ` of ${scvProgress.totalBatches}` : ''}
                  </span>
                </div>
                <Progress
                  value={
                    scvProgress.total && scvProgress.total > 0
                      ? (scvProgress.processed / scvProgress.total) * 100
                      : undefined
                  }
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{scvProgress.processed.toLocaleString()} vehicles processed</span>
                  <span>
                    {scvProgress.total
                      ? `${scvProgress.total.toLocaleString()} total`
                      : 'total pending'}
                  </span>
                </div>
              </div>
            )}

            {scvResult && (
              <div className="rounded-md border p-4 text-sm space-y-2 bg-muted/30">
                <div className="font-semibold">
                  {scvLastRunDryRun ? 'Dry Run Results' : 'Sync Results'}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <span className="text-muted-foreground">SCV list entries:</span>
                  <span className="font-medium">{scvResult.total_in_scv_list.toLocaleString()}</span>
                  <span className="text-muted-foreground">Canonical vehicles checked:</span>
                  <span className="font-medium">{scvResult.canonical_vehicles_checked.toLocaleString()}</span>
                  <span className="text-muted-foreground">Set to self-contained:</span>
                  <span className="font-medium text-green-600">{scvResult.set_to_current}</span>
                  <span className="text-muted-foreground">Expiry corrected:</span>
                  <span className="font-medium text-blue-600">{scvResult.expiry_corrected}</span>
                  <span className="text-muted-foreground">Cleared (not in list):</span>
                  <span className="font-medium text-orange-600">{scvResult.set_to_not_current}</span>
                  <span className="text-muted-foreground">Unchanged:</span>
                  <span className="font-medium">{scvResult.unchanged}</span>
                  {!scvLastRunDryRun && (
                    <>
                      <span className="text-muted-foreground">Observations updated:</span>
                      <span className="font-medium">{scvResult.observations_updated}</span>
                      <span className="text-muted-foreground">Breach alerts resolved:</span>
                      <span className="font-medium text-green-600">{scvResult.breach_alerts_resolved}</span>
                    </>
                  )}
                </div>
                {scvResult.errors.length > 0 && (
                  <div className="mt-2 text-red-600">
                    <div className="font-medium">Errors ({scvResult.errors.length}):</div>
                    <ul className="list-disc ml-4">
                      {scvResult.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Maintenance Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Automated Maintenance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Daily Photo Cleanup</div>
                  <div className="text-sm text-muted-foreground">
                    Removes photos older than retention policy
                  </div>
                </div>
                <Badge>Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Weekly Duplicate Detection</div>
                  <div className="text-sm text-muted-foreground">
                    Scans for duplicate observations
                  </div>
                </div>
                <Badge>Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Monthly Data Integrity Check</div>
                  <div className="text-sm text-muted-foreground">
                    Validates referential integrity
                  </div>
                </div>
                <Badge>Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
