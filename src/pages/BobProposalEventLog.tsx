/**
 * BobProposalEventLog — B-140
 *
 * Admin audit log for bob_action_proposal_events.
 * Surfaces each state-change / lifecycle event on a Bob proposal with actor and metadata.
 *
 * Route: /bob-proposal-events-log — admin/admin_officer/master
 */
import { useState } from 'react'
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
  created:   'bg-blue-100 text-blue-800',
  approved:  'bg-green-100 text-green-800',
  rejected:  'bg-rose-100 text-rose-800',
  executed:  'bg-indigo-100 text-indigo-800',
  failed:    'bg-red-100 text-red-800',
  escalated: 'bg-purple-100 text-purple-800',
  reviewed:  'bg-amber-100 text-amber-800',
}

export default function BobProposalEventLog() {
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all')
  const [dateFrom, setDateFrom]               = useState('')
  const [proposalQuery, setProposalQuery]     = useState('')
  const [caseQuery, setCaseQuery]             = useState('')
  const [expanded, setExpanded]               = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<EventRow[]>({
    queryKey: ['bob-proposal-events-log', eventTypeFilter, dateFrom, proposalQuery, caseQuery],
    queryFn: async () => {
      let q = supabase
        .from('bob_action_proposal_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (eventTypeFilter !== 'all') q = q.eq('event_type', eventTypeFilter)
      if (dateFrom)                  q = q.gte('created_at', dateFrom)
      if (proposalQuery.trim())      q = q.ilike('proposal_id', `%${proposalQuery.trim()}%`)
      if (caseQuery.trim())          q = q.ilike('case_id', `%${caseQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const uniqueProposals = new Set(rows.map(r => r.proposal_id)).size
  const uniqueCases     = new Set(rows.filter(r => r.case_id).map(r => r.case_id)).size
  const uniqueActors    = new Set(rows.filter(r => r.actor_id).map(r => r.actor_id)).size

  const eventTypes = ['all', ...Array.from(new Set(rows.map(r => r.event_type)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrainCircuit className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Bob Proposal Event Log</h1>
              <p className="text-sm text-muted-foreground">Lifecycle events for Bob action proposals — each state change captured per actor</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Events',      value: rows.length,    colour: 'text-gray-700' },
            { label: 'Unique Proposals',  value: uniqueProposals, colour: 'text-violet-700' },
            { label: 'Unique Cases',      value: uniqueCases,    colour: 'text-sky-700' },
            { label: 'Unique Actors',     value: uniqueActors,   colour: 'text-indigo-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>{eventTypes.map(t => <SelectItem key={t} value={t}>{t === 'all' ? 'All event types' : t}</SelectItem>)}</SelectContent>
          </Select>
          <Input
            value={proposalQuery}
            onChange={e => setProposalQuery(e.target.value)}
            placeholder="Search proposal ID…"
            className="w-52"
          />
          <Input
            value={caseQuery}
            onChange={e => setCaseQuery(e.target.value)}
            placeholder="Search case ID…"
            className="w-44"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No events found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Proposal ID</TableHead>
                  <TableHead>Case ID</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
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
                        {row.case_id ? row.case_id.slice(0, 8) + '…' : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.actor_id ? row.actor_id.slice(0, 8) + '…' : '—'}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm text-muted-foreground" title={row.notes ?? ''}>
                        {row.notes ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Proposal ID:</span> {row.proposal_id}</div>
                            <div><span className="font-medium">Case ID:</span> {row.case_id ?? '—'}</div>
                            <div><span className="font-medium">Actor ID:</span> {row.actor_id ?? '—'}</div>
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
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
