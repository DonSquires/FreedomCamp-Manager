/**
 * NoiseJobLog — B-93
 *
 * Log viewer for noise_jobs — noise control dispatch jobs.
 *
 * Features:
 *  - KPI cards: Total / Open / Completed / High Priority
 *  - Filters: status (dynamic), priority (dynamic), noise_type (dynamic), date from
 *  - Table: job_number, title, address, noise_type badge, priority badge,
 *           status badge, created_at, outcome
 *  - Expandable row: complaint_description, outcome_notes, GPS coordinates,
 *                    complainant_ref, safety_notes
 *
 * Route: /noise-jobs-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Volume2, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type NoiseJob = Database['public']['Tables']['noise_jobs']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  if (status === 'open')        return 'bg-blue-100 text-blue-800'
  if (status === 'dispatched')  return 'bg-purple-100 text-purple-800'
  if (status === 'on_scene')    return 'bg-orange-100 text-orange-800'
  if (status === 'completed')   return 'bg-green-100 text-green-800'
  if (status === 'cancelled')   return 'bg-gray-100 text-gray-600'
  return 'bg-yellow-100 text-yellow-800'
}

function priorityBadge(priority: string) {
  if (priority === 'high')     return 'bg-red-100 text-red-800'
  if (priority === 'medium')   return 'bg-yellow-100 text-yellow-800'
  if (priority === 'low')      return 'bg-gray-100 text-gray-700'
  return 'bg-gray-100 text-gray-700'
}

function noiseBadge(type: string) {
  const colours: Record<string, string> = {
    music:       'bg-pink-100 text-pink-800',
    construction:'bg-orange-100 text-orange-800',
    party:       'bg-purple-100 text-purple-800',
    animal:      'bg-teal-100 text-teal-800',
    vehicle:     'bg-indigo-100 text-indigo-800',
  }
  return colours[type] ?? 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NoiseJobLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter,    setStatusFilter]    = useState('all')
  const [priorityFilter,  setPriorityFilter]  = useState('all')
  const [noiseTypeFilter, setNoiseTypeFilter] = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<NoiseJob[]>({
    queryKey: ['noise-jobs-log', orgId, statusFilter, priorityFilter, noiseTypeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('noise_jobs')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (statusFilter    !== 'all') q = q.eq('status', statusFilter)
      if (priorityFilter  !== 'all') q = q.eq('priority', priorityFilter)
      if (noiseTypeFilter !== 'all') q = q.eq('noise_type', noiseTypeFilter)
      if (dateFrom)                  q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statusTypes    = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const priorityTypes  = [...new Set(rows.map(r => r.priority).filter(Boolean))].sort()
  const noiseTypes     = [...new Set(rows.map(r => r.noise_type).filter(Boolean))].sort()
  const openCount      = rows.filter(r => !['completed', 'cancelled'].includes(r.status)).length
  const completedCount = rows.filter(r => r.status === 'completed').length
  const highPriority   = rows.filter(r => r.priority === 'high').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Volume2 className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Noise Job Log</h1>
              <p className="text-sm text-muted-foreground">Noise control dispatch jobs and complaint outcomes</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Jobs',    value: rows.length,    colour: 'text-gray-700' },
            { label: 'Open',          value: openCount,      colour: 'text-blue-700' },
            { label: 'Completed',     value: completedCount, colour: 'text-green-700' },
            { label: 'High Priority', value: highPriority,   colour: 'text-red-700' },
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
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusTypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorityTypes.map(p => (
                <SelectItem key={p} value={p}>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-1 ${priorityBadge(p)}`}>{p}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={noiseTypeFilter} onValueChange={setNoiseTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Noise type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All noise types</SelectItem>
              {noiseTypes.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
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
            <AlertCircle className="h-8 w-8" /><p>No noise jobs found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Job #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Noise Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Outcome</TableHead>
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
                          {expanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">{row.job_number}</TableCell>
                        <TableCell className="text-sm font-medium max-w-48 truncate">{row.title}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-40 truncate">{row.address}</TableCell>
                        <TableCell>
                          <Badge className={noiseBadge(row.noise_type)}>{row.noise_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={priorityBadge(row.priority)}>{row.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.status)}>{row.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm">{row.outcome ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={9} className="p-4 space-y-3">
                            {row.complaint_description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Complaint Description</p>
                                <p className="text-sm text-muted-foreground">{row.complaint_description}</p>
                              </div>
                            )}
                            {row.outcome_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Outcome Notes</p>
                                <p className="text-sm text-muted-foreground">{row.outcome_notes}</p>
                              </div>
                            )}
                            {row.safety_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Safety Notes</p>
                                <p className="text-sm text-muted-foreground">{row.safety_notes}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {row.gps_lat != null && row.gps_lng != null && (
                                <span>GPS: {row.gps_lat.toFixed(5)}, {row.gps_lng.toFixed(5)}</span>
                              )}
                              {row.complainant_ref && (
                                <span>Complainant ref: {row.complainant_ref}</span>
                              )}
                              {row.complaint_source && (
                                <span>Source: {row.complaint_source}</span>
                              )}
                              {row.prior_notice_count > 0 && (
                                <span>Prior notices: {row.prior_notice_count}</span>
                              )}
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
