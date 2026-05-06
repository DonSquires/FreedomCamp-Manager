/**
 * OfficerAllowances — Sprint 16 / B-54
 *
 * Manages allowance types (admin-defined categories) and officer allowance
 * records (individual assignments with approval workflow).
 *
 * Tables: allowance_types, officer_allowances — NOT in database.ts; uses (supabase as any).
 *
 * Tabs:
 *   1. Allowances — list of officer_allowances with approve/reject actions
 *   2. Types      — CRUD for allowance_types
 *
 * Features per tab:
 *   Allowances: KPIs (Pending / Approved / Total $), officer/status/category filters,
 *               approve + reject (with reason) row actions.
 *   Types: list allowance_types with add + toggle-active actions.
 *
 * Route: /officer-allowances
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowLeft,
  BadgeDollarSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Layers,
  Plus,
  Search,
  Sliders,
  Tag,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

// ─── Types ──────────────────────────────────────────────────────────────────────

type AllowanceStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled'
type RateType = 'flat' | 'hourly' | 'daily' | 'percentage' | 'per_km' | 'per_unit'
type AllowanceCategory =
  | 'higher_duties' | 'meal' | 'uniform' | 'travel' | 'on_call' | 'tool'
  | 'first_aid' | 'training' | 'remote' | 'hazard' | 'shift' | 'general' | 'custom'

interface AllowanceType {
  id: string
  organization_id: string
  code: string
  name: string
  description: string | null
  category: AllowanceCategory
  rate_type: RateType
  default_rate: number | null
  is_taxable: boolean
  requires_approval: boolean
  is_active: boolean
  created_at: string
}

interface OfficerAllowance {
  id: string
  organization_id: string
  officer_id: string
  allowance_type_id: string
  effective_date: string
  end_date: string | null
  rate: number
  rate_type: RateType
  quantity: number
  total_amount: number | null
  acting_role: string | null
  status: AllowanceStatus
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  notes: string | null
  created_at: string
  officer?: { first_name: string; last_name: string } | null
  allowance_type?: { name: string; category: AllowanceCategory; code: string } | null
}

interface Officer {
  id: string
  first_name: string
  last_name: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AllowanceStatus, { label: string; color: string }> = {
  pending:   { label: 'Pending',   color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved:  { label: 'Approved',  color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected:  { label: 'Rejected',  color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  paid:      { label: 'Paid',      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400' },
}

const CATEGORY_LABELS: Record<AllowanceCategory, string> = {
  higher_duties: 'Higher Duties',
  meal:          'Meal',
  uniform:       'Uniform',
  travel:        'Travel',
  on_call:       'On-Call',
  tool:          'Tool/Equipment',
  first_aid:     'First Aid',
  training:      'Training',
  remote:        'Remote Location',
  hazard:        'Hazardous Duty',
  shift:         'Shift Loading',
  general:       'General',
  custom:        'Custom',
}

const RATE_TYPE_LABELS: Record<RateType, string> = {
  flat:       'Flat',
  hourly:     '/hr',
  daily:      '/day',
  percentage: '%',
  per_km:     '/km',
  per_unit:   '/unit',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(v: number | null) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function officerName(a: OfficerAllowance) {
  if (!a.officer) return '—'
  return [a.officer.first_name, a.officer.last_name].filter(Boolean).join(' ')
}

// ─── Add Allowance Type Dialog ──────────────────────────────────────────────────

interface AddTypeDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (v: Record<string, any>) => void
  isSaving: boolean
}

function AddTypeDialog({ open, onClose, onSubmit, isSaving }: AddTypeDialogProps) {
  const [form, setForm] = useState({
    code: '', name: '', description: '',
    category: 'general' as AllowanceCategory,
    rate_type: 'flat' as RateType,
    default_rate: '',
    is_taxable: true,
    requires_approval: true,
  })
  const set = (k: string) => (v: any) => setForm((f) => ({ ...f, [k]: v }))
  const isValid = form.code.trim() && form.name.trim()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-violet-500" />
            New Allowance Type
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Code <span className="text-red-500">*</span></Label>
              <Input placeholder="e.g. HD" value={form.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} />
            </div>
            <div className="grid gap-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input placeholder="Higher Duties" value={form.name} onChange={(e) => set('name')(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={set('category') as any}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Rate Type</Label>
              <Select value={form.rate_type} onValueChange={set('rate_type') as any}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RATE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{k} ({v})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Default Rate (NZD)</Label>
              <Input type="number" step="0.01" min="0" value={form.default_rate}
                onChange={(e) => set('default_rate')(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set('description')(e.target.value)}
              placeholder="Optional description…" />
          </div>
          <div className="flex items-center gap-6 pt-1">
            <div className="flex items-center gap-2">
              <Switch checked={form.is_taxable} onCheckedChange={set('is_taxable')} id="taxable" />
              <Label htmlFor="taxable" className="cursor-pointer">Taxable</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.requires_approval} onCheckedChange={set('requires_approval')} id="approval" />
              <Label htmlFor="approval" className="cursor-pointer">Requires Approval</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={() => onSubmit({
            ...form,
            default_rate: form.default_rate ? parseFloat(form.default_rate) : null,
            description: form.description || null,
          })} disabled={isSaving || !isValid}>
            {isSaving ? 'Saving…' : 'Create Type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Add Allowance Dialog ───────────────────────────────────────────────────────

interface AddAllowanceDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (v: Record<string, any>) => void
  isSaving: boolean
  officers: Officer[]
  types: AllowanceType[]
}

function AddAllowanceDialog({ open, onClose, onSubmit, isSaving, officers, types }: AddAllowanceDialogProps) {
  const [form, setForm] = useState({
    officer_id: '',
    allowance_type_id: '',
    effective_date: format(new Date(), 'yyyy-MM-dd'),
    rate: '',
    rate_type: 'flat' as RateType,
    quantity: '1',
    acting_role: '',
    notes: '',
  })
  const set = (k: string) => (v: any) => setForm((f) => ({ ...f, [k]: v }))

  // Pre-fill rate from selected type
  const selectedType = types.find((t) => t.id === form.allowance_type_id)

  const handleTypeChange = (typeId: string) => {
    const t = types.find((x) => x.id === typeId)
    setForm((f) => ({
      ...f,
      allowance_type_id: typeId,
      rate: t?.default_rate != null ? String(t.default_rate) : f.rate,
      rate_type: t?.rate_type ?? f.rate_type,
    }))
  }

  const isValid = form.officer_id && form.allowance_type_id && form.rate && form.effective_date

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeDollarSign className="h-4 w-4 text-emerald-500" />
            Add Allowance
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
          <div className="grid gap-1.5">
            <Label>Allowance Type <span className="text-red-500">*</span></Label>
            <Select value={form.allowance_type_id} onValueChange={handleTypeChange}>
              <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>
                {types.filter((t) => t.is_active).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label>Rate <span className="text-red-500">*</span></Label>
              <Input type="number" step="0.01" min="0" value={form.rate}
                onChange={(e) => set('rate')(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Rate Type</Label>
              <Select value={form.rate_type} onValueChange={set('rate_type') as any}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RATE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Quantity</Label>
              <Input type="number" step="0.5" min="0.5" value={form.quantity}
                onChange={(e) => set('quantity')(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Effective Date <span className="text-red-500">*</span></Label>
            <Input type="date" value={form.effective_date}
              onChange={(e) => set('effective_date')(e.target.value)} />
          </div>
          {selectedType?.category === 'higher_duties' && (
            <div className="grid gap-1.5">
              <Label>Acting Role</Label>
              <Input value={form.acting_role} onChange={(e) => set('acting_role')(e.target.value)}
                placeholder="e.g. Supervisor" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)}
              rows={2} placeholder="Optional notes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={() => onSubmit({
            officer_id: form.officer_id,
            allowance_type_id: form.allowance_type_id,
            effective_date: form.effective_date,
            rate: parseFloat(form.rate),
            rate_type: form.rate_type,
            quantity: parseFloat(form.quantity),
            acting_role: form.acting_role || null,
            notes: form.notes || null,
            status: 'pending',
          })} disabled={isSaving || !isValid}>
            {isSaving ? 'Saving…' : 'Add Allowance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Reject Dialog ──────────────────────────────────────────────────────────────

function RejectDialog({
  open,
  onClose,
  onSubmit,
  isSaving,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
  isSaving: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reject Allowance</DialogTitle></DialogHeader>
        <div className="grid gap-2 py-2">
          <Label>Reason (optional)</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this allowance is rejected…" />
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

// ─── Allowances Tab ─────────────────────────────────────────────────────────────

function AllowancesTab({
  allowances,
  isLoading,
  officers,
  types,
  onApprove,
  onReject,
  orgId,
  userId,
}: {
  allowances: OfficerAllowance[]
  isLoading: boolean
  officers: Officer[]
  types: AllowanceType[]
  onApprove: (id: string) => void
  onReject: (id: string, reason: string) => void
  orgId: string
  userId: string
}) {
  const qc = useQueryClient()
  const [officerFilter, setOfficerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)

  const addMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { error } = await (supabase as any).from('officer_allowances').insert({
        ...values,
        organization_id: orgId,
        created_by: userId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['officer-allowances'] })
      toast.success('Allowance added')
      setAddOpen(false)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to add allowance'),
  })

  // KPIs
  const kpis = useMemo(() => ({
    pending:  allowances.filter((a) => a.status === 'pending').length,
    approved: allowances.filter((a) => a.status === 'approved').length,
    totalPendingAmt: allowances
      .filter((a) => a.status === 'pending')
      .reduce((s, a) => s + (a.total_amount ?? 0), 0),
    totalApprovedAmt: allowances
      .filter((a) => a.status === 'approved' || a.status === 'paid')
      .reduce((s, a) => s + (a.total_amount ?? 0), 0),
  }), [allowances])

  const filtered = useMemo(() => allowances.filter((a) => {
    if (officerFilter !== 'all' && a.officer_id !== officerFilter) return false
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    if (categoryFilter !== 'all' && a.allowance_type?.category !== categoryFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = officerName(a).toLowerCase()
      const typeName = (a.allowance_type?.name ?? '').toLowerCase()
      if (!name.includes(q) && !typeName.includes(q)) return false
    }
    return true
  }), [allowances, officerFilter, statusFilter, categoryFilter, search])

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Pending',           value: kpis.pending,                         Icon: Clock,         color: 'text-amber-600' },
          { label: 'Approved',          value: kpis.approved,                        Icon: CheckCircle2,  color: 'text-emerald-600' },
          { label: 'Pending Amount',    value: fmtCurrency(kpis.totalPendingAmt),    Icon: DollarSign,    color: 'text-amber-600', raw: true },
          { label: 'Approved Amount',   value: fmtCurrency(kpis.totalApprovedAmt),   Icon: BadgeDollarSign, color: 'text-emerald-600', raw: true },
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
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search officer, type…" className="pl-8 w-48 h-8 text-xs" />
        </div>
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />Add Allowance
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Officer</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Rate</TableHead>
                <TableHead className="text-xs">Qty</TableHead>
                <TableHead className="text-xs">Total</TableHead>
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
                    No allowances match the current filters.
                  </TableCell>
                </TableRow>
              ) : filtered.map((a) => {
                const statusCfg = STATUS_CONFIG[a.status] ?? STATUS_CONFIG.pending
                return (
                  <TableRow key={a.id}>
                    <TableCell className="py-2 text-sm font-medium">{officerName(a)}</TableCell>
                    <TableCell className="py-2 text-xs">
                      {a.allowance_type ? (
                        <span className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">
                          {a.allowance_type.code}
                        </span>
                      ) : '—'}
                      {' '}{a.allowance_type?.name}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {a.allowance_type ? CATEGORY_LABELS[a.allowance_type.category] : '—'}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {a.effective_date}
                    </TableCell>
                    <TableCell className="py-2 text-xs">
                      {fmtCurrency(a.rate)}{RATE_TYPE_LABELS[a.rate_type]}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {a.quantity}
                    </TableCell>
                    <TableCell className="py-2 text-xs font-medium">
                      {fmtCurrency(a.total_amount)}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </TableCell>
                    <TableCell className="py-2">
                      {a.status === 'pending' && (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm"
                            className="h-6 px-2 text-[10px] text-emerald-700 hover:text-emerald-900"
                            onClick={() => onApprove(a.id)}>
                            Approve
                          </Button>
                          <Button variant="ghost" size="sm"
                            className="h-6 px-2 text-[10px] text-red-700 hover:text-red-900"
                            onClick={() => setRejectTarget(a.id)}>
                            Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} of {allowances.length} allowance{allowances.length !== 1 ? 's' : ''}
          </div>
        )}
      </Card>

      <AddAllowanceDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(v) => addMutation.mutate(v)}
        isSaving={addMutation.isPending}
        officers={officers}
        types={types}
      />
      <RejectDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onSubmit={(reason) => {
          if (rejectTarget) onReject(rejectTarget, reason)
          setRejectTarget(null)
        }}
        isSaving={false}
      />
    </>
  )
}

// ─── Types Tab ──────────────────────────────────────────────────────────────────

function TypesTab({
  types,
  isLoading,
  orgId,
  userId,
}: {
  types: AllowanceType[]
  isLoading: boolean
  orgId: string
  userId: string
}) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const addMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { error } = await (supabase as any).from('allowance_types').insert({
        ...values,
        organization_id: orgId,
        created_by: userId,
        is_active: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allowance-types'] })
      toast.success('Allowance type created')
      setAddOpen(false)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to create type'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('allowance_types')
        .update({ is_active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['allowance-types'] }),
    onError: (e: any) => toast.error(e?.message || 'Failed to update type'),
  })

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" />New Type
        </Button>
      </div>
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Code</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Default Rate</TableHead>
                <TableHead className="text-xs">Rate Type</TableHead>
                <TableHead className="text-xs">Taxable</TableHead>
                <TableHead className="text-xs">Approval Required</TableHead>
                <TableHead className="text-xs">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                ))
              ) : types.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    No allowance types defined yet. Click "New Type" to add one.
                  </TableCell>
                </TableRow>
              ) : types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="py-2">
                    <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs font-bold">{t.code}</span>
                  </TableCell>
                  <TableCell className="py-2 text-sm font-medium">{t.name}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </TableCell>
                  <TableCell className="py-2 text-xs">
                    {t.default_rate != null ? fmtCurrency(t.default_rate) : '—'}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {t.rate_type}
                  </TableCell>
                  <TableCell className="py-2 text-center">
                    {t.is_taxable
                      ? <Check className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
                      : <X className="h-3.5 w-3.5 text-muted-foreground mx-auto" />}
                  </TableCell>
                  <TableCell className="py-2 text-center">
                    {t.requires_approval
                      ? <Check className="h-3.5 w-3.5 text-blue-500 mx-auto" />
                      : <X className="h-3.5 w-3.5 text-muted-foreground mx-auto" />}
                  </TableCell>
                  <TableCell className="py-2">
                    <Switch
                      checked={t.is_active}
                      onCheckedChange={(v) => toggleActiveMutation.mutate({ id: t.id, is_active: v })}
                      disabled={toggleActiveMutation.isPending}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AddTypeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(v) => addMutation.mutate(v)}
        isSaving={addMutation.isPending}
      />
    </>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function OfficerAllowances() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const userId = user?.id ?? ''
  const qc = useQueryClient()

  // ── Fetch allowance types ──────────────────────────────────────────────────
  const { data: types = [], isLoading: typesLoading } = useQuery<AllowanceType[]>({
    queryKey: ['allowance-types', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('allowance_types')
        .select('*')
        .eq('organization_id', orgId)
        .order('category')
        .order('name')
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return []
      if (error) throw error
      return (data ?? []) as AllowanceType[]
    },
    enabled: !!orgId,
    staleTime: 60_000,
    retry: false,
  })

  // ── Fetch officer allowances ───────────────────────────────────────────────
  const { data: allowances = [], isLoading: allowancesLoading } = useQuery<OfficerAllowance[]>({
    queryKey: ['officer-allowances', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('officer_allowances')
        .select(`
          *,
          officer:officer_id(first_name, last_name),
          allowance_type:allowance_type_id(name, category, code)
        `)
        .eq('organization_id', orgId)
        .order('effective_date', { ascending: false })
        .limit(300)
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return []
      if (error) throw error
      return (data ?? []) as OfficerAllowance[]
    },
    enabled: !!orgId,
    staleTime: 30_000,
    retry: false,
  })

  // ── Fetch officers ─────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<Officer[]>({
    queryKey: ['allowance-officers', orgId],
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

  // ── Approve mutation ───────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('officer_allowances')
        .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['officer-allowances'] })
      toast.success('Allowance approved')
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve'),
  })

  // ── Reject mutation ────────────────────────────────────────────────────────
  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await (supabase as any)
        .from('officer_allowances')
        .update({ status: 'rejected', rejection_reason: reason || null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['officer-allowances'] })
      toast.success('Allowance rejected')
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject'),
  })

  return (
    <AppLayout
      title="Officer Allowances"
      description="Manage higher duties, meal, uniform, and custom allowances for officers"
    >
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}
          className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Button>
      </div>

      <Tabs defaultValue="allowances">
        <TabsList className="mb-4">
          <TabsTrigger value="allowances" className="gap-1.5">
            <BadgeDollarSign className="h-3.5 w-3.5" />
            Allowances
          </TabsTrigger>
          <TabsTrigger value="types" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Allowance Types
          </TabsTrigger>
        </TabsList>

        <TabsContent value="allowances">
          <AllowancesTab
            allowances={allowances}
            isLoading={allowancesLoading}
            officers={officers}
            types={types}
            onApprove={(id) => approveMutation.mutate(id)}
            onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
            orgId={orgId}
            userId={userId}
          />
        </TabsContent>

        <TabsContent value="types">
          <TypesTab
            types={types}
            isLoading={typesLoading}
            orgId={orgId}
            userId={userId}
          />
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
