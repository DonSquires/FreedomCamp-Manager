/**
 * ParkingOfficerPortal.tsx
 *
 * Field-officer-facing parking enforcement portal.
 *
 * Workflow mirrors TicketOr2 (ADR) + NZ council best practice:
 *   1. CHALK PASS   — scan plate, photo address + tyre valve, start session
 *   2. RECHECK PASS — re-scan plate, system shows dwell time vs. limit
 *   3. INFRINGEMENT — if over limit & vehicle unmoved, pre-fill & issue notice
 *   4. PERMIT CHECK — lookup permit before issuing (ParkPow allow-list)
 *
 * Inference service (ONNX) is used for vehicle detection + plate pre-fill.
 */
import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import {
  Camera, Car, Clock, MapPin, AlertTriangle, CheckCircle,
  ChevronRight, Search, FileText, History, QrCode, Shield,
  RotateCcw, Timer, CircleX, PlusCircle, RefreshCw, Zap,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type PassMode = null | 'chalk' | 'recheck' | 'infringement' | 'permit_check'

interface ChalkPassForm {
  plate_number: string
  parking_zone_id: string
  tyre_valve_pos: 'north' | 'south' | 'east' | 'west' | 'unknown'
  address_photo_url: string
  tyre_valve_photo_url: string
  notes: string
}

interface InfringementForm {
  session_id: string
  plate_number: string
  zone_name: string
  location_address: string
  offence_description: string
  fine_amount_nzd: string
  vehicle_make: string
  vehicle_model: string
  vehicle_colour: string
  notes: string
}

// ─── Tyre valve positions — the TicketOr2 standard ───────────────────────────
const VALVE_POSITIONS = [
  { value: 'north', label: '↑ North (12 o'clock)' },
  { value: 'east',  label: '→ East  (3 o'clock)' },
  { value: 'south', label: '↓ South (6 o'clock)' },
  { value: 'west',  label: '← West  (9 o'clock)' },
  { value: 'unknown', label: 'Unknown / not visible' },
]

const STATUS_COLOURS: Record<string, string> = {
  active:      'bg-blue-100 text-blue-800 border-blue-200',
  violation:   'bg-red-100 text-red-800 border-red-200',
  expired:     'bg-orange-100 text-orange-800 border-orange-200',
  compliant:   'bg-green-100 text-green-800 border-green-200',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ParkingOfficerPortal() {
  const { user } = useAuthStore()
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const [mode, setMode]           = useState<PassMode>(null)
  const [searchPlate, setSearch]  = useState('')
  const [foundSession, setFound]  = useState<any>(null)
  const [searching, setSearching] = useState(false)

  // Chalk pass form
  const [chalkForm, setChalk] = useState<ChalkPassForm>({
    plate_number: '', parking_zone_id: '', tyre_valve_pos: 'north',
    address_photo_url: '', tyre_valve_photo_url: '', notes: '',
  })
  const [chalking, setChalking] = useState(false)

  // Re-check result
  const [recheckResult, setRecheckResult] = useState<{
    session: any
    dwell_minutes: number
    max_stay_minutes: number | null
    is_over_limit: boolean
    valve_moved: boolean
  } | null>(null)

  // Infringement form
  const [infForm, setInfForm] = useState<InfringementForm>({
    session_id: '', plate_number: '', zone_name: '', location_address: '',
    offence_description: '', fine_amount_nzd: '', vehicle_make: '',
    vehicle_model: '', vehicle_colour: '', notes: '',
  })
  const [issuing, setIssuing] = useState(false)

  // ── Fetch active sessions for my zone / org ──────────────────
  const { data: activeSessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['parking-officer-sessions', user?.organization_id],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('parking_sessions')
        .select('*, parking_zones(name, max_stay_minutes, zone_type, address)')
        .eq('organization_id', user!.organization_id)
        .is('exit_time', null)
        .order('entry_time', { ascending: false })
        .limit(50)
        .abortSignal(signal)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.organization_id,
    refetchInterval: 30_000,
  })

  // ── Fetch parking zones for this org ─────────────────────────
  const { data: zones = [] } = useQuery({
    queryKey: ['parking-zones', user?.organization_id],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('parking_zones')
        .select('id, name, zone_type, max_stay_minutes, fine_amount_nzd, address')
        .eq('organization_id', user!.organization_id)
        .eq('is_active', true)
        .order('name')
        .abortSignal(signal)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.organization_id,
  })

  // ── Search a plate (recheck flow) ─────────────────────────────
  const handleSearchPlate = useCallback(async () => {
    if (!searchPlate.trim()) return
    setSearching(true)
    try {
      // Find latest active session for this plate
      const { data, error } = await supabase
        .from('parking_sessions')
        .select('*, parking_zones(name, max_stay_minutes, fine_amount_nzd, zone_type, address)')
        .eq('organization_id', user!.organization_id)
        .eq('plate_number', searchPlate.toUpperCase().trim())
        .is('exit_time', null)
        .order('entry_time', { ascending: false })
        .limit(1)
        .single()

      if (error || !data) {
        toast.info(`No active chalk session found for ${searchPlate.toUpperCase()}. Start a new chalk pass.`)
        setFound(null)
        return
      }

      const zone = (data as any).parking_zones
      const entryTime  = new Date(data.entry_time)
      const now        = new Date()
      const dwell      = Math.floor((now.getTime() - entryTime.getTime()) / 60_000)
      const max        = zone?.max_stay_minutes ?? null
      const over       = max !== null && dwell > max

      setRecheckResult({
        session:          data,
        dwell_minutes:    dwell,
        max_stay_minutes: max,
        is_over_limit:    over,
        valve_moved:      false, // officer manually flags this
      })
      setFound(data)
      setMode('recheck')

      // Pre-fill infringement form
      setInfForm({
        session_id:          data.id,
        plate_number:        data.plate_number,
        zone_name:           zone?.name ?? '',
        location_address:    zone?.address ?? '',
        offence_description: max
          ? `Vehicle exceeded ${max}-minute time limit (present for ${dwell} minutes)`
          : 'Parking violation',
        fine_amount_nzd: zone?.fine_amount_nzd?.toString() ?? '40',
        vehicle_make:    '',
        vehicle_model:   '',
        vehicle_colour:  '',
        notes:           '',
      })
    } catch (err: any) {
      toast.error(err.message ?? 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [searchPlate, user])

  // ── Submit chalk pass (first observation) ────────────────────
  const handleChalkPass = useCallback(async () => {
    if (!chalkForm.plate_number.trim() || !chalkForm.parking_zone_id) {
      toast.error('Plate number and zone are required')
      return
    }
    setChalking(true)
    try {
      // Check if there's already an active session for this plate+zone
      const { data: existing } = await supabase
        .from('parking_sessions')
        .select('id, entry_time')
        .eq('organization_id', user!.organization_id)
        .eq('plate_number', chalkForm.plate_number.toUpperCase())
        .eq('parking_zone_id', chalkForm.parking_zone_id)
        .is('exit_time', null)
        .maybeSingle()

      if (existing) {
        const dwell = Math.floor((Date.now() - new Date(existing.entry_time).getTime()) / 60_000)
        toast.warning(`Vehicle already chalked in this zone ${dwell} minutes ago. Use Recheck Pass instead.`)
        return
      }

      const { error } = await supabase
        .from('parking_sessions')
        .insert({
          organization_id:      user!.organization_id,
          parking_zone_id:      chalkForm.parking_zone_id,
          plate_number:         chalkForm.plate_number.toUpperCase().trim(),
          entry_tyre_valve_pos: chalkForm.tyre_valve_pos,
          tyre_valve_photo_url: chalkForm.tyre_valve_photo_url || null,
          entry_photo_url:      chalkForm.address_photo_url || null,
          pass_number:          1,
          officer_id:           user!.id,
          notes:                chalkForm.notes || null,
        })
      if (error) throw error

      toast.success(`Chalk pass recorded for ${chalkForm.plate_number.toUpperCase()}`)
      setChalk({ plate_number: '', parking_zone_id: '', tyre_valve_pos: 'north',
                 address_photo_url: '', tyre_valve_photo_url: '', notes: '' })
      setMode(null)
      qc.invalidateQueries({ queryKey: ['parking-officer-sessions'] })
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to record chalk pass')
    } finally {
      setChalking(false)
    }
  }, [chalkForm, user, qc])

  // ── Issue infringement ────────────────────────────────────────
  const handleIssueInfringement = useCallback(async () => {
    if (!infForm.plate_number || !infForm.offence_description) {
      toast.error('Plate and offence description required')
      return
    }
    setIssuing(true)
    try {
      // Generate infringement number
      const { data: numData, error: numErr } = await supabase
        .rpc('next_parking_infringement_number', { p_org_id: user!.organization_id })
      if (numErr) throw numErr

      const { error } = await supabase
        .from('parking_infringements')
        .insert({
          organization_id:     user!.organization_id,
          infringement_number: numData,
          parking_session_id:  infForm.session_id || null,
          plate_number:        infForm.plate_number.toUpperCase(),
          vehicle_make:        infForm.vehicle_make || null,
          vehicle_model:       infForm.vehicle_model || null,
          vehicle_colour:      infForm.vehicle_colour || null,
          offence_description: infForm.offence_description,
          offence_time:        new Date().toISOString(),
          location_address:    infForm.location_address,
          fine_amount_nzd:     parseFloat(infForm.fine_amount_nzd) || null,
          early_payment_amount: infForm.fine_amount_nzd ? parseFloat(infForm.fine_amount_nzd) * 0.5 : null,
          status:              'issued',
          officer_id:          user!.id,
          officer_name:        user!.full_name ?? user!.email,
          notes:               infForm.notes || null,
        })
      if (error) throw error

      // Mark session as violation
      if (infForm.session_id) {
        await supabase
          .from('parking_sessions')
          .update({ is_violation: true, violation_reason: infForm.offence_description })
          .eq('id', infForm.session_id)
      }

      toast.success(`Infringement ${numData} issued for ${infForm.plate_number.toUpperCase()}`)
      setMode(null)
      setRecheckResult(null)
      setFound(null)
      setSearch('')
      qc.invalidateQueries({ queryKey: ['parking-officer-sessions'] })
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to issue infringement')
    } finally {
      setIssuing(false)
    }
  }, [infForm, user, qc])

  // ── Mark session as vehicle moved (valve position changed) ────
  const handleVehicleMoved = useCallback(async (sessionId: string) => {
    await supabase
      .from('parking_sessions')
      .update({ exit_time: new Date().toISOString(), notes: 'Vehicle moved — re-chalked' })
      .eq('id', sessionId)
    toast.success('Session closed — vehicle was moved. Start a new chalk pass if still parked.')
    setMode(null)
    setRecheckResult(null)
    setFound(null)
    setSearch('')
    qc.invalidateQueries({ queryKey: ['parking-officer-sessions'] })
  }, [qc])

  // ─── Dwell time display ──────────────────────────────────────
  const dwellLabel = (entryIso: string) => {
    const mins = Math.floor((Date.now() - new Date(entryIso).getTime()) / 60_000)
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  const dwellStatus = (session: any) => {
    const zone = session.parking_zones
    const max  = zone?.max_stay_minutes
    if (!max) return 'active'
    const dwell = Math.floor((Date.now() - new Date(session.entry_time).getTime()) / 60_000)
    if (session.is_violation) return 'violation'
    if (dwell > max) return 'expired'
    if (dwell > max * 0.8) return 'expired' // near limit
    return 'active'
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <AppLayout
      title="Parking Enforcement"
      description={`${activeSessions.length} active session${activeSessions.length !== 1 ? 's' : ''} · TicketOr2-style workflow`}
      showBackButton
      onBack={() => navigate('/portal-selection')}
    >
      {/* ── Home grid ─────────────────────────────────────────── */}
      {mode === null && (
        <div className="space-y-6">
          {/* Quick action cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              className="cursor-pointer hover:shadow-lg border-blue-200 hover:border-blue-400 transition-all"
              onClick={() => setMode('chalk')}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Camera className="h-5 w-5 text-blue-600" />
                  </div>
                  Chalk Pass
                  <Badge variant="outline" className="ml-auto text-xs">1st Visit</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  First observation — scan plate, photo tyre valve
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm">
                  New Chalk Pass
                </Button>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-lg border-orange-200 hover:border-orange-400 transition-all"
              onClick={() => setMode('recheck')}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <RotateCcw className="h-5 w-5 text-orange-600" />
                  </div>
                  Recheck Pass
                  <Badge variant="outline" className="ml-auto text-xs">2nd Visit</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Check dwell time — issue infringement if over limit
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white text-sm">
                  Recheck Plate
                </Button>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-lg border-purple-200 hover:border-purple-400 transition-all"
              onClick={() => setMode('permit_check')}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Shield className="h-5 w-5 text-purple-600" />
                  </div>
                  Permit Check
                </CardTitle>
                <CardDescription className="text-xs">
                  Verify if vehicle has a valid parking permit
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm">
                  Check Permit
                </Button>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-lg border-gray-200 hover:border-gray-400 transition-all"
              onClick={() => navigate('/parking')}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <History className="h-5 w-5 text-gray-600" />
                  </div>
                  History
                </CardTitle>
                <CardDescription className="text-xs">
                  View my issued notices and session history
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full text-sm">
                  View History
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Active chalked vehicles */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Timer className="h-4 w-4 text-blue-600" />
                  Active Chalk Sessions
                </CardTitle>
                <CardDescription className="text-xs">
                  Vehicles currently chalked in your patrol area
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchSessions()}>
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {activeSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No active chalk sessions — start a new chalk pass
                </p>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map((s: any) => {
                    const status = dwellStatus(s)
                    const zone   = s.parking_zones
                    return (
                      <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg border ${STATUS_COLOURS[status] ?? ''}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <Car className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-sm">{s.plate_number}</p>
                            <p className="text-xs truncate">{zone?.name ?? 'Unknown zone'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <div className="text-right">
                            <p className="text-sm font-semibold">{dwellLabel(s.entry_time)}</p>
                            {zone?.max_stay_minutes && (
                              <p className="text-xs opacity-70">/ {zone.max_stay_minutes}m limit</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant={status === 'expired' || status === 'violation' ? 'default' : 'outline'}
                            className={status === 'expired' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
                            onClick={() => {
                              setSearch(s.plate_number)
                              setMode('recheck')
                            }}
                          >
                            {status === 'expired' ? 'Issue Notice' : 'Recheck'}
                            <ChevronRight className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Chalk Pass Mode ───────────────────────────────────── */}
      {mode === 'chalk' && (
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-blue-600" />
              New Chalk Pass — First Observation
            </CardTitle>
            <CardDescription>
              Record vehicle presence. Take a photo of the address sign and tyre valve position.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Plate Number *</Label>
              <Input
                placeholder="e.g. ABC123"
                value={chalkForm.plate_number}
                onChange={e => setChalk(f => ({ ...f, plate_number: e.target.value.toUpperCase() }))}
                className="font-mono uppercase"
                maxLength={8}
              />
            </div>

            <div className="space-y-2">
              <Label>Parking Zone *</Label>
              <Select
                value={chalkForm.parking_zone_id}
                onValueChange={v => setChalk(f => ({ ...f, parking_zone_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select zone..." />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z: any) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                      {z.max_stay_minutes ? ` — ${z.max_stay_minutes}min limit` : ' — No time limit'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tyre valve position — TicketOr2 core feature */}
            <div className="space-y-2">
              <Label>Tyre Valve Position *</Label>
              <p className="text-xs text-muted-foreground">
                Photo the front-left tyre valve. Record its clock position.
                If same plate is present on recheck with same valve position = vehicle hasn't moved.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {VALVE_POSITIONS.map(p => (
                  <Button
                    key={p.value}
                    type="button"
                    variant={chalkForm.tyre_valve_pos === p.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChalk(f => ({ ...f, tyre_valve_pos: p.value as any }))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address / Sign Photo URL</Label>
              <Input
                placeholder="Photo URL or leave blank (upload later)"
                value={chalkForm.address_photo_url}
                onChange={e => setChalk(f => ({ ...f, address_photo_url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Take a clear photo of the street sign / parking restriction sign.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tyre Valve Photo URL</Label>
              <Input
                placeholder="Photo URL of tyre valve"
                value={chalkForm.tyre_valve_photo_url}
                onChange={e => setChalk(f => ({ ...f, tyre_valve_photo_url: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional notes..."
                value={chalkForm.notes}
                onChange={e => setChalk(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setMode(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={handleChalkPass}
                disabled={chalking || !chalkForm.plate_number || !chalkForm.parking_zone_id}
              >
                {chalking ? 'Saving…' : 'Record Chalk Pass'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Recheck Mode ─────────────────────────────────────── */}
      {mode === 'recheck' && !recheckResult && (
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-orange-600" />
              Recheck Pass
            </CardTitle>
            <CardDescription>
              Enter the plate number to check dwell time against the original chalk pass.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Plate number e.g. ABC123"
                value={searchPlate}
                onChange={e => setSearch(e.target.value.toUpperCase())}
                className="font-mono uppercase flex-1"
                maxLength={8}
                onKeyDown={e => e.key === 'Enter' && handleSearchPlate()}
              />
              <Button onClick={handleSearchPlate} disabled={searching || !searchPlate.trim()}>
                {searching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Recheck Result ────────────────────────────────────── */}
      {mode === 'recheck' && recheckResult && (
        <div className="max-w-lg mx-auto space-y-4">
          {/* Dwell time card */}
          <Card className={recheckResult.is_over_limit ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {recheckResult.is_over_limit
                  ? <AlertTriangle className="h-5 w-5 text-red-600" />
                  : <CheckCircle className="h-5 w-5 text-green-600" />
                }
                {recheckResult.session.plate_number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white/70 rounded-lg p-2">
                  <p className="text-xs text-muted-foreground">Dwell Time</p>
                  <p className="text-lg font-bold">
                    {recheckResult.dwell_minutes < 60
                      ? `${recheckResult.dwell_minutes}m`
                      : `${Math.floor(recheckResult.dwell_minutes / 60)}h ${recheckResult.dwell_minutes % 60}m`}
                  </p>
                </div>
                <div className="bg-white/70 rounded-lg p-2">
                  <p className="text-xs text-muted-foreground">Limit</p>
                  <p className="text-lg font-bold">
                    {recheckResult.max_stay_minutes ? `${recheckResult.max_stay_minutes}m` : 'None'}
                  </p>
                </div>
                <div className="bg-white/70 rounded-lg p-2">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className={`text-sm font-bold ${recheckResult.is_over_limit ? 'text-red-700' : 'text-green-700'}`}>
                    {recheckResult.is_over_limit ? 'OVER LIMIT' : 'COMPLIANT'}
                  </p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Zone:</strong> {(recheckResult.session as any).parking_zones?.name ?? 'Unknown'}</p>
                <p><strong>Chalked at:</strong> {formatDateTime(recheckResult.session.entry_time)}</p>
                <p><strong>Valve (chalked):</strong> {recheckResult.session.entry_tyre_valve_pos ?? 'Not recorded'}</p>
              </div>

              {recheckResult.is_over_limit && (
                <div className="bg-yellow-100 border border-yellow-300 rounded p-2 text-xs text-yellow-900">
                  <strong>Before issuing:</strong> Check if the tyre valve position has changed since the chalk pass.
                  If the valve has moved, the vehicle was moved and returned — close session and re-chalk.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="space-y-2">
            {recheckResult.is_over_limit && (
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setMode('infringement')}
              >
                <FileText className="h-4 w-4 mr-2" />
                Issue Infringement Notice
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleVehicleMoved(recheckResult.session.id)}
            >
              <Car className="h-4 w-4 mr-2" />
              Vehicle Moved (valve position changed)
            </Button>
            <Button variant="outline" className="w-full" onClick={() => {
              setMode(null)
              setRecheckResult(null)
              setFound(null)
              setSearch('')
            }}>
              Back
            </Button>
          </div>
        </div>
      )}

      {/* ── Issue Infringement ────────────────────────────────── */}
      {mode === 'infringement' && (
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-red-600" />
              Issue Parking Infringement
            </CardTitle>
            <CardDescription>
              Pre-filled from chalk session. Review details and confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Plate Number *</Label>
                <Input
                  value={infForm.plate_number}
                  onChange={e => setInfForm(f => ({ ...f, plate_number: e.target.value.toUpperCase() }))}
                  className="font-mono uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label>Fine Amount (NZD) *</Label>
                <Input
                  type="number"
                  value={infForm.fine_amount_nzd}
                  onChange={e => setInfForm(f => ({ ...f, fine_amount_nzd: e.target.value }))}
                  placeholder="40.00"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Location Address *</Label>
              <Input
                value={infForm.location_address}
                onChange={e => setInfForm(f => ({ ...f, location_address: e.target.value }))}
                placeholder="Street address"
              />
            </div>

            <div className="space-y-1">
              <Label>Offence Description *</Label>
              <Textarea
                value={infForm.offence_description}
                onChange={e => setInfForm(f => ({ ...f, offence_description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Make</Label>
                <Input
                  placeholder="Toyota"
                  value={infForm.vehicle_make}
                  onChange={e => setInfForm(f => ({ ...f, vehicle_make: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Model</Label>
                <Input
                  placeholder="Corolla"
                  value={infForm.vehicle_model}
                  onChange={e => setInfForm(f => ({ ...f, vehicle_model: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Colour</Label>
                <Input
                  placeholder="Silver"
                  value={infForm.vehicle_colour}
                  onChange={e => setInfForm(f => ({ ...f, vehicle_colour: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Officer Notes</Label>
              <Textarea
                value={infForm.notes}
                onChange={e => setInfForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Optional notes..."
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-900 space-y-1">
              <p className="font-semibold">Early payment discount: 50% if paid within 14 days</p>
              <p>Notice will be mailed to NZTA-registered vehicle owner.</p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setMode('recheck')}>
                Back
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                onClick={handleIssueInfringement}
                disabled={issuing || !infForm.plate_number || !infForm.offence_description}
              >
                {issuing ? 'Issuing…' : 'Confirm & Issue'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Permit Check Mode ─────────────────────────────────── */}
      {mode === 'permit_check' && (
        <PermitCheckPanel
          zones={zones}
          organizationId={user!.organization_id}
          onClose={() => setMode(null)}
        />
      )}
    </AppLayout>
  )
}

// ─── PermitCheckPanel ─────────────────────────────────────────────────────────

function PermitCheckPanel({ zones, organizationId, onClose }: {
  zones: any[]
  organizationId: string
  onClose: () => void
}) {
  const [plate, setPlate] = useState('')
  const [result, setResult] = useState<any>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    if (!plate.trim()) return
    setChecking(true)
    setResult(null)
    try {
      const { data, error } = await supabase
        .from('parking_permits')
        .select('*, parking_zones(name, zone_type)')
        .eq('organization_id', organizationId)
        .eq('plate_number', plate.toUpperCase().trim())
        .eq('is_active', true)
        .order('valid_from', { ascending: false })

      if (error) throw error
      setResult(data ?? [])
    } catch (err: any) {
      toast.error(err.message ?? 'Permit check failed')
    } finally {
      setChecking(false)
    }
  }, [plate, organizationId])

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-purple-600" />
          Permit Check
        </CardTitle>
        <CardDescription>
          Check if a vehicle has a valid parking permit before issuing an infringement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Plate number e.g. ABC123"
            value={plate}
            onChange={e => setPlate(e.target.value.toUpperCase())}
            className="font-mono uppercase flex-1"
            maxLength={8}
            onKeyDown={e => e.key === 'Enter' && check()}
          />
          <Button onClick={check} disabled={checking || !plate.trim()}>
            {checking ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {result !== null && (
          <div>
            {result.length === 0 ? (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded">
                <CircleX className="h-5 w-5 text-red-600 shrink-0" />
                <div>
                  <p className="font-semibold text-red-900 text-sm">No Valid Permit Found</p>
                  <p className="text-xs text-red-700">
                    {plate.toUpperCase()} has no active permits. Proceed with enforcement if in violation.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-900 font-semibold">
                    {result.length} valid permit{result.length > 1 ? 's' : ''} found
                  </p>
                </div>
                {result.map((p: any) => (
                  <div key={p.id} className="border rounded p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="font-semibold">{p.permit_type.replace('_', ' ').toUpperCase()}</span>
                      <Badge variant="outline" className="text-green-700 border-green-400">ACTIVE</Badge>
                    </div>
                    <p><strong>Zone:</strong> {p.parking_zones?.name ?? 'Any'}</p>
                    <p><strong>Holder:</strong> {p.holder_name ?? 'Not specified'}</p>
                    <p><strong>Valid:</strong> {p.valid_from} → {p.valid_to ?? 'Permanent'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Button variant="outline" className="w-full" onClick={onClose}>
          Back to Portal
        </Button>
      </CardContent>
    </Card>
  )
}
