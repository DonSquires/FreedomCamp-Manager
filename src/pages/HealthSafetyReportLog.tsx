import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ShieldAlert, RefreshCw, AlertCircle, Loader2,
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

type HealthSafetyRow = Database['public']['Tables']['health_safety_reports']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function severityTone(severity: string | null) {
  const s = severity?.toLowerCase()
  if (s === 'critical' || s === 'high') return 'bg-red-100 text-red-800'
  if (s === 'medium') return 'bg-yellow-100 text-yellow-800'
  if (s === 'low') return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-700'
}

export default function HealthSafetyReportLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<HealthSafetyRow[]>({
    queryKey: ['health-safety-report-log', orgId, severityFilter, statusFilter, typeFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('health_safety_reports')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (severityFilter !== 'all') q = q.eq('severity', severityFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all') q = q.eq('incident_type', typeFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const severities = [...new Set(rows.map(r => r.severity).filter(Boolean))].sort()
  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const incidentTypes = [...new Set(rows.map(r => r.incident_type).filter(Boolean))].sort()
  const openCount = rows.filter(r => !['closed', 'resolved'].includes((r.status ?? '').toLowerCase())).length
  const highPlusCount = rows.filter(r => ['high', 'critical', 'severe'].includes((r.severity ?? '').toLowerCase())).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Health &amp; Safety Report Log</h1>
              <p className="text-sm text-muted-foreground">Incident and safety reports submitted by field teams</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Reports', value: rows.length, colour: 'text-gray-700' },
            { label: 'Open', value: openCount, colour: 'text-blue-700' },
            { label: 'High+', value: highPlusCount, colour: 'text-red-700' },
            { label: 'Incident Types', value: incidentTypes.length, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {severities.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Incident type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {incidentTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No health and safety reports found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Reported By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="text-sm">{row.incident_type ?? '—'}</TableCell>
                        <TableCell><Badge className={severityTone(row.severity)}>{row.severity ?? '—'}</Badge></TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id ? `${row.zone_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.reported_by ? `${row.reported_by.slice(0, 8)}…` : '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-2 text-sm">
                              <div><span className="font-medium">Description:</span> <span className="text-muted-foreground">{row.description ?? '—'}</span></div>
                              <div><span className="font-medium">Updated:</span> <span className="text-muted-foreground">{fmtDate(row.updated_at)}</span></div>
                              <div><span className="font-medium">Report ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
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
