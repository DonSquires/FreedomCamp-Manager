/**
 * HealthSafetyReportLog — B-113
 *
 * Log viewer for health_safety_reports — H&S incident reports filed within zones.
 *
 * Features:
 *  - KPI cards: Total / Open / High+ Severity / Unique Zones
 *  - Filters: severity (dynamic), status (dynamic), incident_type (dynamic), date from
 *  - Table: severity badge, incident_type, reported_by (truncated), status badge,
 *           zone_id (truncated), created_at
 *  - Expandable row: full description, zone_id, reported_by, updated_at
 *
 * Route: /health-safety-report-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  HeartPulse, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type HealthSafetyReport = Database['public']['Tables']['health_safety_reports']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function severityBadge(sev: string | null) {
  if (!sev)               return 'bg-gray-100 text-gray-700'
  if (sev === 'critical') return 'bg-red-200 text-red-900'
  if (sev === 'high')     return 'bg-red-100 text-red-800'
  if (sev === 'medium')   return 'bg-yellow-100 text-yellow-800'
  if (sev === 'low')      return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-700'
}

function statusBadge(status: string | null) {
  if (!status)                              return 'bg-gray-100 text-gray-700'
  if (status === 'open')                    return 'bg-yellow-100 text-yellow-800'
  if (status === 'in_review')               return 'bg-blue-100 text-blue-800'
  if (status === 'closed' || status === 'resolved') return 'bg-green-100 text-green-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HealthSafetyReportLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [typeFilter,     setTypeFilter]     = useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [expandedId,     setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<HealthSafetyReport[]>({
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
      if (statusFilter   !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter     !== 'all') q = q.eq('incident_type', typeFilter)
      if (dateFrom)                 q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const openCount     = rows.filter(r => r.status === 'open').length
  const highPlusCount = rows.filter(r => r.severity === 'high' || r.severity === 'critical').length
  const uniqueZones   = new Set(rows.map(r => r.zone_id).filter(Boolean)).size
  const severities    = [...new Set(rows.map(r => r.severity).filter(Boolean))].sort()
  const statuses      = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const incidentTypes = [...new Set(rows.map(r => r.incident_type).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeartPulse className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Health &amp; Safety Report Log</h1>
              <p className="text-sm text-muted-foreground">H&amp;S incident reports filed within enforcement zones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Reports',    value: rows.length,   colour: 'text-gray-700' },
            { label: 'Open',             value: openCount,     colour: 'text-yellow-700' },
            { label: 'High+ Severity',   value: highPlusCount, colour: 'text-red-700' },
            { label: 'Unique Zones',     value: uniqueZones,   colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {severities.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Incident type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {incidentTypes.map(t => <SelectItem key={t} value={t!}>{t.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No H&amp;S reports found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Severity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reported By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${(row.severity === 'critical' || row.severity === 'high') ? 'bg-red-50/20 dark:bg-red-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell><Badge className={severityBadge(row.severity)}>{row.severity ?? '—'}</Badge></TableCell>
                        <TableCell className="text-sm">{row.incident_type ? row.incident_type.replace(/_/g, ' ') : '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.reported_by ? `${row.reported_by.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell><Badge className={statusBadge(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.zone_id ? `${row.zone_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.reported_by && <span>Reported by: {row.reported_by}</span>}
                              {row.zone_id     && <span>Zone: {row.zone_id}</span>}
                              {row.updated_at  && <span>Updated: {fmtDate(row.updated_at)}</span>}
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
