import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { SplitScanCamera } from '@/components/features/SplitScanCamera'
import { LocationAuthorizationStatus } from '@/components/features/LocationAuthorizationStatus'
import { QRCheckpointScanner } from '@/components/features/QRCheckpointScanner'
import { ScanDetailPanel, type DetailScanData } from '@/components/features/ScanDetailPanel'
import { BulkScanSession } from '@/components/features/BulkScanSession'
import { OfficerFollowUpQueue } from '@/components/features/OfficerFollowUpQueue'
import { captureAndSave, SCAN_PROGRESS_LABELS, type ScanProgressStage } from '@/lib/scanPipeline'
import { useManDownDetection } from '@/hooks/useManDownDetection'
import {
  Camera, Map, FileText, History, AlertTriangle, MapPin, QrCode,
  ShieldAlert, CheckCircle, Shield, Megaphone, FileWarning, XCircle,
  Clock, Home, X, Car, Zap, Search, Printer,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKFLOW_LABELS: Record<string, string> = {
  admin_first:    'Admin First',
  officer_direct: 'Officer Direct',
  hybrid:         'Hybrid',
}

/** Converts snake_case breach type keys to human-readable labels. */
const formatBreachType = (bt: string | null | undefined): string => {
  if (!bt) return 'Breach'
  return bt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Duration (ms) the "observation captured" toast stays on screen. */
const CAPTURE_TOAST_DURATION_MS = 5000


export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const { zoneId, zoneName, setZone } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // ── Scan mode: null = portal home, 'detail' = single-vehicle scan,
  //              'bulk' = quick area sweep, 'checkpoint' = QR check-in
  const [scanMode,       setScanMode]       = useState<null | 'detail' | 'bulk'>(null)
  const [showCheckpoint, setShowCheckpoint] = useState(false)

  // Detail scan state — camera + result panel
  const [detailCameraOpen,  setDetailCameraOpen]  = useState(false)
  const [isProcessing,      setIsProcessing]       = useState(false)
  const [scanProgressLabel, setScanProgressLabel]  = useState(SCAN_PROGRESS_LABELS.gps)
  const [detailScanData,    setDetailScanData]     = useState<DetailScanData | null>(null)
  const [showDetailPanel,   setShowDetailPanel]    = useState(false)

  // Admin-assigned follow-up count — used to show badge on the queue card header
  const [followUpCount,     setFollowUpCount]      = useState(0)

  const [currentPatrolZone, setCurrentPatrolZone] = useState<string | null>(zoneId)
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [scanTabFilter, setScanTabFilter] = useState<'all' | 'compliant' | 'breach' | 'at_risk' | 'homeless'>('all')

  // Man-Down Detection — records GPS updates and fires alert if stationary too long
  const { recordGPSUpdate, isManDownActive } = useManDownDetection()

  // Display-friendly zone label for the officer status card
  const displayZone = zoneName || (zoneId ? `${zoneId.substring(0, 8)}...` : 'Scanning Geofence...')

  // ── Fetch org enforcement_workflow ────────────────────────────────────────
  const { data: orgWorkflow } = useQuery({
    queryKey: ['org-workflow', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return 'admin_first'
      const { data, error } = await supabase
        .from('organizations')
        .select('enforcement_workflow')
        .eq('id', user.organization_id)
        .single()
      if (error) return 'admin_first'
      return ((data as any)?.enforcement_workflow as string) || 'admin_first'
    },
    enabled: !!user?.organization_id,
    staleTime: 1000 * 60 * 10,
  })

  // ── Fetch officer's recent observations ───────────────────────────────────
  const { data: recentScans = [], refetch: refetchScans } = useQuery({
    queryKey: ['my-recent-scans', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const historyCutoffIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()

      // Live schema: PK is observation_id, photo cols are photo + photo_url, no processing_status
      const selectCandidates = [
        [
          'observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        // Minimal fallback
        [
          'observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type',
          'zone:zones!zone_id(name)',
        ].join(', '),
      ]

      for (const selectClause of selectCandidates) {
        const { data, error } = await supabase
          .from('observations')
          .select(selectClause)
          .eq('recorded_by', user.id)
          .gte('recorded_at', historyCutoffIso)
          .order('recorded_at', { ascending: false })
          .limit(20)

        if (error) continue

        const rows = (data || []).map((row: any) => ({
          ...row,
          id: row.observation_id ?? row.id,
          // No processing_status in live schema — use plate_number to infer ALPR state
          photo_url: row.photo ?? row.photo_url ?? null,
        }))

        return rows as any[]
      }

      return []
    },
    enabled: !!user?.id,
    refetchInterval: 15000,  // auto-refresh every 15 s so AI results appear
  })

  // ── Enforcement action mutation ────────────────────────────────────────────
  const issueAction = useMutation({
    mutationFn: async ({ observationId, zoneId: obsZoneId, plateNumber, actionType }: {
      observationId: string
      zoneId: string
      plateNumber: string
      actionType: 'warning' | 'notice_to_vacate'
    }) => {
      const { error } = await (supabase
        .from('enforcement_actions') as any)
        .insert({
          organization_id: user?.organization_id,
          created_by: user?.id,
          zone_id: obsZoneId,
          plate_number: plateNumber,
          action_type: actionType,
          observation_id: observationId,
          status: 'pending',
        })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.actionType === 'warning'
          ? '⚠️ Warning issued'
          : '📋 Notice to Vacate issued'
      )
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to issue enforcement action')
    },
  })

  // Auto-monitor geofence and manage patrol
  useEffect(() => {
    if (!user?.id || !user?.organization_id) return

    const checkGeofence = () => {
      monitorGeofenceAndPatrol(
        user.id,
        user.organization_id!,
        currentPatrolZone,
        (newZoneId, newZoneName) => {
          setCurrentPatrolZone(newZoneId)
          setZone(newZoneId, newZoneName)
        }
      )
    }

    // Defer first geofence check by 2 s so the portal finishes rendering before
    // the browser GPS permission prompt appears (avoids a blank-screen flash).
    const initialDelay = setTimeout(() => checkGeofence(), 2000)
    const interval = setInterval(checkGeofence, 30000)
    return () => {
      clearTimeout(initialDelay)
      clearInterval(interval)
    }
  }, [user, currentPatrolZone, setZone])

  // ── Detail scan: capture handler ─────────────────────────────────────────
  const handleDetailCapture = useCallback(async (file: File) => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired — please log out and back in')
      return
    }
    setIsProcessing(true)
    setScanProgressLabel(SCAN_PROGRESS_LABELS.gps)
    try {
      const result = await captureAndSave(
        file,
        { id: user.id, organization_id: user.organization_id, full_name: user.full_name },
        zoneId,
        (lat, lon) => {
          setCurrentLocation({ latitude: lat, longitude: lon })
          recordGPSUpdate(lat, lon)
        },
        (_stage: ScanProgressStage, label: string) => setScanProgressLabel(label),
      )

      toast.success('✅ Observation captured — detecting plate…', {
        duration: CAPTURE_TOAST_DURATION_MS,
      })

      // Open the detail panel — it polls internally for enrichment
      setDetailScanData({
        observationId:       result.observationId,
        photoUrl:            result.photoUrl,
        plateNumber:         null,
        isCompliant:         null,
        isHomelessExempt:    false,
        homelessStatus:      null,
        breachType:          null,
        processingPending:   true,
        zoneName:            zoneName ?? null,
        observationZoneId:   result.zoneId,
        recordedAt:          result.recordedAt,
        vehicleMake:         null,
        vehicleModel:        null,
        vehicleYear:         null,
        vehicleColor:        null,
        vehicleAttributeSources: null,
        isSelfContained:     false,
        selfContainedExpiry: null,
        cscStatus:           null,
        vehicleMoved:        null,
        isNewVehicle:        false,
        officerNotes:        result.weather !== 'Unknown' ? `Weather: ${result.weather}` : null,
        hasDiscrepancies:    false,
        discrepancyFlags:    null,
      })
      setDetailCameraOpen(false)
      setShowDetailPanel(true)
      refetchScans()

    } catch (err: any) {
      toast.error(err.message || 'Scan failed — please try again')
    } finally {
      setIsProcessing(false)
      setScanProgressLabel(SCAN_PROGRESS_LABELS.gps)
    }
  }, [user, zoneId, zoneName, recordGPSUpdate, refetchScans])

  const handleViewHistory = () => {
    if (user?.role === 'officer') {
      const panel = document.getElementById('recent-scans-panel')
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    navigate('/compliance')
  }

  return (
    <AppLayout
      title="Field Officer Portal"
      description={`Welcome, ${user?.full_name || 'Officer'}${followUpCount > 0 ? ` · ${followUpCount} follow-up${followUpCount > 1 ? 's' : ''} assigned` : ''}`}
    >

      {/* ── Man-Down active warning banner ──────────────────────────── */}
      {isManDownActive && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-400 bg-red-50 dark:bg-red-950 p-4">
          <ShieldAlert className="h-6 w-6 text-red-600 shrink-0 animate-pulse" />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">🚨 Man-Down Alert Active</p>
            <p className="text-sm text-red-600 dark:text-red-400">Emergency alert sent to admin. Move or acknowledge to clear.</p>
          </div>
        </div>
      )}

      {/* ── BULK SCAN MODE — full screen ────────────────────────────── */}
      {scanMode === 'bulk' ? (
        <BulkScanSession
          recordGPSUpdate={recordGPSUpdate}
          orgWorkflow={orgWorkflow || 'admin_first'}
          onIssueAction={(p) => issueAction.mutate(p)}
          isIssuingAction={issueAction.isPending}
          onFinish={() => setScanMode(null)}
          onScanSaved={() => { refetchScans() }}
        />

      ) : showCheckpoint ? (
        /* ── CHECKPOINT CHECK-IN ────────────────────────────────────── */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-indigo-600" />
              Checkpoint Check-In
            </CardTitle>
            <CardDescription>Scan QR code or enter code at patrol checkpoint</CardDescription>
          </CardHeader>
          <CardContent>
            <QRCheckpointScanner
              patrolId={currentPatrolZone}
              onVisitRecorded={() => setShowCheckpoint(false)}
            />
            <Button variant="ghost" className="w-full mt-4" onClick={() => setShowCheckpoint(false)}>
              Back to Portal
            </Button>
          </CardContent>
        </Card>

      ) : detailCameraOpen ? (
        /* ── DETAIL SCAN — camera ───────────────────────────────────── */
        <div className="flex flex-col gap-3">
          {isProcessing && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3">
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {scanProgressLabel}
              </span>
            </div>
          )}
          <div
            className="w-full rounded-xl overflow-hidden border border-gray-700 shadow-lg"
            style={{ height: isProcessing ? '65dvh' : '75dvh', minHeight: '300px' }}
          >
            <SplitScanCamera
              onCapture={handleDetailCapture}
              onCancel={() => { setDetailCameraOpen(false); setScanMode(null) }}
              isProcessing={isProcessing}
              statusLabel={scanProgressLabel}
            />
          </div>
        </div>

      ) : (
        /* ── PORTAL HOME ────────────────────────────────────────────── */
        <>
          {/* ── Admin-assigned follow-ups — shown first so officer sees tasks immediately */}
          <OfficerFollowUpQueue
            onCountChange={setFollowUpCount}
            orgWorkflow={orgWorkflow || 'admin_first'}
            onIssueAction={(p) => issueAction.mutate(p)}
            isIssuingAction={issueAction.isPending}
            onActivity={() => recordGPSUpdate(
              currentLocation?.latitude ?? 0,
              currentLocation?.longitude ?? 0,
            )}
          />

          <div className="grid gap-4 grid-cols-2 mb-6">
            {/* ── Detail Scan card ────────────────────────────── */}
            <Card
              className="hover:shadow-lg transition-shadow border-2 border-blue-300 dark:border-blue-800 cursor-pointer"
              onClick={() => {
                if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not available'); return }
                setScanMode('detail')
                setDetailCameraOpen(true)
                setShowDetailPanel(false)
                setDetailScanData(null)
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg shrink-0">
                    <Search className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Detail Scan</CardTitle>
                    <CardDescription className="text-xs leading-snug">
                      One vehicle — full details, notes &amp; actions
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-[11px] text-muted-foreground">
                  Targeted inspection. Edit corrections, add H&amp;S, issue warnings or notices.
                </p>
              </CardContent>
            </Card>

            {/* ── Bulk (Zoom) Scan card ────────────────────────── */}
            <Card
              className="hover:shadow-lg transition-shadow border-2 border-yellow-300 dark:border-yellow-800 cursor-pointer"
              onClick={() => {
                if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not available'); return }
                setScanMode('bulk')
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-lg shrink-0">
                    <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Bulk Scan</CardTitle>
                    <CardDescription className="text-xs leading-snug">
                      Area sweep — multiple vehicles fast
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-[11px] text-muted-foreground">
                  Camera stays open. Scan one after another with live breach tally.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* QR Checkpoint Check-In */}
          <Card className="hover:shadow-lg transition-shadow border-indigo-200 dark:border-indigo-900 border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                  <QrCode className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                Checkpoint
                <Badge variant="outline" className="ml-auto text-xs">Lone Worker</Badge>
              </CardTitle>
              <CardDescription>Scan QR/NFC at patrol checkpoint</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => setShowCheckpoint(true)}>
                Check In at Checkpoint
              </Button>
            </CardContent>
          </Card>

          {/* Secondary Actions */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                  <Map className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                Active Patrol
              </CardTitle>
              <CardDescription>Manage your patrol session</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => toast.info('Patrol tracking active via geofence')}>
                Patrol Status
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                  <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                Create Report
              </CardTitle>
              <CardDescription>Submit incident or H&S</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
                New Report
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                  <History className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                My Scans
              </CardTitle>
              <CardDescription>Recent observations</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={handleViewHistory}>
                {user?.role === 'officer' ? 'View 24h History' : 'View History'}
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                Breach Alerts
              </CardTitle>
              <CardDescription>Active notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/breaches')}>
                View Alerts
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-teal-100 dark:bg-teal-900 rounded-lg">
                  <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                Zones
              </CardTitle>
              <CardDescription>Enforcement zones</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/zones')}>
                View Zones
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow border-red-200 dark:border-red-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                  <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                Infringement Notices
              </CardTitle>
              <CardDescription>Issue fines on-site</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/infringements')}>
                Issue / View Notices
              </Button>
            </CardContent>
          </Card>
        </div>
        </>
      )}

      {/* Location Authorization Status */}
      {scanMode !== 'bulk' && currentLocation && user?.organization_id && (
        <div className="mt-6">
          <LocationAuthorizationStatus
            organizationId={user.organization_id}
            latitude={currentLocation.latitude}
            longitude={currentLocation.longitude}
            refreshInterval={10000}
          />
        </div>
      )}

      {/* Info Card — includes enforcement workflow badge */}
      <Card className="mt-6 bg-slate-50 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-sm">Officer Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Current Zone:</span>
              <span className="font-semibold text-blue-600">{displayZone}</span>
            </div>
            <div className="flex justify-between">
              <span>Organisation:</span>
              <span>{user?.organization_id?.substring(0, 8)}...</span>
            </div>
            <div className="flex justify-between items-center">
              <span>Enforcement Mode:</span>
              <Badge
                variant="outline"
                className={
                  orgWorkflow === 'officer_direct'
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : orgWorkflow === 'hybrid'
                    ? 'border-yellow-500 text-yellow-700 bg-yellow-50'
                    : 'border-blue-400 text-blue-700 bg-blue-50'
                }
              >
                {WORKFLOW_LABELS[orgWorkflow || 'admin_first'] || orgWorkflow}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent Scans with enforcement actions ─────────────────────────── */}
      {scanMode !== 'bulk' && !showCheckpoint && !detailCameraOpen && recentScans.length > 0 && (
        <Card className="mt-6" id="recent-scans-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent Scans
            </CardTitle>
            {user?.role === 'officer' && (
              <div className="inline-flex items-center w-fit rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                Showing last 24 hours only
              </div>
            )}
            <CardDescription className="text-xs">
              {orgWorkflow === 'officer_direct' && 'Officer Direct mode — you can issue warnings and notices on-site.'}
              {orgWorkflow === 'hybrid' && 'Hybrid mode — you can issue warnings on-site; notices require admin approval.'}
              {(!orgWorkflow || orgWorkflow === 'admin_first') && 'Admin First mode — breaches are automatically reported to admin.'}
            </CardDescription>
            {/* Compliance filter tabs */}
            <div className="flex gap-1 flex-wrap mt-2">
              {([
                { key: 'all', label: 'All', icon: null, style: '' },
                { key: 'compliant', label: 'Compliant', icon: CheckCircle, style: 'text-green-700 border-green-400 bg-green-50 dark:bg-green-950/40' },
                { key: 'breach', label: 'Breach', icon: XCircle, style: 'text-red-700 border-red-400 bg-red-50 dark:bg-red-950/40' },
                { key: 'at_risk', label: 'At Risk', icon: AlertTriangle, style: 'text-yellow-700 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/40' },
                { key: 'homeless', label: 'Homeless/Exempt', icon: Home, style: 'text-purple-700 border-purple-400 bg-purple-50 dark:bg-purple-950/40' },
              ] as const).map(({ key, label, icon: Icon, style }) => (
                <button
                  key={key}
                  onClick={() => setScanTabFilter(key)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    scanTabFilter === key
                      ? style || 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
                  }`}
                >
                  {Icon && <Icon className="h-2.5 w-2.5" />}
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {recentScans.filter((scan: any) => {
              if (scanTabFilter === 'all') return true
              const isProcessingAI = scan.plate_number === 'PROCESSING...' || scan.plate_number === 'MANUAL_REQUIRED'
              if (scanTabFilter === 'compliant') return scan.is_compliant === true && !isProcessingAI
              if (scanTabFilter === 'breach') return scan.is_compliant === false && !isProcessingAI
              if (scanTabFilter === 'at_risk') return isProcessingAI || (scan.is_compliant && (scan.consecutive_nights ?? 0) >= 2)
              if (scanTabFilter === 'homeless') {
                const vehicle = scan.vehicle as any
                const homelessStatus = vehicle?.homeless_status
                const isExempt = Boolean(vehicle?.is_exempt)
                return homelessStatus === 'confirmed' || homelessStatus === 'claimed' || isExempt
              }
              return true
            }).map((scan: any) => {
              const isProcessingAI = scan.plate_number === 'PROCESSING...' || scan.plate_number === 'MANUAL_REQUIRED'
              const inBreach = scan.is_compliant === false && !isProcessingAI
              return (
                <div
                  key={scan.id}
                  className={`flex items-center gap-3 rounded-lg border p-2.5 ${
                    inBreach ? 'border-red-200 bg-red-50 dark:bg-red-950/30' : 'border-gray-100 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Thumbnail */}
                  {scan.photo_url ? (
                    <img
                      src={scan.photo_url}
                      alt={scan.plate_number}
                      className="h-10 w-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center shrink-0">
                      <Camera className="h-5 w-5 text-gray-400" />
                    </div>
                  )}

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-bold text-sm">
                        {isProcessingAI ? '⏳ Scanning...' : (scan.plate_number || '—')}
                      </span>
                      {!isProcessingAI && scan.is_compliant !== null && (
                        <Badge
                          variant={scan.is_compliant ? 'default' : 'destructive'}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {scan.is_compliant ? 'Compliant' : 'Breach'}
                        </Badge>
                      )}
                      {!isProcessingAI && scan.is_compliant === null && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Pending
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {scan.zone?.name} · {formatDateTime(scan.recorded_at)}
                    </div>
                  </div>

                  {/* Enforcement action buttons — only shown for breach + AI complete */}
                  {inBreach && (
                    <div className="flex gap-1 shrink-0">
                      {/* Warning: shown for officer_direct AND hybrid */}
                      {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px] border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                          disabled={issueAction.isPending}
                          onClick={() =>
                            issueAction.mutate({
                              observationId: scan.id,
                              zoneId: scan.zone_id || '',
                              plateNumber: scan.plate_number,
                              actionType: 'warning',
                            })
                          }
                        >
                          <FileWarning className="h-3 w-3 mr-1" />
                          Warning
                        </Button>
                      )}

                      {/* Notice to Vacate: officer_direct only */}
                      {orgWorkflow === 'officer_direct' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px] border-red-400 text-red-700 hover:bg-red-50"
                          disabled={issueAction.isPending}
                          onClick={() =>
                            issueAction.mutate({
                              observationId: scan.id,
                              zoneId: scan.zone_id || '',
                              plateNumber: scan.plate_number,
                              actionType: 'notice_to_vacate',
                            })
                          }
                        >
                          <Megaphone className="h-3 w-3 mr-1" />
                          Notice
                        </Button>
                      )}

                      {/* Admin First: read-only badge */}
                      {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                        <Badge variant="secondary" className="text-[10px]">
                          <Shield className="h-2.5 w-2.5 mr-1" />
                          Reported
                        </Badge>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => navigate(`/infringements?observation_id=${encodeURIComponent(scan.id)}`)}
                      >
                        <Printer className="h-3 w-3 mr-1" />
                        Ticket
                      </Button>
                    </div>
                  )}

                  {/* Compliant: green tick */}
                  {!inBreach && !isProcessingAI && (
                    <div className="flex items-center gap-1 shrink-0">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => navigate(`/infringements?observation_id=${encodeURIComponent(scan.id)}`)}
                      >
                        <Printer className="h-3 w-3 mr-1" />
                        Ticket
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}



      {/* ── Detail Scan result panel (bottom Sheet) ──────────────────── */}
      <ScanDetailPanel
        open={showDetailPanel}
        onClose={() => {
          setShowDetailPanel(false)
          setScanMode(null)
        }}
        initialData={detailScanData}
        orgWorkflow={orgWorkflow || 'admin_first'}
        onIssueAction={(p) => issueAction.mutate(p)}
        isIssuingAction={issueAction.isPending}
        onActivity={() => recordGPSUpdate(
          currentLocation?.latitude ?? 0,
          currentLocation?.longitude ?? 0,
        )}
      />
    </AppLayout>
  )
}
