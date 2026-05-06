/**
 * RosterShiftLog — B-67
 *
 * Admin viewer for roster_shifts — all scheduled shifts with status,
 * officer assignment, zone, date, and type.
 *
 * Features:
 *  - KPI cards: Total / Confirmed / Cancelled / Conflicts
 *  - Filters: status, shift_type, date-from/to, search (officer / position)
 *  - Table: shift_date, start_time, officer, zone, type, status, hours
 *  - Publish action (status → confirmed)
 *  - Cancel action with confirmation
 *
 * Route: /roster-shifts — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO, differenceInMinutes } from 'date-fns'
import {
  CalendarRange, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, XCircle, Clock, AlertTriangle, Send,
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

type RosterShift = Database['public']['Tables']['roster_shifts']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtTime(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'HH:mm') } catch { return ts }
}

function shiftHours(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  try {
    const mins = differenceInMinutes(parseISO(end), parseISO(start))
    if (mins <= 0) return '—'
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  } catch { return '—' }
}

const STATUS_COLOURS: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  published:  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  confirmed:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled:  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  completed:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RosterShiftLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]             = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType]     = useState('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [cancelTarget, setCancelTarget] = useState<RosterShift | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: shifts = [], isLoading, error, refetch } = useQuery<RosterShift[]>({
    queryKey: ['roster-shifts', orgId, filterStatus, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('roster_shifts')
        .select('*')
        .order('shift_date', { ascending: false })
        .order('start_time', { ascending: true })
        .limit(500)
      if (orgId)       q = q.eq('organization_id', orgId)
      if (filterStatus !== 'all') q = q.eq('status', filterStatus)
      if (dateFrom)    q = q.gte('shift_date', dateFrom)
      if (dateTo)      q = q.lte('shift_date', dateTo)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = shifts.filter(s => {
    if (filterType !== 'all' && s.shift_type !== filterType) return false
    if (search) {
      const lo = search.toLowerCase()
      return (
        s.officer_id?.toLowerCase().includes(lo) ||
        s.position_title?.toLowerCase().includes(lo) ||
        s.service_type?.toLowerCase().includes(lo) ||
        s.shift_type?.toLowerCase().includes(lo)
      )
    }
    return true
  })

  const total     = shifts.length
  const confirmed = shifts.filter(s => s.status === 'confirmed').length
  const cancelled = shifts.filter(s => s.status === 'cancelled').length
  const conflicts = shifts.filter(s => s.has_conflict).length

  const shiftTypes = Array.from(new Set(shifts.map(s => s.shift_type).filter(Boolean)))

  // ── Publish mutation ──────────────────────────────────────────────────────

  const publish = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('roster_shifts')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster-shifts'] })
      toast.success('Shift confirmed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Cancel mutation ───────────────────────────────────────────────────────

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('roster_shifts')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster-shifts'] })
      toast.success('Shift cancelled')
      setCancelTarget(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CalendarRange className="h-7 w-7 text-violet-500" />
            <div>
              <h1 className="text-2xl font-bold">Roster Shift Log</h1>
              <p className="text-sm text-muted-foreground">Scheduled shift management and confirmation</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Shifts',  value: total,     icon: CalendarRange, colour: 'text-slate-600' },
            { label: 'Confirmed',     value: confirmed, icon: CheckCircle2,  colour: 'text-green-600' },
            { label: 'Cancelled',     value: cancelled, icon: XCircle,       colour: 'text-red-600' },
            { label: 'Conflicts',     value: conflicts, icon: AlertTriangle, colour: conflicts > 0 ? 'text-orange-600' : 'text-muted-foreground' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Officer, position, service type…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          {shiftTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Shift Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {shiftTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex gap-2 items-center">
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px]" />
            <span className="text-muted-foreground text-sm">→</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px]" />
          </div>
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
              <div className="text-center py-12 text-muted-foreground text-sm">No shifts match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Conflict</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => (
                    <TableRow key={s.id} className={s.has_conflict ? 'bg-orange-50/50 dark:bg-orange-950/10' : ''}>
                      <TableCell className="whitespace-nowrap font-medium">{fmtDate(s.shift_date)}</TableCell>
                      <TableCell className="text-sm">{fmtTime(s.start_time)}</TableCell>
                      <TableCell className="text-sm">{fmtTime(s.end_time)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {shiftHours(s.start_time, s.end_time)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {s.shift_type?.replace(/_/g, ' ') ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">{s.position_title ?? '—'}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${STATUS_COLOURS[s.status] ?? ''}`}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.has_conflict && (
                          <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Conflict
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {(s.status === 'draft' || s.status === 'published') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={publish.isPending}
                              onClick={() => publish.mutate(s.id)}
                            >
                              <Send className="h-3.5 w-3.5 mr-1" />
                              Confirm
                            </Button>
                          )}
                          {s.status !== 'cancelled' && s.status !== 'completed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => setCancelTarget(s)}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelTarget} onOpenChange={open => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Shift</AlertDialogTitle>
            <AlertDialogDescription>
              Cancel the shift on <strong>{cancelTarget ? fmtDate(cancelTarget.shift_date) : ''}</strong>?
              This cannot be undone from this interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Shift</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelTarget && cancel.mutate(cancelTarget.id)}
            >
              Cancel Shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}
