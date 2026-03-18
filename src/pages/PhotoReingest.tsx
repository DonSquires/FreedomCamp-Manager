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
  matched: number
  processed: number
  updated: number
  failed: number
  duration_seconds: number
  status: 'completed' | 'failed'
  error_message?: string
}

interface ReingestBatchResponse {
  processed?: number
  scanned_rows?: number
  next_before_recorded_at?: string | null
  observations?: ReingestObservation[]
}

interface ReingestObservation {
  observation_id: string
  photo_url: string | null
  photo_hash: string | null
  recorded_at: string | null
  zone_id: string | null
  organization_id: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  gps_accuracy: number | null
  plate_number: string | null
  officer_notes: string | null
}

interface LiveRunState {
  matched: number
  processed: number
  updated: number
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
  const [batchFailureReason, setBatchFailureReason] = useState<string | null>(null)

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
      // Map generic OperationProgress fields to reingest-specific LiveRunState.
      // OperationProgress is designed for compliance recalculation, so we reuse:
      //   changed        → updated (existing observations reprocessed)
      //   breachesCreated → failed  (observations that failed to reingest)
      setLiveRun({
        matched: globalLiveProgress.total,
        processed: globalLiveProgress.processed,
        updated: globalLiveProgress.changed,
        failed: globalLiveProgress.breachesCreated,
      })
    }
    if (globalResult && !result) {
      // Map generic OperationResult fields to reingest-specific ReingestResult.
      //   compliance_changed → updated (existing observations reprocessed)
      //   breaches_created   → failed  (observations that failed to reingest)
      setResult({
        matched: globalResult.observations_processed,
        processed: globalResult.observations_processed,
        updated: globalResult.compliance_changed,
        failed: globalResult.breaches_created,
        duration_seconds: globalResult.duration_seconds,
        status: globalResult.status,
        error_message: globalResult.error_message,
      })
    }
  }, [globalProgress, globalLiveProgress, globalResult, globalStatus, result])

  const effectiveOrgId = selectedOrgId || (user?.role !== 'master' ? user?.organization_id || '' : '')

  const { data: organizations } = useOrganizations()

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
        }, timeoutMs)
      })
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  const runReingestBatched = async (): Promise<ReingestResult> => {
    const startedAt = Date.now()

    // No count query — just stream batches until the function returns processed=0.
    // This avoids a slow full-table COUNT that was timing out before any work started.
    let beforeRecordedAt: string | null = null
    const batchSize = 10
    let matchedTotal = 0
    let processedTotal = 0
    let updatedTotal = 0
    let failedTotal = 0
    let topFailureReason: string | null = null
    let batchNumber = 0

    const invokeVehicleIngest = async (observation: ReingestObservation) => {
      const { data, error } = await withTimeout(
        edgeFunctions.ingestVehicleObservation({
          existing_observation_id: observation.observation_id,
          observation_id: observation.observation_id,
          photo_url: observation.photo_url,
          photo_hash: observation.photo_hash,
          recorded_at: observation.recorded_at,
          recordedAt: observation.recorded_at,
          zone_id: observation.zone_id,
          zoneId: observation.zone_id,
          organization_id: observation.organization_id,
          organizationId: observation.organization_id,
          gps_latitude: observation.gps_latitude,
          gps_longitude: observation.gps_longitude,
          gps_accuracy: observation.gps_accuracy,
          plate_number: observation.plate_number,
          plate: observation.plate_number,
          officer_notes: observation.officer_notes,
          notes: observation.officer_notes,
          idempotencyKey: `reingest-update-${observation.observation_id}-${Date.now()}`,
        }),
        30_000,
        `vehicle-ingest for ${observation.observation_id}`,
      )

      if (error) {
        throw new Error(error)
      }

      return data
    }

    // Seed the live display immediately so the card appears.
    setBatchFailureReason(null)
    setLiveRun({ matched: 0, processed: 0, updated: 0, failed: 0 })
    setProgress(5)
    updateProgress(OPERATION_ID, 5, {
      total: 0,
      processed: 0,
      changed: 0,
      breachesCreated: 0,
      breachesDismissed: 0,
      skippedNoRules: 0,
    })

    while (true) {
      const { data: batchData, error: batchError } = await withTimeout(
        edgeFunctions.reingestPhotos({
          organization_id: effectiveOrgId || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          batch_size: batchSize,
          before_recorded_at: beforeRecordedAt || undefined,
        }),
        90_000,
        `Reingest batch before ${beforeRecordedAt || 'latest'}`,
      )

      if (batchError) throw new Error(batchError)

      const parsedBatch = (batchData as ReingestBatchResponse | null) ?? {}
      const observations = Array.isArray(parsedBatch.observations) ? parsedBatch.observations : []
      const nextBeforeRecordedAt = parsedBatch.next_before_recorded_at ?? null
      matchedTotal += observations.length
      let batchFirstFailureReason: string | null = null

      for (const observation of observations) {
        if (!observation.photo_url) {
          failedTotal += 1
          if (!batchFirstFailureReason) {
            batchFirstFailureReason = `${observation.observation_id}: no_photo_url`
          }
          if (!topFailureReason) {
            topFailureReason = `${observation.observation_id}: no_photo_url`
          }
          continue
        }

        try {
          await invokeVehicleIngest(observation)
          updatedTotal += 1
        } catch (error: any) {
          failedTotal += 1
          if (!batchFirstFailureReason) {
            batchFirstFailureReason = `${observation.observation_id}: ${error?.message || 'vehicle-ingest_failed'}`
          }
          if (!topFailureReason) {
            topFailureReason = `${observation.observation_id}: ${error?.message || 'vehicle-ingest_failed'}`
          }
        }

        processedTotal += 1
      }

      batchNumber++
      setBatchFailureReason(batchFirstFailureReason)

      // Pulse the progress bar: creep toward 95% as batches complete, never reach 100 until done.
      const pulsedProgress = Math.min(95, 5 + batchNumber * 8)
      setProgress(pulsedProgress)
      setLiveRun({
        matched: matchedTotal,
        processed: processedTotal,
        updated: updatedTotal,
        failed: failedTotal,
      })
      updateProgress(OPERATION_ID, pulsedProgress, {
        total: matchedTotal,
        processed: processedTotal,
        changed: updatedTotal,
        breachesCreated: failedTotal,
        breachesDismissed: 0,
        skippedNoRules: 0,
      })

      if (observations.length <= 0 || !nextBeforeRecordedAt) break
      beforeRecordedAt = nextBeforeRecordedAt
    }

    return {
      matched: matchedTotal,
      processed: processedTotal,
      updated: updatedTotal,
      failed: failedTotal,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      status: 'completed',
      error_message:
        updatedTotal === 0 && failedTotal > 0
          ? (topFailureReason ? `Top failure: ${topFailureReason}` : 'No observations were updated in this run')
          : undefined,
    }
  }

  const reingestMutation = useMutation({
    mutationFn: runReingestBatched,
    onMutate: () => {
      setLocalRunning(true)
      setProgress(0)
      setResult(null)
      setLiveRun(null)
      setBatchFailureReason(null)
      startOperation(OPERATION_ID, 'Photo Reingest')
      return {}
    },
    onSuccess: (data) => {
      setProgress(100)
      setResult(data)
      // Map reingest fields to OperationResult: compliance_changed=updated, breaches_created=failed
      completeOperation(OPERATION_ID, {
        observations_processed: data.matched,
        compliance_changed: data.updated,
        breaches_created: data.failed,
        breaches_dismissed: 0,
        skipped_no_rules: 0,
        duration_seconds: data.duration_seconds,
        status: 'completed',
      })
      toast.success(`Photo reingest completed — ${data.updated} existing observations reprocessed`)
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
    toast.info('Starting photo reingest — reprocessing existing observations from stored photos (10 per batch)')
    reingestMutation.mutate()
  }

  return (
    <AppLayout
      title="Photo Reingest"
      description="Reprocess existing observation photos through the vehicle ingest pipeline and update the original records"
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
                  Important: This updates existing observation records
                </h3>
                <p className="text-sm text-orange-700 dark:text-orange-200 mt-1">
                    This operation queries all existing observations that have photos and
                    runs the ingest pipeline again against the <strong>same</strong> observation record, treating the photo as
                  if it were freshly submitted by an officer. This will:
                </p>
                <ul className="text-sm text-orange-700 dark:text-orange-200 mt-2 space-y-1 list-disc list-inside">
                  <li>Reprocess existing observation records linked to stored photos</li>
                  <li>Trigger compliance evaluation and enrichment again for each observation</li>
                  <li>Preserve the original date/time, zone, GPS, and officer metadata</li>
                  <li>Avoid creating duplicate observation rows</li>
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
                Reprocesses existing observation records from stored photos via the vehicle ingest pipeline
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
              <p className="text-sm text-gray-600 text-center">
                Matched {(liveRun?.matched ?? 0).toLocaleString()} observations, attempted {(liveRun?.processed ?? 0).toLocaleString()} vehicle-ingest calls
              </p>

              {batchFailureReason && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                  Current batch first failure: {batchFailureReason}
                </div>
              )}

              {liveRun && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Matched</div>
                    <div className="text-lg font-semibold mt-1">{liveRun.matched.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Processed</div>
                    <div className="text-lg font-semibold mt-1">{liveRun.processed.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-lg">
                    <div className="text-xs text-gray-600">Updated</div>
                    <div className="text-lg font-semibold text-green-600 mt-1">{liveRun.updated.toLocaleString()}</div>
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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Matched</div>
                  <div className="text-2xl font-bold mt-1">
                    {result.matched.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Processed</div>
                  <div className="text-2xl font-bold mt-1">
                    {result.processed.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Updated</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {result.updated.toLocaleString()}
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
                    <li>Each existing observation photo was reprocessed against the same observation record</li>
                    <li>Updated records went back through the compliance evaluation pipeline</li>
                    <li>Original scan metadata (time/zone/GPS/officer) was retained</li>
                    <li>Check the Observations page to review updated compliance outcomes</li>
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
