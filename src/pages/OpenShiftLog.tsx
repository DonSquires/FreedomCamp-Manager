import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarClock, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

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

type OpenShiftRow = Database['public']['Tables']['open_shifts']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDateOnly(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-amber-100 text-amber-800',
  medium: 'bg-blue-100 text-blue-800',
  low: 'bg-slate-100 text-slate-700',
}

function priorityBadge(priority: string | null) {
  return PRIORITY_COLOURS[priority?.toLowerCase() ?? ''] ?? 'bg-slate-100 text-slate-700'
}

export default function OpenShiftLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [shiftTypeFilter, setShiftTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OpenShiftRow[]>({
    queryKey: ['open-shift-log', user?.role, orgId, searchQuery, statusFilter, priorityFilter, shiftTypeFilter, dateFrom],
    enabled: !!user,
    queryFn: async () => {
      let q = (supabase as any)
        .from('open_shifts')
        .select('*')
        .order('shift_date', { ascending: false, nullsFirst: false })
        .order('start_time', { ascending: false, nullsFirst: false })
        .limit(500)

      if (user?.role !== 'master') {
        if (!orgId) return []
        q = q.eq('organization_id', orgId)
      }

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (shiftTypeFilter !== 'all') q = q.eq('shift_type', shiftTypeFilter)
      if (dateFrom) q = q.gte('shift_date', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%,created_by.ilike.%${term}%,claimed_by.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const openCount = rows.filter((row) => row.status === 'open').length
  const claimedCount = rows.filter((row) => !!row.claimed_at).length
  const priorities = [...new Set(rows.map((row) => row.priority).filter(Boolean))].sort()
  const statuses = [...new Set(rows.map((row) => row.status).filter(Boolean))].sort()
  const shiftTypes = [...new Set(rows.map((row) => row.shift_type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Open Shift Log</h1>
              <p className="text-sm text-muted-foreground">Roster gap registry with priority, claim status, zone linkage, and shift scheduling detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Shifts', value: rows.length, colour: 'text-slate-700' },
            { label: 'Open', value: openCount, colour: 'text-blue-700' },
            { label: 'Claimed', value: claimedCount, colour: 'text-green-700' },
            { label: 'Shift Types', value: shiftTypes.length, colour: 'text-indigo-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search title, description, creator, claimant…" className="w-80" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorities.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={shiftTypeFilter} onValueChange={setShiftTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Shift type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shift types</SelectItem>
              {shiftTypes.map((shiftType) => <SelectItem key={shiftType} value={shiftType}>{shiftType}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Shift Type</TableHead>
                  <TableHead>Shift Date</TableHead>
                  <TableHead>Claimed By</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell>
                        <div className="font-medium">{row.title}</div>
                        <div className="text-xs text-muted-foreground">{row.start_time ?? '—'} → {row.end_time ?? '—'}</div>
                      </TableCell>
                      <TableCell><Badge className="bg-slate-100 text-slate-700">{row.status}</Badge></TableCell>
                      <TableCell><Badge className={priorityBadge(row.priority)}>{row.priority}</Badge></TableCell>
                      <TableCell className="text-sm">{row.shift_type}</TableCell>
                      <TableCell className="text-sm">{fmtDateOnly(row.shift_date)}</TableCell>
                      <TableCell className="text-sm">{row.claimed_by ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Created by:</span> {row.created_by} · <span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                          <div><span className="font-medium">Claim:</span> {row.claimed_by ?? '—'} · <span className="font-medium">Claimed at:</span> {fmtDate(row.claimed_at)}</div>
                          <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'} · <span className="font-medium">Officer shift:</span> {row.officer_shift_id ?? '—'}</div>
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          {row.requirements && <div><span className="font-medium">Requirements:</span> {row.requirements}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
