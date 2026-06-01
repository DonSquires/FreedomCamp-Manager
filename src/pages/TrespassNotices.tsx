/**
 * TrespassNotices — B-45
 *
 * Issue, search, and manage trespass notices under the Trespass Act 1980.
 * Reuses the useTrespassNotices hook from usePointsOfInterest.
 *
 * Features:
 *  - KPI cards: Total / Active / Expired / Withdrawn
 *  - Filters: status dropdown, notice_type dropdown, keyword search
 *  - Table: reference, person/vehicle, type, status, zone, issuer, issued date, expiry
 *  - Issue dialog: reason, type, duration, served method, zone, person/vehicle refs,
 *    witness, privacy notice checkbox
 *  - Withdraw action for active notices
 */

import { useState } from 'react'
import { format, parseISO, isPast } from 'date-fns'
import {
  Ban, Plus, Search, RefreshCw, CheckCircle2, AlertCircle,
  Clock, XCircle, Loader2, User, Car, MapPin,
} from 'lucide-react'

import {
  useTrespassNotices,
  type TrespassNotice,
} from '@/hooks/usePointsOfInterest'
import { useAuthStore } from '@/stores/authStore'
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

// ─── Styling maps ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active:    { label: 'Active',    className: 'bg-green-100 text-green-800' },
  expired:   { label: 'Expired',   className: 'bg-gray-100 text-gray-600' },
  withdrawn: { label: 'Withdrawn', className: 'bg-orange-100 text-orange-700' },
  appealed:  { label: 'Appealed',  className: 'bg-yellow-100 text-yellow-800' },
}

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  verbal:    { label: 'Verbal',    className: 'bg-blue-100 text-blue-700' },
  written:   { label: 'Written',   className: 'bg-purple-100 text-purple-700' },
  permanent: { label: 'Permanent', className: 'bg-red-100 text-red-700' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function issuedByName(n: { first_name: string; last_name: string } | null | undefined) {
  if (!n) return '—'
  return `${n.first_name ?? ''} ${n.last_name ?? ''}`.trim() || '—'
}

function isExpired(n: TrespassNotice): boolean {
  if (n.status === 'expired') return true
  return n.status === 'active' && !!n.expires_at && isPast(parseISO(n.expires_at))
}

function blankNotice(): Partial<TrespassNotice> {
  return {
    trespass_reason: '',
    notice_type: 'written',
    duration_days: 365,
    status: 'active',
    trespass_from: '',
    legal_basis: 'Trespass Act 1980, Section 3 & 4',
    served_method: 'in_person',
    witness_present: false,
    witness_name: '',
    privacy_notice_given: false,
    notes: '',
    person_id: null,
    vehicle_id: null,
    zone_id: null,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrespassNoticesPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master' || user?.role === 'grand_master'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<Partial<TrespassNotice>>(blankNotice())
  const [saving, setSaving] = useState(false)

  const { notices, isLoading, refetch, createNotice, updateNotice } = useTrespassNotices(
    statusFilter !== 'all' ? { status: statusFilter } : {}
  )

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:     notices.length,
    active:    notices.filter(n => n.status === 'active').length,
    expired:   notices.filter(isExpired).length,
    withdrawn: notices.filter(n => n.status === 'withdrawn').length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = notices.filter(n => {
    if (typeFilter !== 'all' && n.notice_type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !(n.trespass_reason ?? '').toLowerCase().includes(q) &&
        !(n.reference_number ?? '').toLowerCase().includes(q) &&
        !(n.person?.full_name ?? '').toLowerCase().includes(q) &&
        !(n.vehicle?.plate_number ?? '').toLowerCase().includes(q) &&
        !(n.zone?.name ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleIssue() {
    if (!form.trespass_reason?.trim()) return
    setSaving(true)
    try {
      await createNotice.mutateAsync(form)
      setDialogOpen(false)
      setForm(blankNotice())
    } finally {
      setSaving(false)
    }
  }

  async function handleWithdraw(n: TrespassNotice) {
    await updateNotice.mutateAsync({ id: n.id, status: 'withdrawn' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Trespass Notices" description="Manage trespass notices under the Trespass Act 1980">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Ban className="h-5 w-5 text-destructive" />
          <span className="font-semibold text-lg">Trespass Notices</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => { setForm(blankNotice()); setDialogOpen(true) }}>
              <Plus className="h-4 w-4 mr-1" /> Issue Notice
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',     value: kpis.total,     icon: <Ban className="h-4 w-4" />,          color: 'text-foreground' },
          { label: 'Active',    value: kpis.active,    icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
          { label: 'Expired',   value: kpis.expired,   icon: <Clock className="h-4 w-4" />,        color: 'text-gray-500' },
          { label: 'Withdrawn', value: kpis.withdrawn, icon: <XCircle className="h-4 w-4" />,      color: 'text-orange-600' },
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
            placeholder="Search reason, reference, person, plate, zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_STYLES).map(([v, s]) => (
              <SelectItem key={v} value={v}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Type" />
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
      {!isLoading && notices.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No trespass notices found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Person / Vehicle</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Issued By</TableHead>
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
            {!isLoading && filtered.length === 0 && notices.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No notices match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(n => (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-xs">
                  {n.reference_number ?? <span className="text-muted-foreground italic">—</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {n.person?.full_name && (
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span>{n.person.full_name}</span>
                    </div>
                  )}
                  {n.vehicle?.plate_number && (
                    <div className="flex items-center gap-1">
                      <Car className="h-3 w-3 text-muted-foreground" />
                      <span>{n.vehicle.plate_number}</span>
                    </div>
                  )}
                  {!n.person?.full_name && !n.vehicle?.plate_number && (
                    <span className="text-muted-foreground italic">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_STYLES[n.notice_type]?.className ?? ''}`}>
                    {TYPE_STYLES[n.notice_type]?.label ?? n.notice_type}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[n.status]?.className ?? ''}`}>
                    {STATUS_STYLES[n.status]?.label ?? n.status}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {n.zone?.name
                    ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{n.zone.name}</span>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(n.issued_at)}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {n.expires_at
                    ? <span className={isPast(parseISO(n.expires_at)) ? 'text-red-600' : ''}>{fmtDate(n.expires_at)}</span>
                    : <span className="text-red-600 font-medium">Permanent</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{issuedByName(n.issuer)}</TableCell>
                {isAdmin && (
                  <TableCell>
                    {n.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-orange-600 hover:text-orange-700 h-7 text-xs"
                        onClick={() => handleWithdraw(n)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {notices.length} notices
        </p>
      )}

      {/* Issue Notice Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue Trespass Notice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="trespass_reason">Reason *</Label>
              <Textarea
                id="trespass_reason"
                placeholder="Describe the reason for trespass…"
                rows={3}
                value={form.trespass_reason ?? ''}
                onChange={e => setForm(f => ({ ...f, trespass_reason: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="notice_type">Notice Type</Label>
                <Select
                  value={form.notice_type ?? 'written'}
                  onValueChange={v => setForm(f => ({ ...f, notice_type: v as TrespassNotice['notice_type'] }))}
                >
                  <SelectTrigger id="notice_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verbal">Verbal</SelectItem>
                    <SelectItem value="written">Written</SelectItem>
                    <SelectItem value="permanent">Permanent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="served_method">Served Method</Label>
                <Select
                  value={form.served_method ?? 'in_person'}
                  onValueChange={v => setForm(f => ({ ...f, served_method: v }))}
                >
                  <SelectTrigger id="served_method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_person">In Person</SelectItem>
                    <SelectItem value="posted">Posted</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="left_on_vehicle">Left on Vehicle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="duration_days">Duration (days)</Label>
                <Input
                  id="duration_days"
                  type="number"
                  min={1}
                  value={form.duration_days ?? 365}
                  onChange={e => setForm(f => ({ ...f, duration_days: Number(e.target.value) }))}
                />
                <p className="text-xs text-muted-foreground mt-1">Leave blank / 0 for permanent</p>
              </div>
              <div>
                <Label htmlFor="trespass_from">Trespass From (location)</Label>
                <Input
                  id="trespass_from"
                  placeholder="e.g. Riverside Reserve"
                  value={form.trespass_from ?? ''}
                  onChange={e => setForm(f => ({ ...f, trespass_from: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="legal_basis">Legal Basis</Label>
              <Input
                id="legal_basis"
                value={form.legal_basis ?? 'Trespass Act 1980, Section 3 & 4'}
                onChange={e => setForm(f => ({ ...f, legal_basis: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="witness_name">Witness Name</Label>
              <Input
                id="witness_name"
                placeholder="Name of witness if present"
                value={form.witness_name ?? ''}
                onChange={e => setForm(f => ({ ...f, witness_name: e.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="witness_present"
                  checked={!!form.witness_present}
                  onCheckedChange={v => setForm(f => ({ ...f, witness_present: !!v }))}
                />
                <Label htmlFor="witness_present">Witness present</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="privacy_notice_given"
                  checked={!!form.privacy_notice_given}
                  onCheckedChange={v => setForm(f => ({ ...f, privacy_notice_given: !!v }))}
                />
                <Label htmlFor="privacy_notice_given">Privacy notice given</Label>
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="Internal notes…"
                value={form.notes ?? ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleIssue}
              disabled={saving || !form.trespass_reason?.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Issue Notice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
