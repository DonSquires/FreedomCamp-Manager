/**
 * TrespassNotices — Sprint 14 / B-45
 *
 * Dedicated standalone view for trespass notice management.
 * Reuses `useTrespassNotices` from usePointsOfInterest.ts.
 *
 * Features:
 * - KPI cards: Total / Active / Expired / Withdrawn
 * - Table with status filter, notice type filter, free-text search
 * - Issue new notice inline dialog
 * - Update status (withdraw / expire) action
 *
 * Route: /trespass-notices
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Clock, FileText, Search, X } from 'lucide-react'

import { useTrespassNotices } from '@/hooks/usePointsOfInterest'
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
import type { TrespassNotice } from '@/hooks/usePointsOfInterest'

// ─── Types ──────────────────────────────────────────────────────────────────────

type NoticeStatus = 'active' | 'expired' | 'withdrawn' | 'appealed'

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<NoticeStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.FC<{ className?: string }> }> = {
  active:    { label: 'Active',    variant: 'default',     icon: CheckCircle2 },
  expired:   { label: 'Expired',   variant: 'secondary',   icon: Clock },
  withdrawn: { label: 'Withdrawn', variant: 'outline',     icon: X },
  appealed:  { label: 'Appealed',  variant: 'destructive', icon: AlertTriangle },
}

const NOTICE_TYPES: Record<string, string> = {
  verbal:    'Verbal',
  written:   'Written',
  permanent: 'Permanent',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  try { return format(parseISO(s), 'd MMM yyyy') } catch { return s }
}

function subjectLabel(n: TrespassNotice) {
  if (n.person?.full_name) return n.person.full_name
  if (n.vehicle?.plate_number) return n.vehicle.plate_number
  return '—'
}

// ─── Issue Notice Dialog (minimal — full form lives in PointsOfInterest) ───────

interface IssueDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: Partial<TrespassNotice>) => void
  isSaving: boolean
}

function IssueNoticeDialog({ open, onClose, onSubmit, isSaving }: IssueDialogProps) {
  const [form, setForm] = useState({
    notice_type: 'written' as 'verbal' | 'written' | 'permanent',
    trespass_reason: '',
    legal_basis: 'Trespass Act 1980, Section 3 & 4',
    duration_days: 90,
    notes: '',
  })

  const handleSubmit = () => {
    if (!form.trespass_reason.trim()) return
    onSubmit(form)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-500" />
            Issue Trespass Notice
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Notice Type</Label>
            <Select value={form.notice_type} onValueChange={(v) => setForm({ ...form, notice_type: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(NOTICE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Reason <span className="text-red-500">*</span></Label>
            <Textarea
              value={form.trespass_reason}
              onChange={(e) => setForm({ ...form, trespass_reason: e.target.value })}
              rows={3}
              placeholder="Describe the trespass reason…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Legal Basis</Label>
            <Input
              value={form.legal_basis}
              onChange={(e) => setForm({ ...form, legal_basis: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Duration (days)</Label>
            <Input
              type="number"
              min={1}
              value={form.duration_days}
              onChange={(e) => setForm({ ...form, duration_days: Number(e.target.value) })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Optional internal notes…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !form.trespass_reason.trim()}>
            {isSaving ? 'Saving…' : 'Issue Notice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function TrespassNotices() {
  const navigate = useNavigate()

  // State
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [issueOpen, setIssueOpen] = useState(false)

  // Data — pass no status filter to load all statuses; filter client-side for KPIs
  const { notices, isLoading, createNotice, updateNotice } = useTrespassNotices()

  // KPIs
  const kpis = useMemo(() => ({
    total:     notices.length,
    active:    notices.filter((n) => n.status === 'active').length,
    expired:   notices.filter((n) => n.status === 'expired').length,
    withdrawn: notices.filter((n) => n.status === 'withdrawn').length,
  }), [notices])

  // Filtered rows
  const filtered = useMemo(() => {
    return notices.filter((n) => {
      if (statusFilter !== 'all' && n.status !== statusFilter) return false
      if (typeFilter !== 'all' && n.notice_type !== typeFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const subject = subjectLabel(n).toLowerCase()
        const zone = (n.zone?.name ?? '').toLowerCase()
        const reason = (n.trespass_reason ?? '').toLowerCase()
        const ref = (n.reference_number ?? '').toLowerCase()
        if (!subject.includes(q) && !zone.includes(q) && !reason.includes(q) && !ref.includes(q)) return false
      }
      return true
    })
  }, [notices, statusFilter, typeFilter, search])

  const handleIssue = (values: Partial<TrespassNotice>) => {
    createNotice.mutate(values, { onSuccess: () => setIssueOpen(false) })
  }

  const handleWithdraw = (notice: TrespassNotice) => {
    updateNotice.mutate({ id: notice.id, status: 'withdrawn' })
  }

  return (
    <AppLayout
      title="Trespass Notices"
      description="Manage active and historical trespass notices issued under the NZ Trespass Act 1980"
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
          { label: 'Total', value: kpis.total,     Icon: FileText,     color: 'text-blue-600' },
          { label: 'Active', value: kpis.active,    Icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Expired', value: kpis.expired,   Icon: Clock,        color: 'text-gray-500' },
          { label: 'Withdrawn', value: kpis.withdrawn, Icon: X,            color: 'text-amber-600' },
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
            placeholder="Search person, plate, zone, ref…"
            className="pl-8 w-60 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="withdrawn">Withdrawn</SelectItem>
            <SelectItem value="appealed">Appealed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(NOTICE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setIssueOpen(true)}>
            <Ban className="h-3.5 w-3.5" />
            Issue Notice
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Reference</TableHead>
                <TableHead className="text-xs">Subject</TableHead>
                <TableHead className="text-xs">Zone</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Issued</TableHead>
                <TableHead className="text-xs">Expires</TableHead>
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
                    No trespass notices match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((notice) => {
                  const statusCfg = STATUS_CONFIG[notice.status as NoticeStatus] ?? STATUS_CONFIG.active
                  const StatusIcon = statusCfg.icon
                  return (
                    <TableRow key={notice.id}>
                      <TableCell className="py-2 text-xs font-mono text-muted-foreground">
                        {notice.reference_number ?? '—'}
                      </TableCell>
                      <TableCell className="py-2 text-sm font-medium">{subjectLabel(notice)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{notice.zone?.name ?? '—'}</TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {NOTICE_TYPES[notice.notice_type] ?? notice.notice_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant={statusCfg.variant} className="text-[10px] px-1.5 py-0 gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {statusCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(notice.issued_at)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {notice.expires_at
                          ? <span className={new Date(notice.expires_at) < new Date() ? 'text-red-500' : ''}>{fmtDate(notice.expires_at)}</span>
                          : '—'
                        }
                      </TableCell>
                      <TableCell className="py-2">
                        {notice.status === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] text-amber-700 hover:text-amber-900"
                            onClick={() => handleWithdraw(notice)}
                            disabled={updateNotice.isPending}
                          >
                            Withdraw
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
            {filtered.length} of {notices.length} notice{notices.length !== 1 ? 's' : ''}
          </div>
        )}
      </Card>

      {/* Issue dialog */}
      <IssueNoticeDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onSubmit={handleIssue}
        isSaving={createNotice.isPending}
      />
    </AppLayout>
  )
}
