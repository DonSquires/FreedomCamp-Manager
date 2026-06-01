import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Shield,
  Home,
  Car,
  Eye,
  Search,
  Edit,
  Trash2,
  Plus,
  CheckCircle,
  XCircle,
  Calendar,
  RefreshCw,
  Database,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CanonicalScvRow {
  plate_number: string
  is_self_contained: boolean
  certificate_expiry: string | null
  source: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface CanonicalHomelessRow {
  plate_number: string
  status: string
  confirmed_by: string | null
  confirmed_at: string | null
  source: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface CanonicalVehicleRow {
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  vehicle_color: string | null
  /** Denormalised from canonical_scv — may be stale. Canonical source is canonical_scv table. */
  self_contained: boolean | null
  /** Denormalised from canonical_scv — may be stale. Canonical source is canonical_scv table. */
  self_contained_expiry: string | null
  /** Denormalised from canonical_homeless — may be stale. Canonical source is canonical_homeless table. */
  homeless_status: string | null
  is_flagged: boolean | null
  total_observations: number | null
  total_breaches: number | null
  last_seen_at: string | null
  notes: string | null
}

interface ObservationRow {
  observation_id: string
  plate_number: string | null
  recorded_at: string
  is_compliant: boolean | null
  is_breach: boolean | null
  breach_type: string | null
  officer_notes: string | null
  self_contained: boolean | null
  zone_id: string | null
  organization_id: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HOMELESS_STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'declined', label: 'Declined' },
  { value: 'freedom_camper', label: 'Freedom Camper' },
  { value: 'none', label: 'None / Clear' },
]

const homelessBadge = (status: string) => {
  if (status === 'confirmed') return <Badge className="bg-red-100 text-red-800 border-red-200">Confirmed</Badge>
  if (status === 'claimed')   return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Claimed</Badge>
  if (status === 'declined')  return <Badge variant="outline">Declined</Badge>
  if (status === 'freedom_camper') return <Badge variant="secondary">Freedom Camper</Badge>
  return <Badge variant="outline" className="text-muted-foreground">None</Badge>
}

// ─── Tab: SCV Registry ────────────────────────────────────────────────────────

function ScvRegistryTab({ isMaster }: { isMaster: boolean }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterSc, setFilterSc] = useState<'all' | 'yes' | 'no'>('all')
  const [editRow, setEditRow] = useState<CanonicalScvRow | null>(null)
  const [form, setForm] = useState({ is_self_contained: 'true', certificate_expiry: '', notes: '' })
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['canonical-scv', search, filterSc],
    queryFn: async () => {
      let q = (supabase.from('canonical_scv') as any)
        .select('*')
        .order('plate_number')
        .limit(500)
      if (filterSc === 'yes') q = q.eq('is_self_contained', true)
      if (filterSc === 'no')  q = q.eq('is_self_contained', false)
      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CanonicalScvRow[]
    },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editRow) return
      const { error } = await (supabase.from('canonical_scv') as any)
        .update({
          is_self_contained: form.is_self_contained === 'true',
          certificate_expiry: form.certificate_expiry || null,
          notes: form.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('plate_number', editRow.plate_number)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('SCV record updated')
      setEditRow(null)
      queryClient.invalidateQueries({ queryKey: ['canonical-scv'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (plate: string) => {
      const { error } = await (supabase.from('canonical_scv') as any)
        .delete()
        .eq('plate_number', plate)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('SCV record deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['canonical-scv'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openEdit = (row: CanonicalScvRow) => {
    setEditRow(row)
    setForm({
      is_self_contained: row.is_self_contained ? 'true' : 'false',
      certificate_expiry: row.certificate_expiry ?? '',
      notes: row.notes ?? '',
    })
  }

  const scCount = rows.filter(r => r.is_self_contained).length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search plate…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterSc} onValueChange={v => setFilterSc(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="yes">Self-contained only</SelectItem>
            <SelectItem value="no">Not self-contained</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['canonical-scv'] })}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{rows.length} records</span>
        <span className="text-green-600 font-medium">{scCount} self-contained</span>
        <span className="text-orange-600 font-medium">{rows.length - scCount} not SC</span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No records found</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {rows.map(row => (
                <div key={row.plate_number} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <Shield className={`h-4 w-4 shrink-0 ${row.is_self_contained ? 'text-green-600' : 'text-muted-foreground'}`} />
                  <span className="font-mono font-bold text-sm w-28 shrink-0">{row.plate_number}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    {row.is_self_contained
                      ? <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">SC Certified</Badge>
                      : <Badge variant="outline" className="text-xs text-muted-foreground">Not SC</Badge>
                    }
                    {row.certificate_expiry && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Exp: {row.certificate_expiry}
                      </span>
                    )}
                    {row.source && <span className="text-xs text-muted-foreground">src: {row.source}</span>}
                    {row.notes && <span className="text-xs text-muted-foreground line-clamp-1">{row.notes}</span>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isMaster && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(row)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row.plate_number)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit dialog (master only) */}
      <Dialog open={!!editRow} onOpenChange={open => { if (!open) setEditRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit SCV Record — {editRow?.plate_number}</DialogTitle>
            <DialogDescription>Update the self-contained vehicle certification for this plate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>SCV Status</Label>
              <Select value={form.is_self_contained} onValueChange={v => setForm(f => ({ ...f, is_self_contained: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Self-Contained (Certified)</SelectItem>
                  <SelectItem value="false">Not Self-Contained</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Certificate Expiry</Label>
              <Input type="date" value={form.certificate_expiry} onChange={e => setForm(f => ({ ...f, certificate_expiry: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional admin notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SCV record for {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>This plate will be treated as non-self-contained on future scans. This cannot be undone from the UI.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Tab: Homeless Register ───────────────────────────────────────────────────

function HomelessRegisterTab({ isAdmin, isMaster }: { isAdmin: boolean; isMaster: boolean }) {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editRow, setEditRow] = useState<CanonicalHomelessRow | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState({ plate_number: '', status: 'confirmed', notes: '', source: '' })
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['canonical-homeless', search, statusFilter],
    queryFn: async () => {
      let q = (supabase.from('canonical_homeless') as any)
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CanonicalHomelessRow[]
    },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString()
      if (isCreating) {
        const { error } = await (supabase.from('canonical_homeless') as any).insert({
          plate_number: form.plate_number.trim().toUpperCase(),
          status: form.status,
          notes: form.notes || null,
          source: form.source || 'admin_manual',
          confirmed_by: user?.id ?? null,
          confirmed_at: now,
          updated_at: now,
        })
        if (error) throw error
      } else if (editRow) {
        const { error } = await (supabase.from('canonical_homeless') as any)
          .update({
            status: form.status,
            notes: form.notes || null,
            source: form.source || editRow.source || 'admin_manual',
            confirmed_by: user?.id ?? null,
            confirmed_at: now,
            updated_at: now,
          })
          .eq('plate_number', editRow.plate_number)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(isCreating ? 'Homeless record created' : 'Homeless record updated')
      setEditRow(null)
      setIsCreating(false)
      setForm({ plate_number: '', status: 'confirmed', notes: '', source: '' })
      queryClient.invalidateQueries({ queryKey: ['canonical-homeless'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (plate: string) => {
      const { error } = await (supabase.from('canonical_homeless') as any)
        .delete()
        .eq('plate_number', plate)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Homeless record deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['canonical-homeless'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openEdit = (row: CanonicalHomelessRow) => {
    setIsCreating(false)
    setEditRow(row)
    setForm({ plate_number: row.plate_number, status: row.status, notes: row.notes ?? '', source: row.source ?? '' })
  }

  const openCreate = () => {
    setIsCreating(true)
    setEditRow(null)
    setForm({ plate_number: '', status: 'confirmed', notes: '', source: 'admin_manual' })
  }

  const confirmedCount = rows.filter(r => r.status === 'confirmed' || r.status === 'claimed').length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search plate…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="claimed">Claimed</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="freedom_camper">Freedom Camper</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Record
          </Button>
        )}
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['canonical-homeless'] })}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{rows.length} records</span>
        <span className="text-red-600 font-medium">{confirmedCount} homeless/claimed</span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No records found</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {rows.map(row => (
                <div key={row.plate_number} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
                  <Home className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="font-mono font-bold text-sm w-28 shrink-0">{row.plate_number}</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {homelessBadge(row.status)}
                      {row.source && <span className="text-xs text-muted-foreground">src: {row.source}</span>}
                    </div>
                    {row.notes && <p className="text-xs text-muted-foreground line-clamp-2">{row.notes}</p>}
                    <p className="text-xs text-muted-foreground">Updated: {formatDateTime(row.updated_at)}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(row)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isMaster && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row.plate_number)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit / Create dialog */}
      <Dialog open={!!editRow || isCreating} onOpenChange={open => { if (!open) { setEditRow(null); setIsCreating(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isCreating ? 'Add Homeless Record' : `Edit Homeless — ${editRow?.plate_number}`}</DialogTitle>
            <DialogDescription>Set the canonical homeless status for this vehicle plate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {isCreating && (
              <div className="space-y-1.5">
                <Label>Plate Number *</Label>
                <Input
                  value={form.plate_number}
                  onChange={e => setForm(f => ({ ...f, plate_number: e.target.value.toUpperCase() }))}
                  placeholder="e.g. ABC123"
                  className="font-mono uppercase"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOMELESS_STATUS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g. admin_manual, council_referral" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Supporting notes or observations…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditRow(null); setIsCreating(false) }}>Cancel</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || (isCreating && !form.plate_number.trim())}
            >
              {saveMut.isPending ? 'Saving…' : isCreating ? 'Add Record' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete homeless record for {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>This vehicle will no longer have a homeless exemption. This cannot be undone from the UI.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Tab: Canonical Vehicles (master) ─────────────────────────────────────────

function CanonicalVehiclesTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editRow, setEditRow] = useState<CanonicalVehicleRow | null>(null)
  const [form, setForm] = useState({
    vehicle_make: '', vehicle_model: '', vehicle_year: '',
    vehicle_color: '', notes: '',
  })
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['canonical-vehicles-admin', search],
    queryFn: async () => {
      let q = (supabase.from('canonical_vehicles') as any)
        .select([
          'plate_number', 'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_color',
          'self_contained', 'self_contained_expiry', 'homeless_status',
          'is_flagged', 'total_observations', 'total_breaches', 'last_seen_at', 'notes',
        ].join(','))
        .order('plate_number')
        .limit(300)
      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CanonicalVehicleRow[]
    },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editRow) return
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .update({
          vehicle_make: form.vehicle_make || null,
          vehicle_model: form.vehicle_model || null,
          vehicle_year: form.vehicle_year ? parseInt(form.vehicle_year, 10) : null,
          vehicle_color: form.vehicle_color || null,
          notes: form.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('plate_number', editRow.plate_number)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Vehicle updated')
      setEditRow(null)
      queryClient.invalidateQueries({ queryKey: ['canonical-vehicles-admin'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (plate: string) => {
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .delete()
        .eq('plate_number', plate)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Vehicle record deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['canonical-vehicles-admin'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openEdit = (row: CanonicalVehicleRow) => {
    setEditRow(row)
    setForm({
      vehicle_make: row.vehicle_make ?? '',
      vehicle_model: row.vehicle_model ?? '',
      vehicle_year: row.vehicle_year != null ? String(row.vehicle_year) : '',
      vehicle_color: row.vehicle_color ?? '',
      notes: row.notes ?? '',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search plate…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['canonical-vehicles-admin'] })}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{rows.length} records shown (max 300)</p>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No records found</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {rows.map(row => (
                <div key={row.plate_number} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <Car className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-mono font-bold text-sm w-28 shrink-0">{row.plate_number}</span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="text-sm">
                      {[row.vehicle_make, row.vehicle_model, row.vehicle_year, row.vehicle_color].filter(Boolean).join(' · ') || 'Unknown'}
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                      {/* self_contained and homeless_status are denormalised — canonical sources are canonical_scv and canonical_homeless tabs */}
                      {row.self_contained && <span className="text-green-600" title="Denormalised from canonical_scv — manage in SCV Registry tab">SC (denorm)</span>}
                      {row.homeless_status && row.homeless_status !== 'none' && <span className="text-amber-600" title="Denormalised from canonical_homeless — manage in Homeless Register tab">Homeless:{row.homeless_status} (denorm)</span>}
                      <span>{row.total_observations ?? 0} obs</span>
                      {(row.total_breaches ?? 0) > 0 && <span className="text-red-600">{row.total_breaches} breaches</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(row)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row.plate_number)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editRow} onOpenChange={open => { if (!open) setEditRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Vehicle — {editRow?.plate_number}</DialogTitle>
            <DialogDescription>Update canonical vehicle attributes. SCV and homeless status are managed in their respective tabs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Make</Label>
                <Input value={form.vehicle_make} onChange={e => setForm(f => ({ ...f, vehicle_make: e.target.value }))} placeholder="e.g. Toyota" />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input value={form.vehicle_model} onChange={e => setForm(f => ({ ...f, vehicle_model: e.target.value }))} placeholder="e.g. HiAce" />
              </div>
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Input type="number" value={form.vehicle_year} onChange={e => setForm(f => ({ ...f, vehicle_year: e.target.value }))} placeholder="e.g. 2020" />
              </div>
              <div className="space-y-1.5">
                <Label>Colour</Label>
                <Input value={form.vehicle_color} onChange={e => setForm(f => ({ ...f, vehicle_color: e.target.value }))} placeholder="e.g. White" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Admin notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete canonical vehicle {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the vehicle record. All associated observations will lose their canonical reference.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}>
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Tab: Observations (master) ───────────────────────────────────────────────

function ObservationsTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editRow, setEditRow] = useState<ObservationRow | null>(null)
  const [notesForm, setNotesForm] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['observations-master-admin', search],
    queryFn: async () => {
      let q = (supabase.from('observations') as any)
        .select('observation_id, plate_number, recorded_at, is_compliant, is_breach, breach_type, officer_notes, self_contained, zone_id, organization_id')
        .order('recorded_at', { ascending: false })
        .limit(200)
      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ObservationRow[]
    },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editRow) return
      const { error } = await (supabase.from('observations') as any)
        .update({ officer_notes: notesForm || null })
        .eq('observation_id', editRow.observation_id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Observation updated')
      setEditRow(null)
      queryClient.invalidateQueries({ queryKey: ['observations-master-admin'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('observations') as any)
        .delete()
        .eq('observation_id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Observation deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['observations-master-admin'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openEdit = (row: ObservationRow) => {
    setEditRow(row)
    setNotesForm(row.officer_notes ?? '')
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search plate…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['observations-master-admin'] })}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{rows.length} most recent records shown (max 200)</p>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No records found</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {rows.map(row => (
                <div key={row.observation_id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm">{row.plate_number ?? 'No plate'}</span>
                      {row.is_breach
                        ? <Badge variant="destructive" className="text-xs">Breach{row.breach_type ? `: ${row.breach_type}` : ''}</Badge>
                        : <Badge variant="outline" className="text-xs text-green-700 border-green-300">Compliant</Badge>
                      }
                      {row.self_contained && <Badge variant="secondary" className="text-xs">SC</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatDateTime(row.recorded_at)}
                      <span className="font-mono text-xs text-muted-foreground/60">{row.observation_id.slice(0, 8)}…</span>
                    </div>
                    {row.officer_notes && <p className="text-xs text-muted-foreground line-clamp-1">{row.officer_notes}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(row)} title="Edit notes">
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row.observation_id)} title="Delete observation">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit notes dialog */}
      <Dialog open={!!editRow} onOpenChange={open => { if (!open) setEditRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Observation — {editRow?.plate_number}</DialogTitle>
            <DialogDescription>{editRow ? formatDateTime(editRow.recorded_at) : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Officer Notes</Label>
              <Textarea rows={4} value={notesForm} onChange={e => setNotesForm(e.target.value)} placeholder="Officer notes for this observation…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete observation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the observation record and any associated compliance data.
              Breach alerts referencing this observation will be orphaned. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}>
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CanonicalRecordsManager() {
  const { user } = useAuthStore()
  const isMaster = user?.role === 'master' || user?.role === 'grand_master'
  const isAdmin = ['admin', 'admin_officer', 'master', 'grand_master'].includes(user?.role ?? '')

  return (
    <AppLayout title="Canonical Records" description="View and manage canonical SCV, homeless, vehicle and observation records">
      <GlobalFilterRibbon showDateFilter={false} showZoneFilter={false} />

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Canonical Records Manager</h2>
            <p className="text-sm text-muted-foreground">
              Admin: view SCV, manage homeless status.
              {isMaster && ' Master: full edit/delete access on all canonical tables.'}
            </p>
          </div>
        </div>

        <Tabs defaultValue="homeless" className="mt-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="homeless" className="flex items-center gap-1.5">
              <Home className="h-3.5 w-3.5" />
              Homeless Register
            </TabsTrigger>
            <TabsTrigger value="scv" className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              SCV Registry
            </TabsTrigger>
            {isMaster && (
              <>
                <TabsTrigger value="vehicles" className="flex items-center gap-1.5">
                  <Car className="h-3.5 w-3.5" />
                  Vehicles
                </TabsTrigger>
                <TabsTrigger value="observations" className="flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Observations
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="homeless" className="mt-4">
            <HomelessRegisterTab isAdmin={isAdmin} isMaster={isMaster} />
          </TabsContent>

          <TabsContent value="scv" className="mt-4">
            <div className="mb-3">
              {!isMaster && (
                <p className="text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                  SCV records are read-only for admin accounts. Editing requires master role.
                  To update SCV data, run the SCV List Sync in the Data Management Hub.
                </p>
              )}
            </div>
            <ScvRegistryTab isMaster={isMaster} />
          </TabsContent>

          {isMaster && (
            <>
              <TabsContent value="vehicles" className="mt-4">
                <div className="mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  ⚠️ Editing or deleting vehicle records affects all organisations. Deletions cascade to all associated data. Proceed with caution.
                </div>
                <CanonicalVehiclesTab />
              </TabsContent>

              <TabsContent value="observations" className="mt-4">
                <div className="mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  ⚠️ Deleting observations is irreversible and will orphan any breach alerts referencing them. Only delete erroneous records.
                </div>
                <ObservationsTab />
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </AppLayout>
  )
}
