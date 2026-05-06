/**
 * DriftEventLog — B-76
 *
 * Admin log for drift_events — vehicle or camper drift detection events.
 *
 * Features:
 *  - KPI cards: Total / Unreviewed / In Progress / Remediated
 *  - Filters: status, event_type, review_month, search (plate / zone)
 *  - Table: detected_at, plate, event_type, zone, status, review_month
 *  - Mark Reviewed action per row (writes reviewed_at + reviewed_by, status → reviewed)
 *  - Expandable row: remediation_notes, metadata preview
 *
 * Route: /drift-events — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Waypoints, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, Clock,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type DriftEvent = Database['public']['Tables']['drift_events']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  detected:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  reviewed:    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  remediated:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  dismissed:   'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DriftEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType]   = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<DriftEvent[]>({
    queryKey: ['drift-events', orgId],
    queryFn: async () => {
      let q = supabase
        .from('drift_events')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = events.filter(e => {
    if (filterStatus !== 'all' && e.status !== filterStatus) return false
    if (filterType   !== 'all' && e.event_type !== filterType)   return false
    if (filterMonth  !== 'all' && e.review_month !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.plate_number?.toLowerCase().includes(s) ||
        e.zone_id?.toLowerCase().includes(s) ||
        e.event_type?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total      = events.length
  const unreviewed = events.filter(e => !e.reviewed_at && e.status !== 'dismissed').length
  const inProgress = events.filter(e => e.status === 'in_progress').length
  const remediated = events.filter(e => e.status === 'remediated').length

  const eventTypes  = Array.from(new Set(events.map(e => e.event_type).filter(Boolean)))
  const statuses    = Array.from(new Set(events.map(e => e.status).filter(Boolean)))
  const months      = Array.from(new Set(events.map(e => e.review_month).filter(Boolean))).sort().reverse()

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('drift_events')
        .update({
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id,
          status: 'reviewed',
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drift-events'] }); toast.success('Event marked reviewed') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Waypoints className="h-7 w-7 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Drift Event Log</h1>
              <p className="text-sm text-muted-foreground">Vehicle and camper drift detection events requiring review</p>
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
            { label: 'Total',       value: total,      icon: Waypoints,   colour: 'text-slate-600' },
            { label: 'Unreviewed',  value: unreviewed, icon: Clock,       colour: unreviewed > 0 ? 'text-yellow-600' : 'text-muted-foreground' },
            { label: 'In Progress', value: inProgress, icon: AlertCircle, colour: inProgress > 0 ? 'text-blue-600' : 'text-muted-foreground' },
            { label: 'Remediated',  value: remediated, icon: CheckCircle2,colour: 'text-emerald-600' },
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
              placeholder="Plate, zone, type…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {statuses.length > 0 && (
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statuses.map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {eventTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {eventTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
              <div className="text-center py-12 text-muted-foreground text-sm">No drift events match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Detected</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reviewed</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    return (
                      <>
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : e.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.detected_at)}</TableCell>
                          <TableCell className="font-mono font-semibold">{e.plate_number ?? '—'}</TableCell>
                          <TableCell className="text-sm capitalize">{e.event_type?.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.zone_id ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.review_month ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${STATUS_COLOURS[e.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.status?.replace(/_/g, ' ') ?? 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {e.reviewed_at ? (
                              <span className="text-green-600 text-xs">{fmtDate(e.reviewed_at)}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">Pending</span>
                            )}
                          </TableCell>
                          <TableCell onClick={ev => ev.stopPropagation()}>
                            {!e.reviewed_at && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={markReviewed.isPending}
                                onClick={() => markReviewed.mutate(e.id)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Review
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                {e.remediation_notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Remediation Notes</p>
                                    <p>{e.remediation_notes}</p>
                                  </div>
                                )}
                                {e.metadata && Object.keys(e.metadata as object).length > 0 && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Metadata</p>
                                    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32">
                                      {JSON.stringify(e.metadata, null, 2)}
                                    </pre>
                                  </div>
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
