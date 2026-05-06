/**
 * TravelAllowances — Sprint 16 / B-55
 *
 * Admin management of travel allowances linked to callout shifts and roster shifts.
 * Tables: travel_allowances — NOT in database.ts; uses (supabase as any).
 *
 * Features:
 * - KPI strip: Pending / Approved / Total Pending $ / Total Approved $
 * - Table with officer, status, journey-type filters and keyword search
 * - URL param ?callout_shift_id=… to pre-filter from CalloutShifts page
 * - Expandable row: origin/destination, distance, travel times, pay breakdown
 * - Approve + Reject (with reason) row actions
 * - Add manual travel allowance dialog
 *
 * Route: /travel-allowances
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  MapPin,
  Navigation,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ──────────────────────────────────────────────────────────────────────

type TravelStatus = 'pending' | 'approved' | 'rejected' | 'paid'
type JourneyType = 'outbound' | 'return' | 'round_trip' | 'site_to_site'

interface TravelAllowance {
  id: string
  organization_id: string
  officer_id: string
  callout_shift_id: string | null
  roster_shift_id: string | null
  travel_date: string
  journey_type: JourneyType
  origin_address: string | null
  destination_address: string | null
  distance_km: number | null
  distance_in_jurisdiction_km: number | null
  distance_out_of_jurisdiction_km: number | null
  is_outside_jurisdiction: boolean
  travel_start_time: string | null
  travel_end_time: string | null
  travel_duration_minutes: number | null
  rate_per_km: number | null
  rate_per_hour: number | null
  distance_pay_amount: number | null
  time_pay_amount: number | null
  total_pay_amount: number | null
  status: TravelStatus
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
  officer?: { first_name: string; last_name: string } | null
}

interface Officer {
  id: string
  first_name: string
  last_name: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const NZ_TZ = 'Pacific/Auckland'

const STATUS_CONFIG: Record<TravelStatus, { label: string; color: string }> = {
  pending:  { label: 'Pending',  color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  paid:     { label: 'Paid',     color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
}

const JOURNEY_TYPE_LABELS: Record<JourneyType, string> = {
  outbound:     'Outbound',
  return:       'Return',
  round_trip:   'Round Trip',
  site_to_site: 'Site-to-Site',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(v: number | null) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function fmtKm(v: number | null) {
  if (v == null) return '—'
  return `${v.toFixed(1)} km`
}

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  try { return formatInTimeZone(new Date(iso), NZ_TZ, 'HH:mm') } catch { return iso }
}

function officerName(t: TravelAllowance) {
  if (!t.officer) return '—'
  return [t.officer.first_name, t.officer.last_name].filter(Boolean).join(' ')
}

// ─── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({ ta }: { ta: TravelAllowance }) {
  return (
    <div className="bg-muted/40 border-t px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 text-xs">
      {/* Journey */}
      <div>
        <p className="font-medium text-muted-foreground mb-2">Journey</p>
        <div className="space-y-1.5">
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Origin</p>
              <p>{ta.origin_address ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-1.5">
            <Navigation className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Destination</p>
              <p>{ta.destination_address ?? '—'}</p>
            </div>
          </div>
          {ta.travel_start_time && (
            <div className="flex items-start gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Travel Window</p>
                <p>{fmtTs(ta.travel_start_time)} → {fmtTs(ta.travel_end_time)}</p>
                {ta.travel_duration_minutes != null && (
                  <p className="text-muted-foreground">{ta.travel_duration_minutes} min</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Distance breakdown */}
      <div>
        <p className="font-medium text-muted-foreground mb-2">Distance</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span>{fmtKm(ta.distance_km)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">In-jurisdiction</span>
            <span>{fmtKm(ta.distance_in_jurisdiction_km)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Out-of-jurisdiction</span>
            <span>{fmtKm(ta.distance_out_of_jurisdiction_km)}</span>
          </div>
          {ta.is_outside_jurisdiction && (
            <Badge variant="secondary" className="text-[10px] mt-1">Outside jurisdiction</Badge>
          )}
        </div>
        <p className="font-medium text-muted-foreground mb-2 mt-4">Rates Applied</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Per km</span>
            <span>{ta.rate_per_km != null ? `$${ta.rate_per_km.toFixed(4)}` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Per hour</span>
            <span>{fmtCurrency(ta.rate_per_hour)}/hr</span>
          </div>
        </div>
      </div>

      {/* Pay */}
      <div>
        <p className="font-medium text-muted-foreground mb-2">Pay Breakdown</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Distance pay</span>
            <span>{fmtCurrency(ta.distance_pay_amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Time pay</span>
            <span>{fmtCurrency(ta.time_pay_amount)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1 mt-1 text-emerald-700 dark:text-emerald-400">
            <span>Total Travel Pay</span>
            <span>{fmtCurrency(ta.total_pay_amount)}</span>
          </div>
        </div>
        {ta.notes && (
          <div className="mt-4">
            <p className="font-medium text-muted-foreground mb-1">Notes</p>
            <p>{ta.notes}</p>
          </div>
        )}
        {ta.admin_notes && (
          <div className="mt-4">
            <p className="font-medium text-muted-foreground mb-1">Admin Notes</p>
            <p>{ta.admin_notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Add Travel Dialog ──────────────────────────────────────────────────────────

interface AddTravelDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (v: Record<string, any>) => void
  isSaving: boolean
  officers: Officer[]
}

function AddTravelDialog({ open, onClose, onSubmit, isSaving, officers }: AddTravelDialogProps) {
  const [form, setForm] = useState({
    officer_id: '',
    travel_date: format(new Date(), 'yyyy-MM-dd'),
    journey_type: 'round_trip' as JourneyType,
    origin_address: '',
    destination_address: '',
    distance_km: '',
    rate_per_km: '',
    notes: '',
  })
  const set = (k: string) => (v: any) => setForm((f) => ({ ...f, [k]: v }))
  const isValid = form.officer_id && form.travel_date && form.destination_address

  const distancePay = form.distance_km && form.rate_per_km
    ? (parseFloat(form.distance_km) * parseFloat(form.rate_per_km)).toFixed(2)
    : null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-4 w-4 text-sky-500" />
            Add Travel Allowance
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label>Officer <span className="text-red-500">*</span></Label>
            <Select value={form.officer_id} onValueChange={set('officer_id')}>
              <SelectTrigger><SelectValue placeholder="Select officer…" /></SelectTrigger>
              <SelectContent>
                {officers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {[o.first_name, o.last_name].filter(Boolean).join(' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={form.travel_date}
                onChange={(e) => set('travel_date')(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Journey Type</Label>
              <Select value={form.journey_type} onValueChange={set('journey_type') as any}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(JOURNEY_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Origin</Label>
            <Input value={form.origin_address}
              onChange={(e) => set('origin_address')(e.target.value)}
              placeholder="e.g. Christchurch City Office" />
          </div>
          <div className="grid gap-1.5">
            <Label>Destination <span className="text-red-500">*</span></Label>
            <Input value={form.destination_address}
              onChange={(e) => set('destination_address')(e.target.value)}
              placeholder="e.g. 42 Main Rd, Rangiora" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Distance (km)</Label>
              <Input type="number" step="0.1" min="0" value={form.distance_km}
                onChange={(e) => set('distance_km')(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Rate per km (NZD)</Label>
              <Input type="number" step="0.0001" min="0" value={form.rate_per_km}
                onChange={(e) => set('rate_per_km')(e.target.value)} />
            </div>
          </div>
          {distancePay && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              Estimated distance pay: ${distancePay}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes}
              onChange={(e) => set('notes')(e.target.value)} placeholder="Optional notes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={() => onSubmit({
            officer_id: form.officer_id,
            travel_date: form.travel_date,
            journey_type: form.journey_type,
            origin_address: form.origin_address || null,
            destination_address: form.destination_address,
            distance_km: form.distance_km ? parseFloat(form.distance_km) : null,
            rate_per_km: form.rate_per_km ? parseFloat(form.rate_per_km) : null,
            distance_pay_amount: distancePay ? parseFloat(distancePay) : null,
            total_pay_amount: distancePay ? parseFloat(distancePay) : null,
            notes: form.notes || null,
            status: 'pending',
          })} disabled={isSaving || !isValid}>
            {isSaving ? 'Saving…' : 'Add Travel Claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Reject Dialog ──────────────────────────────────────────────────────────────

function RejectDialog({
  open, onClose, onSubmit, isSaving,
}: {
  open: boolean; onClose: () => void; onSubmit: (reason: string) => void; isSaving: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reject Travel Claim</DialogTitle></DialogHeader>
        <div className="grid gap-2 py-2">
          <Label>Reason (optional)</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this claim is rejected…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button variant="destructive" onClick={() => onSubmit(reason)} disabled={isSaving}>
            {isSaving ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function TravelAllowances() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const userId = user?.id ?? ''
  const qc = useQueryClient()

  const preFilterCalloutId = searchParams.get('callout_shift_id') ?? ''

  const [statusFilter, setStatusFilter] = useState('all')
  const [officerFilter, setOfficerFilter] = useState('all')
  const [journeyFilter, setJourneyFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)

  // ── Fetch travel allowances ────────────────────────────────────────────────
  const { data: allowances = [], isLoading } = useQuery<TravelAllowance[]>({
    queryKey: ['travel-allowances', orgId, preFilterCalloutId],
    queryFn: async () => {
      if (!orgId) return []
      let q = (supabase as any)
        .from('travel_allowances')
        .select('*, officer:officer_id(first_name, last_name)')
        .eq('organization_id', orgId)
        .order('travel_date', { ascending: false })
        .limit(300)
      if (preFilterCalloutId) q = q.eq('callout_shift_id', preFilterCalloutId)
      const { data, error } = await q
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return []
      if (error) throw error
      return (data ?? []) as TravelAllowance[]
    },
    enabled: !!orgId,
    staleTime: 30_000,
    retry: false,
  })

  // ── Fetch officers ─────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<Officer[]>({
    queryKey: ['travel-officers', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, first_name, last_name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return (data ?? []) as Officer[]
    },
    enabled: !!orgId,
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => ({
    pending:  allowances.filter((a) => a.status === 'pending').length,
    approved: allowances.filter((a) => a.status === 'approved' || a.status === 'paid').length,
    pendingAmt: allowances
      .filter((a) => a.status === 'pending')
      .reduce((s, a) => s + (a.total_pay_amount ?? 0), 0),
    approvedAmt: allowances
      .filter((a) => a.status === 'approved' || a.status === 'paid')
      .reduce((s, a) => s + (a.total_pay_amount ?? 0), 0),
  }), [allowances])

  // ── Filtered ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => allowances.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    if (officerFilter !== 'all' && a.officer_id !== officerFilter) return false
    if (journeyFilter !== 'all' && a.journey_type !== journeyFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = officerName(a).toLowerCase()
      const dest = (a.destination_address ?? '').toLowerCase()
      if (!name.includes(q) && !dest.includes(q)) return false
    }
    return true
  }), [allowances, statusFilter, officerFilter, journeyFilter, search])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('travel_allowances')
        .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['travel-allowances'] })
      toast.success('Travel claim approved')
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve'),
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await (supabase as any)
        .from('travel_allowances')
        .update({ status: 'rejected', admin_notes: reason || null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['travel-allowances'] })
      toast.success('Travel claim rejected')
      setRejectTarget(null)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject'),
  })

  const addMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { error } = await (supabase as any)
        .from('travel_allowances')
        .insert({ ...values, organization_id: orgId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['travel-allowances'] })
      toast.success('Travel claim added')
      setAddOpen(false)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to add claim'),
  })

  return (
    <AppLayout
      title="Travel Allowances"
      description="Review and approve travel claims from callout shifts and rostered patrols"
    >
      {/* Back nav */}
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/callout-shifts')}
          className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Callout Shifts
        </Button>
        {preFilterCalloutId && (
          <Badge variant="secondary" className="text-xs gap-1.5">
            Filtered by callout shift
            <button className="hover:text-foreground" onClick={() => navigate('/travel-allowances')}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Pending',         value: kpis.pending,                       Icon: Clock,        color: 'text-amber-600' },
          { label: 'Approved',        value: kpis.approved,                      Icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Pending Amount',  value: fmtCurrency(kpis.pendingAmt),       Icon: DollarSign,   color: 'text-amber-600', raw: true },
          { label: 'Approved Amount', value: fmtCurrency(kpis.approvedAmt),      Icon: Car,          color: 'text-emerald-600', raw: true },
        ].map(({ label, value, Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-xl font-bold leading-tight">{isLoading ? '—' : value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search officer, destination…" className="pl-8 w-52 h-8 text-xs" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={officerFilter} onValueChange={setOfficerFilter}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Officer" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All officers</SelectItem>
            {officers.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {[o.first_name, o.last_name].filter(Boolean).join(' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={journeyFilter} onValueChange={setJourneyFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Journey" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All journeys</SelectItem>
            {Object.entries(JOURNEY_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />Add Claim
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs w-6" />
                <TableHead className="text-xs">Officer</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Journey</TableHead>
                <TableHead className="text-xs">Destination</TableHead>
                <TableHead className="text-xs">Distance</TableHead>
                <TableHead className="text-xs">Total Pay</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                    No travel claims match the current filters.
                  </TableCell>
                </TableRow>
              ) : filtered.map((ta) => {
                const isExpanded = expandedId === ta.id
                const statusCfg = STATUS_CONFIG[ta.status] ?? STATUS_CONFIG.pending
                return (
                  <>
                    <TableRow key={ta.id} className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedId(isExpanded ? null : ta.id)}>
                      <TableCell className="py-2 pl-3 pr-0">
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="py-2 text-sm font-medium">{officerName(ta)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {ta.travel_date}
                      </TableCell>
                      <TableCell className="py-2 text-xs">
                        {JOURNEY_TYPE_LABELS[ta.journey_type] ?? ta.journey_type}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground max-w-[140px] truncate"
                        title={ta.destination_address ?? undefined}>
                        {ta.destination_address ?? '—'}
                      </TableCell>
                      <TableCell className="py-2 text-xs">
                        {fmtKm(ta.distance_km)}
                      </TableCell>
                      <TableCell className="py-2 text-xs font-medium">
                        {fmtCurrency(ta.total_pay_amount)}
                      </TableCell>
                      <TableCell className="py-2">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        {ta.status === 'pending' && (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm"
                              className="h-6 px-2 text-[10px] text-emerald-700 hover:text-emerald-900"
                              onClick={() => approveMutation.mutate(ta.id)}
                              disabled={approveMutation.isPending}>
                              Approve
                            </Button>
                            <Button variant="ghost" size="sm"
                              className="h-6 px-2 text-[10px] text-red-700 hover:text-red-900"
                              onClick={() => setRejectTarget(ta.id)}>
                              Reject
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${ta.id}-detail`}>
                        <TableCell colSpan={9} className="p-0">
                          <DetailPanel ta={ta} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} of {allowances.length} claim{allowances.length !== 1 ? 's' : ''}
          </div>
        )}
      </Card>

      <AddTravelDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(v) => addMutation.mutate(v)}
        isSaving={addMutation.isPending}
        officers={officers}
      />
      <RejectDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onSubmit={(reason) => rejectTarget && rejectMutation.mutate({ id: rejectTarget, reason })}
        isSaving={rejectMutation.isPending}
      />
    </AppLayout>
  )
}
