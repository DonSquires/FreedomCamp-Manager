/**
 * ParkingEnforcementPortal.tsx
 *
 * Admin-facing parking enforcement management portal.
 *
 * Covers the full TicketOr2 / NZ council parking lifecycle:
 *   Sessions      — live ANPR/officer-chalked vehicles per zone
 *   Infringements — issued notices, appeals, payment tracking
 *   Permits       — virtual permit management
 *   Zones         — parking zone config (time limits, fine amounts)
 *   Analytics     — occupancy, revenue, repeat offenders
 *   ParkPow Sync  — watchlist, lots, violations sync
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { formatDateTime, formatDate } from '@/lib/utils'
import {
  Car, Clock, AlertTriangle, CheckCircle, MapPin, BarChart3,
  RefreshCw, PlusCircle, Shield, DollarSign, Zap, Filter,
  FileText, Edit, Ban, CircleCheck, RotateCcw, TrendingUp,
  Users, Timer, Printer,
} from 'lucide-react'

// ─── Status helpers ───────────────────────────────────────────────────────────

const INF_STATUS: Record<string, { label: string; colour: string }> = {
  issued:          { label: 'Issued',          colour: 'bg-blue-100 text-blue-800 border-blue-200' },
  reminder_sent:   { label: 'Reminder Sent',   colour: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  paid:            { label: 'Paid',             colour: 'bg-green-100 text-green-800 border-green-200' },
  disputed:        { label: 'Disputed',         colour: 'bg-orange-100 text-orange-800 border-orange-200' },
  withdrawn:       { label: 'Withdrawn',        colour: 'bg-gray-100 text-gray-600 border-gray-200' },
  court_referred:  { label: 'Court Referred',  colour: 'bg-red-100 text-red-800 border-red-200' },
  written_off:     { label: 'Written Off',     colour: 'bg-gray-100 text-gray-500 border-gray-200' },
}

const ZONE_TYPE_LABELS: Record<string, string> = {
  time_limited:   'Time Limited',
  permit_only:    'Permit Only',
  pay_and_display:'Pay & Display',
  no_parking:     'No Parking',
  disabled_only:  'Disabled Only',
  loading_zone:   'Loading Zone',
  mixed:          'Mixed',
}

// ─── Printable receipt HTML generator ────────────────────────────────────────

function generateParkingNoticeHtml(inf: any): string {
  const earlyAmt   = inf.early_payment_amount ? `NZD $${Number(inf.early_payment_amount).toFixed(2)}` : null
  const fineAmt    = inf.fine_amount_nzd     ? `NZD $${Number(inf.fine_amount_nzd).toFixed(2)}`     : 'As Prescribed'
  const dueDate    = inf.due_date
    ? new Date(inf.due_date).toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric' })
    : '28 days from date of issue'
  const issuedAt   = inf.issued_at
    ? new Date(inf.issued_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Parking Infringement ${inf.infringement_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 20mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 16px; }
  .title { font-size: 20pt; font-weight: bold; color: #1e3a5f; }
  .notice-num { font-size: 13pt; font-weight: bold; color: #1e3a5f; text-align: right; }
  .section { margin-bottom: 14px; }
  .section-title { font-weight: bold; font-size: 10pt; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 2px; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .field label { font-size: 9pt; color: #666; display: block; }
  .field p { font-weight: bold; }
  .plate { font-family: monospace; font-size: 18pt; font-weight: bold; letter-spacing: 2px; background: #f0f0f0; padding: 6px 14px; border-radius: 4px; display: inline-block; border: 2px solid #ccc; }
  .fine-box { background: #fff3cd; border: 2px solid #ffc107; border-radius: 6px; padding: 12px; margin-top: 8px; }
  .fine-box .amount { font-size: 22pt; font-weight: bold; color: #c00; }
  .early { color: #2a6; font-size: 10pt; margin-top: 4px; }
  .offence-box { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px; }
  .rights { font-size: 9pt; color: #444; border-top: 1px solid #ccc; padding-top: 10px; margin-top: 14px; }
  @media print { body { padding: 10mm; } }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="title">PARKING INFRINGEMENT NOTICE</div>
    <div style="font-size:9pt;color:#666;margin-top:4px;">Issued under the Land Transport (Road User) Rule 2004</div>
  </div>
  <div class="notice-num">
    Notice No.<br/>${inf.infringement_number}
  </div>
</div>

<div class="section">
  <div class="section-title">Vehicle</div>
  <div class="grid">
    <div class="field">
      <label>Plate Number</label>
      <div class="plate">${inf.plate_number}</div>
    </div>
    <div class="field">
      <label>Make / Model / Colour</label>
      <p>${[inf.vehicle_make, inf.vehicle_model, inf.vehicle_colour].filter(Boolean).join(' ') || '—'}</p>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Offence</div>
  <div class="grid">
    <div class="field">
      <label>Date &amp; Time of Offence</label>
      <p>${issuedAt}</p>
    </div>
    <div class="field">
      <label>Location</label>
      <p>${inf.location_address || '—'}</p>
    </div>
  </div>
  <div class="offence-box" style="margin-top:8px;">
    <strong>Offence Description:</strong><br/>${inf.offence_description || '—'}
  </div>
</div>

<div class="section">
  <div class="section-title">Fine</div>
  <div class="fine-box">
    <div class="amount">${fineAmt}</div>
    ${earlyAmt ? `<div class="early">⚡ Pay <strong>${earlyAmt}</strong> within 14 days for 50% early payment discount</div>` : ''}
    <div style="margin-top:6px;font-size:9pt;">Payment due by: <strong>${dueDate}</strong></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Issuing Officer</div>
  <div class="grid">
    <div class="field"><label>Officer</label><p>${inf.officer_name || '—'}</p></div>
    <div class="field"><label>Notice Status</label><p>${inf.status ? inf.status.replace(/_/g, ' ').toUpperCase() : 'ISSUED'}</p></div>
  </div>
</div>

<div class="rights">
  <strong>Your rights:</strong> You have the right to request a review of this infringement notice. Contact the issuing authority within 28 days of the date of issue.
  Payment does not constitute an admission of liability. If you wish to dispute this notice, contact us in writing before the due date.
</div>

</body>
</html>`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingEnforcementPortal() {
  const { user }  = useAuthStore()
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const [activeTab, setActiveTab] = useState('sessions')
  const [statusFilter, setStatusFilter]   = useState<string>('all')
  const [searchPlate, setSearchPlate]     = useState('')
  const [syncing, setSyncing]             = useState(false)
  const [showNewZone, setShowNewZone]     = useState(false)
  const [showNewPermit, setShowNewPermit] = useState(false)
  const [selectedInf, setSelectedInf]     = useState<any>(null)
  const [printHtml, setPrintHtml]         = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['parking-admin-sessions', user?.organization_id],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('parking_sessions')
        .select('*, parking_zones(name, max_stay_minutes, zone_type)')
        .eq('organization_id', user!.organization_id)
        .is('exit_time', null)
        .order('entry_time', { ascending: false })
        .limit(200)
        .abortSignal(signal)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.organization_id,
    refetchInterval: 60_000,
  })

  const { data: infringements = [], refetch: refetchInf } = useQuery({
    queryKey: ['parking-infringements', user?.organization_id, statusFilter, searchPlate],
    queryFn: async ({ signal }) => {
      let q = supabase
        .from('parking_infringements')
        .select('*')
        .eq('organization_id', user!.organization_id)
        .order('issued_at', { ascending: false })
        .limit(100)
        .abortSignal(signal)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (searchPlate.trim())     q = q.ilike('plate_number', `%${searchPlate.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.organization_id,
  })

  const { data: permits = [], refetch: refetchPermits } = useQuery({
    queryKey: ['parking-permits', user?.organization_id],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('parking_permits')
        .select('*, parking_zones(name)')
        .eq('organization_id', user!.organization_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(200)
        .abortSignal(signal)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.organization_id,
  })

  const { data: zones = [], refetch: refetchZones } = useQuery({
    queryKey: ['parking-zones-admin', user?.organization_id],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('parking_zones')
        .select('*')
        .eq('organization_id', user!.organization_id)
        .order('name')
        .abortSignal(signal)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.organization_id,
  })

  // ── Analytics ────────────────────────────────────────────────
  const totalFines   = infringements.filter((i: any) => i.status !== 'withdrawn' && i.status !== 'written_off')
  const totalRevenue = infringements.filter((i: any) => i.status === 'paid')
    .reduce((s: number, i: any) => s + (parseFloat(i.fine_amount_nzd) || 0), 0)
  const outstanding  = infringements.filter((i: any) => i.status === 'issued' || i.status === 'reminder_sent')
    .reduce((s: number, i: any) => s + (parseFloat(i.fine_amount_nzd) || 0), 0)
  const overLimit    = sessions.filter((s: any) => {
    const max = s.parking_zones?.max_stay_minutes
    if (!max) return false
    const dwell = Math.floor((Date.now() - new Date(s.entry_time).getTime()) / 60_000)
    return dwell > max
  })

  // ── ParkPow Sync ─────────────────────────────────────────────
  const handleParkPowSync = async (action: 'sync-lots' | 'sync-watchlist' | 'push-violations') => {
    setSyncing(true)
    try {
      const result: any = await edgeFunctions.runParkPowSync({ action })
      if (result?.success) {
        toast.success(`ParkPow ${action} sync complete`)
      } else {
        toast.error(`ParkPow sync failed: ${result?.error ?? 'Unknown error'}`)
      }
    } catch (err: any) {
      toast.error(err.message ?? `ParkPow ${action} sync failed`)
    } finally {
      setSyncing(false)
    }
  }

  // ── Update infringement status ────────────────────────────────
  const handleStatusChange = async (id: string, status: string) => {
    const update: any = { status }
    if (status === 'paid') update.payment_received_at = new Date().toISOString()
    const { error } = await supabase.from('parking_infringements').update(update).eq('id', id)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(`Status updated to ${INF_STATUS[status]?.label ?? status}`)
      qc.invalidateQueries({ queryKey: ['parking-infringements'] })
      setSelectedInf(null)
    }
  }

  // ─── Render ──────────────────────────────────────────────────

  return (
    <AppLayout
      title="Parking Enforcement"
      description="NZ council-style parking management — TicketOr2 workflow"
    >
      {/* ── KPI summary strip ─────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Active Sessions</p>
                <p className="text-2xl font-bold">{sessions.length}</p>
              </div>
              <Timer className="h-8 w-8 text-blue-400" />
            </div>
            {overLimit.length > 0 && (
              <p className="text-xs text-red-600 mt-1">{overLimit.length} over time limit</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Infringements</p>
                <p className="text-2xl font-bold">{totalFines.length}</p>
              </div>
              <FileText className="h-8 w-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Revenue Collected</p>
                <p className="text-2xl font-bold">${totalRevenue.toFixed(0)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-2xl font-bold">${outstanding.toFixed(0)}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="sessions">
            Active Sessions
            {overLimit.length > 0 && (
              <Badge className="ml-1 bg-red-600 text-white text-xs">{overLimit.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="infringements">Infringements</TabsTrigger>
          <TabsTrigger value="permits">Permits</TabsTrigger>
          <TabsTrigger value="zones">Zones</TabsTrigger>
          <TabsTrigger value="sync">ParkPow Sync</TabsTrigger>
        </TabsList>

        {/* ── Active Sessions ───────────────────────────────── */}
        <TabsContent value="sessions" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {sessions.length} vehicle{sessions.length !== 1 ? 's' : ''} currently chalked / in zone
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchSessions()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>

          {sessions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No active sessions — officers haven't chalked any vehicles yet today.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium">Plate</th>
                    <th className="text-left px-3 py-2 font-medium">Zone</th>
                    <th className="text-left px-3 py-2 font-medium">Entry</th>
                    <th className="text-left px-3 py-2 font-medium">Dwell</th>
                    <th className="text-left px-3 py-2 font-medium">Limit</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Valve</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s: any) => {
                    const zone  = s.parking_zones
                    const max   = zone?.max_stay_minutes
                    const dwell = Math.floor((Date.now() - new Date(s.entry_time).getTime()) / 60_000)
                    const over  = max && dwell > max
                    return (
                      <tr key={s.id} className={`border-b hover:bg-muted/20 ${over ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-2 font-mono font-bold">{s.plate_number}</td>
                        <td className="px-3 py-2 text-xs">{zone?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-xs">{formatDateTime(s.entry_time)}</td>
                        <td className={`px-3 py-2 font-semibold ${over ? 'text-red-700' : ''}`}>
                          {dwell < 60 ? `${dwell}m` : `${Math.floor(dwell / 60)}h ${dwell % 60}m`}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {max ? `${max}m` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {s.is_violation
                            ? <Badge variant="destructive" className="text-xs">Violation</Badge>
                            : over
                              ? <Badge className="bg-orange-100 text-orange-800 border border-orange-200 text-xs">Over Limit</Badge>
                              : <Badge variant="outline" className="text-xs">Active</Badge>
                          }
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground capitalize">
                          {s.entry_tyre_valve_pos ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Infringements ─────────────────────────────────── */}
        <TabsContent value="infringements" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Filter className="absolute left-2 top-2.5 h-3 w-3 text-muted-foreground" />
              <Input
                className="pl-7 h-8 text-sm w-40"
                placeholder="Plate..."
                value={searchPlate}
                onChange={e => setSearchPlate(e.target.value.toUpperCase())}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-sm w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(INF_STATUS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetchInf()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>

          {infringements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No infringements found for the selected filters.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium">Notice No.</th>
                    <th className="text-left px-3 py-2 font-medium">Plate</th>
                    <th className="text-left px-3 py-2 font-medium">Offence</th>
                    <th className="text-left px-3 py-2 font-medium">Fine</th>
                    <th className="text-left px-3 py-2 font-medium">Issued</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {infringements.map((inf: any) => {
                    const st = INF_STATUS[inf.status] ?? { label: inf.status, colour: 'bg-gray-100 text-gray-700' }
                    return (
                      <tr key={inf.id} className="border-b hover:bg-muted/20 cursor-pointer"
                          onClick={() => setSelectedInf(inf)}>
                        <td className="px-3 py-2 font-mono text-xs">{inf.infringement_number}</td>
                        <td className="px-3 py-2 font-mono font-bold">{inf.plate_number}</td>
                        <td className="px-3 py-2 text-xs max-w-[200px] truncate">{inf.offence_description}</td>
                        <td className="px-3 py-2 font-semibold">${inf.fine_amount_nzd ?? '—'}</td>
                        <td className="px-3 py-2 text-xs">{formatDate(inf.issued_at)}</td>
                        <td className="px-3 py-2">
                          <Badge className={`text-xs border ${st.colour}`}>{st.label}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="ghost" size="sm" className="h-6 text-xs">
                            Manage
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Permits ──────────────────────────────────────── */}
        <TabsContent value="permits" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {permits.length} active permit{permits.length !== 1 ? 's' : ''} on file
            </p>
            <Button size="sm" onClick={() => setShowNewPermit(true)}>
              <PlusCircle className="h-4 w-4 mr-1" /> New Permit
            </Button>
          </div>

          {permits.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No active permits — add permits for resident/business vehicles.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium">Plate</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Zone</th>
                    <th className="text-left px-3 py-2 font-medium">Holder</th>
                    <th className="text-left px-3 py-2 font-medium">Valid To</th>
                    <th className="text-left px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p: any) => (
                    <tr key={p.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-bold">{p.plate_number}</td>
                      <td className="px-3 py-2 capitalize text-xs">{p.permit_type.replace('_', ' ')}</td>
                      <td className="px-3 py-2 text-xs">{p.parking_zones?.name ?? 'Any'}</td>
                      <td className="px-3 py-2 text-xs">{p.holder_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">{p.valid_to ?? 'Permanent'}</td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-red-600 hover:text-red-700"
                          onClick={async () => {
                            await supabase.from('parking_permits').update({ is_active: false }).eq('id', p.id)
                            toast.success('Permit revoked')
                            refetchPermits()
                          }}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Zones ─────────────────────────────────────────── */}
        <TabsContent value="zones" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {zones.length} parking zone{zones.length !== 1 ? 's' : ''} configured
            </p>
            <Button size="sm" onClick={() => setShowNewZone(true)}>
              <PlusCircle className="h-4 w-4 mr-1" /> New Zone
            </Button>
          </div>

          {zones.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No parking zones configured. Add a zone to start enforcement.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {zones.map((z: any) => (
                <Card key={z.id} className={z.is_active ? '' : 'opacity-60'}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4 text-blue-500" />
                        {z.name}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {ZONE_TYPE_LABELS[z.zone_type] ?? z.zone_type}
                      </Badge>
                    </CardTitle>
                    {z.address && <p className="text-xs text-muted-foreground">{z.address}</p>}
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Time Limit</span>
                      <span className="font-semibold">
                        {z.max_stay_minutes ? `${z.max_stay_minutes} minutes` : 'No limit'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fine</span>
                      <span className="font-semibold">
                        {z.fine_amount_nzd ? `$${z.fine_amount_nzd}` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Grace Period</span>
                      <span>{z.grace_period_minutes ?? 5} minutes</span>
                    </div>
                    {z.parkpow_lot_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ParkPow Lot</span>
                        <span className="font-mono">#{z.parkpow_lot_id}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── ParkPow Sync ─────────────────────────────────── */}
        <TabsContent value="sync" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                ParkPow Integration Sync
              </CardTitle>
              <CardDescription>
                Synchronise FieldOps Manager zones, watchlists, and violations with ParkPow's enforcement platform.
                Requires PARKPOW_API_TOKEN to be configured in Supabase secrets.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="border rounded-lg p-4 space-y-3">
                  <div>
                    <p className="font-semibold text-sm">Sync Lots</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Push parking zones to ParkPow as enforcement lots. Assigns ParkPow lot IDs back to zones.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={syncing}
                    onClick={() => handleParkPowSync('sync-lots')}
                  >
                    {syncing ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Sync Lots
                  </Button>
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div>
                    <p className="font-semibold text-sm">Sync Watchlist</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Push flagged / exempt vehicles to ParkPow watchlists (block / allow lists).
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={syncing}
                    onClick={() => handleParkPowSync('sync-watchlist')}
                  >
                    {syncing ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Shield className="h-3 w-3 mr-1" />}
                    Sync Watchlist
                  </Button>
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div>
                    <p className="font-semibold text-sm">Push Violations</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Push unsynced parking infringements to ParkPow as formal violations for enforcement workflow.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={syncing}
                    onClick={() => handleParkPowSync('push-violations')}
                  >
                    {syncing ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                    Push Violations
                  </Button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900 space-y-1">
                <p className="font-semibold">About ParkPow (by Plate Recognizer)</p>
                <p>
                  ParkPow is used by NZ councils and private operators for ANPR-based enforcement.
                  Syncing here pushes data to ParkPow's cloud for their enforcement workflow,
                  including email/SMS alerts to officers, violation dashboards, and appeal handling.
                </p>
                <p>
                  ParkPow is complementary to TicketOr2 (ADR) — use ParkPow for automated ANPR camera
                  enforcement, TicketOr2 (this portal) for officer-issued hand-written / handheld enforcement.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Infringement detail / status modal ───────────────── */}
      {selectedInf && (
        <Dialog open onOpenChange={() => setSelectedInf(null)}>
          <DialogContent className="max-w-lg" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Infringement {selectedInf.infringement_number}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-muted-foreground">Plate</span><p className="font-mono font-bold">{selectedInf.plate_number}</p></div>
                <div><span className="text-muted-foreground">Fine</span><p className="font-bold">${selectedInf.fine_amount_nzd ?? '—'}</p></div>
                <div><span className="text-muted-foreground">Location</span><p>{selectedInf.location_address}</p></div>
                <div><span className="text-muted-foreground">Issued</span><p>{formatDateTime(selectedInf.issued_at)}</p></div>
                <div><span className="text-muted-foreground">Officer</span><p>{selectedInf.officer_name ?? '—'}</p></div>
                <div><span className="text-muted-foreground">Due Date</span><p>{selectedInf.due_date ?? '—'}</p></div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Offence</span>
                <p className="mt-1">{selectedInf.offence_description}</p>
              </div>
              {selectedInf.notes && (
                <div>
                  <span className="text-xs text-muted-foreground">Notes</span>
                  <p className="mt-1">{selectedInf.notes}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold mb-2">Update Status</p>
                <div className="flex flex-wrap gap-2">
                  {['paid','disputed','withdrawn','reminder_sent','court_referred','written_off'].map(s => (
                    <Button
                      key={s}
                      size="sm"
                      variant={selectedInf.status === s ? 'default' : 'outline'}
                      className="text-xs h-7"
                      onClick={() => handleStatusChange(selectedInf.id, s)}
                    >
                      {INF_STATUS[s]?.label ?? s}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPrintHtml(generateParkingNoticeHtml(selectedInf))}
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />
                  Print Receipt
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Print Preview Dialog ──────────────────────────────── */}
      {printHtml && (
        <Dialog open={!!printHtml} onOpenChange={() => setPrintHtml(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-gray-600" /> Parking Infringement Receipt
              </DialogTitle>
            </DialogHeader>
            <div className="flex gap-2 mb-3">
              <Button
                size="sm"
                onClick={() => {
                  const w = window.open('', '_blank')
                  if (w) { w.document.write(printHtml ?? ''); w.document.close(); w.focus(); w.print() }
                }}
              >
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const blob = new Blob([printHtml ?? ''], { type: 'text/html' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'parking-infringement-receipt.html'
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Download HTML
              </Button>
            </div>
            <div className="flex-1 overflow-auto rounded border border-gray-200 bg-white">
              <iframe
                srcDoc={printHtml ?? ''}
                className="w-full"
                style={{ height: '60vh', border: 'none' }}
                title="Infringement Receipt Preview"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── New Zone dialog ───────────────────────────────────── */}
      <NewZoneDialog
        open={showNewZone}
        organizationId={user?.organization_id ?? ''}
        onClose={() => setShowNewZone(false)}
        onSaved={() => { setShowNewZone(false); refetchZones() }}
      />

      {/* ── New Permit dialog ─────────────────────────────────── */}
      <NewPermitDialog
        open={showNewPermit}
        organizationId={user?.organization_id ?? ''}
        zones={zones}
        onClose={() => setShowNewPermit(false)}
        onSaved={() => { setShowNewPermit(false); refetchPermits() }}
      />
    </AppLayout>
  )
}

// ─── NewZoneDialog ────────────────────────────────────────────────────────────

function NewZoneDialog({ open, organizationId, onClose, onSaved }: {
  open: boolean; organizationId: string; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: '', address: '', zone_type: 'time_limited', max_stay_minutes: '',
    fine_amount_nzd: '', grace_period_minutes: '5', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Zone name required'); return }
    setSaving(true)
    const { error } = await supabase.from('parking_zones').insert({
      organization_id:     organizationId,
      name:                form.name.trim(),
      address:             form.address || null,
      zone_type:           form.zone_type,
      max_stay_minutes:    form.max_stay_minutes ? parseInt(form.max_stay_minutes) : null,
      fine_amount_nzd:     form.fine_amount_nzd  ? parseFloat(form.fine_amount_nzd) : null,
      grace_period_minutes: parseInt(form.grace_period_minutes) || 5,
      notes:               form.notes || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Zone "${form.name}" created`)
    setForm({ name: '', address: '', zone_type: 'time_limited', max_stay_minutes: '',
              fine_amount_nzd: '', grace_period_minutes: '5', notes: '' })
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>New Parking Zone</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1"><Label>Zone Name *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Queen Street — 30 min" />
          </div>
          <div className="space-y-1"><Label>Address</Label>
            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street address" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Zone Type</Label>
              <Select value={form.zone_type} onValueChange={v => setForm(f => ({ ...f, zone_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ZONE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Max Stay (minutes)</Label>
              <Input type="number" value={form.max_stay_minutes} onChange={e => setForm(f => ({ ...f, max_stay_minutes: e.target.value }))} placeholder="e.g. 30" />
            </div>
            <div className="space-y-1"><Label>Fine (NZD)</Label>
              <Input type="number" value={form.fine_amount_nzd} onChange={e => setForm(f => ({ ...f, fine_amount_nzd: e.target.value }))} placeholder="40.00" />
            </div>
            <div className="space-y-1"><Label>Grace Period (min)</Label>
              <Input type="number" value={form.grace_period_minutes} onChange={e => setForm(f => ({ ...f, grace_period_minutes: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Create Zone'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── NewPermitDialog ──────────────────────────────────────────────────────────

function NewPermitDialog({ open, organizationId, zones, onClose, onSaved }: {
  open: boolean; organizationId: string; zones: any[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    plate_number: '', permit_type: 'resident', parking_zone_id: '',
    holder_name: '', holder_address: '', valid_from: new Date().toISOString().slice(0, 10),
    valid_to: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.plate_number.trim()) { toast.error('Plate number required'); return }
    setSaving(true)
    const { error } = await supabase.from('parking_permits').insert({
      organization_id:  organizationId,
      plate_number:     form.plate_number.toUpperCase().trim(),
      permit_type:      form.permit_type,
      parking_zone_id:  form.parking_zone_id || null,
      holder_name:      form.holder_name || null,
      holder_address:   form.holder_address || null,
      valid_from:       form.valid_from,
      valid_to:         form.valid_to || null,
      is_active:        true,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Permit issued for ${form.plate_number.toUpperCase()}`)
    setForm({ plate_number: '', permit_type: 'resident', parking_zone_id: '',
              holder_name: '', holder_address: '', valid_from: new Date().toISOString().slice(0, 10),
              valid_to: '', notes: '' })
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Issue Parking Permit</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Plate Number *</Label>
              <Input value={form.plate_number} onChange={e => setForm(f => ({ ...f, plate_number: e.target.value.toUpperCase() }))} className="font-mono uppercase" />
            </div>
            <div className="space-y-1"><Label>Permit Type</Label>
              <Select value={form.permit_type} onValueChange={v => setForm(f => ({ ...f, permit_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['resident','business','disabled','visitor','contractor','staff','other'].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label>Zone (optional — blank = any zone)</Label>
            <Select value={form.parking_zone_id} onValueChange={v => setForm(f => ({ ...f, parking_zone_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Any zone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any zone</SelectItem>
                {zones.map((z: any) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Holder Name</Label>
            <Input value={form.holder_name} onChange={e => setForm(f => ({ ...f, holder_name: e.target.value }))} placeholder="Permit holder name" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Valid From</Label>
              <Input type="date" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
            </div>
            <div className="space-y-1"><Label>Valid To (blank = permanent)</Label>
              <Input type="date" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Issue Permit'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
