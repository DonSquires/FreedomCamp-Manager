/**
 * IncidentLog — B-151
 *
 * Admin log and viewer for the incidents table.
 * Displays reported incidents with severity, status, type, plate, location, and
 * evidence count. Supports search, type/severity/status filters, and an
 * expandable detail row for notes, metadata, and person/zone cross-references.
 *
 * Route: /incidents-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ShieldAlert, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type IncidentRow = Database['public']['Tables']['incidents']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high:     'bg-orange-100 text-orange-800',
  medium:   'bg-amber-100 text-amber-800',
  low:      'bg-blue-100 text-blue-800',
}
function severityBadge(v: string | null) {
  return SEVERITY_COLOURS[v?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

const STATUS_COLOURS: Record<string, string> = {
  open:     'bg-sky-100 text-sky-800',
  resolved: 'bg-green-100 text-green-800',
  closed:   'bg-gray-100 text-gray-700',
}
function statusBadge(v: string | null) {
  return STATUS_COLOURS[v?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

export default function IncidentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery,  setSearchQuery]  = useState('')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [sevFilter,    setSevFilter]    = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom,     setDateFrom]     = useState('')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<IncidentRow[]>({
    queryKey: ['incidents-log', orgId, searchQuery, typeFilter, sevFilter, statusFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('incidents')
        .select('*')
        .eq('organization_id', orgId!)
        .is('deleted_at', null)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (typeFilter !== 'all')   q = q.eq('incident_type', typeFilter)
      if (sevFilter !== 'all')    q = q.eq('severity', sevFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)               q = q.gte('created_at', dateFrom)
      if (searchQuery.trim())     q = q.or(`plate_number.ilike.%${searchQuery.trim()}%,description.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const openCount    = rows.filter(r => r.status === 'open').length
  const critCount    = rows.filter(r => r.severity === 'critical').length
  const withEvidence = rows.filter(r => (r.evidence_count ?? 0) > 0).length
  const types        = [...new Set(rows.map(r => r.incident_type).filter(Boolean))].sort()
  const statuses     = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Incident Log</h1>
              <p className="text-sm text-muted-foreground">Reported incidents with severity, status, evidence count, and location detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Incidents',  value: rows.length,    colour: 'text-gray-700' },
            { label: 'Open',             value: openCount,      colour: 'text-sky-700' },
            { label: 'Critical',         value: critCount,      colour: 'text-red-700' },
            { label: 'With Evidence',    value: withEvidence,   colour: 'text-emerald-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate or description…" className="w-64" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sevFilter} onValueChange={setSevFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {['critical','high','medium','low'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
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
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm">{row.incident_type ?? '—'}</TableCell>
                      <TableCell><Badge className={severityBadge(row.severity)}>{row.severity ?? '—'}</Badge></TableCell>
                      <TableCell><Badge className={statusBadge(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-[16rem] truncate">{row.description ?? '—'}</TableCell>
                      <TableCell className="text-sm text-center">{row.evidence_count ?? 0}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Incident ID:</span> {row.id}</div>
                          {row.location_address && <div><span className="font-medium">Location:</span> {row.location_address}</div>}
                          {(row.location_lat != null && row.location_lng != null) && (
                            <div><span className="font-medium">Coords:</span> {row.location_lat}, {row.location_lng}</div>
                          )}
                          {row.reported_by  && <div><span className="font-medium">Reported by:</span> {row.reported_by}</div>}
                          {row.zone_id      && <div><span className="font-medium">Zone:</span> {row.zone_id}</div>}
                          {row.person_record_id && <div><span className="font-medium">Person record:</span> {row.person_record_id}</div>}
                          {row.retention_hold && <div><span className="font-medium">Retention hold:</span> until {fmtDate(row.retention_until)}</div>}
                          {row.notes        && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          {row.metadata != null && (
                            <div>
                              <span className="font-medium">Metadata:</span>
                              <pre className="mt-1 whitespace-pre-wrap break-all bg-muted rounded p-2">{JSON.stringify(row.metadata, null, 2)}</pre>
                            </div>
                          )}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
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
