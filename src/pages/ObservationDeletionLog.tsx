/**
 * ObservationDeletionLog — B-136
 *
 * Admin audit log for observation_deletions.
 * Every deleted observation is soft-archived here with a snapshot and reason.
 *
 * Route: /observation-deletions-log — admin/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Trash2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

type DelRow = Database['public']['Tables']['observation_deletions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ObservationDeletionLog() {
  const [plateQuery, setPlateQuery] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<DelRow[]>({
    queryKey: ['observation-deletions-log', plateQuery, userQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('observation_deletions')
        .select('*')
        .order('deleted_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (userQuery.trim()) q = q.ilike('deleted_by', `%${userQuery.trim()}%`)
      if (dateFrom) q = q.gte('deleted_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const uniqueZones = new Set(rows.map(r => r.zone_id)).size
  const withReason = rows.filter(r => !!r.deletion_reason).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trash2 className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Observation Deletion Log</h1>
              <p className="text-sm text-muted-foreground">Audit trail of deleted observations with snapshots and deletion reasons</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Deletions', value: rows.length, colour: 'text-gray-700' },
            { label: 'With Reason', value: withReason, colour: 'text-amber-700' },
            { label: 'Unique Zones', value: uniqueZones, colour: 'text-sky-700' },
            { label: 'Unique Plates', value: new Set(rows.map(r => r.plate_number)).size, colour: 'text-indigo-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={plateQuery} onChange={e => setPlateQuery(e.target.value)} placeholder="Search plate…" className="w-44" />
          <Input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="Search deleted by…" className="w-52" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
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
                  <TableHead>Deleted At</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Deleted By</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Snapshot</TableHead>
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
                      <TableCell className="text-sm">{fmtDate(row.deleted_at)}</TableCell>
                      <TableCell className="font-mono font-semibold">{row.plate_number}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id}</TableCell>
                      <TableCell className="font-mono text-xs">{row.deleted_by}</TableCell>
                      <TableCell className="max-w-[16rem] truncate text-sm" title={row.deletion_reason ?? ''}>
                        {row.deletion_reason
                          ? <Badge className="bg-rose-100 text-rose-800">{row.deletion_reason}</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={6} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Observation ID:</span> {row.observation_id}</div>
                          <div><span className="font-medium">Recorded at:</span> {fmtDate(row.recorded_at)} &nbsp; <span className="font-medium">Recorded by:</span> {row.recorded_by}</div>
                          <div>
                            <span className="font-medium">Snapshot:</span>
                            <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">
                              {JSON.stringify(row.observation_snapshot, null, 2)}
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
