/**
 * ParkingPermitManager — B-66
 *
 * Admin UI for managing parking permits and zones.
 *
 * Features:
 *  - KPI cards: Total, Active, Expiring Soon (≤30 days), Expired / Inactive
 *  - Zone filter, permit type filter, search
 *  - Table: plate, permit type, holder, zone, valid from/to, status
 *  - Issue dialog: new permit creation
 *  - Deactivate action (is_active = false)
 *
 * Route: /parking-permits — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO, differenceInDays, isPast, isWithinInterval, addDays } from 'date-fns'
import {
  ParkingSquare, Plus, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, Clock, XCircle, ToggleLeft,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type Permit    = Database['public']['Tables']['parking_permits']['Row']
type ParkZone  = Database['public']['Tables']['parking_zones']['Row']

interface IssueForm {
  plate_number:   string
  permit_type:    string
  holder_name:    string
  holder_email:   string
  holder_phone:   string
  holder_address: string
  parking_zone_id: string
  valid_from:     string
  valid_to:       string
  notes:          string
}

const BLANK_FORM: IssueForm = {
  plate_number:    '',
  permit_type:     'resident',
  holder_name:     '',
  holder_email:    '',
  holder_phone:    '',
  holder_address:  '',
  parking_zone_id: '',
  valid_from:      format(new Date(), 'yyyy-MM-dd'),
  valid_to:        '',
  notes:           '',
}

const PERMIT_TYPES = ['resident', 'visitor', 'contractor', 'disabled', 'commercial', 'event', 'other']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function permitStatus(p: Permit): 'active' | 'expiring_soon' | 'expired' | 'inactive' {
  if (!p.is_active) return 'inactive'
  if (!p.valid_to) return 'active'
  const to = parseISO(p.valid_to)
  if (isPast(to)) return 'expired'
  if (isWithinInterval(to, { start: new Date(), end: addDays(new Date(), 30) })) return 'expiring_soon'
  return 'active'
}

const STATUS_COLOURS: Record<string, string> = {
  active:        'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  expiring_soon: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  expired:       'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  inactive:      'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-400',
}

const STATUS_LABEL: Record<string, string> = {
  active:        'Active',
  expiring_soon: 'Expiring Soon',
  expired:       'Expired',
  inactive:      'Inactive',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ParkingPermitManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]         = useState('')
  const [filterZone, setFilterZone] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [issueOpen, setIssueOpen]   = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<Permit | null>(null)
  const [form, setForm]             = useState<IssueForm>(BLANK_FORM)
  const [saving, setSaving]         = useState(false)

  // ── Zones query ───────────────────────────────────────────────────────────

  const { data: zones = [] } = useQuery<ParkZone[]>({
    queryKey: ['parking-zones', orgId],
    queryFn: async () => {
      let q = supabase
        .from('parking_zones')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Permits query ─────────────────────────────────────────────────────────

  const { data: permits = [], isLoading, error, refetch } = useQuery<Permit[]>({
    queryKey: ['parking-permits', orgId],
    queryFn: async () => {
      let q = supabase
        .from('parking_permits')
        .select('*')
        .order('created_at', { ascending: false })
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived / filtered ────────────────────────────────────────────────────

  const filtered = permits.filter(p => {
    if (filterZone !== 'all' && p.parking_zone_id !== filterZone) return false
    if (filterType !== 'all' && p.permit_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        p.plate_number.toLowerCase().includes(s) ||
        p.holder_name?.toLowerCase().includes(s) ||
        p.holder_email?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total        = permits.length
  const activeCount  = permits.filter(p => permitStatus(p) === 'active').length
  const expiringSoon = permits.filter(p => permitStatus(p) === 'expiring_soon').length
  const expiredOrInactive = permits.filter(p => ['expired', 'inactive'].includes(permitStatus(p))).length

  // ── Issue mutation ────────────────────────────────────────────────────────

  const handleIssue = async () => {
    if (!form.plate_number.trim() || !orgId) return
    setSaving(true)
    try {
      const { error } = await supabase.from('parking_permits').insert({
        organization_id:  orgId,
        plate_number:     form.plate_number.trim().toUpperCase(),
        permit_type:      form.permit_type,
        holder_name:      form.holder_name || null,
        holder_email:     form.holder_email || null,
        holder_phone:     form.holder_phone || null,
        holder_address:   form.holder_address || null,
        parking_zone_id:  form.parking_zone_id || null,
        valid_from:       form.valid_from,
        valid_to:         form.valid_to || null,
        notes:            form.notes || null,
        issued_by:        user?.id,
        is_active:        true,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['parking-permits'] })
      toast.success('Permit issued')
      setIssueOpen(false)
      setForm(BLANK_FORM)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Deactivate mutation ───────────────────────────────────────────────────

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('parking_permits')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parking-permits'] })
      toast.success('Permit deactivated')
      setDeactivateTarget(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Form helpers ──────────────────────────────────────────────────────────

  const setField = (k: keyof IssueForm, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ParkingSquare className="h-7 w-7 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold">Parking Permit Manager</h1>
              <p className="text-sm text-muted-foreground">Issue and manage parking permits</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setIssueOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Issue Permit
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',            value: total,             icon: ParkingSquare, colour: 'text-slate-600' },
            { label: 'Active',           value: activeCount,       icon: CheckCircle2,  colour: 'text-green-600' },
            { label: 'Expiring ≤30 days',value: expiringSoon,      icon: Clock,         colour: 'text-amber-600' },
            { label: 'Expired / Inactive',value: expiredOrInactive,icon: XCircle,       colour: 'text-red-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
                <span className="text-2xl font-bold">{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Plate, holder name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {zones.length > 0 && (
            <Select value={filterZone} onValueChange={setFilterZone}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Zone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Zones</SelectItem>
                {zones.map(z => (
                  <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Permit Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {PERMIT_TYPES.map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No permits match your filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Holder</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Valid From</TableHead>
                    <TableHead>Valid To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => {
                    const status = permitStatus(p)
                    const zone   = zones.find(z => z.id === p.parking_zone_id)
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono font-semibold">{p.plate_number}</TableCell>
                        <TableCell className="capitalize text-sm">{p.permit_type.replace(/_/g, ' ')}</TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{p.holder_name ?? '—'}</div>
                          {p.holder_email && (
                            <div className="text-xs text-muted-foreground">{p.holder_email}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{zone?.name ?? '—'}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{fmtDate(p.valid_from)}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{fmtDate(p.valid_to)}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLOURS[status]}>
                            {STATUS_LABEL[status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {p.is_active && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => setDeactivateTarget(p)}
                            >
                              <ToggleLeft className="h-3.5 w-3.5 mr-1" />
                              Deactivate
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Issue Permit Dialog ──────────────────────────────────────── */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue New Permit</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <Label>Plate Number *</Label>
              <Input
                value={form.plate_number}
                onChange={e => setField('plate_number', e.target.value)}
                placeholder="ABC123"
                className="uppercase"
              />
            </div>

            <div className="space-y-1 col-span-2 sm:col-span-1">
              <Label>Permit Type</Label>
              <Select value={form.permit_type} onValueChange={v => setField('permit_type', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMIT_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Holder Name</Label>
              <Input value={form.holder_name} onChange={e => setField('holder_name', e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Holder Email</Label>
              <Input value={form.holder_email} onChange={e => setField('holder_email', e.target.value)} type="email" />
            </div>

            <div className="space-y-1">
              <Label>Holder Phone</Label>
              <Input value={form.holder_phone} onChange={e => setField('holder_phone', e.target.value)} />
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Holder Address</Label>
              <Input value={form.holder_address} onChange={e => setField('holder_address', e.target.value)} />
            </div>

            {zones.length > 0 && (
              <div className="space-y-1 col-span-2">
                <Label>Zone</Label>
                <Select value={form.parking_zone_id} onValueChange={v => setField('parking_zone_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>Valid From</Label>
              <Input type="date" value={form.valid_from} onChange={e => setField('valid_from', e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Valid To</Label>
              <Input type="date" value={form.valid_to} onChange={e => setField('valid_to', e.target.value)} />
            </div>

            <div className="space-y-1 col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={e => setField('notes', e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
            <Button
              onClick={handleIssue}
              disabled={saving || !form.plate_number.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Issue Permit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deactivate Confirm Dialog ────────────────────────────────── */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={open => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Permit</AlertDialogTitle>
            <AlertDialogDescription>
              Deactivate permit for plate <strong>{deactivateTarget?.plate_number}</strong>?
              This cannot be undone from this interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deactivateTarget && deactivate.mutate(deactivateTarget.id)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}
