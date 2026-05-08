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

type SiteRiskRow = Database['public']['Tables']['site_risk_assessments']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const RISK_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-emerald-100 text-emerald-800',
}

function hazardCount(row: SiteRiskRow) {
  return [
    row.hazard_aggressive_persons,
    row.hazard_animals,
    row.hazard_biological,
    row.hazard_confined_spaces,
    row.hazard_electrical,
    row.hazard_fire,
    row.hazard_hazardous_substances,
    row.hazard_lone_working,
    row.hazard_manual_handling,
    row.hazard_noise,
    row.hazard_other,
    row.hazard_poor_lighting,
    row.hazard_slips_trips_falls,
    row.hazard_uneven_terrain,
    row.hazard_vehicles_traffic,
    row.hazard_water_drowning,
    row.hazard_weather_exposure,
    row.hazard_working_at_height,
  ].filter(Boolean).length
}

export default function SiteRiskAssessmentLog() {
  const { user } = useAuthStore()
  const [riskFilter, setRiskFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [requestTypeFilter, setRequestTypeFilter] = useState('all')
  const [siteQuery, setSiteQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<SiteRiskRow[]>({
    queryKey: ['site-risk-assessments-log', riskFilter, statusFilter, requestTypeFilter, siteQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('site_risk_assessments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (riskFilter !== 'all') q = q.eq('overall_risk_level', riskFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (requestTypeFilter !== 'all') q = q.eq('request_type', requestTypeFilter)
      if (siteQuery.trim()) q = q.ilike('site_name', `%${siteQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const highRiskCount = rows.filter((r) => r.overall_risk_level === 'high' || r.overall_risk_level === 'critical').length
  const openCount = rows.filter((r) => r.status === 'draft' || r.status === 'pending').length
  const reviewedCount = rows.filter((r) => Boolean(r.reviewed_at)).length
  const requestTypes = ['all', ...Array.from(new Set(rows.map((r) => r.request_type).filter(Boolean)))]
  const statuses = ['all', ...Array.from(new Set(rows.map((r) => r.status).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Site Risk Assessment Log</h1>
              <p className="text-sm text-muted-foreground">Worksite risk records with hazard controls and review status</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Assessments', value: rows.length, color: 'text-gray-700' },
            { label: 'High/Critical', value: highRiskCount, color: 'text-red-700' },
            { label: 'Open', value: openCount, color: 'text-amber-700' },
            { label: 'Reviewed', value: reviewedCount, color: 'text-emerald-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={siteQuery}
            onChange={(e) => setSiteQuery(e.target.value)}
            placeholder="Search site…"
            className="w-44"
          />
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={requestTypeFilter} onValueChange={setRequestTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Request type" /></SelectTrigger>
            <SelectContent>
              {requestTypes.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All request types' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <p>No site risk assessments found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead>Hazards</TableHead>
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
                      <TableCell className="text-sm font-medium">{row.site_name}</TableCell>
                      <TableCell>
                        <Badge className={RISK_COLOURS[row.overall_risk_level ?? ''] ?? 'bg-slate-100 text-slate-700'}>
                          {row.overall_risk_level}
                        </Badge>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.status}</Badge></TableCell>
                      <TableCell className="text-sm">{row.request_type}</TableCell>
                      <TableCell className="text-sm">{hazardCount(row)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Assessment date:</span> {fmtDate(row.assessment_date)}</div>
                            <div><span className="font-medium">Assessed by:</span> {row.assessed_by ?? '—'}</div>
                            <div><span className="font-medium">Reviewed by:</span> {row.reviewed_by ?? '—'}</div>
                            <div><span className="font-medium">Reviewed at:</span> {fmtDate(row.reviewed_at)}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Address:</span> {row.site_address ?? '—'}</div>
                          </div>
                          {row.controls_in_place && <div><span className="font-medium">Controls:</span> {row.controls_in_place}</div>}
                          {row.additional_controls && <div><span className="font-medium">Additional controls:</span> {row.additional_controls}</div>}
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
