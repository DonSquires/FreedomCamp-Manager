/**
 * AccessPermissions — Sprint 14 / B-46
 *
 * Dedicated view for managing zone-level access permissions per person.
 * `access_permissions` is NOT in database.ts — uses (supabase as any).
 * Person/zone dropdowns via usePersonRecords + useZones.
 *
 * Features:
 * - KPI cards: Total / Active (not expired) / Escort-Required / Denied
 * - Table with permission_type filter, zone filter, free-text search
 * - Grant new permission dialog (person + zone + type + valid_until)
 * - Revoke action
 *
 * Route: /access-permissions
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { format, parseISO, isAfter } from 'date-fns'
import { ArrowLeft, CheckCircle2, Clock, Lock, Plus, Search, Shield, X } from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { usePersonRecords } from '@/hooks/usePersonRecords'
import { useZones } from '@/hooks/useZones'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ──────────────────────────────────────────────────────────────────────

type PermissionType = 'full_access' | 'time_restricted' | 'escort_required' | 'denied'

interface AccessPermission {
  id: string
  organization_id: string
  person_record_id: string
  zone_id: string
  permission_type: PermissionType
  valid_from: string
  valid_until: string | null
  time_restrictions: any | null
  requires_escort: boolean
  escort_person_id: string | null
  notes: string | null
  granted_by: string | null
  created_at: string
  updated_at: string
  person?: { first_name: string; last_name: string } | null
  zone?: { name: string } | null
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PERM_TYPE_CONFIG: Record<PermissionType, { label: string; color: string }> = {
  full_access:       { label: 'Full Access',       color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  time_restricted:   { label: 'Time Restricted',   color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  escort_required:   { label: 'Escort Required',   color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  denied:            { label: 'Denied',             color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  try { return format(parseISO(s), 'd MMM yyyy') } catch { return s }
}

function personName(p: AccessPermission) {
  if (!p.person) return '—'
  return [p.person.first_name, p.person.last_name].filter(Boolean).join(' ') || '—'
}

function isActive(p: AccessPermission) {
  if (!p.valid_until) return true
  return isAfter(parseISO(p.valid_until), new Date())
}

// ─── Grant Dialog ───────────────────────────────────────────────────────────────

interface GrantDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: Record<string, any>) => void
  isSaving: boolean
  persons: Array<{ id: string; first_name: string | null; last_name: string | null }>
  zones: Array<{ id: string; name: string }>
}

function GrantDialog({ open, onClose, onSubmit, isSaving, persons, zones }: GrantDialogProps) {
  const [form, setForm] = useState({
    person_record_id: '',
    zone_id: '',
    permission_type: 'full_access' as PermissionType,
    valid_until: '',
    requires_escort: false,
    notes: '',
  })

  const handleSubmit = () => {
    if (!form.person_record_id || !form.zone_id) return
    onSubmit({
      ...form,
      requires_escort: form.permission_type === 'escort_required' ? true : form.requires_escort,
      valid_until: form.valid_until || null,
    })
  }

  const set = (key: string) => (value: any) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-500" />
            Grant Access Permission
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Person <span className="text-red-500">*</span></Label>
            <Select value={form.person_record_id} onValueChange={set('person_record_id')}>
              <SelectTrigger>
                <SelectValue placeholder="Select a person…" />
              </SelectTrigger>
              <SelectContent>
                {persons.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {[p.first_name, p.last_name].filter(Boolean).join(' ') || p.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Zone <span className="text-red-500">*</span></Label>
            <Select value={form.zone_id} onValueChange={set('zone_id')}>
              <SelectTrigger>
                <SelectValue placeholder="Select a zone…" />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Permission Type</Label>
            <Select value={form.permission_type} onValueChange={set('permission_type') as any}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PERM_TYPE_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Valid Until (leave blank = indefinite)</Label>
            <Input
              type="date"
              value={form.valid_until}
              onChange={(e) => set('valid_until')(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !form.person_record_id || !form.zone_id}>
            {isSaving ? 'Saving…' : 'Grant Permission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function AccessPermissions() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  const [typeFilter, setTypeFilter] = useState('all')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [grantOpen, setGrantOpen] = useState(false)

  // Fetch permissions
  const { data: permissions = [], isLoading } = useQuery<AccessPermission[]>({
    queryKey: ['access-permissions', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('access_permissions')
        .select('*, person:person_record_id(first_name, last_name), zone:zone_id(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return []
      if (error) throw error
      return (data ?? []) as AccessPermission[]
    },
    enabled: !!orgId,
    staleTime: 60_000,
    retry: false,
  })

  // Person / Zone dropdowns
  const { persons: personRows } = usePersonRecords()
  const { data: zoneRows = [] } = useZones()

  // KPIs
  const kpis = useMemo(() => ({
    total:   permissions.length,
    active:  permissions.filter(isActive).length,
    escort:  permissions.filter((p) => p.permission_type === 'escort_required').length,
    denied:  permissions.filter((p) => p.permission_type === 'denied').length,
  }), [permissions])

  // Filtered rows
  const filtered = useMemo(() => {
    return permissions.filter((p) => {
      if (typeFilter !== 'all' && p.permission_type !== typeFilter) return false
      if (zoneFilter !== 'all' && p.zone_id !== zoneFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = personName(p).toLowerCase()
        const zone = (p.zone?.name ?? '').toLowerCase()
        const notes = (p.notes ?? '').toLowerCase()
        if (!name.includes(q) && !zone.includes(q) && !notes.includes(q)) return false
      }
      return true
    })
  }, [permissions, typeFilter, zoneFilter, search])

  // Grant permission
  const grantMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { error } = await (supabase as any)
        .from('access_permissions')
        .insert({ ...values, organization_id: orgId, granted_by: user?.id })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-permissions'] })
      toast.success('Permission granted')
      setGrantOpen(false)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to grant permission'),
  })

  // Revoke permission
  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const yesterday = new Date(Date.now() - 86400000).toISOString()
      const { error } = await (supabase as any)
        .from('access_permissions')
        .update({ valid_until: yesterday })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-permissions'] })
      toast.success('Permission revoked')
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to revoke permission'),
  })

  return (
    <AppLayout
      title="Access Permissions"
      description="Zone-level access control — grant, restrict, or deny individual access rights per person and zone"
    >
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/admin')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',          value: kpis.total,  Icon: Lock,         color: 'text-blue-600' },
          { label: 'Active',         value: kpis.active, Icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Escort Required',value: kpis.escort, Icon: Shield,       color: 'text-amber-600' },
          { label: 'Denied',         value: kpis.denied, Icon: X,            color: 'text-red-600' },
        ].map(({ label, value, Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-bold leading-tight">{isLoading ? '—' : value}</p>
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
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search person, zone, notes…"
            className="pl-8 w-56 h-8 text-xs"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Permission type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(PERM_TYPE_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={zoneFilter} onValueChange={setZoneFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Zone" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All zones</SelectItem>
            {zoneRows.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setGrantOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Grant Permission
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Person</TableHead>
                <TableHead className="text-xs">Zone</TableHead>
                <TableHead className="text-xs">Permission</TableHead>
                <TableHead className="text-xs">Valid From</TableHead>
                <TableHead className="text-xs">Valid Until</TableHead>
                <TableHead className="text-xs">Escort</TableHead>
                <TableHead className="text-xs">Notes</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    No permissions match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((perm) => {
                  const cfg = PERM_TYPE_CONFIG[perm.permission_type] ?? PERM_TYPE_CONFIG.denied
                  const expired = perm.valid_until ? !isAfter(parseISO(perm.valid_until), new Date()) : false
                  return (
                    <TableRow key={perm.id} className={expired ? 'opacity-50' : ''}>
                      <TableCell className="py-2 text-sm font-medium">{personName(perm)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{perm.zone?.name ?? '—'}</TableCell>
                      <TableCell className="py-2">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(perm.valid_from)}</TableCell>
                      <TableCell className="py-2 text-xs">
                        {perm.valid_until
                          ? <span className={expired ? 'text-red-500' : 'text-muted-foreground'}>{fmtDate(perm.valid_until)}</span>
                          : <span className="text-muted-foreground">Indefinite</span>
                        }
                      </TableCell>
                      <TableCell className="py-2 text-xs text-center">
                        {perm.requires_escort
                          ? <Shield className="h-3.5 w-3.5 text-amber-500 mx-auto" aria-label="Escort required" />
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground max-w-[120px] truncate" title={perm.notes ?? undefined}>
                        {perm.notes ?? '—'}
                      </TableCell>
                      <TableCell className="py-2">
                        {!expired && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] text-red-700 hover:text-red-900"
                            onClick={() => revokeMutation.mutate(perm.id)}
                            disabled={revokeMutation.isPending}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} of {permissions.length} permission{permissions.length !== 1 ? 's' : ''}
            {permissions.length >= 500 && ' (capped at 500)'}
          </div>
        )}
      </Card>

      {/* Grant dialog */}
      <GrantDialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        onSubmit={(v) => grantMutation.mutate(v)}
        isSaving={grantMutation.isPending}
        persons={personRows as any}
        zones={zoneRows as any}
      />
    </AppLayout>
  )
}
