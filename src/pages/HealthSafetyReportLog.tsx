import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type HealthSafetyReport = Database['public']['Tables']['health_safety_reports']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function severityBadge(v: string | null) {
  const s = (v ?? '').toLowerCase()
  if (s.includes('critical') || s.includes('high')) return 'bg-red-100 text-red-800'
  if (s.includes('medium')) return 'bg-yellow-100 text-yellow-800'
  if (s.includes('low')) return 'bg-green-100 text-green-800'
  return 'bg-slate-100 text-slate-800'
}

export default function HealthSafetyReportLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<HealthSafetyReport[]>({
    queryKey: ['health-safety-report-log', orgId, severityFilter, statusFilter, typeFilter],
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

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const severities = useMemo(() => [...new Set(rows.map((r) => r.severity).filter(Boolean))].sort(), [rows])
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows])
  const incidentTypes = useMemo(() => [...new Set(rows.map((r) => r.incident_type).filter(Boolean))].sort(), [rows])
  const highPlusCount = rows.filter((r) => {
    const s = (r.severity ?? '').toLowerCase()
    return s.includes('high') || s.includes('critical')
  }).length
  const openCount = rows.filter((r) => !['closed', 'resolved'].includes((r.status ?? '').toLowerCase())).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Health & Safety Report Log</h1>
              <p className="text-sm text-muted-foreground">Incident reports and mitigation tracking</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Reports', value: rows.length, color: 'text-slate-700' },
            { label: 'High+', value: highPlusCount, color: 'text-rose-700' },
            { label: 'Open', value: openCount, color: 'text-orange-700' },
            { label: 'Incident Types', value: incidentTypes.length, color: 'text-indigo-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {severities.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Incident type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {incidentTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No reports found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reported By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell><Badge className={`text-xs ${severityBadge(row.severity)}`}>{row.severity ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm">{row.status ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.incident_type ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.reported_by?.slice(0, 8) ?? '—'}…</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Org: {row.organization_id}</span>
                              <span>Zone: {row.zone_id ?? '—'}</span>
                              <span>Updated: {fmtDate(row.updated_at)}</span>
                            </div>
                            {row.description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Description</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.description}</p>
                              </div>
                            )}
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
