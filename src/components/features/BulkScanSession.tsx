/**
 * BulkScanSession
 *
 * Full-screen quick-sweep scanning mode for officers patrolling a camping or
 * parking area with multiple vehicles.
 *
 * Design goals:
 *  - Camera stays open between captures (no blocking wait)
 *  - Each capture is fire-and-forget: GPS → upload → save → enrich async
 *  - Running session tally: total scanned / breaches found
 *  - Live list of scans in this session (updates as enrichment completes)
 *  - Per-scan quick enforcement action for breaches (workflow-gated)
 *  - Welfare: GPS updates recorded on every capture
 *  - Patrol: attempts to increment patrols.vehicles_checked / breaches_found
 *  - "End Session" shows summary, then returns officer to portal
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { SplitScanCamera } from '@/components/features/SplitScanCamera'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { captureAndSave, SCAN_PROGRESS_LABELS, type ScanProgressStage } from '@/lib/scanPipeline'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import {
  Camera, CheckCircle, XCircle, Clock, Zap, X,
  FileWarning, Megaphone, Shield, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionScan {
  clientId: string
  observationId: string
  photoUrl: string
  plateNumber: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleYear: string | null
  vehicleColor: string | null
  isCompliant: boolean | null
  breachType: string | null
  processingPending: boolean
  queueState: 'queued' | 'processing' | null
  zoneId: string
  recordedAt: string
}

interface QueuedCaptureTask {
  clientId: string
  file: File
}

interface BulkScanSessionProps {
  /** Called with (lat, lon) on every GPS fix — keeps man-down timer alive */
  recordGPSUpdate: (lat: number, lon: number) => void
  /** Active patrol session ID for incrementing vehicles_checked / breaches_found. Optional — counters are silently skipped when absent. */
  activePatrolId?: string | null
  orgWorkflow: string
  onIssueAction: (params: {
    observationId: string
    zoneId: string
    plateNumber: string
    actionType: 'warning' | 'notice_to_vacate'
  }) => void
  isIssuingAction: boolean
  onFinish: () => void
  /** Called after each capture so recent-scans list refreshes */
  onScanSaved?: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS  = 2_000
const MAX_POLL_ATTEMPTS = 45
const MAX_LOCAL_QUEUE_SIZE = 12

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBreach(v: string | null | undefined) {
  if (!v) return 'Breach'
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BulkScanSession({
  recordGPSUpdate,
  activePatrolId,
  orgWorkflow,
  onIssueAction,
  isIssuingAction,
  onFinish,
  onScanSaved,
}: BulkScanSessionProps) {
  const { user }   = useAuthStore()
  const { zoneId } = useGlobalFiltersStore()

  const [isCapturing,   setIsCapturing]   = useState(false)
  const [captureStageLabel, setCaptureStageLabel] = useState(SCAN_PROGRESS_LABELS.gps)
  const [queueDepth, setQueueDepth] = useState(0)
  const [scans,         setScans]         = useState<SessionScan[]>([])
  const [showList,      setShowList]      = useState(true)
  const [showSummary,   setShowSummary]   = useState(false)
  const captureQueueRef = useRef<QueuedCaptureTask[]>([])
  const queueWorkerActiveRef = useRef(false)

  // Keep a ref to the latest scans list for use inside polling closures
  const scansRef = useRef<SessionScan[]>([])
  scansRef.current = scans

  // Derived session totals
  const totalScanned = scans.length
  const totalBreaches = scans.filter(s => s.isCompliant === false).length
  const totalCompliant = scans.filter(s => s.isCompliant === true).length
  const totalPending  = scans.filter(s => s.processingPending || s.queueState !== null).length

  const runQueueWorker = useCallback(async () => {
    if (queueWorkerActiveRef.current) return
    queueWorkerActiveRef.current = true
    setIsCapturing(true)

    try {
      while (captureQueueRef.current.length > 0) {
        const task = captureQueueRef.current[0]

        setScans(prev => prev.map(s =>
          s.clientId === task.clientId ? { ...s, queueState: 'processing' } : s
        ))

        setCaptureStageLabel(SCAN_PROGRESS_LABELS.gps)

        try {
          const result = await captureAndSave(
            task.file,
            { id: user!.id, organization_id: user!.organization_id, full_name: user!.full_name },
            zoneId,
            recordGPSUpdate,
            (_stage: ScanProgressStage, label: string) => setCaptureStageLabel(label),
          )

          setScans(prev => prev.map(s =>
            s.clientId !== task.clientId ? s : {
              ...s,
              observationId: result.observationId,
              photoUrl: result.photoUrl,
              zoneId: result.zoneId,
              recordedAt: result.recordedAt,
              queueState: null,
              processingPending: true,
            }
          ))

          setShowList(true)
          onScanSaved?.()

          if (activePatrolId) {
            ;(supabase as any)
              .rpc('increment_patrol_vehicles_checked', { p_patrol_id: activePatrolId })
              .catch(() => {/* non-critical */})
          }
        } catch (err: any) {
          setScans(prev => prev.map(s =>
            s.clientId !== task.clientId ? s : { ...s, processingPending: false, queueState: null }
          ))
          toast.error(err?.message || 'Queued scan failed')
        } finally {
          captureQueueRef.current.shift()
          setQueueDepth(captureQueueRef.current.length)
        }
      }
    } finally {
      queueWorkerActiveRef.current = false
      setIsCapturing(false)
      setCaptureStageLabel(SCAN_PROGRESS_LABELS.gps)
    }
  }, [activePatrolId, onScanSaved, recordGPSUpdate, user, zoneId])

  // ── Capture handler ──────────────────────────────────────────────────────
  const handleCapture = useCallback((file: File) => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired — please log out and back in')
      return
    }

    if (captureQueueRef.current.length >= MAX_LOCAL_QUEUE_SIZE) {
      toast.error(`Queue is full (${MAX_LOCAL_QUEUE_SIZE}). Please wait for current uploads to finish.`)
      return
    }

    const clientId = `queued-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const nowIso = new Date().toISOString()

    const queuedScan: SessionScan = {
      clientId,
      observationId: clientId,
      photoUrl: '',
      plateNumber: null,
      vehicleMake: null,
      vehicleModel: null,
      vehicleYear: null,
      vehicleColor: null,
      isCompliant: null,
      breachType: null,
      processingPending: true,
      queueState: 'queued',
      zoneId: zoneId || '',
      recordedAt: nowIso,
    }

    setScans(prev => [queuedScan, ...prev])
    setShowList(true)

    captureQueueRef.current.push({ clientId, file })
    setQueueDepth(captureQueueRef.current.length)
    void runQueueWorker()
  }, [runQueueWorker, user, zoneId])

  // ── Background polling for each pending scan ─────────────────────────────
  useEffect(() => {
    const pending = scans.filter(s => s.processingPending && s.queueState === null)
    if (!pending.length) return

    const controllers: Map<string, { cancelled: boolean; timer: ReturnType<typeof setTimeout> | null }> = new Map()

    pending.forEach(scan => {
      if (controllers.has(scan.clientId)) return
      const ctrl = { cancelled: false, timer: null as ReturnType<typeof setTimeout> | null }
      controllers.set(scan.clientId, ctrl)

      let attempts = 0

      const poll = async () => {
        if (ctrl.cancelled) return
        attempts++

        const { data } = await (supabase.from('observations') as any)
          .select('observation_id, plate_number, is_compliant, breach_type, vehicle_make, vehicle_model, vehicle_year, vehicle_color')
          .eq('observation_id', scan.observationId)
          .maybeSingle()

        if (!data) {
          if (attempts < MAX_POLL_ATTEMPTS) ctrl.timer = setTimeout(poll, POLL_INTERVAL_MS)
          return
        }

        const resolved =
          data.plate_number &&
          data.plate_number !== 'PROCESSING...' &&
          data.plate_number !== 'MANUAL_REQUIRED'

        const compliant = typeof data.is_compliant === 'boolean' ? data.is_compliant : null

        setScans(prev => prev.map(s =>
          s.clientId !== scan.clientId ? s : {
            ...s,
            plateNumber:       data.plate_number ?? null,
            vehicleMake:       data.vehicle_make ?? null,
            vehicleModel:      data.vehicle_model ?? null,
            vehicleYear:       data.vehicle_year != null ? String(data.vehicle_year) : null,
            vehicleColor:      data.vehicle_color ?? null,
            isCompliant:       compliant,
            breachType:        data.breach_type ?? null,
            processingPending: !resolved,
            queueState:        null,
          }
        ))

        if (resolved) {
          if (compliant === false) {
            toast.warning(`⚠️ Breach: ${fmtBreach(data.breach_type)} — ${data.plate_number}`, { duration: 4000 })

            // Update patrol breach counter — fire-and-forget
            if (activePatrolId) {
              ;(supabase as any)
                .rpc('increment_patrol_breaches_found', { p_patrol_id: activePatrolId })
                .catch(() => {/* non-critical */})
            }
          }
        } else if (attempts < MAX_POLL_ATTEMPTS) {
          ctrl.timer = setTimeout(poll, POLL_INTERVAL_MS)
        } else {
          setScans(prev => prev.map(s =>
            s.clientId !== scan.clientId ? s : { ...s, processingPending: false, queueState: null }
          ))
        }
      }

      poll()
    })

    return () => {
      controllers.forEach(ctrl => {
        ctrl.cancelled = true
        if (ctrl.timer) clearTimeout(ctrl.timer)
      })
    }
  // Re-run only when the set of pending IDs changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scans.filter(s => s.processingPending && s.queueState === null).map(s => s.clientId).join(',')])

  // ── Summary / finish ─────────────────────────────────────────────────────
  const handleFinish = () => {
    if (scans.length === 0) { onFinish(); return }
    setShowSummary(true)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (showSummary) {
    return (
      <SessionSummary
        totalScanned={totalScanned}
        totalCompliant={totalCompliant}
        totalBreaches={totalBreaches}
        onClose={onFinish}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Camera (top 52%) ──────────────────────────────────────── */}
      <div className="relative shrink-0" style={{ height: '52dvh', minHeight: 260 }}>
        <SplitScanCamera
          onCapture={handleCapture}
          onCancel={handleFinish}
          isProcessing={false}
          statusLabel={queueDepth > 0 ? `${queueDepth} queued` : undefined}
        />

        {/* Session stats overlay — top left */}
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-white text-xs font-semibold">
            <Zap className="h-3 w-3 text-yellow-400" />
            <span>Bulk Scan</span>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-white text-xs">
            <Camera className="h-3 w-3 text-blue-300" />
            <span>{totalScanned}</span>
          </div>
          {totalBreaches > 0 && (
            <div className="flex items-center gap-1 rounded-full bg-red-600/90 px-2.5 py-1 text-white text-xs font-bold animate-pulse">
              <XCircle className="h-3 w-3" />
              <span>{totalBreaches}</span>
            </div>
          )}
          {isCapturing && (
            <div className="flex items-center gap-1 rounded-full bg-blue-600/90 px-2.5 py-1 text-white text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{captureStageLabel}</span>
            </div>
          )}
          {queueDepth > 0 && (
            <div className="flex items-center gap-1 rounded-full bg-amber-600/90 px-2.5 py-1 text-white text-xs">
              <Clock className="h-3 w-3" />
              <span>{queueDepth} queued</span>
            </div>
          )}
        </div>

        {/* End session button — top right (replaces camera's own cancel) */}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleFinish}
          className="absolute top-2 right-12 z-30 h-7 text-xs bg-black/50 text-white hover:bg-black/70 rounded-full px-3"
        >
          <X className="h-3 w-3 mr-1" />End
        </Button>
      </div>

      {/* ── Session list (bottom 48%) ─────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden border-t border-gray-200 dark:border-gray-800">
        {/* Collapse/expand header */}
        <button
          className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-muted-foreground shrink-0 hover:bg-muted/30"
          onClick={() => setShowList(p => !p)}
        >
          <span>
            {totalScanned === 0
              ? 'No scans yet — tap the shutter to scan'
              : `${totalScanned} scanned · ${totalCompliant} compliant · ${totalBreaches} breach${totalBreaches !== 1 ? 'es' : ''}`}
            {totalPending > 0 && ` · ${totalPending} processing`}
          </span>
          {showList ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        {showList && (
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
            {scans.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Point the camera at a vehicle and tap the shutter button
              </p>
            )}

            {scans.map(scan => {
              const pending = scan.processingPending
              const inBreach = scan.isCompliant === false && !pending && scan.queueState === null
              const vehicleSummary = [scan.vehicleYear, scan.vehicleMake, scan.vehicleModel, scan.vehicleColor]
                .filter(Boolean)
                .join(' · ')
              return (
                <div
                  key={scan.clientId}
                  className={`flex items-center gap-2.5 rounded-lg border p-2 ${
                    inBreach
                      ? 'border-red-200 bg-red-50 dark:bg-red-950/30'
                      : 'border-gray-100 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Thumbnail */}
                  {scan.photoUrl ? (
                    <img
                      src={scan.photoUrl}
                      alt={scan.plateNumber || 'Scan'}
                      className="h-9 w-9 rounded object-cover shrink-0 border"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded shrink-0 border bg-slate-200 dark:bg-slate-800" />
                  )}

                  {/* Plate + status */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {scan.queueState === 'queued' ? (
                        <span className="flex items-center gap-1 text-xs text-amber-600">
                          <Clock className="h-3 w-3" />
                          <span aria-label="Queued">Queued…</span>
                        </span>
                      ) : scan.queueState === 'processing' ? (
                        <span className="flex items-center gap-1 text-xs text-blue-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span aria-label="Uploading">{captureStageLabel}</span>
                        </span>
                      ) : pending ? (
                        <span className="flex items-center gap-1 text-xs text-blue-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span aria-label="Detecting">Detecting…</span>
                        </span>
                      ) : (
                        <span className="font-mono font-bold text-sm">
                          {scan.plateNumber || '—'}
                        </span>
                      )}
                      {!pending && scan.isCompliant === true && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-green-600">✓</Badge>
                      )}
                      {inBreach && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {fmtBreach(scan.breachType)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{fmtTime(scan.recordedAt)}</p>
                    {vehicleSummary && (
                      <p className="text-[11px] text-muted-foreground truncate">{vehicleSummary}</p>
                    )}
                  </div>

                  {/* Quick enforcement buttons for breach */}
                  {inBreach && scan.plateNumber && (
                    <div className="flex gap-1 shrink-0">
                      {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 px-1.5 text-[10px] border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                          disabled={isIssuingAction}
                          onClick={() => onIssueAction({
                            observationId: scan.observationId,
                            zoneId:        scan.zoneId,
                            plateNumber:   scan.plateNumber!,
                            actionType:    'warning',
                          })}
                        >
                          <FileWarning className="h-3 w-3" />
                        </Button>
                      )}
                      {orgWorkflow === 'officer_direct' && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 px-1.5 text-[10px] border-red-400 text-red-700 hover:bg-red-50"
                          disabled={isIssuingAction}
                          onClick={() => onIssueAction({
                            observationId: scan.observationId,
                            zoneId:        scan.zoneId,
                            plateNumber:   scan.plateNumber!,
                            actionType:    'notice_to_vacate',
                          })}
                        >
                          <Megaphone className="h-3 w-3" />
                        </Button>
                      )}
                      {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                        <Badge variant="secondary" className="text-[10px] h-7 px-1.5">
                          <Shield className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Compliant tick */}
                  {!inBreach && !pending && scan.isCompliant === true && (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  )}

                  {/* Still unknown */}
                  {!pending && scan.isCompliant === null && (
                    <Clock className="h-4 w-4 text-gray-400 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Session Summary Modal ────────────────────────────────────────────────────

function SessionSummary({
  totalScanned,
  totalCompliant,
  totalBreaches,
  onClose,
}: {
  totalScanned: number
  totalCompliant: number
  totalBreaches: number
  onClose: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900">
        <Zap className="h-8 w-8 text-blue-600 dark:text-blue-400" />
      </div>

      <div>
        <h2 className="text-xl font-bold">Session Complete</h2>
        <p className="text-sm text-muted-foreground mt-1">Bulk scan session ended</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-xs">
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{totalScanned}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Scanned</p>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{totalCompliant}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Compliant</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${totalBreaches > 0 ? 'border-red-300 bg-red-50 dark:bg-red-950/40' : ''}`}>
          <p className={`text-2xl font-bold ${totalBreaches > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {totalBreaches}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Breach{totalBreaches !== 1 ? 'es' : ''}</p>
        </div>
      </div>

      {totalBreaches > 0 && (
        <p className="text-sm text-red-700 dark:text-red-400 max-w-xs">
          {totalBreaches} breach{totalBreaches !== 1 ? 'es were' : ' was'} detected and reported.
          Enforcement actions may still be taken from the Recent Scans list.
        </p>
      )}

      <Button className="w-full max-w-xs h-12 text-base" onClick={onClose}>
        Back to Portal
      </Button>
    </div>
  )
}
