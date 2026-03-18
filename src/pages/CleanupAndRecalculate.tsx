import { useState, useEffect } from 'react'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useOperationsStore } from '@/stores/operationsStore'
import { useOrganizations } from '@/hooks/useOrganizations'
import { useZones } from '@/hooks/useZones'
import { toast } from 'sonner'
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  MapPin,
  Trash2,
  BarChart3,
  Database,
  Play,
} from 'lucide-react'

interface CleanupResult {
  processed: number
  zonesCorrected: number
  duplicatesRemoved: number
  complianceChanged: number
  breachesCreated: number
  skippedNoMatrix: number
  duration_seconds: number
  status: 'completed' | 'failed'
  error_message?: string
}

interface CleanupBatchResponse {
  total?: number
  processed?: number
  zonesCorrected?: number
  duplicatesRemoved?: number
  complianceChanged?: number
  breachesCreated?: number
  skippedNoMatrix?: number
}

interface LiveState {
  total: number
  processed: number
  zonesCorrected: number
  duplicatesRemoved: number
  complianceChanged: number
  breachesCreated: number
  skippedNoMatrix: number
}

const OPERATION_ID = 'cleanup-and-recalculate'
const INVOKE_TIMEOUT_MS = 90_000

export default function CleanupAndRecalculate() {
  const { user } = useAuthStore()
  const { startOperation, updateProgress, completeOperation, failOperation, operations } = useOperationsStore()

  const [scope, setScope] = useState<'organization' | 'zone' | 'date_range'>('organization')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [selectedZoneId, setSelectedZoneId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [liveRun, setLiveRun] = useState<LiveState | null>(null)
  const [localRunning, setLocalRunning] = useState(false)

  const globalOp = operations.find((op) => op.id === OPERATION_ID)
  const isRunning = localRunning || globalOp?.status === 'running'

  // Sync from global operation when returning to this page
  useEffect(() => {
    if (globalOp?.progress != null) setProgress(globalOp.progress)
    if (globalOp?.liveProgress) setLiveRun(globalOp.liveProgress as unknown as LiveState)
    if (globalOp?.result && !result) setResult(globalOp.result as unknown as CleanupResult)
  }, [globalOp?.progress, globalOp?.liveProgress, globalOp?.result, globalOp?.status, result])

  const effectiveOrgId = selectedOrgId || (user?.role !== 'master' ? user?.organization_id || '' : '')

  const { data: organizations } = useOrganizations()
  const { data: zones } = useZones({
    organizationId: effectiveOrgId || undefined,
    showInactive: false,
  })

  useEffect(() => {
    if (!selectedOrgId && user?.role !== 'master' && user?.organization_id) {
      setSelectedOrgId(user.organization_id)
    }
  }, [selectedOrgId, user?.organization_id, user?.role])

  const handleOrgChangeForZone = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedOrgId(e.target.value)
    setSelectedZoneId('')
  }

  const runCleanup = async (params: {
    zoneIds: string[]
    dateRangeStart?: string
    dateRangeEnd?: string
  }): Promise<CleanupResult> => {
    const startedAt = Date.now()

    const withTimeout = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${Math.round(INVOKE_TIMEOUT_MS / 1000)}s`))
          }, INVOKE_TIMEOUT_MS)
        })
        return await Promise.race([promise, timeoutPromise])
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    }

    const buildPayload = (base: {
      offset?: number
      batch_size?: number
      get_total?: boolean
    }) => ({
      zoneIds: params.zoneIds,
      zone_ids: params.zoneIds,
      dateRangeStart: params.dateRangeStart,
      date_range_start: params.dateRangeStart,
      dateRangeEnd: params.dateRangeEnd,
      date_range_end: params.dateRangeEnd,
      ...base,
    })

    // Get total count first
    const { data: totalData, error: totalError } = await withTimeout(
      edgeFunctions.cleanupAndRecalculate(
        buildPayload({
          get_total: true,
        })
      ),
      'cleanup-and-recalculate get_total'
    )

    if (totalError) throw new Error(totalError)

    const totalResponse = totalData as CleanupBatchResponse
    const total = Number(totalResponse?.total ?? 0)

    if (total <= 0) {
      return {
        processed: 0,
        zonesCorrected: 0,
        duplicatesRemoved: 0,
        complianceChanged: 0,
        breachesCreated: 0,
        skippedNoMatrix: 0,
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
        status: 'completed',
      }
    }

    const initialLive: LiveState = {
      total,
      processed: 0,
      zonesCorrected: 0,
      duplicatesRemoved: 0,
      complianceChanged: 0,
      breachesCreated: 0,
      skippedNoMatrix: 0,
    }
    setLiveRun(initialLive)
    updateProgress(OPERATION_ID, 0, initialLive as any)

    const batchSize = 50
    let offset = 0
    let processedTotal = 0
    let zonesCorrectedTotal = 0
    let duplicatesRemovedTotal = 0
    let complianceChangedTotal = 0
    let breachesCreatedTotal = 0
    let skippedNoMatrixTotal = 0

    while (offset < total) {
      const { data: batchData, error: batchError } = await withTimeout(
        edgeFunctions.cleanupAndRecalculate(
          buildPayload({
            offset,
            batch_size: batchSize,
          })
        ),
        `cleanup-and-recalculate batch offset ${offset}`
      )

      if (batchError) throw new Error(batchError)

      const batch = batchData as CleanupBatchResponse
      const processed = Number(batch?.processed ?? 0)
      const zonesCorrected = Number(batch?.zonesCorrected ?? 0)
      const duplicatesRemoved = Number(batch?.duplicatesRemoved ?? 0)
      const complianceChanged = Number(batch?.complianceChanged ?? 0)
      const breachesCreated = Number(batch?.breachesCreated ?? 0)
      const skippedNoMatrix = Number(batch?.skippedNoMatrix ?? 0)

      processedTotal += processed
      zonesCorrectedTotal += zonesCorrected
      duplicatesRemovedTotal += duplicatesRemoved
      complianceChangedTotal += complianceChanged
      breachesCreatedTotal += breachesCreated
      skippedNoMatrixTotal += skippedNoMatrix

      const pct = total > 0 ? Math.min(100, Math.round((processedTotal / total) * 100)) : 0
      setProgress(pct)

      const live: LiveState = {
        total,
        processed: processedTotal,
        zonesCorrected: zonesCorrectedTotal,
        duplicatesRemoved: duplicatesRemovedTotal,
        complianceChanged: complianceChangedTotal,
        breachesCreated: breachesCreatedTotal,
        skippedNoMatrix: skippedNoMatrixTotal,
      }
      setLiveRun(live)
      updateProgress(OPERATION_ID, pct, live as any)

      if (processed <= 0) break
      offset += processed
    }

    return {
      processed: processedTotal,
      zonesCorrected: zonesCorrectedTotal,
      duplicatesRemoved: duplicatesRemovedTotal,
      complianceChanged: complianceChangedTotal,
      breachesCreated: breachesCreatedTotal,
      skippedNoMatrix: skippedNoMatrixTotal,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      status: 'completed',
    }
  }

  const handleStart = async () => {
    if (scope === 'organization' && !effectiveOrgId) {
      toast.error('Please select an organisation')
      return
    }
    if (scope === 'zone' && !selectedZoneId) {
      toast.error('Please select a zone')
      return
    }
    if (scope === 'date_range' && (!dateFrom || !dateTo)) {
      toast.error('Please select both start and end dates')
      return
    }

    // Build zone IDs list
    let zoneIds: string[] = []
    if (scope === 'zone' && selectedZoneId) {
      zoneIds = [selectedZoneId]
    } else {
      // Load all zones for the org
      const { data: orgZones } = await supabase
        .from('zones')
        .select('id')
        .eq('organization_id', effectiveOrgId)
        .eq('is_active', true)
      zoneIds = (orgZones || []).map((z: { id: string }) => z.id)
      if (zoneIds.length === 0) {
        toast.error('No active zones found for the selected organisation')
        return
      }
    }

    setLocalRunning(true)
    setProgress(0)
    setResult(null)
    setLiveRun(null)
    startOperation(OPERATION_ID, 'Zone Correction + Dedup + Compliance Recalculation')
    toast.info('Starting 3-phase cleanup: zone correction → duplicate removal → compliance recalculation')

    try {
      setProgress(1)
      const res = await runCleanup({
        zoneIds,
        dateRangeStart: scope === 'date_range' ? dateFrom : undefined,
        dateRangeEnd: scope === 'date_range' ? dateTo : undefined,
      })

      setProgress(100)
      setResult(res)
      completeOperation(OPERATION_ID, {
        observations_processed: res.processed,
        compliance_changed: res.complianceChanged,
        breaches_created: res.breachesCreated,
        breaches_dismissed: 0,
        skipped_no_rules: res.skippedNoMatrix,
        duration_seconds: res.duration_seconds,
        status: 'completed',
      })
      toast.success(
        `✅ Cleanup complete: ${res.processed} processed, ${res.zonesCorrected} zones corrected, ${res.duplicatesRemoved} duplicates removed, ${res.complianceChanged} compliance changes`
      )
    } catch (error: any) {
      let msg: string = error?.message || 'Cleanup failed'
      if (msg.includes('timed out')) {
        msg = `${msg}. Edge function did not respond in time. Check that cleanup-and-recalculate is deployed and inspect Supabase Edge Function logs.`
      }
      setProgress(0)
      failOperation(OPERATION_ID, msg)
      const isSessionError =
        msg === 'Session expired. Please sign in again.' ||
        msg === 'Session has expired. Please sign in again.' ||
        msg === 'No active session found. Please sign in again and retry.'
      if (isSessionError) {
        toast.error('Your session has expired. Please sign in again to retry.', { duration: 8000 })
      } else {
        toast.error(msg)
      }
    } finally {
      setLocalRunning(false)
    }
  }

  return (
    <AppLayout
      title="Cleanup & Recalculate"
      description="Zone correction, duplicate removal and compliance recalculation in one pass"
      showBackButton
    >
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Info Banner */}
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 dark:text-blue-100">
                  3-Phase Comprehensive Cleanup
                </h3>
                <ul className="text-sm text-blue-700 dark:text-blue-200 mt-2 space-y-1 list-disc list-inside">
                  <li><strong>Phase 1 – Zone Correction:</strong> Re-assigns observations to the correct zone using GPS coordinates</li>
                  <li><strong>Phase 2 – Duplicate Removal:</strong> Removes duplicate observations in the same patrol window and zone (≤50 m apart)</li>
                  <li><strong>Phase 3 – Compliance Recalculation:</strong> Re-evaluates is_compliant, breach_type and breach_reason for each observation</li>
                </ul>
                <p className="text-xs text-blue-700 dark:text-blue-200 mt-2">
                  Runtime logs for this workflow appear under the <strong>cleanup-and-recalculate</strong> edge function.
                  The standalone <strong>zone-correction</strong> function is a separate tool and is not called by this page.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Warning */}
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/10">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
              <p className="text-sm text-orange-700 dark:text-orange-200">
                This operation permanently deletes duplicate records and changes compliance status.
                Run this after importing historical data or after correcting zone boundaries.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Scope Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Scope
            </CardTitle>
            <CardDescription>Choose what to clean up and recalculate</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Scope buttons */}
            <div>
              <Label>Scope</Label>
              <div className="grid grid-cols-3 gap-3 mt-2">
                {(
                  [
                    { value: 'organization', label: 'Organisation', sub: 'All active zones' },
                    { value: 'zone', label: 'Single Zone', sub: 'Specific area' },
                    { value: 'date_range', label: 'Date Range', sub: 'All zones in period' },
                  ] as { value: typeof scope; label: string; sub: string }[]
                ).map((opt) => (
                  <Button
                    key={opt.value}
                    variant={scope === opt.value ? 'default' : 'outline'}
                    onClick={() => setScope(opt.value)}
                    className="h-auto py-3"
                    disabled={isRunning}
                  >
                    <div className="text-left w-full">
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-xs opacity-70">{opt.sub}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            {/* Organisation picker (master users or org scope) */}
            {(scope === 'organization' || scope === 'date_range') && user?.role === 'master' && (
              <div>
                <Label>Organisation</Label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  disabled={isRunning}
                  className="w-full mt-2 px-3 py-2 border rounded-md bg-background text-sm"
                >
                  <option value="">Select organisation…</option>
                  {organizations?.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Zone picker */}
            {scope === 'zone' && (
              <div className="space-y-4">
                {user?.role === 'master' && (
                  <div>
                    <Label>Organisation</Label>
                    <select
                      value={selectedOrgId}
                      onChange={handleOrgChangeForZone}
                      disabled={isRunning}
                      className="w-full mt-2 px-3 py-2 border rounded-md bg-background text-sm"
                    >
                      <option value="">Select organisation…</option>
                      {organizations?.map((org) => (
                        <option key={org.id} value={org.id}>{org.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <Label>Zone</Label>
                  <select
                    value={selectedZoneId}
                    onChange={(e) => setSelectedZoneId(e.target.value)}
                    disabled={isRunning}
                    className="w-full mt-2 px-3 py-2 border rounded-md bg-background text-sm"
                  >
                    <option value="">Select zone…</option>
                    {(zones || []).map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Date range */}
            {scope === 'date_range' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="date-from">From Date</Label>
                  <input
                    id="date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    disabled={isRunning}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="date-to">To Date</Label>
                  <input
                    id="date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    disabled={isRunning}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm mt-1.5"
                  />
                </div>
              </div>
            )}

            {/* Start button */}
            <Button
              size="lg"
              className="w-full"
              onClick={handleStart}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Running… ({progress}%)
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Cleanup &amp; Recalculation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Live Progress */}
        {(isRunning || liveRun) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} />
                Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="w-full h-3" />
              <p className="text-sm text-muted-foreground text-center">{progress}% complete</p>
              {liveRun && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard label="Processed" value={liveRun.processed} total={liveRun.total} />
                  <StatCard label="Zones Corrected" value={liveRun.zonesCorrected} icon={<MapPin className="h-4 w-4 text-blue-500" />} />
                  <StatCard label="Duplicates Removed" value={liveRun.duplicatesRemoved} icon={<Trash2 className="h-4 w-4 text-red-500" />} />
                  <StatCard label="Compliance Changed" value={liveRun.complianceChanged} icon={<BarChart3 className="h-4 w-4 text-yellow-500" />} />
                  <StatCard label="Breaches Created" value={liveRun.breachesCreated} icon={<AlertTriangle className="h-4 w-4 text-orange-500" />} />
                  <StatCard label="Skipped (no matrix)" value={liveRun.skippedNoMatrix} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Result Summary */}
        {result && !isRunning && (
          <Card className={result.status === 'completed' ? 'border-green-300' : 'border-red-300'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.status === 'completed' ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                )}
                {result.status === 'completed' ? 'Completed' : 'Failed'}
                <Badge variant="secondary" className="ml-2">
                  {result.duration_seconds}s
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.error_message && (
                <p className="text-sm text-red-600 mb-4">{result.error_message}</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard label="Observations Processed" value={result.processed} />
                <StatCard label="Zones Corrected" value={result.zonesCorrected} icon={<MapPin className="h-4 w-4 text-blue-500" />} />
                <StatCard label="Duplicates Removed" value={result.duplicatesRemoved} icon={<Trash2 className="h-4 w-4 text-red-500" />} />
                <StatCard label="Compliance Changed" value={result.complianceChanged} icon={<BarChart3 className="h-4 w-4 text-yellow-500" />} />
                <StatCard label="Breaches Created" value={result.breachesCreated} icon={<AlertTriangle className="h-4 w-4 text-orange-500" />} />
                <StatCard label="Skipped (no matrix)" value={result.skippedNoMatrix} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}

function StatCard({
  label,
  value,
  total,
  icon,
}: {
  label: string
  value: number
  total?: number
  icon?: React.ReactNode
}) {
  return (
    <div className="bg-muted/40 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold">
        {value.toLocaleString()}
        {total != null && (
          <span className="text-sm font-normal text-muted-foreground ml-1">/ {total.toLocaleString()}</span>
        )}
      </div>
    </div>
  )
}
