/**
 * OpenShiftManager — B-98
 *
 * Manager for open_shifts — unclaimed / published shifts available for officers.
 *
 * Features:
 *  - KPI cards: Total / Open (unclaimed) / Claimed / High Priority
 *  - Filters: status (dynamic), shift_type (dynamic), priority (dynamic), date
 *  - Table: title, shift_type badge, priority badge, status badge,
 *           shift_date, start_time, end_time, zone_id, claimed_by
 *  - Actions: Claim shift (sets claimed_at + claimed_by, status → claimed);
 *             Unclaim shift (clears claimed fields, status → open)
 *  - Expandable row: description, requirements, officer_shift_id
 *
 * Route: /open-shifts — admin/admin_officer/master/officer
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarClock, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type OpenShift = Database['public']['Tables']['open_shifts']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  // Handle HH:mm:ss or ISO
  if (/^\d{2}:\d{2}/.test(ts)) return ts.slice(0, 5)
  try { return format(parseISO(ts), 'HH:mm') } catch { return ts }
}

function priorityBadge(priority: string) {
  if (priority === 'high')   return 'bg-red-100 text-red-800'
  if (priority === 'medium') return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-700'
}

function statusBadge(status: string) {
  if (status === 'open')    return 'bg-blue-100 text-blue-800'
  if (status === 'claimed') return 'bg-green-100 text-green-800'
  if (status === 'filled')  return 'bg-purple-100 text-purple-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OpenShiftManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [statusFilter,    setStatusFilter]    = useState('all')
  const [shiftTypeFilter, setShiftTypeFilter] = useState('all')
  const [priorityFilter,  setPriorityFilter]  = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<OpenShift[]>({
    queryKey: ['open-shifts', orgId, statusFilter, shiftTypeFilter, priorityFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('open_shifts')
        .select('*')
        .eq('organization_id', orgId!)
        .order('shift_date', { ascending: false })
        .limit(500)

      if (statusFilter    !== 'all') q = q.eq('status', statusFilter)
      if (shiftTypeFilter !== 'all') q = q.eq('shift_type', shiftTypeFilter)
      if (priorityFilter  !== 'all') q = q.eq('priority', priorityFilter)
      if (dateFrom)                  q = q.gte('shift_date', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // ── Claim / Unclaim mutations ──────────────────────────────────────────────

  const claim = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('open_shifts')
        .update({ status: 'claimed', claimed_at: new Date().toISOString(), claimed_by: user?.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Shift claimed'); qc.invalidateQueries({ queryKey: ['open-shifts'] }) },
    onError: () => toast.error('Failed to claim shift'),
  })

  const unclaim = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('open_shifts')
        .update({ status: 'open', claimed_at: null, claimed_by: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Shift unclaimed'); qc.invalidateQueries({ queryKey: ['open-shifts'] }) },
    onError: () => toast.error('Failed to unclaim shift'),
  })

  const openCount    = rows.filter(r => r.status === 'open').length
  const claimedCount = rows.filter(r => r.status === 'claimed' || r.status === 'filled').length
  const highCount    = rows.filter(r => r.priority === 'high').length
  const statusTypes  = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const shiftTypes   = [...new Set(rows.map(r => r.shift_type).filter(Boolean))].sort()
  const priorities   = [...new Set(rows.map(r => r.priority).filter(Boolean))].sort()

  const isMutating = claim.isPending || unclaim.isPending

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Open Shift Manager</h1>
              <p className="text-sm text-muted-foreground">Published and unclaimed shifts available to officers</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Shifts',    value: rows.length,  colour: 'text-gray-700' },
            { label: 'Open',            value: openCount,    colour: 'text-blue-700' },
            { label: 'Claimed / Filled',value: claimedCount, colour: 'text-green-700' },
            { label: 'High Priority',   value: highCount,    colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusTypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={shiftTypeFilter} onValueChange={setShiftTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Shift type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shift types</SelectItem>
              {shiftTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorities.map(p => (
                <SelectItem key={p} value={p}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${priorityBadge(p)}`}>{p}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No open shifts found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Claimed By</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-sm font-medium max-w-44 truncate">{row.title}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.shift_type}</Badge></TableCell>
                        <TableCell><Badge className={priorityBadge(row.priority)}>{row.priority}</Badge></TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-sm">{fmtDate(row.shift_date)}</TableCell>
                        <TableCell className="text-sm">{fmtTime(row.start_time)}</TableCell>
                        <TableCell className="text-sm">{fmtTime(row.end_time)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.claimed_by ? `${row.claimed_by.slice(0, 8)}…` : '—'}
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {row.status === 'open' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              disabled={isMutating}
                              onClick={() => claim.mutate(row.id)}
                            >
                              Claim
                            </Button>
                          ) : row.status === 'claimed' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-muted-foreground"
                              disabled={isMutating}
                              onClick={() => unclaim.mutate(row.id)}
                            >
                              Unclaim
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={10} className="p-4 space-y-2">
                            {row.description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Description</p>
                                <p className="text-sm text-muted-foreground">{row.description}</p>
                              </div>
                            )}
                            {row.requirements && (
                              <div>
                                <p className="font-medium text-sm mb-1">Requirements</p>
                                <p className="text-sm text-muted-foreground">{row.requirements}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {row.zone_id && <span>Zone: {row.zone_id.slice(0, 8)}…</span>}
                              {row.officer_shift_id && <span>Officer shift: {row.officer_shift_id.slice(0, 8)}…</span>}
                              {row.claimed_at && <span>Claimed: {fmtDate(row.claimed_at)}</span>}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
