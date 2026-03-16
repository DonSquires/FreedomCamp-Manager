import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useOrganizations } from '@/hooks/useOrganizations'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useOperationsStore } from '@/stores/operationsStore'
import { toast } from 'sonner'
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Camera,
  Info,
  XCircle,
} from 'lucide-react'

interface ReingestResult {
  processed: number
  created: number
  failed: number
  duration_seconds: number
  status: 'completed' | 'failed'
  error_message?: string
}

interface LiveRunState {
  total: number
  processed: number
  created: number
  failed: number
}

const OPERATION_ID = 'photo-reingest'

export default function PhotoReingest() {
  const { user } = useAuthStore()
  const { startOperation, updateProgress, completeOperation, failOperation, operations } = useOperationsStore()
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [result, setResult] = useState<ReingestResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null)

  // Track running state from both local mutation and global store
  const globalOp = operations.find((op) => op.id === OPERATION_ID)
  const [localRunning, setLocalRunning] = useState(false)
  const isRunning = localRunning || globalOp?.status === 'running'

  // Sync from global operation when returning to this page
  const globalProgress = globalOp?.progress
  const globalLiveProgress = globalOp?.liveProgress
  const globalResult = globalOp?.result
  const globalStatus = globalOp?.status
  useEffect(() => {
    if (globalProgress != null) {
      setProgress(globalProgress)
    }
    if (globalLiveProgress) {
      setLiveRun({
        total: globalLiveProgress.total,
        processed: globalLiveProgress.processed,
        created: globalLiveProgress.changed,
        failed: globalLiveProgress.breachesCreated,
      })
    }
    if (globalResult && !result) {
      setResult({
        processed: globalResult.observations_processed,
        created: globalResult.compliance_changed,
        failed: globalResult.breaches_created,
        duration_seconds: globalResult.duration_seconds,
        status: globalResult.status,
        error_message: globalResult.error_message,
      })
    }
  }, [globalProgress, globalLiveProgress, globalResult, globalStatus, result])

  const effectiveOrgId = selectedOrgId || (user?.role !== 'master' ? user?.organization_id || '' : '')

  const { data: organizations } = useOrganizations()

  const runReingestBatched = async (): Promise<ReingestResult> => {
    const startedAt = Date.now()

    // Step 1: Get total count of observations with photos
    const { data: totalData, error: totalError } = await edgeFunctions.reingestPhotos({
      get_total: true,
      organization_id: effectiveOrgId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    })

    if (totalError) throw new Error(totalError)

    const total = Number((totalData as any)?.total ?? 0)

    if (total <= 0) {
      return {
        processed: 0,
        created: 0,
        failed: 0,
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
        status: 'completed',
      }
    }

    const initialLiveState: LiveRunState = { total, processed: 0, created: 0, failed: 0 }
    setLiveRun(initialLiveState)
    updateProgress(OPERATION_ID, 0, {
      total,
      processed: 0,
      changed: 0,
      breachesCreated: 0,
      breachesDismissed: 0,
      skippedNoRules: 0,
    })

    let offset = 0
    const batchSize = 50
    let processedTotal = 0
    let createdTotal = 0
    let failedTotal = 0

    while (offset < total) {
      const { data: batchData, error: batchError } = await edgeFunctions.reingestPhotos({
        organization_id: effectiveOrgId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        offset,
        batch_size: batchSize,
      })

      if (batchError) throw new Error(batchError)

      const processed = Number((batchData as any)?.processed ?? 0)
      const created = Number((batchData as any)?.created ?? 0)
      const failed = Number((batchData as any)?.failed ?? 0)

      processedTotal += processed
      createdTotal += created
      failedTotal += failed

      const progressPct = total > 0 ? Math.min(100, Math.round((processedTotal / total) * 100)) : 0
      setProgress(progressPct)
      const liveState: LiveRunState = {
        total,
        processed: processedTotal,
        created: createdTotal,
        failed: failedTotal,
      }
      setLiveRun(liveState)
      updateProgress(OPERATION_ID, progressPct, {
        total,
        processed: processedTotal,
        changed: createdTotal,
        breachesCreated: failedTotal,
        breachesDismissed: 0,
        skippedNoRules: 0,
      })

      if (processed <= 0) break
      offset += processed
    }

    return {
      processed: processedTotal,
      created: createdTotal,
      failed: failedTotal,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      status: 'completed',
    }
  }

  const reingestMutation = useMutation({
    mutationFn: runReingestBatched,
    onMutate: () => {
      setLocalRunning(true)
      setProgress(0)
      setResult(null)
      setLiveRun(null)
      startOperation(OPERATION_ID, 'Photo Reingest')
      return {}
    },
    onSuccess: (data) => {
      setProgress(100)
      setResult(data)
      completeOperation(OPERATION_ID, {
        observations_processed: data.processed,
        compliance_changed: data.created,
        breaches_created: data.failed,
        breaches_dismissed: 0,
        skipped_no_rules: 0,
        duration_seconds: data.duration_seconds,
        status: 'completed',
      })
      toast.success(`Photo reingest completed — ${data.created} new observations created`)
    },
    onError: (error: any) => {
      setProgress(0)
      const msg: string = error?.message || 'Photo reingest failed'
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
    },
    onSettled: () => {
      setLocalRunning(false)
    },
  })

  const handleStart = () => {
    if (!effectiveOrgId && user?.role !== 'master') {
      toast.error('Please select an organisation')
      return
    }
    toast.info('Starting photo reingest — creating new observations from existing photos (50 per batch)')
    reingestMutation.mutate()
  }

  return (
    <AppLayout
      title="Photo Reingest"
      description="Reprocess existing observation photos through the vehicle ingest pipeline to create new observation records"
      showBackButton
    >
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Warning Banner */}
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                  Important: This creates new observation records
                </h3>
                <p className="text-sm text-orange-700 dark:text-orange-200 mt-1">
                  This operation queries all existing observations that have photos and creates
                  a <strong>new</strong> observation record for each one, treating the photo as
                  if it were freshly submitted by an officer. This will:
                </p>
                <ul className="text-sm text-orange-700 dark:text-orange-200 mt-2 space-y-1 list-disc list-inside">
                  <li>Create new observation records linked to existing photos</li>
                  <li>Trigger compliance evaluation for each new observation</li>
                  <li>Preserve the original officer, zone, GPS, and timestamp data</li>
                  <li>Mark new records with "[Reingested]" in officer notes</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Reingest Scope
            </CardTitle>
            <CardDescription>
              Select which observations to reprocess. Only observations with photos will be included.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Organization Selection */}
            <div>
              <Label htmlFor="organization">Organisation</Label>
              <select
                id="organization"
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                disabled={isRunning}
                className="w-full mt-2 px-3 py-2 border rounded-md"
              >
                {user?.role === 'master' && <option value="">All organisations</option>}
                {organizations?.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range (optional) */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="date-from">Start Date (optional)</Label>
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
                <Label htmlFor="date-to">End Date (optional)</Label>
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

            {/* Action Button */}
            <div className="pt-4 border-t">
              <Button
                onClick={handleStart}
                disabled={isRunning}
                className="w-full"
                size="lg"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    Reingesting Photos...
                  </>
                ) : (
                  <>
                    <Camera className="h-5 w-5 mr-2" />
                    Start Photo Reingest
                  </>
                )}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground text-center">
                Creates new observation records from existing photos via the vehicle ingest pipeline
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Target</div>
                    <div className="text-lg font-semibold mt-1">{liveRun.total.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Processed</div>
                    <div className="text-lg font-semibold mt-1">{liveRun.processed.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Created</div>
                    <div className="text-lg font-semibold text-green-600 mt-1">{liveRun.created.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Failed</div>
                    <div className="text-lg font-semibold text-red-600 mt-1">{liveRun.failed.toLocaleString()}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Results Display */}
        {result && (
          <Card className={result.status === 'completed' ? 'border-green-200 bg-green-50 dark:bg-green-900/10' : 'border-red-200 bg-red-50 dark:bg-red-900/10'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.status === 'completed' ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                {result.status === 'completed' ? 'Photo Reingest Complete' : 'Photo Reingest Failed'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Processed</div>
                  <div className="text-2xl font-bold mt-1">
                    {result.processed.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Created</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {result.created.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Failed</div>
                  <div className="text-2xl font-bold text-red-600 mt-1">
                    {result.failed.toLocaleString()}
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
                  <p className="font-semibold">What happened?</p>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>Each existing observation photo was used to create a new observation record</li>
                    <li>New records went through the compliance evaluation pipeline</li>
                    <li>New observations are marked with "[Reingested]" in officer notes</li>
                    <li>Check the Observations page to review the new records</li>
                  </ul>
                </div>
              </div>

              {result.error_message && (
                <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                  <div className="flex-1 text-sm text-red-900 dark:text-red-100">
                    <p className="font-semibold">Error Details</p>
                    <p className="mt-1 font-mono text-xs">{result.error_message}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
