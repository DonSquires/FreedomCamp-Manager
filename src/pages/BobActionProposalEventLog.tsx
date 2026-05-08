import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { BrainCircuit, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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
  created: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-800',
  executed: 'bg-indigo-100 text-indigo-800',
  failed: 'bg-red-100 text-red-800',
  escalated: 'bg-purple-100 text-purple-800',
  reviewed: 'bg-amber-100 text-amber-800',
}

export default function BobActionProposalEventLog() {
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [actorQuery, setActorQuery] = useState('')
  const [proposalQuery, setProposalQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<EventRow[]>({
    queryKey: ['bob-action-proposal-events-log', eventTypeFilter, actorQuery, proposalQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('bob_action_proposal_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (actorQuery.trim()) q = q.ilike('actor_id', `%${actorQuery.trim()}%`)
      if (proposalQuery.trim()) q = q.ilike('proposal_id', `%${proposalQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const reviewedCount = rows.filter((r) => r.event_type === 'reviewed').length
  const failedCount = rows.filter((r) => r.event_type === 'failed').length
  const withNotesCount = rows.filter((r) => !!r.notes).length
  const eventTypes = ['all', ...Array.from(new Set(rows.map((r) => r.event_type)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrainCircuit className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Bob Action Proposal Event Log</h1>
              <p className="text-sm text-muted-foreground">Operational event stream for Bob proposal lifecycle actions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: rows.length, color: 'text-gray-700' },
            { label: 'Reviewed', value: reviewedCount, color: 'text-amber-700' },
            { label: 'Failed', value: failedCount, color: 'text-red-700' },
            { label: 'With Notes', value: withNotesCount, color: 'text-indigo-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All event types' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={actorQuery}
            onChange={(e) => setActorQuery(e.target.value)}
            placeholder="Search actor ID…"
            className="w-44"
          />
          <Input
            value={proposalQuery}
            onChange={(e) => setProposalQuery(e.target.value)}
            placeholder="Search proposal ID…"
            className="w-52"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No proposal events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Proposal</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${EVENT_COLOURS[row.event_type] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.event_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.proposal_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.actor_id ? `${row.actor_id.slice(0, 8)}…` : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.organization_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground" title={row.notes ?? ''}>
                        {row.notes ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Proposal ID:</span> {row.proposal_id}</div>
                            <div><span className="font-medium">Case ID:</span> {row.case_id ?? '—'}</div>
                            <div><span className="font-medium">Actor ID:</span> {row.actor_id ?? '—'}</div>
                            <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                            <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                          </div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          <div>
                            <span className="font-medium">Metadata:</span>
                            <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">
                              {JSON.stringify(row.metadata, null, 2)}
                            </pre>
                          </div>
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
