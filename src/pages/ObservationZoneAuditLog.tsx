/**
 * ObservationZoneAuditLog — B-131
 *
 * Admin log for v_observation_zone_audit.
 *
 * Features:
 *  - KPIs: Total / Correctly Assigned / Mismatched / Legacy Imports
 *  - Filters: assignment status / legacy flag / plate / date-from
 *  - Expandable row: zone IDs + legacy import metadata
 *
 * Route: /observation-zone-audit-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPinned, RefreshCw, AlertCircle, Loader2,
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

type ZoneAuditRow = Database['public']['Views']['v_observation_zone_audit']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

export default function ObservationZoneAuditLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [assignmentFilter, setAssignmentFilter] = useState('all')
  const [legacyFilter, setLegacyFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneAuditRow[]>({
    queryKey: ['observation-zone-audit-log', orgId, assignmentFilter, legacyFilter, plateQuery, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('v_observation_zone_audit')
        .select('*')
        .eq('current_org_id', orgId!)
        .order('observed_date', { ascending: false, nullsFirst: false })
        .limit(500)

      if (assignmentFilter === 'yes') q = q.eq('is_correctly_assigned', true)
      if (assignmentFilter === 'no') q = q.eq('is_correctly_assigned', false)
      if (legacyFilter === 'yes') q = q.eq('is_legacy_import', true)
      if (legacyFilter === 'no') q = q.eq('is_legacy_import', false)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('observed_date', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const correct = rows.filter(r => r.is_correctly_assigned).length
  const mismatched = rows.filter(r => r.is_correctly_assigned === false).length
  const legacy = rows.filter(r => r.is_legacy_import).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPinned className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Observation Zone Audit Log</h1>
              <p className="text-sm text-muted-foreground">Canonical vs current zone assignment history</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, colour: 'text-gray-700' },
            { label: 'Correctly Assigned', value: correct, colour: 'text-green-700' },
            { label: 'Mismatched', value: mismatched, colour: 'text-red-700' },
            { label: 'Legacy Imports', value: legacy, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={plateQuery} onChange={e => setPlateQuery(e.target.value)} placeholder="Search plate…" className="w-44" />
          <Select value={assignmentFilter} onValueChange={setAssignmentFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Assignment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignments</SelectItem>
              <SelectItem value="yes">Correct only</SelectItem>
              <SelectItem value="no">Mismatched only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={legacyFilter} onValueChange={setLegacyFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Legacy" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All imports</SelectItem>
              <SelectItem value="yes">Legacy only</SelectItem>
              <SelectItem value="no">Non-legacy only</SelectItem>
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No audit records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Observed Date</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Current Zone</TableHead>
                  <TableHead>Canonical Zone</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Legacy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => {
                  const rowId = row.observation_id ?? `${row.plate_number ?? 'plate'}-${idx}`
                  const expanded = expandedId === rowId
                  return (
                    <Fragment key={rowId}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : rowId)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.observed_date)}</TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.current_zone_name ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.canonical_zone_name ?? '—'}</TableCell>
                        <TableCell>
                          <Badge className={row.is_correctly_assigned ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {row.is_correctly_assigned ? 'correct' : 'mismatch'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={row.is_legacy_import ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}>
                            {row.is_legacy_import ? 'legacy' : 'current'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Observation ID:</span> <span className="font-mono text-xs">{row.observation_id ?? '—'}</span></div>
                              <div><span className="font-medium">Current Org:</span> {row.current_org_name ?? '—'}</div>
                              <div><span className="font-medium">Canonical Org:</span> {row.canonical_org_name ?? '—'}</div>
                              <div><span className="font-medium">Current Zone ID:</span> <span className="font-mono text-xs">{row.current_zone_id ?? '—'}</span></div>
                              <div><span className="font-medium">Canonical Zone ID:</span> <span className="font-mono text-xs">{row.canonical_zone_id ?? '—'}</span></div>
                              <div><span className="font-medium">Legacy Source:</span> {row.legacy_source_tag ?? '—'}</div>
                              <div className="md:col-span-2"><span className="font-medium">Zone Name at Import:</span> {row.zone_name_at_import ?? '—'}</div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
