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
import { captureAndSave } from '@/lib/scanPipeline'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import {
  Camera, CheckCircle, XCircle, Clock, Zap,
  FileWarning, Megaphone, Shield, ChevronDown, ChevronUp, Loader2, MapPin, AlertTriangle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionScan {
  observationId: string
  photoUrl: string
  plateNumber: string | null
  isCompliant: boolean | null
  breachType: string | null
  processingPending: boolean
  zoneId: string
  recordedAt: string
}

interface BulkScanSessionProps {
  /** Called with (lat, lon) on every GPS fix — keeps man-down timer alive */
  recordGPSUpdate: (lat: number, lon: number) => void
  /** Called after each scan capture — records vehicle_scan to officer_activity_log */
  logVehicleScan?: (lat: number, lng: number, meta?: { observation_id?: string | null; zone_id?: string | null }) => void
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
  logVehicleScan,
  activePatrolId,
  orgWorkflow,
  onIssueAction,
  isIssuingAction,
  onFinish,
  onScanSaved,
}: BulkScanSessionProps) {
  const { user }   = useAuthStore()
  const { zoneId, zoneName } = useGlobalFiltersStore()

  const [isCapturing,   setIsCapturing]   = useState(false)
  const [scans,         setScans]         = useState<SessionScan[]>([])
  const [showList,      setShowList]      = useState(true)
  const [showSummary,   setShowSummary]   = useState(false)
  // 'checking' = first GPS fix pending; 'authorized' / 'unauthorized' = result known
  const [authStatus,    setAuthStatus]    = useState<'checking' | 'authorized' | 'unauthorized'>('checking')

  // Keep a ref to the latest scans list for use inside polling closures
  const scansRef = useRef<SessionScan[]>([])
  scansRef.current = scans

  // Derived session totals
  const totalScanned = scans.length
  const totalBreaches = scans.filter(s => s.isCompliant === false).length
  const totalCompliant = scans.filter(s => s.isCompliant === true).length
  const totalPending  = scans.filter(s => s.processingPending).length

  // ── Capture handler ──────────────────────────────────────────────────────
  const handleCapture = useCallback(async (file: File) => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired — please log out and back in')
      return
    }

    setIsCapturing(true)
    let scanLat: number | null = null
    let scanLon: number | null = null
    try {
      const result = await captureAndSave(
        file,
        { id: user.id, organization_id: user.organization_id, full_name: user.full_name },
        zoneId,
        (lat, lon) => {
          scanLat = lat
          scanLon = lon
          recordGPSUpdate(lat, lon)
        },
      )

      // Log vehicle_scan activity for live welfare tracking
      if (scanLat !== null && scanLon !== null) {
        logVehicleScan?.(scanLat, scanLon, {
          observation_id: result.observationId,
          zone_id:        result.zoneId,
        })
      }

      // Add to session list immediately as pending
      const newScan: SessionScan = {
        observationId:   result.observationId,
        photoUrl:        result.photoUrl,
        plateNumber:     null,
        isCompliant:     null,
        breachType:      null,
        processingPending: true,
        zoneId:          result.zoneId,
        recordedAt:      result.recordedAt,
      }
      setScans(prev => [newScan, ...prev])
      setShowList(true)
      onScanSaved?.()

      // Update patrol counter (vehicles_checked) — fire-and-forget
      if (activePatrolId) {
        ;(supabase as any)
          .rpc('increment_patrol_vehicles_checked', { p_patrol_id: activePatrolId })
          .catch(() => {/* non-critical */})
      }

    } catch (err: any) {
      toast.error(err.message || 'Scan failed')
    } finally {
      setIsCapturing(false)
    }
  }, [user, zoneId, recordGPSUpdate, logVehicleScan, activePatrolId, onScanSaved])

  // ── Background polling for each pending scan ─────────────────────────────
  useEffect(() => {
    const pending = scans.filter(s => s.processingPending)
    if (!pending.length) return

    const controllers: Map<string, { cancelled: boolean; timer: ReturnType<typeof setTimeout> | null }> = new Map()

    pending.forEach(scan => {
      if (controllers.has(scan.observationId)) return
      const ctrl = { cancelled: false, timer: null as ReturnType<typeof setTimeout> | null }
      controllers.set(scan.observationId, ctrl)

      let attempts = 0

      const poll = async () => {
        if (ctrl.cancelled) return
        attempts++

        const { data } = await (supabase.from('observations') as any)
          .select('observation_id, plate_number, is_compliant, breach_type')
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
          s.observationId !== scan.observationId ? s : {
            ...s,
            plateNumber:       data.plate_number ?? null,
            isCompliant:       compliant,
            breachType:        data.breach_type ?? null,
            processingPending: !resolved,
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
            s.observationId !== scan.observationId ? s : { ...s, processingPending: false }
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
  }, [scans.filter(s => s.processingPending).map(s => s.observationId).join(',')])

  // ── Location authorization check ─────────────────────────────────────────
  // Blocks scanning when officer is outside their assigned jurisdiction.
  useEffect(() => {
    if (!user?.organization_id) { setAuthStatus('authorized'); return }

    const PGRST_NOT_FOUND = 'PGRST202'

    const check = async () => {
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })
      // GPS unavailable — don't block the officer
      if (!pos) { setAuthStatus('authorized'); return }

      try {
        const { data, error } = await (supabase as any).rpc('check_location_in_org', {
          org_id: user.organization_id,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        })
        if (error) {
          // Function not deployed or other non-fatal error — don't block
          if (error.code !== PGRST_NOT_FOUND) console.warn('Auth check error:', error.message)
          setAuthStatus('authorized')
          return
        }
        setAuthStatus((data as any)?.inside ? 'authorized' : 'unauthorized')
      } catch {
        setAuthStatus('authorized')
      }
    }

    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [user?.organization_id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Outside authorised jurisdiction ──────────────────────────────────────
  // Instead of a full-screen replacement, we block the camera but keep the
  // rest of the session UI (scan list, stats, finish button) functional.
  const isOutsideJurisdiction = authStatus === 'unauthorized'

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Camera (top 52%) ──────────────────────────────────────── */}
      <div className="relative shrink-0" style={{ height: '52dvh', minHeight: 260 }}>
        <SplitScanCamera
          onCapture={handleCapture}
          onCancel={handleFinish}
          isProcessing={isCapturing}
          isBlocked={isOutsideJurisdiction}
          blockedReason="You are not within your authorised patrol jurisdiction. Move into your assigned patrol area to resume scanning."
        />

        {/* Session stats overlay — top left */}
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-white text-xs font-semibold">
            <Zap className="h-3 w-3 text-yellow-400" />
            <span>Bulk Scan</span>
          </div>
          {isOutsideJurisdiction ? (
            <div className="flex items-center gap-1 rounded-full bg-orange-600/90 px-2.5 py-1 text-white text-xs font-semibold animate-pulse">
              <AlertTriangle className="h-3 w-3" />
              <span>Outside Zone</span>
            </div>
          ) : (
            <>
              {zoneName && (
                <div className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-white text-xs">
                  <MapPin className="h-3 w-3 text-green-300" />
                  <span className="max-w-[90px] truncate">{zoneName}</span>
                </div>
              )}
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
                  <span>Saving…</span>
                </div>
              )}
            </>
          )}
        </div>
        {/* SplitScanCamera's own × button (top-right) handles session end via onCancel */}
      </div>

      {/* ── Out-of-jurisdiction warning strip ─────────────────────── */}
      {isOutsideJurisdiction && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-950 border-b border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-200 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Camera blocked — outside authorised patrol area. You can still review previous scans below.</span>
        </div>
      )}

      {/* ── Session list (bottom 48%) ─────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden border-t border-gray-200 dark:border-gray-800">
        {/* Collapse/expand header */}
        <button
          className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-muted-foreground shrink-0 hover:bg-muted/30"
          onClick={() => setShowList(p => !p)}
        >
          <span>
            {totalScanned === 0
              ? isOutsideJurisdiction ? 'Outside patrol zone — no scanning available' : 'No scans yet — tap the shutter to scan'
              : `${totalScanned} scanned · ${totalCompliant} compliant · ${totalBreaches} breach${totalBreaches !== 1 ? 'es' : ''}`}
            {totalPending > 0 && ` · ${totalPending} processing`}
          </span>
          {showList ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        {showList && (
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
            {scans.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                {isOutsideJurisdiction
                  ? 'Move into your assigned patrol area to start scanning vehicles.'
                  : 'Point the camera at a vehicle and tap the shutter button'}
              </p>
            )}

            {scans.map(scan => {
              const pending = scan.processingPending
              const inBreach = scan.isCompliant === false && !pending
              return (
                <div
                  key={scan.observationId}
                  className={`flex items-center gap-2.5 rounded-lg border p-2 ${
                    inBreach
                      ? 'border-red-200 bg-red-50 dark:bg-red-950/30'
                      : 'border-gray-100 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Thumbnail */}
                  <img
                    src={scan.photoUrl}
                    alt={scan.plateNumber || 'Scan'}
                    className="h-9 w-9 rounded object-cover shrink-0 border"
                  />

                  {/* Plate + status */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {pending ? (
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
