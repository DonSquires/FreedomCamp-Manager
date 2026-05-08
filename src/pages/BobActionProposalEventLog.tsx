/**
 * BobActionProposalEventLog — B-148
 *
 * Admin log and viewer for bob_action_proposal_events.
 * Displays the audit trail of lifecycle events on Bob AI action proposals —
 * submissions, approvals, rejections, escalations, and revocations.
 *
 * Route: /bob-action-proposal-event-log — admin/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Bot, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type EventRow = Database['public']['Tables']['bob_action_proposal_events']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const EVENT_COLOURS: Record<string, string> = {
  submitted:  'bg-blue-100 text-blue-800',
  approved:   'bg-green-100 text-green-800',
  rejected:   'bg-rose-100 text-rose-800',
  escalated:  'bg-amber-100 text-amber-800',
  revoked:    'bg-gray-100 text-gray-700',
  executed:   'bg-emerald-100 text-emerald-800',
}

function eventBadge(type: string) {
  return EVENT_COLOURS[type?.toLowerCase()] ?? 'bg-sky-100 text-sky-800'
}

export default function BobActionProposalEventLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery,   setSearchQuery]   = useState('')
  const [eventFilter,   setEventFilter]   = useState('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [expanded,      setExpanded]      = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<EventRow[]>({
    queryKey: ['bob-action-proposal-event-log', orgId, searchQuery, eventFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('bob_action_proposal_events')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (eventFilter !== 'all') q = q.eq('event_type', eventFilter)
      if (searchQuery.trim()) q = q.or(`proposal_id.ilike.%${searchQuery.trim()}%,event_type.ilike.%${searchQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const eventTypes  = [...new Set(rows.map(r => r.event_type).filter(Boolean))].sort()
  const withNotes   = rows.filter(r => !!r.notes).length
  const withCase    = rows.filter(r => !!r.case_id).length
  const uniqueProps = new Set(rows.map(r => r.proposal_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Bob Action Proposal Event Log</h1>
              <p className="text-sm text-muted-foreground">Audit trail of lifecycle events on Bob AI action proposals</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events',       value: rows.length,    colour: 'text-gray-700' },
            { label: 'Unique Proposals',   value: uniqueProps,    colour: 'text-sky-700' },
            { label: 'Case-Linked Events', value: withCase,       colour: 'text-amber-700' },
            { label: 'With Notes',         value: withNotes,      colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search proposal ID or event type…" className="w-72" />
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventTypes.map(et => <SelectItem key={et} value={et}>{et}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Event Type</TableHead>
                  <TableHead>Proposal</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell><Badge className={eventBadge(row.event_type)}>{row.event_type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.proposal_id.slice(0, 8)}…</TableCell>
                      <TableCell className="font-mono text-xs">{row.actor_id ? `${row.actor_id.slice(0, 8)}…` : '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.case_id ? `${row.case_id.slice(0, 8)}…` : '—'}</TableCell>
                      <TableCell className="text-sm max-w-[16rem] truncate">{row.notes ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Event ID:</span> {row.id}</div>
                          <div><span className="font-medium">Proposal ID:</span> {row.proposal_id}</div>
                          {row.actor_id  && <div><span className="font-medium">Actor ID:</span> {row.actor_id}</div>}
                          {row.case_id   && <div><span className="font-medium">Case ID:</span> {row.case_id}</div>}
                          {row.notes     && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          {row.metadata != null && (
                            <div>
                              <span className="font-medium">Metadata:</span>
                              <pre className="mt-1 whitespace-pre-wrap break-all bg-muted rounded p-2">{JSON.stringify(row.metadata, null, 2)}</pre>
                            </div>
                          )}
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
