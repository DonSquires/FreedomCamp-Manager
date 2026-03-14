import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useOrganizations } from '@/hooks/useOrganizations'
import { useZones } from '@/hooks/useZones'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useOperationsStore } from '@/stores/operationsStore'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Database,
  TrendingUp,
  Info,
  History,
  XCircle,
} from 'lucide-react'

interface RecalculationResult {
  action_id?: string | null
  observations_processed: number
  compliance_changed: number
  breaches_created: number
  breaches_dismissed: number
  skipped_no_rules: number
  duration_seconds: number
  status: 'completed' | 'failed'
  error_message?: string
}

interface RecalcAction {
  id: string
  scope_type: string
  observations_processed: number | null
  compliance_changed: number | null
  status: string
  started_at: string
  completed_at: string | null
  duration_seconds: number | null
  error_message: string | null
}

interface LiveRunState {
  total: number
  processed: number
  changed: number
  breachesCreated: number
  breachesDismissed: number
  skippedNoRules: number
}

const OPERATION_ID = 'compliance-recalculation'

export default function ComplianceRecalculation() {
  const { user } = useAuthStore()
  const { startOperation, updateProgress, completeOperation, failOperation, operations } = useOperationsStore()
  const [scope, setScope] = useState<'organization' | 'zone' | 'date_range'>('organization')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [selectedZoneId, setSelectedZoneId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [result, setResult] = useState<RecalculationResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null)

  // Track running state from both local mutation and global store
  const globalOp = operations.find((op) => op.id === OPERATION_ID && op.status === 'running')
  const [localRunning, setLocalRunning] = useState(false)
  const isRunning = localRunning || !!globalOp

  // Sync from global operation when returning to this page
  const globalProgress = globalOp?.progress
  const globalLiveProgress = globalOp?.liveProgress
  useEffect(() => {
    if (globalProgress != null) {
      setProgress(globalProgress)
    }
    if (globalLiveProgress) {
      setLiveRun(globalLiveProgress)
    }
  }, [globalProgress, globalLiveProgress])

  const effectiveOrgId = selectedOrgId || (user?.role !== 'master' ? user?.organization_id || '' : '')

  const { data: organizations } = useOrganizations()
  const { data: zones } = useZones({ 
    organizationId: effectiveOrgId || undefined,
    showInactive: true,
  })

  // Recent recalculation actions log
  const { data: recentActions, refetch: refetchActions } = useQuery<RecalcAction[]>({
    queryKey: ['recalculation-actions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_recalculation_actions' as any)
        .select('id, scope_type, observations_processed, compliance_changed, status, started_at, completed_at, duration_seconds, error_message')
        .order('started_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as RecalcAction[]
    },
  })

  useEffect(() => {
    if (!selectedOrgId && user?.role !== 'master' && user?.organization_id) {
      setSelectedOrgId(user.organization_id)
    }
  }, [selectedOrgId, user?.organization_id, user?.role])

  const runRecalculatePinnedBatched = async (params: {
    zone_ids: string[]
    date_from?: string
    date_to?: string
  }): Promise<RecalculationResult> => {
    const startedAt = Date.now()

    const { data: totalData, error: totalError } = await edgeFunctions.recalculateComplianceUIPinned({
      zone_ids: params.zone_ids,
      date_from: params.date_from,
      date_to: params.date_to,
      get_total: true,
    })

    if (totalError) throw new Error(totalError)

    const total = Number((totalData as any)?.total ?? 0)
    const warning = (totalData as any)?.warning as string | undefined
    if (warning) {
      toast.warning(warning)
    }

    if (total <= 0) {
      return {
        observations_processed: 0,
        compliance_changed: 0,
        breaches_created: 0,
        breaches_dismissed: 0,
        skipped_no_rules: 0,
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
        status: 'completed',
      }
    }

    const initialLiveState = {
      total,
      processed: 0,
      changed: 0,
      breachesCreated: 0,
      breachesDismissed: 0,
      skippedNoRules: 0,
    }
    setLiveRun(initialLiveState)
    updateProgress(OPERATION_ID, 0, initialLiveState)

    let offset = 0
    const batchSize = 50
    let processedTotal = 0
    let changedTotal = 0
    let breachesCreatedTotal = 0
    let breachesDismissedTotal = 0
    let skippedNoRulesTotal = 0

    while (offset < total) {
      const { data: batchData, error: batchError } = await edgeFunctions.recalculateComplianceUIPinned({
        zone_ids: params.zone_ids,
        date_from: params.date_from,
        date_to: params.date_to,
        offset,
        batch_size: batchSize,
      })

      if (batchError) throw new Error(batchError)

      const processed = Number((batchData as any)?.processed ?? 0)
      const changed = Number((batchData as any)?.complianceChanged ?? 0)
      const breachesCreated = Number((batchData as any)?.breachesCreated ?? 0)
      const breachesDismissed = Number((batchData as any)?.breachesDismissed ?? 0)
      const skippedNoRules = Number((batchData as any)?.skippedNoRules ?? 0)

      processedTotal += processed
      changedTotal += changed
      breachesCreatedTotal += breachesCreated
      breachesDismissedTotal += breachesDismissed
      skippedNoRulesTotal += skippedNoRules

      const progressPct = total > 0 ? Math.min(100, Math.round((processedTotal / total) * 100)) : 0
      setProgress(progressPct)
      const liveState = {
        total,
        processed: processedTotal,
        changed: changedTotal,
        breachesCreated: breachesCreatedTotal,
        breachesDismissed: breachesDismissedTotal,
        skippedNoRules: skippedNoRulesTotal,
      }
      setLiveRun(liveState)
      updateProgress(OPERATION_ID, progressPct, liveState)

      if (processed <= 0) break
      offset += processed
    }

    return {
      observations_processed: processedTotal,
      compliance_changed: changedTotal,
      breaches_created: breachesCreatedTotal,
      breaches_dismissed: breachesDismissedTotal,
      skipped_no_rules: skippedNoRulesTotal,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      status: 'completed',
    }
  }

  const recalculateMutation = useMutation({
    mutationFn: async (): Promise<RecalculationResult> => {
      if (scope === 'zone' && selectedZoneId) {
        return runRecalculatePinnedBatched({
          zone_ids: [selectedZoneId],
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        })
      }

      const zoneIds = (zones ?? [])
        .filter((z) => !effectiveOrgId || z.organization_id === effectiveOrgId)
        .map((z) => z.id)

      if (zoneIds.length === 0) {
        throw new Error('No zones available for recalculation in the selected scope')
      }

      return runRecalculatePinnedBatched({
        zone_ids: zoneIds,
        date_from: scope === 'date_range' ? dateFrom : undefined,
        date_to: scope === 'date_range' ? dateTo : undefined,
      })
    },
    onMutate: () => {
      setLocalRunning(true)
      setProgress(0)
      setResult(null)
      setLiveRun(null)
      startOperation(OPERATION_ID, 'Compliance Recalculation')
      return {}
    },
    onSuccess: (data) => {
      setProgress(100)
      setResult(data)
      completeOperation(OPERATION_ID, {
        observations_processed: data.observations_processed,
        compliance_changed: data.compliance_changed,
        breaches_created: data.breaches_created,
        breaches_dismissed: data.breaches_dismissed,
        skipped_no_rules: data.skipped_no_rules,
        duration_seconds: data.duration_seconds,
        status: 'completed',
      })
      toast.success('Compliance recalculation completed successfully')
      refetchActions()
    },
    onError: (error: any) => {
      setProgress(0)
      const msg: string = error?.message || 'Recalculation failed'
      failOperation(OPERATION_ID, msg)
      // Match the exact messages produced by edgeFunctions.ts session error paths
      const isSessionError =
        msg === 'Session expired. Please sign in again.' ||
        msg === 'Session has expired. Please sign in again.' ||
        msg === 'No active session found. Please sign in again and retry.'
      if (isSessionError) {
        toast.error('Your session has expired. Please sign in again to retry.', { duration: 8000 })
      } else {
        toast.error(msg)
      }
      refetchActions()
    },
    onSettled: (_, __, context: any) => {
      setLocalRunning(false)
      if (context?.interval) clearInterval(context.interval)
    },
  })

  const handleRecalculate = () => {
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

    toast.info('Starting live compliance recalculation (50 records per batch)')
    recalculateMutation.mutate(undefined as any)
  }

  return (
    <AppLayout 
      title="Compliance Recalculation" 
      description="Recalculate compliance status for observations"
      showBackButton
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-center">
          <Badge variant="secondary" className="text-xs">
            Active Engine: recalculate-compliance-v3 (UI pinned)
          </Badge>
        </div>

        {/* Warning Banner */}
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                  Important: Recalculation Impact
                </h3>
                <p className="text-sm text-orange-700 dark:text-orange-200 mt-1">
                  This operation will reprocess all observations in the selected scope and may:
                </p>
                <ul className="text-sm text-orange-700 dark:text-orange-200 mt-2 space-y-1 list-disc list-inside">
                  <li>Change compliance status for vehicles</li>
                  <li>Create or resolve breach alerts</li>
                  <li>Trigger enforcement notifications</li>
                  <li>Generate drift event logs if rules changed</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Recalculation Scope
            </CardTitle>
            <CardDescription>
              Select the scope for compliance recalculation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Scope Selection */}
            <div>
              <Label>Recalculation Scope</Label>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <Button
                  variant={scope === 'organization' ? 'default' : 'outline'}
                  onClick={() => setScope('organization')}
                  className="h-auto py-3"
                  disabled={isRunning}
                >
                  <div className="text-left w-full">
                    <div className="font-semibold">Organisation</div>
                    <div className="text-xs opacity-70">All zones</div>
                  </div>
                </Button>
                <Button
                  variant={scope === 'zone' ? 'default' : 'outline'}
                  onClick={() => setScope('zone')}
                  className="h-auto py-3"
                  disabled={isRunning}
                >
                  <div className="text-left w-full">
                    <div className="font-semibold">Single Zone</div>
                    <div className="text-xs opacity-70">Specific area</div>
                  </div>
                </Button>
                <Button
                  variant={scope === 'date_range' ? 'default' : 'outline'}
                  onClick={() => setScope('date_range')}
                  className="h-auto py-3"
                  disabled={isRunning}
                >
                  <div className="text-left w-full">
                    <div className="font-semibold">Date Range</div>
                    <div className="text-xs opacity-70">Time period</div>
                  </div>
                </Button>
              </div>
            </div>

            {/* Organization Selection */}
            {scope === 'organization' && (
              <div>
                <Label htmlFor="organization">Organisation</Label>
                <select
                  id="organization"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  disabled={isRunning}
                  className="w-full mt-2 px-3 py-2 border rounded-md"
                >
                  <option value="">Select organisation...</option>
                  {organizations?.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Zone Selection */}
            {scope === 'zone' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="org-for-zone">Organisation</Label>
                  <select
                    id="org-for-zone"
                    value={selectedOrgId}
                    onChange={(e) => {
                      setSelectedOrgId(e.target.value)
                      setSelectedZoneId('')
                    }}
                    disabled={isRunning}
                    className="w-full mt-2 px-3 py-2 border rounded-md"
                  >
                    <option value="">Select organisation...</option>
                    {organizations?.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedOrgId && (
                  <div>
                    <Label htmlFor="zone">Zone</Label>
                    <select
                      id="zone"
                      value={selectedZoneId}
                      onChange={(e) => setSelectedZoneId(e.target.value)}
                      disabled={isRunning || !selectedOrgId}
                      className="w-full mt-2 px-3 py-2 border rounded-md"
                    >
                      <option value="">Select zone...</option>
                      {zones?.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Date Range Selection */}
            {scope === 'date_range' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="org-for-date">Organisation</Label>
                  <select
                    id="org-for-date"
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    disabled={isRunning}
                    className="w-full mt-2 px-3 py-2 border rounded-md"
                  >
                    <option value="">All organisations (master only)</option>
                    {organizations?.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date-from">Start Date</Label>
                    <Input
                      id="date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      disabled={isRunning}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="date-to">End Date</Label>
                    <Input
                      id="date-to"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      disabled={isRunning}
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Action Button */}
            <div className="pt-4 border-t">
              <Button
                onClick={handleRecalculate}
                disabled={isRunning}
                className="w-full"
                size="lg"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    Recalculating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2" />
                    Start Recalculation
                  </>
                )}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground text-center">
                Uses canonical compliance engine: <code>recalculate-compliance-v3</code>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Progress Indicator */}
        {isRunning && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 animate-pulse" />
                Processing Live...
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-gray-600 text-center">{progress}% complete</p>

              {liveRun && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Target</div>
                    <div className="text-lg font-semibold mt-1">{liveRun.total.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Processed</div>
                    <div className="text-lg font-semibold mt-1">{liveRun.processed.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Changed</div>
                    <div className="text-lg font-semibold text-orange-600 mt-1">{liveRun.changed.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Breaches</div>
                    <div className="text-lg font-semibold text-red-600 mt-1">{liveRun.breachesCreated.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Dismissed</div>
                    <div className="text-lg font-semibold text-green-600 mt-1">{liveRun.breachesDismissed.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg col-span-2 md:col-span-5">
                    <div className="text-xs text-gray-600">Skipped (No Rules)</div>
                    <div className="text-lg font-semibold text-blue-600 mt-1">{liveRun.skippedNoRules.toLocaleString()}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Results Display */}
        {result && (
          <Card className="border-green-200 bg-green-50 dark:bg-green-900/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-900 dark:text-green-100">
                <CheckCircle className="h-5 w-5" />
                Recalculation Complete
              </CardTitle>
              {result.action_id && (
                <CardDescription className="text-xs font-mono text-green-700 dark:text-green-300">
                  Action ID: {result.action_id}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Observations</div>
                  <div className="text-2xl font-bold mt-1">
                    {result.observations_processed.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Changed</div>
                  <div className="text-2xl font-bold text-orange-600 mt-1">
                    {result.compliance_changed.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Breaches Created</div>
                  <div className="text-2xl font-bold text-red-600 mt-1">
                    {result.breaches_created.toLocaleString()}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Breaches Dismissed</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {result.breaches_dismissed.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Duration</div>
                  <div className="text-2xl font-bold text-purple-600 mt-1">
                    {result.duration_seconds}s
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Skipped (No Rules)</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">
                    {result.skipped_no_rules.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="flex-1 text-sm text-blue-900 dark:text-blue-100">
                  <p className="font-semibold">What happens next?</p>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>Breach alerts have been updated or created</li>
                    <li>Vehicle compliance status has been refreshed</li>
                    <li>Monthly stay counts have been recalculated</li>
                    <li>Check the Breach Alerts page to review actions needed</li>
                  </ul>
                </div>
              </div>

              {result.breaches_created > 0 && (
                <div className="flex items-start gap-3 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="flex-1 text-sm text-yellow-900 dark:text-yellow-100">
                    <p className="font-semibold">New Breaches Created</p>
                    <p className="mt-1">
                      {result.breaches_created} new pending breach alert(s) were created during this run.
                      Review these in the Admin Portal to triage required enforcement actions.
                    </p>
                  </div>
                </div>
              )}

              {result.breaches_dismissed > 0 && (
                <div className="flex items-start gap-3 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div className="flex-1 text-sm text-green-900 dark:text-green-100">
                    <p className="font-semibold">Breach Alerts Auto-Dismissed</p>
                    <p className="mt-1">
                      {result.breaches_dismissed} breach alert(s) were automatically dismissed because
                      the associated observations are now compliant after recalculation.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recent Recalculation Actions Log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Recent Recalculation Actions
            </CardTitle>
            <CardDescription>
              Admin audit log for the last 10 recalculation jobs
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!recentActions || recentActions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recalculation actions recorded yet.
              </p>
            ) : (
              <div className="space-y-3">
                {recentActions.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-muted/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {action.status === 'completed' ? (
                        <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                      ) : action.status === 'failed' ? (
                        <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                      ) : (
                        <RefreshCw className="h-4 w-4 text-blue-600 animate-spin shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {action.scope_type} scope
                          </span>
                          <Badge
                            variant={
                              action.status === 'completed' ? 'default' :
                              action.status === 'failed' ? 'destructive' : 'secondary'
                            }
                            className="text-xs"
                          >
                            {action.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(action.started_at), 'PPp')}
                          {action.duration_seconds != null && ` · ${action.duration_seconds}s`}
                        </div>
                        {action.error_message && (
                          <div className="text-xs text-red-600 mt-1 truncate max-w-xs">
                            {action.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-sm">
                      {action.observations_processed != null && (
                        <div className="font-semibold">
                          {action.observations_processed.toLocaleString()} obs
                        </div>
                      )}
                      {action.compliance_changed != null && (
                        <div className="text-xs text-muted-foreground">
                          {action.compliance_changed.toLocaleString()} changed
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
