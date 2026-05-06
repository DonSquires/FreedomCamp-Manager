/**
 * ServiceAgreements — B-39
 *
 * Admin UI for managing service agreements between the organisation and
 * client organisations (alarm, patrol, freedom-camping, parking, etc.).
 *
 * Features:
 *   - KPI cards: Total, Active, Expiring (≤30 days), Expired
 *   - Filterable list by type, status, search
 *   - Create / Edit dialog with full field set
 *   - Toggle active / inactive
 *   - Delete with confirmation
 */

import { useState } from 'react'
import { format, parseISO, differenceInDays, isPast, isWithinInterval, addDays } from 'date-fns'
import { toast } from 'sonner'
import {
  FileText, Plus, Search, Pencil, Trash2, ToggleLeft, ToggleRight,
  Loader2, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

// ─── Local Types ──────────────────────────────────────────────────────────────

type ServiceAgreement = {
  id: string
  organization_id: string
  client_org_id: string | null
  name: string
  reference_number: string | null
  agreement_type: string
  allows_client_submission: boolean
  allows_auto_dispatch: boolean
  default_sla_minutes: number
  default_priority: string
  active_from: string | null
  active_to: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGREEMENT_TYPES = [
  'alarm', 'patrol', 'noise_control', 'freedom_camping',
  'parking', 'investigation', 'guarding', 'biosecurity', 'ems', 'other',
]

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']

const EMPTY_FORM = {
  name: '',
  reference_number: '',
  agreement_type: 'patrol',
  allows_client_submission: false,
  allows_auto_dispatch: false,
  default_sla_minutes: 60,
  default_priority: 'normal',
  active_from: '',
  active_to: '',
  notes: '',
  is_active: true,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return format(parseISO(d), 'dd MMM yyyy') } catch { return d }
}

function expiryStatus(active_to: string | null): 'expired' | 'expiring' | 'active' | 'open' {
  if (!active_to) return 'open'
  const to = parseISO(active_to)
  if (isPast(to)) return 'expired'
  if (isWithinInterval(to, { start: new Date(), end: addDays(new Date(), 30) })) return 'expiring'
  return 'active'
}

function expiryBadge(active_to: string | null) {
  const s = expiryStatus(active_to)
  const map: Record<string, string> = {
    expired:  'bg-red-100 text-red-800',
    expiring: 'bg-yellow-100 text-yellow-800',
    active:   'bg-green-100 text-green-800',
    open:     'bg-blue-100 text-blue-700',
  }
  const label: Record<string, string> = {
    expired: 'Expired', expiring: 'Expiring Soon', active: 'Active', open: 'Open-ended',
  }
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[s]}`}>
      {label[s]}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ServiceAgreements() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  // Filters
  const [search, setSearch]           = useState('')
  const [filterType, setFilterType]   = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  // Dialog
  const [showDialog, setShowDialog]   = useState(false)
  const [editing, setEditing]         = useState<ServiceAgreement | null>(null)
  const [form, setForm]               = useState({ ...EMPTY_FORM })

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<ServiceAgreement | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: agreements = [], isLoading, refetch } = useQuery({
    queryKey: ['service_agreements', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('service_agreements')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ServiceAgreement[]
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveAgreement = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        name: form.name.trim(),
        reference_number: form.reference_number.trim() || null,
        agreement_type: form.agreement_type,
        allows_client_submission: form.allows_client_submission,
        allows_auto_dispatch: form.allows_auto_dispatch,
        default_sla_minutes: form.default_sla_minutes,
        default_priority: form.default_priority,
        active_from: form.active_from || null,
        active_to: form.active_to || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
        created_by: user?.id ?? null,
      }
      if (editing) {
        const { error } = await (supabase as any)
          .from('service_agreements')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('service_agreements')
          .insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_agreements', orgId] })
      toast.success(editing ? 'Agreement updated' : 'Agreement created')
      closeDialog()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('service_agreements')
        .update({ is_active: !is_active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_agreements', orgId] })
      toast.success('Agreement updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteAgreement = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('service_agreements')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_agreements', orgId] })
      toast.success('Agreement deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Dialog helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setShowDialog(true)
  }

  function openEdit(a: ServiceAgreement) {
    setEditing(a)
    setForm({
      name: a.name,
      reference_number: a.reference_number ?? '',
      agreement_type: a.agreement_type,
      allows_client_submission: a.allows_client_submission,
      allows_auto_dispatch: a.allows_auto_dispatch,
      default_sla_minutes: a.default_sla_minutes,
      default_priority: a.default_priority,
      active_from: a.active_from ?? '',
      active_to: a.active_to ?? '',
      notes: a.notes ?? '',
      is_active: a.is_active,
    })
    setShowDialog(true)
  }

  function closeDialog() {
    setShowDialog(false)
    setEditing(null)
  }

  function setField<K extends keyof typeof EMPTY_FORM>(k: K, v: typeof EMPTY_FORM[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = agreements.filter(a => {
    if (filterType !== 'all' && a.agreement_type !== filterType) return false
    if (filterStatus === 'active' && !a.is_active) return false
    if (filterStatus === 'inactive' && a.is_active) return false
    if (filterStatus === 'expiring' && expiryStatus(a.active_to) !== 'expiring') return false
    if (filterStatus === 'expired' && expiryStatus(a.active_to) !== 'expired') return false
    if (search) {
      const q = search.toLowerCase()
      if (!a.name.toLowerCase().includes(q) && !(a.reference_number ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:    agreements.length,
    active:   agreements.filter(a => a.is_active).length,
    expiring: agreements.filter(a => expiryStatus(a.active_to) === 'expiring').length,
    expired:  agreements.filter(a => expiryStatus(a.active_to) === 'expired').length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Service Agreements" description="Manage client and operational service agreements">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">Service Agreements</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Agreement
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: kpis.total,    color: 'text-foreground' },
          { label: 'Active', value: kpis.active,   color: 'text-green-600' },
          { label: 'Expiring ≤30d', value: kpis.expiring, color: 'text-yellow-600' },
          { label: 'Expired', value: kpis.expired, color: 'text-red-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Expiry warning banner */}
      {kpis.expiring > 0 && (
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-md px-4 py-2 mb-4 text-sm text-yellow-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{kpis.expiring} agreement{kpis.expiring > 1 ? 's' : ''} expiring within 30 days — review and renew.</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or reference…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {AGREEMENT_TYPES.map(t => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="expiring">Expiring</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Valid From</TableHead>
              <TableHead>Valid To</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No agreements found.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(a => (
              <TableRow key={a.id}>
                <TableCell className="font-medium max-w-36 truncate">{a.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {a.reference_number ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize text-xs">
                    {a.agreement_type.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{a.default_sla_minutes} min</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(a.active_from)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(a.active_to)}</TableCell>
                <TableCell>{expiryBadge(a.active_to)}</TableCell>
                <TableCell>
                  <span className={`text-xs font-medium ${a.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                    {a.is_active ? 'Active' : 'Inactive'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={a.is_active ? 'Deactivate' : 'Activate'}
                      onClick={() => toggleActive.mutate({ id: a.id, is_active: a.is_active })}
                    >
                      {a.is_active
                        ? <ToggleRight className="h-4 w-4 text-green-600" />
                        : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(a)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(a)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={open => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Agreement' : 'New Service Agreement'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder="e.g. Annual Parking Patrol Contract"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Agreement Type</Label>
                <Select value={form.agreement_type} onValueChange={v => setField('agreement_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGREEMENT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Reference / PO Number</Label>
                <Input
                  value={form.reference_number}
                  onChange={e => setField('reference_number', e.target.value)}
                  placeholder="PO-2026-001"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Default SLA (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.default_sla_minutes}
                  onChange={e => setField('default_sla_minutes', Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label>Default Priority</Label>
                <Select value={form.default_priority} onValueChange={v => setField('default_priority', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map(p => (
                      <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Active From</Label>
                <Input
                  type="date"
                  value={form.active_from}
                  onChange={e => setField('active_from', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Active To <span className="text-muted-foreground font-normal">(blank = open-ended)</span></Label>
                <Input
                  type="date"
                  value={form.active_to}
                  onChange={e => setField('active_to', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Allow Client Submission</p>
                  <p className="text-xs text-muted-foreground">Client staff can submit jobs via the client portal</p>
                </div>
                <Switch
                  checked={form.allows_client_submission}
                  onCheckedChange={v => setField('allows_client_submission', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-Dispatch</p>
                  <p className="text-xs text-muted-foreground">Submitted jobs bypass approval and are dispatched immediately</p>
                </div>
                <Switch
                  checked={form.allows_auto_dispatch}
                  onCheckedChange={v => setField('allows_auto_dispatch', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Active</p>
                </div>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={v => setField('is_active', v)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={e => setField('notes', e.target.value)}
                placeholder="Additional agreement terms or context"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={() => saveAgreement.mutate()}
              disabled={!form.name.trim() || saveAgreement.isPending}
            >
              {saveAgreement.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editing ? 'Save Changes' : 'Create Agreement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agreement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteAgreement.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}
