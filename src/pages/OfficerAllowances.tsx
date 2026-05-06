/**
 * OfficerAllowances — B-54
 *
 * Allowance management with two tabs:
 *  - Allowances: manage officer_allowances (assign, approve, reject)
 *  - Types:      manage allowance_types (create, edit, toggle active)
 *
 * Features:
 *  - KPI cards: Pending / Approved / Rejected / Total Paid
 *  - Approve / Reject workflow for submitted allowances
 *  - Type management: code, name, category, rate_type, default_rate, requires_approval
 *
 * Route: /officer-allowances  — admin/admin_officer/master
 * Note: allowance_types/officer_allowances not in database.ts — uses (supabase as any)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BadgeDollarSign, CheckCircle, XCircle, Clock, AlertCircle,
  Loader2, Plus, RefreshCw, Settings, List, Pencil, Trash2,
  DollarSign,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AllowanceType {
  id: string
  organization_id: string
  code: string
  name: string
  description: string | null
  category: string
  rate_type: string
  default_rate: number | null
  currency: string
  is_taxable: boolean
  requires_approval: boolean
  is_active: boolean
  is_system: boolean
  created_at: string
}

interface OfficerAllowance {
  id: string
  organization_id: string
  officer_id: string
  officer?: { full_name: string; call_sign: string | null }
  allowance_type_id: string
  allowance_type?: AllowanceType
  effective_date: string
  end_date: string | null
  quantity: number | null
  rate: number | null
  total_amount: number | null
  status: string
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
}

interface OfficerOption {
  id: string
  full_name: string
  call_sign: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  higher_duties: 'Higher Duties',
  meal: 'Meal',
  uniform: 'Uniform',
  travel: 'Travel',
  on_call: 'On-Call',
  tool: 'Tool/Equipment',
  first_aid: 'First Aid',
  training: 'Training',
  remote: 'Remote/Isolated',
  hazard: 'Hazardous Duty',
  shift: 'Shift Loading',
  general: 'General',
  custom: 'Custom',
}

const RATE_TYPE_LABELS: Record<string, string> = {
  flat: 'Flat (per occurrence)',
  hourly: 'Hourly',
  daily: 'Daily',
  percentage: 'Percentage of base pay',
  per_km: 'Per km',
  per_unit: 'Per unit',
}

const STATUS_COLOURS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-gray-100 text-gray-700',
}

const EMPTY_TYPE_FORM = {
  code: '', name: '', description: '', category: 'general',
  rate_type: 'flat', default_rate: '', requires_approval: false,
}

const EMPTY_ALLOWANCE_FORM = {
  officer_id: '', allowance_type_id: '',
  effective_date: '', end_date: '',
  quantity: '', rate: '', notes: '',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OfficerAllowances() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const queryClient = useQueryClient()

  const [tab, setTab] = useState('allowances')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  // Type dialog
  const [showTypeDialog, setShowTypeDialog] = useState(false)
  const [editingType, setEditingType] = useState<AllowanceType | null>(null)
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE_FORM)

  // Allowance dialog
  const [showAllowanceDialog, setShowAllowanceDialog] = useState(false)
  const [allowanceForm, setAllowanceForm] = useState(EMPTY_ALLOWANCE_FORM)

  // ── Officers ────────────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<OfficerOption[]>({
    queryKey: ['allowance-officers', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, full_name, call_sign')
        .eq('organization_id', orgId)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as OfficerOption[]
    },
    enabled: !!orgId,
  })

  // ── Allowance Types ─────────────────────────────────────────────────────────
  const { data: types = [], refetch: refetchTypes } = useQuery<AllowanceType[]>({
    queryKey: ['allowance-types', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('allowance_types')
        .select('*')
        .eq('organization_id', orgId)
        .order('category')
        .order('name')
      if (error) throw error
      return (data ?? []) as AllowanceType[]
    },
    enabled: !!orgId,
  })

  // ── Officer Allowances ──────────────────────────────────────────────────────
  const { data: allowances = [], isLoading: allowancesLoading, refetch: refetchAllowances } = useQuery<OfficerAllowance[]>({
    queryKey: ['officer-allowances', orgId, statusFilter, typeFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('officer_allowances')
        .select(`
          *,
          officer:user_profiles!officer_allowances_officer_id_fkey(full_name, call_sign),
          allowance_type:allowance_types!officer_allowances_allowance_type_id_fkey(id, code, name, category)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all') q = q.eq('allowance_type_id', typeFilter)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OfficerAllowance[]
    },
    enabled: !!orgId,
  })

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = {
    pending: allowances.filter((a) => a.status === 'pending').length,
    approved: allowances.filter((a) => a.status === 'approved').length,
    rejected: allowances.filter((a) => a.status === 'rejected').length,
    totalPaid: allowances.filter((a) => a.status === 'paid').reduce((s, a) => s + (a.total_amount ?? 0), 0),
  }

  // ── Approve / Reject ────────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: Record<string, any> = { status }
      if (status === 'approved') {
        update.approved_at = new Date().toISOString()
      }
      const { error } = await (supabase as any)
        .from('officer_allowances')
        .update(update)
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(`Allowance ${vars.status}`)
      queryClient.invalidateQueries({ queryKey: ['officer-allowances'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Update failed'),
  })

  // ── Create / Edit Allowance Type ────────────────────────────────────────────
  const saveTypeMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        code: typeForm.code.toUpperCase(),
        name: typeForm.name,
        description: typeForm.description || null,
        category: typeForm.category,
        rate_type: typeForm.rate_type,
        default_rate: typeForm.default_rate ? parseFloat(typeForm.default_rate) : null,
        requires_approval: typeForm.requires_approval,
      }
      if (editingType) {
        const { error } = await (supabase as any)
          .from('allowance_types')
          .update(payload)
          .eq('id', editingType.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('allowance_types')
          .insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingType ? 'Type updated' : 'Type created')
      setShowTypeDialog(false)
      setEditingType(null)
      setTypeForm(EMPTY_TYPE_FORM)
      queryClient.invalidateQueries({ queryKey: ['allowance-types'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Save failed'),
  })

  // ── Toggle Type Active ──────────────────────────────────────────────────────
  const toggleTypeMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('allowance_types')
        .update({ is_active })
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allowance-types'] }),
    onError: (err: any) => toast.error(err.message ?? 'Toggle failed'),
  })

  // ── Create Allowance ────────────────────────────────────────────────────────
  const createAllowanceMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        organization_id: orgId,
        officer_id: allowanceForm.officer_id,
        allowance_type_id: allowanceForm.allowance_type_id,
        effective_date: allowanceForm.effective_date,
        end_date: allowanceForm.end_date || null,
        quantity: allowanceForm.quantity ? parseFloat(allowanceForm.quantity) : null,
        rate: allowanceForm.rate ? parseFloat(allowanceForm.rate) : null,
        status: 'pending',
        notes: allowanceForm.notes || null,
      }
      const { error } = await (supabase as any)
        .from('officer_allowances')
        .insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Allowance assigned')
      setShowAllowanceDialog(false)
      setAllowanceForm(EMPTY_ALLOWANCE_FORM)
      queryClient.invalidateQueries({ queryKey: ['officer-allowances'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to assign'),
  })

  const openTypeEdit = (t: AllowanceType) => {
    setEditingType(t)
    setTypeForm({
      code: t.code,
      name: t.name,
      description: t.description ?? '',
      category: t.category,
      rate_type: t.rate_type,
      default_rate: t.default_rate != null ? String(t.default_rate) : '',
      requires_approval: t.requires_approval,
    })
    setShowTypeDialog(true)
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BadgeDollarSign className="h-6 w-6 text-primary" />
              Officer Allowances
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage allowance types and officer allowance assignments
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetchAllowances(); refetchTypes() }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending', value: kpis.pending, icon: Clock, colour: 'text-yellow-600' },
            { label: 'Approved', value: kpis.approved, icon: CheckCircle, colour: 'text-green-600' },
            { label: 'Rejected', value: kpis.rejected, icon: XCircle, colour: 'text-red-600' },
            { label: 'Total Paid', value: `$${kpis.totalPaid.toFixed(2)}`, icon: DollarSign, colour: 'text-emerald-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                  <Icon className={`h-7 w-7 ${colour} opacity-70`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="allowances">
              <List className="h-4 w-4 mr-1.5" /> Allowances
            </TabsTrigger>
            <TabsTrigger value="types">
              <Settings className="h-4 w-4 mr-1.5" /> Types
            </TabsTrigger>
          </TabsList>

          {/* ── Allowances Tab ──────────────────────────────────────────── */}
          <TabsContent value="allowances" className="space-y-4">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 text-sm w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Allowance Type</Label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-8 text-sm w-52">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {types.filter((t) => t.is_active).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => setShowAllowanceDialog(true)}>
                <Plus className="h-4 w-4 mr-1" /> Assign Allowance
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {allowancesLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : allowances.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>No allowances found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Effective Date</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allowances.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm font-medium">{a.officer?.full_name ?? '—'}</TableCell>
                          <TableCell>
                            <div className="text-sm">{a.allowance_type?.name ?? '—'}</div>
                            {a.allowance_type?.category && (
                              <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[a.allowance_type.category] ?? a.allowance_type.category}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {a.effective_date ? format(parseISO(a.effective_date), 'dd MMM yyyy') : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {a.rate != null ? `$${Number(a.rate).toFixed(2)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {a.total_amount != null ? `$${Number(a.total_amount).toFixed(2)}` : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLOURS[a.status] ?? ''}>{a.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {a.status === 'pending' && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-green-700 border-green-300"
                                  onClick={() => statusMutation.mutate({ id: a.id, status: 'approved' })}
                                  disabled={statusMutation.isPending}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-red-600 hover:text-red-700"
                                  onClick={() => statusMutation.mutate({ id: a.id, status: 'rejected' })}
                                  disabled={statusMutation.isPending}
                                >
                                  Reject
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Types Tab ──────────────────────────────────────────────────── */}
          <TabsContent value="types" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setEditingType(null); setTypeForm(EMPTY_TYPE_FORM); setShowTypeDialog(true) }}>
                <Plus className="h-4 w-4 mr-1" /> New Type
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Rate Type</TableHead>
                      <TableHead className="text-right">Default Rate</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.map((t) => (
                      <TableRow key={t.id} className={!t.is_active ? 'opacity-50' : ''}>
                        <TableCell className="font-mono text-sm font-medium">{t.code}</TableCell>
                        <TableCell className="text-sm">{t.name}</TableCell>
                        <TableCell className="text-sm">{CATEGORY_LABELS[t.category] ?? t.category}</TableCell>
                        <TableCell className="text-sm">{RATE_TYPE_LABELS[t.rate_type] ?? t.rate_type}</TableCell>
                        <TableCell className="text-right text-sm">
                          {t.default_rate != null ? `$${Number(t.default_rate).toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.requires_approval ? 'default' : 'secondary'}>
                            {t.requires_approval ? 'Required' : 'Auto'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={t.is_active}
                            onCheckedChange={(v) => toggleTypeMutation.mutate({ id: t.id, is_active: v })}
                            disabled={t.is_system}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openTypeEdit(t)}
                            disabled={t.is_system}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Type Dialog */}
      <Dialog open={showTypeDialog} onOpenChange={(o) => { if (!o) { setShowTypeDialog(false); setEditingType(null); setTypeForm(EMPTY_TYPE_FORM) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingType ? 'Edit Allowance Type' : 'New Allowance Type'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code *</Label>
                <Input placeholder="e.g. HD" value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} />
              </div>
              <div>
                <Label>Name *</Label>
                <Input placeholder="Higher Duties Allowance" value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input placeholder="Optional description" value={typeForm.description} onChange={(e) => setTypeForm({ ...typeForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={typeForm.category} onValueChange={(v) => setTypeForm({ ...typeForm, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rate Type</Label>
                <Select value={typeForm.rate_type} onValueChange={(v) => setTypeForm({ ...typeForm, rate_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(RATE_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Default Rate (NZD)</Label>
              <Input type="number" step="0.01" placeholder="e.g. 25.00" value={typeForm.default_rate} onChange={(e) => setTypeForm({ ...typeForm, default_rate: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="requires-approval"
                checked={typeForm.requires_approval}
                onCheckedChange={(v) => setTypeForm({ ...typeForm, requires_approval: v })}
              />
              <Label htmlFor="requires-approval" className="cursor-pointer">Requires approval before payment</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowTypeDialog(false); setEditingType(null); setTypeForm(EMPTY_TYPE_FORM) }}>Cancel</Button>
            <Button
              onClick={() => saveTypeMutation.mutate()}
              disabled={!typeForm.code || !typeForm.name || saveTypeMutation.isPending}
            >
              {saveTypeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingType ? 'Save Changes' : 'Create Type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Allowance Dialog */}
      <Dialog open={showAllowanceDialog} onOpenChange={setShowAllowanceDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Allowance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Officer *</Label>
              <Select value={allowanceForm.officer_id} onValueChange={(v) => setAllowanceForm({ ...allowanceForm, officer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
                <SelectContent>
                  {officers.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Allowance Type *</Label>
              <Select value={allowanceForm.allowance_type_id} onValueChange={(v) => setAllowanceForm({ ...allowanceForm, allowance_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {types.filter((t) => t.is_active).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Effective Date *</Label>
                <Input type="date" value={allowanceForm.effective_date} onChange={(e) => setAllowanceForm({ ...allowanceForm, effective_date: e.target.value })} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={allowanceForm.end_date} onChange={(e) => setAllowanceForm({ ...allowanceForm, end_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantity</Label>
                <Input type="number" step="0.01" placeholder="e.g. 1" value={allowanceForm.quantity} onChange={(e) => setAllowanceForm({ ...allowanceForm, quantity: e.target.value })} />
              </div>
              <div>
                <Label>Rate (NZD)</Label>
                <Input type="number" step="0.01" placeholder="Override rate" value={allowanceForm.rate} onChange={(e) => setAllowanceForm({ ...allowanceForm, rate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={allowanceForm.notes} onChange={(e) => setAllowanceForm({ ...allowanceForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAllowanceDialog(false); setAllowanceForm(EMPTY_ALLOWANCE_FORM) }}>Cancel</Button>
            <Button
              onClick={() => createAllowanceMutation.mutate()}
              disabled={!allowanceForm.officer_id || !allowanceForm.allowance_type_id || !allowanceForm.effective_date || createAllowanceMutation.isPending}
            >
              {createAllowanceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
