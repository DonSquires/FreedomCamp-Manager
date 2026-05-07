/**
 * VehicleMigrationLog — B-135
 *
 * Master-only log for vehicle_migration_log.
 *
 * Route: /vehicle-migration-log — master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CarFront, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type MigrationRow = Database['public']['Tables']['vehicle_migration_log']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function VehicleMigrationLog() {
  const [actionFilter, setActionFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [runQuery, setRunQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<MigrationRow[]>({
    queryKey: ['vehicle-migration-log', actionFilter, plateQuery, runQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('vehicle_migration_log')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (actionFilter !== 'all') q = q.eq('action', actionFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (runQuery.trim()) q = q.ilike('migration_run_id', `%${runQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const actions = [...new Set(rows.map(r => r.action).filter(Boolean))].sort()
  const uniqueRuns = new Set(rows.map(r => r.migration_run_id).filter(Boolean)).size
  const linkedCanonical = rows.filter(r => !!r.canonical_vehicle_id).length
  const linkedLegacy = rows.filter(r => !!r.legacy_record_id).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CarFront className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Vehicle Migration Log</h1>
              <p className="text-sm text-muted-foreground">Historical migration outcomes from legacy vehicle records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Entries', value: rows.length, colour: 'text-gray-700' },
            { label: 'Unique Runs', value: uniqueRuns, colour: 'text-cyan-700' },
            { label: 'Linked Canonical', value: linkedCanonical, colour: 'text-green-700' },
            { label: 'Linked Legacy', value: linkedLegacy, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={plateQuery} onChange={e => setPlateQuery(e.target.value)} placeholder="Search plate…" className="w-44" />
          <Input value={runQuery} onChange={e => setRunQuery(e.target.value)} placeholder="Search run ID…" className="w-56" />
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="border rounded px-3 py-1 text-sm bg-background w-48">
            <option value="all">All actions</option>
            {actions.map(action => <option key={action} value={action}>{action}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No migration records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Canonical Vehicle</TableHead>
                  <TableHead>Legacy Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                    <TableCell><Badge className="bg-blue-100 text-blue-800">{row.action}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{row.plate_number}</TableCell>
                    <TableCell className="font-mono text-xs">{row.migration_run_id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.canonical_vehicle_id ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.legacy_record_id ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
