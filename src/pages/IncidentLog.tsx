import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-700',
}

export default function IncidentLog() {
  const { user } = useAuthStore()
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<IncidentRow[]>({
    queryKey: ['incidents-log', typeFilter, statusFilter, severityFilter, plateQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('incidents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (typeFilter !== 'all') q = q.eq('incident_type', typeFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (severityFilter !== 'all') q = q.eq('severity', severityFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const openCount = rows.filter((r) => r.status === 'open').length
  const closedCount = rows.filter((r) => r.status === 'closed' || r.status === 'resolved').length
  const criticalCount = rows.filter((r) => r.severity === 'critical').length
  const incidentTypes = ['all', ...Array.from(new Set(rows.map((r) => r.incident_type).filter(Boolean)))]
  const statuses = ['all', ...Array.from(new Set(rows.map((r) => r.status).filter(Boolean)))]
  const severities = ['all', 'critical', 'high', 'medium', 'low']

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Incident Log</h1>
              <p className="text-sm text-muted-foreground">Operational incident records by type, severity, and plate</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Incidents', value: rows.length, color: 'text-gray-700' },
            { label: 'Open', value: openCount, color: 'text-orange-700' },
            { label: 'Closed/Resolved', value: closedCount, color: 'text-green-700' },
            { label: 'Critical', value: criticalCount, color: 'text-red-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Incident type" /></SelectTrigger>
            <SelectContent>
              {incidentTypes.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              {severities.map((s) => (
                <SelectItem key={s} value={s}>{s === 'all' ? 'All severities' : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={plateQuery}
            onChange={(e) => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-40"
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
            <p>No incidents found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Detail</TableHead>
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
                      <TableCell><Badge variant="outline" className="text-xs">{row.incident_type ?? '—'}</Badge></TableCell>
                      <TableCell>
                        <Badge className={SEVERITY_COLOURS[row.severity ?? ''] ?? 'bg-slate-100 text-slate-700'}>
                          {row.severity ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.status ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">{row.location_address ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Evidence count:</span> {row.evidence_count ?? 0}</div>
                            <div><span className="font-medium">Reported by:</span> {row.reported_by ?? '—'}</div>
                            <div><span className="font-medium">Person record:</span> {row.person_record_id ?? '—'}</div>
                            <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
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
