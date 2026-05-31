/**
 * EnforcementEventLog — B-80
 * Admin log for enforcement_events — enforcement actions and outcomes.
 * Route: /enforcement-events-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Scale, Search, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type EnforcementEventRow = Database['public']['Tables']['enforcement_events']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  open:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  pending:  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  closed:   'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EnforcementEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]           = useState('')
  const [filterType, setFilterType]   = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<EnforcementEventRow[]>({
    queryKey: ['enforcement-events', orgId],
    queryFn: async () => {
      let q = supabase
        .from('enforcement_events')
        .select('*')
        .order('event_timestamp', { ascending: false })
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
    if (filterType   !== 'all' && e.event_type !== filterType) return false
    if (filterStatus !== 'all' && e.status !== filterStatus) return false
    if (filterMonth  !== 'all' && e.event_timestamp?.substring(0, 7) !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.case_id?.toLowerCase().includes(s) ||
        e.action_taken?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total      = events.length
  const open       = events.filter(e => e.status === 'open').length
  const resolved   = events.filter(e => e.status === 'resolved').length
  const withPhotos = events.filter(e => {
    const urls = e.photo_urls as string[] | null
    return urls && urls.length > 0
  }).length

  const eventTypes = Array.from(new Set(events.map(e => e.event_type).filter(Boolean)))
  const statuses   = Array.from(new Set(events.map(e => e.status).filter(Boolean)))
  const months     = Array.from(new Set(events.map(e => e.event_timestamp?.substring(0, 7)).filter(Boolean))).sort().reverse()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Scale className="h-7 w-7 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Enforcement Event Log</h1>
              <p className="text-sm text-muted-foreground">Enforcement actions and outcomes</p>
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
            { label: 'Total',       value: total,      colour: 'text-slate-600' },
            { label: 'Open',        value: open,       colour: open > 0 ? 'text-yellow-600' : 'text-muted-foreground' },
            { label: 'Resolved',    value: resolved,   colour: 'text-green-600' },
            { label: 'With Photos', value: withPhotos, colour: 'text-blue-600' },
          ].map(({ label, value, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
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
              placeholder="Case ID, action…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

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
              <div className="text-center py-12 text-muted-foreground text-sm">No enforcement events match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Case ID</TableHead>
                    <TableHead>Action Taken</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Photos</TableHead>
                    <TableHead>Created By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    const photoUrls = e.photo_urls as string[] | null
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
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.event_timestamp)}</TableCell>
                          <TableCell className="text-sm capitalize">{e.event_type?.replace(/_/g, ' ') ?? '—'}</TableCell>
                          <TableCell className="font-mono text-xs">{e.case_id?.substring(0, 8) ?? '—'}</TableCell>
                          <TableCell className="text-sm max-w-[160px] truncate">{e.action_taken ?? '—'}</TableCell>
                          <TableCell className="text-sm max-w-[120px] truncate">{e.outcome ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${STATUS_COLOURS[e.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.status?.replace(/_/g, ' ') ?? 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {photoUrls && photoUrls.length > 0 ? photoUrls.length : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.created_by?.substring(0, 8) ?? '—'}</TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                {e.evidence_notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Evidence Notes</p>
                                    <p>{e.evidence_notes}</p>
                                  </div>
                                )}
                                {photoUrls && photoUrls.length > 0 && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Photo URLs</p>
                                    <ul className="space-y-1">
                                      {photoUrls.map((url, i) => (
                                        <li key={i}>
                                          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline truncate block max-w-xs">{url}</a>
                                        </li>
                                      ))}
                                    </ul>
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
