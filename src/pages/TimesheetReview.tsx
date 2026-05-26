/**
 * TimesheetReview — Admin page for reviewing and approving officer shift hours.
 * Mirrors Deputy's timesheet approval workflow: admins can review each officer's
 * logged shift, add notes, and approve or reject before payroll export.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Clock,
  CheckCircle,
  XCircle,
  Download,
  Filter,
  User,
  MapPin,
  Calendar,
  ClipboardList,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface OfficerShift {
  id: string
  officer_id: string
  organization_id: string
  started_at: string
  ended_at: string | null
  end_reason: string | null
  gps_start_lat: number | null
  gps_start_lng: number | null
  approval_status: 'pending' | 'approved' | 'rejected'
  approved_at: string | null
  admin_notes: string | null
  officer: {
    first_name: string
    last_name: string
    email: string
  } | null
  approved_by_user: {
    first_name: string
    last_name: string
  } | null
  zone: {
    name: string
  } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDurationMins(started: string, ended: string | null): string {
  if (!ended) return 'In progress'
  const mins = Math.round((new Date(ended).getTime() - new Date(started).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function totalHours(started: string, ended: string | null): number {
  if (!ended) return 0
  return (new Date(ended).getTime() - new Date(started).getTime()) / 3600000
}

const APPROVAL_META: Record<string, { label: string; className: string }> = {
  pending:  { label: 'Pending',  className: 'border-yellow-300 text-yellow-700 bg-yellow-50' },
  approved: { label: 'Approved', className: 'border-green-300 text-green-700 bg-green-50'   },
  rejected: { label: 'Rejected', className: 'border-red-300  text-red-700  bg-red-50'       },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TimesheetReview() {
  const { user } = useAuthStore()
  const qc = useQueryClient()

  // ── Filters ──────────────────────────────────────────────────────────────
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  const [dateFrom, setDateFrom]         = useState(firstOfMonth)
  const [dateTo, setDateTo]             = useState(todayStr)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [officerFilter, setOfficerFilter] = useState('')

  // ── B-20 Export dialog ────────────────────────────────────────────────────
  type ExportFormat = 'generic' | 'xero' | 'myob'
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('generic')

  // ── Review dialog ─────────────────────────────────────────────────────────
  const [reviewing, setReviewing] = useState<OfficerShift | null>(null)
  const [notesDraft, setNotesDraft] = useState('')

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: shifts = [], isLoading } = useQuery<OfficerShift[]>({
    queryKey: ['timesheets', user?.organization_id, dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('officer_shifts')
        .select(`
          id,
          officer_id,
          organization_id,
          started_at,
          ended_at,
          end_reason,
          gps_start_lat,
          gps_start_lng,
          approval_status,
          approved_at,
          admin_notes,
          officer:user_profiles!officer_id(first_name, last_name, email),
          approved_by_user:user_profiles!approved_by(first_name, last_name),
          zone:zones!parent_zone_id(name)
        `)
        .eq('organization_id', user?.organization_id ?? '')
        .gte('started_at', `${dateFrom}T00:00:00`)
        .lte('started_at', `${dateTo}T23:59:59`)
        .order('started_at', { ascending: false })

      if (error) throw error
      return (data ?? []) as unknown as OfficerShift[]
    },
    enabled: !!user?.organization_id,
  })

  // ── Filtered view ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = shifts
    if (statusFilter !== 'all') {
      rows = rows.filter(s => s.approval_status === statusFilter)
    }
    if (officerFilter.trim()) {
      const q = officerFilter.toLowerCase()
      rows = rows.filter(s => {
        const name = `${s.officer?.first_name ?? ''} ${s.officer?.last_name ?? ''}`.toLowerCase()
        return name.includes(q) || (s.officer?.email ?? '').toLowerCase().includes(q)
      })
    }
    return rows
  }, [shifts, statusFilter, officerFilter])

  // ── Summary stats ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const pending  = shifts.filter(s => s.approval_status === 'pending').length
    const approved = shifts.filter(s => s.approval_status === 'approved').length
    const rejected = shifts.filter(s => s.approval_status === 'rejected').length
    const totalHrs = shifts
      .filter(s => s.approval_status === 'approved')
      .reduce((sum, s) => sum + totalHours(s.started_at, s.ended_at), 0)
    return { pending, approved, rejected, totalHrs: totalHrs.toFixed(1) }
  }, [shifts])

  // ── Approve / Reject mutation ─────────────────────────────────────────────
  const updateApproval = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: 'approved' | 'rejected'; notes: string }) => {
      const { error } = await (supabase
        .from('officer_shifts') as any)
        .update({
          approval_status: status,
          approved_by:     user?.id,
          approved_at:     new Date().toISOString(),
          admin_notes:     notes || null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(vars.status === 'approved' ? 'Timesheet approved' : 'Timesheet rejected')
      qc.invalidateQueries({ queryKey: ['timesheets'] })
      setReviewing(null)
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Failed to update timesheet')
    },
  })

  function openReview(shift: OfficerShift) {
    setReviewing(shift)
    setNotesDraft(shift.admin_notes ?? '')
  }

  function submitApproval(status: 'approved' | 'rejected') {
    if (!reviewing) return
    updateApproval.mutate({ id: reviewing.id, status, notes: notesDraft })
  }

  // ── CSV Export (B-20) ────────────────────────────────────────────────────
  function triggerDownload(csv: string, filename: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function csvRow(values: string[]): string {
    return values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  }

  /** Generic Field Compliance CSV — matches original export columns */
  function buildGenericCsv(): string {
    const rows = [
      csvRow(['Officer', 'Email', 'Zone', 'Shift Start', 'Shift End', 'Duration', 'Status', 'Admin Notes']),
      ...filtered.map(s => csvRow([
        `${s.officer?.first_name ?? ''} ${s.officer?.last_name ?? ''}`.trim(),
        s.officer?.email ?? '',
        s.zone?.name ?? '',
        s.started_at,
        s.ended_at ?? '',
        formatDurationMins(s.started_at, s.ended_at),
        s.approval_status,
        s.admin_notes ?? '',
      ])),
    ]
    return rows.join('\n')
  }

  /**
   * Xero Payroll CSV format
   * Ref: Xero Payroll Import guide (NZ edition)
   * Required columns: Employee Code, First Name, Last Name, Date, Start Time, End Time,
   *   Units, Pay Item, Notes
   */
  function buildXeroCsv(): string {
    const rows = [
      csvRow(['Employee Code', 'First Name', 'Last Name', 'Date', 'Start Time', 'End Time', 'Units', 'Pay Item', 'Notes']),
      ...filtered.filter(s => s.approval_status === 'approved' && s.ended_at).map(s => {
        const start = new Date(s.started_at)
        const end   = new Date(s.ended_at!)
        const hours = Math.round((end.getTime() - start.getTime()) / 3600000 * 100) / 100
        return csvRow([
          s.officer_id?.slice(0, 8).toUpperCase() ?? '',
          s.officer?.first_name ?? '',
          s.officer?.last_name  ?? '',
          start.toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          start.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false }),
          end.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false }),
          String(hours),
          'Ordinary Time',
          s.admin_notes ?? '',
        ])
      }),
    ]
    return rows.join('\n')
  }

  /**
   * MYOB PayGlobal / AccountRight CSV format
   * Ref: MYOB AccountRight Timesheets import guide (NZ)
   * Required columns: Employee ID, Employee Name, Date, Start Time, End Time,
   *   Hours, Activity, Cost Centre, Notes
   */
  function buildMyobCsv(): string {
    const rows = [
      csvRow(['Employee ID', 'Employee Name', 'Date', 'Start Time', 'End Time', 'Hours', 'Activity', 'Cost Centre', 'Notes']),
      ...filtered.filter(s => s.approval_status === 'approved' && s.ended_at).map(s => {
        const start = new Date(s.started_at)
        const end   = new Date(s.ended_at!)
        const hours = Math.round((end.getTime() - start.getTime()) / 3600000 * 100) / 100
        return csvRow([
          s.officer_id?.slice(0, 8).toUpperCase() ?? '',
          `${s.officer?.first_name ?? ''} ${s.officer?.last_name ?? ''}`.trim(),
          start.toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          start.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false }),
          end.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false }),
          String(hours),
          'Regular',
          s.zone?.name ?? '',
          s.admin_notes ?? '',
        ])
      }),
    ]
    return rows.join('\n')
  }

  function handleExport() {
    if (filtered.length === 0) { toast.error('No shifts to export'); return }
    const FORMAT_META: Record<string, { csv: () => string; suffix: string; label: string }> = {
      generic: { csv: buildGenericCsv, suffix: 'fieldops',   label: 'Generic Field Compliance CSV' },
      xero:    { csv: buildXeroCsv,   suffix: 'xero',        label: 'Xero Payroll CSV' },
      myob:    { csv: buildMyobCsv,   suffix: 'myob',        label: 'MYOB CSV' },
    }
    const meta = FORMAT_META[exportFormat]
    triggerDownload(meta.csv(), `timesheets-${meta.suffix}-${dateFrom}-to-${dateTo}.csv`)
    toast.success(`${meta.label} downloaded`)
    setShowExportDialog(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Timesheet Review
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Review and approve officer shift hours before payroll export
            </p>
          </div>
          <Button variant="outline" onClick={() => setShowExportDialog(true)} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending Review', value: summary.pending,  icon: Clock,        colour: 'text-yellow-600' },
            { label: 'Approved',       value: summary.approved, icon: CheckCircle,  colour: 'text-green-600'  },
            { label: 'Rejected',       value: summary.rejected, icon: XCircle,      colour: 'text-red-600'    },
            { label: 'Approved Hours', value: `${summary.totalHrs}h`, icon: Clock,  colour: 'text-blue-600'   },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${colour}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Officer</Label>
                <Input
                  placeholder="Search officer…"
                  value={officerFilter}
                  onChange={e => setOfficerFilter(e.target.value)}
                  className="h-8 text-sm w-44"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timesheets table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><User className="inline h-3.5 w-3.5 mr-1" />Officer</TableHead>
                  <TableHead><MapPin className="inline h-3.5 w-3.5 mr-1" />Zone</TableHead>
                  <TableHead><Calendar className="inline h-3.5 w-3.5 mr-1" />Shift Start</TableHead>
                  <TableHead><Clock className="inline h-3.5 w-3.5 mr-1" />Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading timesheets…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No timesheets found for the selected filters.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(shift => {
                  const meta = APPROVAL_META[shift.approval_status]
                  const officerName = `${shift.officer?.first_name ?? ''} ${shift.officer?.last_name ?? ''}`.trim() || 'Unknown'
                  return (
                    <TableRow key={shift.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{officerName}</div>
                        <div className="text-xs text-muted-foreground">{shift.officer?.email}</div>
                      </TableCell>
                      <TableCell className="text-sm">{shift.zone?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm">{formatDateTime(shift.started_at)}</TableCell>
                      <TableCell className="text-sm font-mono">
                        {formatDurationMins(shift.started_at, shift.ended_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[160px] truncate text-muted-foreground">
                        {shift.admin_notes || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openReview(shift)}>
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Review Dialog */}
      {reviewing && (
        <Dialog open onOpenChange={() => setReviewing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Review Timesheet</DialogTitle>
              <DialogDescription>
                {`${reviewing.officer?.first_name ?? ''} ${reviewing.officer?.last_name ?? ''}`.trim()}
                {' · '}{formatDateTime(reviewing.started_at)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Shift Start</p>
                  <p className="font-medium">{formatDateTime(reviewing.started_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Shift End</p>
                  <p className="font-medium">
                    {reviewing.ended_at ? formatDateTime(reviewing.ended_at) : <span className="text-yellow-600">Still active</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Duration</p>
                  <p className="font-medium">{formatDurationMins(reviewing.started_at, reviewing.ended_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">End Reason</p>
                  <p className="font-medium capitalize">{reviewing.end_reason?.replace('_', ' ') ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-0.5">Zone</p>
                  <p className="font-medium">{reviewing.zone?.name ?? '—'}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Admin Notes</Label>
                <Textarea
                  placeholder="Optional notes about this timesheet…"
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                  rows={3}
                />
              </div>

              {reviewing.approved_by_user && (
                <p className="text-xs text-muted-foreground">
                  Previously reviewed by {reviewing.approved_by_user.first_name} {reviewing.approved_by_user.last_name}
                  {reviewing.approved_at ? ` on ${formatDateTime(reviewing.approved_at)}` : ''}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setReviewing(null)}
                disabled={updateApproval.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => submitApproval('rejected')}
                disabled={updateApproval.isPending}
              >
                <XCircle className="h-4 w-4 mr-1.5" /> Reject
              </Button>
              <Button
                onClick={() => submitApproval('approved')}
                disabled={updateApproval.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── B-20 Export format dialog ──────────────────────────────────── */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Timesheets
            </DialogTitle>
            <DialogDescription>
              Choose the format for your payroll system. Xero and MYOB exports
              include only <strong>approved</strong> shifts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Export Format</Label>
            <div className="space-y-2">
              {([
                { value: 'generic', label: 'Generic CSV', desc: 'All shifts — full Field Compliance columns' },
                { value: 'xero',    label: 'Xero Payroll',  desc: 'NZ Xero payroll import format (approved only)' },
                { value: 'myob',    label: 'MYOB AccountRight / PayGlobal', desc: 'MYOB timesheet import format (approved only)' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExportFormat(opt.value)}
                  className={[
                    'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    exportFormat === opt.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-[#2A2A2A]',
                  ].join(' ')}
                >
                  <p className="font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Exporting <strong>{filtered.length}</strong> shift{filtered.length !== 1 ? 's' : ''} · {dateFrom} to {dateTo}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>Cancel</Button>
            <Button onClick={handleExport}>
              <Download className="h-4 w-4 mr-1.5" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
