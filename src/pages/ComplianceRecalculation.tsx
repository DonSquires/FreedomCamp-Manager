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
  drift_events_created: number
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

const BATCH_SIZE = 150

export default function ComplianceRecalculation() {
  const { user } = useAuthStore()
  const [scope, setScope] = useState<'organization' | 'zone' | 'date_range'>('organization')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [selectedZoneId, setSelectedZoneId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [result, setResult] = useState<RecalculationResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)

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

  const recalculateMutation = useMutation({
    mutationFn: async (): Promise<RecalculationResult> => {
      const params: Parameters<typeof edgeFunctions.recalculateCompliance>[0] = {}

      if (scope === 'zone' && selectedZoneId) {
        params.zone_id = selectedZoneId
      } else {
        // organization or date_range scope — restrict to the selected org
        if (effectiveOrgId) params.organization_id = effectiveOrgId
      }

      if (dateFrom) params.date_from = dateFrom
      if (dateTo)   params.date_to   = dateTo

      const { data, error } = await edgeFunctions.recalculateCompliance(params)
      if (error) throw new Error(error)
      return data as RecalculationResult
    },
    onMutate: () => {
      setIsRunning(true)
      setProgress(0)
      setResult(null)
      
      const interval = setInterval(() => {
        setProgress(prev => Math.min(prev + 3, 85))
      }, 800)
      
      return { interval }
    },
    onSuccess: (data) => {
      setProgress(100)
      setResult(data)
      toast.success('Compliance recalculation completed successfully')
      refetchActions()
    },
    onError: (error: any) => {
      setProgress(0)
      const msg: string = error?.message || 'Recalculation failed'
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
      setIsRunning(false)
      if (context?.interval) {
        clearInterval(context.interval)
      }
    },
  })

  const handleRecalculate = () => {
    if (scope === 'organization' && !effectiveOrgId) {
      toast.error('Please select an organization')
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

    toast.info(`Starting compliance recalculation (server processes in batches of ${BATCH_SIZE})`)
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
            Active Engine: recalculate-compliance (observations table · batch {BATCH_SIZE})
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
                    <div className="font-semibold">Organization</div>
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
                <Label htmlFor="organization">Organization</Label>
                <select
                  id="organization"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  disabled={isRunning}
                  className="w-full mt-2 px-3 py-2 border rounded-md"
                >
                  <option value="">Select organization...</option>
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
                  <Label htmlFor="org-for-zone">Organization</Label>
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
                    <option value="">Select organization...</option>
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
                  <Label htmlFor="org-for-date">Organization</Label>
                  <select
                    id="org-for-date"
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    disabled={isRunning}
                    className="w-full mt-2 px-3 py-2 border rounded-md"
                  >
                    <option value="">All organizations (master only)</option>
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
                Uses <code>recalculate-compliance</code> edge function · processes {BATCH_SIZE} records per server batch · each run is logged in Admin Actions
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
                Processing...
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-gray-600 text-center">
                {progress < 30 && "Loading observations..."}
                {progress >= 30 && progress < 60 && "Evaluating compliance rules..."}
                {progress >= 60 && progress < 85 && "Detecting breaches..."}
                {progress >= 85 && "Finalizing results..."}
              </p>
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
                  <div className="text-sm text-gray-600">Drift Events</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">
                    {result.drift_events_created.toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Duration</div>
                  <div className="text-2xl font-bold text-purple-600 mt-1">
                    {result.duration_seconds}s
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

              {result.drift_events_created > 0 && (
                <div className="flex items-start gap-3 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="flex-1 text-sm text-yellow-900 dark:text-yellow-100">
                    <p className="font-semibold">Compliance Drift Detected</p>
                    <p className="mt-1">
                      {result.drift_events_created} drift event(s) were created because compliance rules changed.
                      Review these in the Admin Portal to understand what changed and why.
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
