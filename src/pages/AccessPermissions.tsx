/**
 * AccessPermissions — B-46
 *
 * Grant and revoke per-person, per-zone access permissions.
 * Uses the access_permissions table (not in database.ts — uses supabase as any).
 *
 * Features:
 *  - KPI cards: Total / Full Access / Time Restricted / Denied
 *  - Filters: permission_type dropdown, keyword search
 *  - Table: person, zone, type badge, escort required, valid from/until, notes
 *  - Grant dialog: person_record_id (ref), zone_id (ref), type, valid dates, escort toggle, notes
 *  - Revoke (delete) action for admin roles
 */

import { useState } from 'react'
import { format, parseISO, isPast } from 'date-fns'
import {
  KeyRound, Plus, Search, RefreshCw, CheckCircle2,
  AlertCircle, Loader2, XCircle, Clock, UserCheck,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { usePersonRecords } from '@/hooks/usePersonRecords'
import { useZones } from '@/hooks/useZones'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AccessPermission {
  id: string
  organization_id: string
  person_record_id: string
  zone_id: string
  permission_type: 'full_access' | 'time_restricted' | 'escort_required' | 'denied'
  valid_from: string
  valid_until: string | null
  time_restrictions: unknown
  requires_escort: boolean
  escort_person_id: string | null
  notes: string | null
  granted_by: string | null
  created_at: string
  updated_at: string
  person?: { first_name: string | null; last_name: string | null } | null
  zone?: { name: string } | null
  granter?: { first_name: string; last_name: string } | null
}

// ─── Styling maps ──────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  full_access:      { label: 'Full Access',      className: 'bg-green-100 text-green-800' },
  time_restricted:  { label: 'Time Restricted',  className: 'bg-yellow-100 text-yellow-800' },
  escort_required:  { label: 'Escort Required',  className: 'bg-orange-100 text-orange-700' },
  denied:           { label: 'Denied',           className: 'bg-red-100 text-red-700' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function personName(p: { first_name: string | null; last_name: string | null } | null | undefined) {
  if (!p) return '—'
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || '—'
}

function blankPermission(): Partial<AccessPermission> {
  return {
    permission_type: 'full_access',
    valid_from: new Date().toISOString().slice(0, 10),
    valid_until: null,
    requires_escort: false,
    notes: '',
    person_record_id: '',
    zone_id: '',
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

function useAccessPermissions() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['access-permissions', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('access_permissions')
        .select('*, person:person_record_id(first_name, last_name), zone:zone_id(name), granter:granted_by(first_name, last_name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AccessPermission[]
    },
  })

  const grantPermission = useMutation({
    mutationFn: async (input: Partial<AccessPermission>) => {
      const { data, error } = await (supabase as any)
        .from('access_permissions')
        .insert({ ...input, organization_id: orgId, granted_by: user?.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-permissions'] })
      toast.success('Access permission granted')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to grant permission'),
  })

  const revokePermission = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('access_permissions')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-permissions'] })
      toast.success('Permission revoked')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to revoke permission'),
  })

  return {
    ...query,
    permissions: query.data ?? [],
    grantPermission,
    revokePermission,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccessPermissionsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master'

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<Partial<AccessPermission>>(blankPermission())
  const [saving, setSaving] = useState(false)

  const { permissions, isLoading, refetch, grantPermission, revokePermission } = useAccessPermissions()

  // Live lookups for the grant dialog dropdowns
  const { persons: personRecords = [] } = usePersonRecords()
  const { data: zones = [] } = useZones({ showInactive: false })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:          permissions.length,
    fullAccess:     permissions.filter(p => p.permission_type === 'full_access').length,
    timeRestricted: permissions.filter(p => p.permission_type === 'time_restricted').length,
    denied:         permissions.filter(p => p.permission_type === 'denied').length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = permissions.filter(p => {
    if (typeFilter !== 'all' && p.permission_type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !personName(p.person).toLowerCase().includes(q) &&
        !(p.zone?.name ?? '').toLowerCase().includes(q) &&
        !(p.notes ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleGrant() {
    if (!form.person_record_id || !form.zone_id) return
    setSaving(true)
    try {
      await grantPermission.mutateAsync(form)
      setDialogOpen(false)
      setForm(blankPermission())
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Access Permissions" description="Grant and revoke per-person per-zone access permissions">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">Access Permissions</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => { setForm(blankPermission()); setDialogOpen(true) }}>
              <Plus className="h-4 w-4 mr-1" /> Grant Permission
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',          value: kpis.total,          icon: <KeyRound className="h-4 w-4" />,      color: 'text-foreground' },
          { label: 'Full Access',    value: kpis.fullAccess,     icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
          { label: 'Time Restricted',value: kpis.timeRestricted, icon: <Clock className="h-4 w-4" />,        color: 'text-yellow-600' },
          { label: 'Denied',         value: kpis.denied,         icon: <XCircle className="h-4 w-4" />,      color: 'text-red-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search person, zone, notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Permission type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_STYLES).map(([v, s]) => (
              <SelectItem key={v} value={v}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty-state */}
      {!isLoading && permissions.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No access permissions found. Use the Grant Permission button to add one.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Escort Required</TableHead>
              <TableHead>Valid From</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead>Granted By</TableHead>
              <TableHead>Notes</TableHead>
              {isAdmin && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && permissions.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No permissions match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-sm flex items-center gap-1">
                  <UserCheck className="h-3 w-3 text-muted-foreground" />
                  {personName(p.person)}
                </TableCell>
                <TableCell className="text-sm">{p.zone?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_STYLES[p.permission_type]?.className ?? ''}`}>
                    {TYPE_STYLES[p.permission_type]?.label ?? p.permission_type}
                  </span>
                </TableCell>
                <TableCell>
                  {p.requires_escort
                    ? <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">Yes</Badge>
                    : <span className="text-xs text-muted-foreground">No</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(p.valid_from)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {p.valid_until
                    ? <span className={isPast(parseISO(p.valid_until)) ? 'text-red-600' : 'text-muted-foreground'}>{fmtDate(p.valid_until)}</span>
                    : <span className="text-green-600 font-medium text-xs">No expiry</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{personName(p.granter)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{p.notes ?? '—'}</TableCell>
                {isAdmin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 h-7 text-xs"
                      onClick={() => revokePermission.mutate(p.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {permissions.length} permissions
        </p>
      )}

      {/* Grant Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Grant Access Permission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="person_record_id">Person *</Label>
              <Select
                value={form.person_record_id ?? ''}
                onValueChange={v => setForm(f => ({ ...f, person_record_id: v }))}
              >
                <SelectTrigger id="person_record_id">
                  <SelectValue placeholder="Select person…" />
                </SelectTrigger>
                <SelectContent>
                  {personRecords.map(pr => (
                    <SelectItem key={pr.id} value={pr.id}>
                      {[pr.first_name, pr.last_name].filter(Boolean).join(' ') || pr.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="zone_id">Zone *</Label>
              <Select
                value={form.zone_id ?? ''}
                onValueChange={v => setForm(f => ({ ...f, zone_id: v }))}
              >
                <SelectTrigger id="zone_id">
                  <SelectValue placeholder="Select zone…" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="permission_type">Permission Type</Label>
              <Select
                value={form.permission_type ?? 'full_access'}
                onValueChange={v => setForm(f => ({ ...f, permission_type: v as AccessPermission['permission_type'] }))}
              >
                <SelectTrigger id="permission_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_STYLES).map(([v, s]) => (
                    <SelectItem key={v} value={v}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="valid_from">Valid From</Label>
                <Input
                  id="valid_from"
                  type="date"
                  value={form.valid_from ? form.valid_from.slice(0, 10) : ''}
                  onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="valid_until">Valid Until (optional)</Label>
                <Input
                  id="valid_until"
                  type="date"
                  value={form.valid_until ? form.valid_until.slice(0, 10) : ''}
                  onChange={e => setForm(f => ({ ...f, valid_until: e.target.value || null }))}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="requires_escort"
                checked={!!form.requires_escort}
                onCheckedChange={v => setForm(f => ({ ...f, requires_escort: !!v }))}
              />
              <Label htmlFor="requires_escort">Escort required</Label>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="Reason or notes for this permission…"
                value={form.notes ?? ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleGrant}
              disabled={saving || !form.person_record_id || !form.zone_id}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
