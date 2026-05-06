/**
 * ParkingPermitManager — B-66
 *
 * Admin issuance and management of parking_permits.
 * Field officers view permits from the Parking Officer Portal; this page
 * gives admin staff a full register to issue, search and deactivate permits.
 *
 * Features:
 *  - KPI cards: Total Active, Expiring this week, Expired, by permit_type
 *  - Filters: is_active, permit_type, parking_zone, plate search
 *  - Table: plate, holder, zone, type, valid_from, valid_to, status
 *  - Issue Permit dialog: plate, holder name/email/phone, type, zone, valid_from, valid_to, notes
 *  - Deactivate action (inline)
 *
 * Route: /parking-permits — admin / admin_officer / master
 * parking_permits and parking_zones are fully typed in database.ts
 */

import { useState } from 'react'
import { addDays, format, isAfter, isBefore, isWithinInterval, parseISO } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, BadgeCheck, Car, CheckCircle2, Loader2, ParkingSquare, Plus, RefreshCw, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Permit     = Database['public']['Tables']['parking_permits']['Row']
type ParkingZone = Database['public']['Tables']['parking_zones']['Row']

type PermitWithZone = Permit & {
  parking_zones: Pick<ParkingZone, 'name'> | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PERMIT_TYPES = ['resident', 'visitor', 'accessible', 'contractor', 'staff', 'temporary', 'seasonal', 'other']

function permitStatusBadge(p: Permit) {
  if (!p.is_active)
    return <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 text-xs">Deactivated</Badge>
  if (p.valid_to && isBefore(parseISO(p.valid_to), new Date()))
    return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 text-xs">Expired</Badge>
  if (p.valid_to && isWithinInterval(parseISO(p.valid_to), { start: new Date(), end: addDays(new Date(), 7) }))
    return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 text-xs">Expiring soon</Badge>
  return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 text-xs">Active</Badge>
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ParkingPermitManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [activeFilter, setActiveFilter]   = useState('all')
  const [typeFilter, setTypeFilter]       = useState('all')
  const [zoneFilter, setZoneFilter]       = useState('all')
  const [search, setSearch]               = useState('')
  const [showIssue, setShowIssue]         = useState(false)

  // Issue form state
  const [form, setForm] = useState({
    plate_number: '',
    holder_name: '',
    holder_email: '',
    holder_phone: '',
    permit_type: 'visitor',
    parking_zone_id: '',
    valid_from: format(new Date(), 'yyyy-MM-dd'),
    valid_to: '',
    notes: '',
  })

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: permits = [], isLoading, refetch } = useQuery<PermitWithZone[]>({
    queryKey: ['parking_permits', orgId, activeFilter, typeFilter, zoneFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('parking_permits')
        .select('*, parking_zones(name)')
        .eq('organization_id', orgId as string)
        .order('created_at', { ascending: false })
        .limit(500)

      if (activeFilter === 'active')   q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (typeFilter !== 'all')        q = q.eq('permit_type', typeFilter)
      if (zoneFilter !== 'all')        q = q.eq('parking_zone_id', zoneFilter)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as PermitWithZone[]
    },
  })

  const { data: zones = [] } = useQuery<ParkingZone[]>({
    queryKey: ['parking_zones_list', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parking_zones')
        .select('*')
        .eq('organization_id', orgId as string)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // ── Mutations ───────────────────────────────────────────────────────────────

  const issuePermit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('parking_permits')
        .insert({
          organization_id: orgId as string,
          plate_number: form.plate_number.toUpperCase().trim(),
          holder_name:  form.holder_name || null,
          holder_email: form.holder_email || null,
          holder_phone: form.holder_phone || null,
          permit_type:  form.permit_type,
          parking_zone_id: form.parking_zone_id || null,
          valid_from:   form.valid_from,
          valid_to:     form.valid_to || null,
          notes:        form.notes || null,
          issued_by:    user?.id ?? null,
          is_active:    true,
        })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Permit issued')
      setShowIssue(false)
      setForm({
        plate_number: '', holder_name: '', holder_email: '', holder_phone: '',
        permit_type: 'visitor', parking_zone_id: '',
        valid_from: format(new Date(), 'yyyy-MM-dd'), valid_to: '', notes: '',
      })
      qc.invalidateQueries({ queryKey: ['parking_permits'] })
    },
    onError: () => toast.error('Failed to issue permit'),
  })

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('parking_permits')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Permit deactivated')
      qc.invalidateQueries({ queryKey: ['parking_permits'] })
    },
    onError: () => toast.error('Failed to deactivate permit'),
  })

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filtered = permits.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.plate_number.toLowerCase().includes(q) ||
      (p.holder_name ?? '').toLowerCase().includes(q) ||
      (p.holder_email ?? '').toLowerCase().includes(q)
    )
  })

  const now = new Date()
  const kpiActive   = permits.filter(p => p.is_active && (!p.valid_to || isAfter(parseISO(p.valid_to), now))).length
  const kpiExpiring = permits.filter(p =>
    p.is_active && p.valid_to &&
    isWithinInterval(parseISO(p.valid_to), { start: now, end: addDays(now, 7) })
  ).length
  const kpiExpired  = permits.filter(p => p.valid_to && isBefore(parseISO(p.valid_to), now)).length
  const kpiTotal    = permits.length

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Parking Permit Manager"
      description="Issue and manage parking permits for zones under your organisation"
    >
      <div className="space-y-4">

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Permits',   value: kpiTotal,    icon: ParkingSquare, colour: 'text-slate-600' },
            { label: 'Active',          value: kpiActive,   icon: BadgeCheck,    colour: 'text-green-600' },
            { label: 'Expiring 7 Days', value: kpiExpiring, icon: AlertTriangle, colour: 'text-amber-600' },
            { label: 'Expired',         value: kpiExpired,  icon: XCircle,       colour: 'text-red-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label} className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${colour}`} />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${colour}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Filters + Issue button ──────────────────────────────────────── */}
        <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 flex-1 min-w-[140px]">
                <Label className="text-xs">Search plate / holder</Label>
                <Input
                  placeholder="ABC123 or name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 w-[130px]">
                <Label className="text-xs">Status</Label>
                <Select value={activeFilter} onValueChange={setActiveFilter}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 w-[140px]">
                <Label className="text-xs">Permit Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {PERMIT_TYPES.map(t => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 w-[160px]">
                <Label className="text-xs">Zone</Label>
                <Select value={zoneFilter} onValueChange={setZoneFilter}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All zones</SelectItem>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowIssue(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Issue Permit
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground text-sm">
                <Car className="h-8 w-8 opacity-30" />
                No permits found. Issue your first permit using the button above.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate</TableHead>
                    <TableHead>Holder</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Valid From</TableHead>
                    <TableHead>Valid To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm font-semibold">{p.plate_number}</TableCell>
                      <TableCell className="text-sm">{p.holder_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{p.parking_zones?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm capitalize">{p.permit_type}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(parseISO(p.valid_from), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {p.valid_to ? format(parseISO(p.valid_to), 'dd MMM yyyy') : 'No expiry'}
                      </TableCell>
                      <TableCell>{permitStatusBadge(p)}</TableCell>
                      <TableCell>
                        {p.is_active && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => deactivate.mutate(p.id)}
                            disabled={deactivate.isPending}
                          >
                            <XCircle className="h-3 w-3" />
                            Deactivate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── Issue Permit Dialog ──────────────────────────────────────────── */}
      <Dialog open={showIssue} onOpenChange={setShowIssue}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-green-600" />
              Issue New Parking Permit
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Plate Number <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ABC123"
                value={form.plate_number}
                onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))}
                className="uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Holder Name</Label>
              <Input
                placeholder="Full name"
                value={form.holder_name}
                onChange={e => setForm(f => ({ ...f, holder_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Holder Phone</Label>
              <Input
                placeholder="+64 21 xxx xxxx"
                value={form.holder_phone}
                onChange={e => setForm(f => ({ ...f, holder_phone: e.target.value }))}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Holder Email</Label>
              <Input
                type="email"
                placeholder="holder@example.com"
                value={form.holder_email}
                onChange={e => setForm(f => ({ ...f, holder_email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Permit Type <span className="text-red-500">*</span></Label>
              <Select value={form.permit_type} onValueChange={v => setForm(f => ({ ...f, permit_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERMIT_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Parking Zone</Label>
              <Select value={form.parking_zone_id} onValueChange={v => setForm(f => ({ ...f, parking_zone_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select zone…" /></SelectTrigger>
                <SelectContent>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valid From <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={form.valid_from}
                onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valid To (optional)</Label>
              <Input
                type="date"
                value={form.valid_to}
                onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Notes</Label>
              <Input
                placeholder="Optional notes…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowIssue(false)}>Cancel</Button>
            <Button
              onClick={() => issuePermit.mutate()}
              disabled={!form.plate_number.trim() || !form.valid_from || issuePermit.isPending}
              className="gap-1.5"
            >
              {issuePermit.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Issuing…</>
                : <><CheckCircle2 className="h-3.5 w-3.5" /> Issue Permit</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppLayout>
  )
}
