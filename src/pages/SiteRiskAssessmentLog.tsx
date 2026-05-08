/**
 * SiteRiskAssessmentLog — B-156
 *
 * Admin log and viewer for the site_risk_assessments table.
 * Displays site risk assessments with overall risk level, status, site name/address,
 * request type, and assessor. Supports risk-level/status/request-type/site/date filters
 * and an expandable detail row for hazard checklist, controls, PPE, and GPS.
 *
 * Route: /site-risk-assessments-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ClipboardCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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
  high:     'bg-red-100 text-red-800',
  medium:   'bg-amber-100 text-amber-800',
  low:      'bg-blue-100 text-blue-800',
  critical: 'bg-rose-100 text-rose-800',
}
function riskBadge(v: string) {
  return RISK_COLOURS[v?.toLowerCase()] ?? 'bg-gray-100 text-gray-700'
}

const STATUS_COLOURS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  pending:   'bg-sky-100 text-sky-800',
  reviewed:  'bg-indigo-100 text-indigo-800',
}
function statusBadge(v: string) {
  return STATUS_COLOURS[v?.toLowerCase()] ?? 'bg-gray-100 text-gray-700'
}

/** List active boolean hazard fields */
function activeHazards(row: SiteRiskRow): string[] {
  const hazardMap: [keyof SiteRiskRow, string][] = [
    ['hazard_aggressive_persons',  'Aggressive persons'],
    ['hazard_animals',             'Animals'],
    ['hazard_biological',          'Biological'],
    ['hazard_confined_spaces',     'Confined spaces'],
    ['hazard_electrical',          'Electrical'],
    ['hazard_fire',                'Fire'],
    ['hazard_hazardous_substances','Hazardous substances'],
    ['hazard_lone_working',        'Lone working'],
    ['hazard_manual_handling',     'Manual handling'],
    ['hazard_noise',               'Noise'],
    ['hazard_poor_lighting',       'Poor lighting'],
    ['hazard_slips_trips_falls',   'Slips/trips/falls'],
    ['hazard_uneven_terrain',      'Uneven terrain'],
    ['hazard_vehicles_traffic',    'Vehicles/traffic'],
    ['hazard_water_drowning',      'Water/drowning'],
    ['hazard_weather_exposure',    'Weather exposure'],
    ['hazard_working_at_height',   'Working at height'],
    ['hazard_other',               'Other'],
  ]
  return hazardMap.filter(([key]) => row[key] === true).map(([, label]) => label)
}

export default function SiteRiskAssessmentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [riskFilter,   setRiskFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [siteSearch,   setSiteSearch]   = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<SiteRiskRow[]>({
    queryKey: ['site-risk-assessments-log', orgId, riskFilter, statusFilter, typeFilter, siteSearch, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('site_risk_assessments')
        .select('*')
        .eq('organization_id', orgId!)
        .order('assessment_date', { ascending: false, nullsFirst: false })
        .limit(500)

      if (riskFilter !== 'all')   q = q.eq('overall_risk_level', riskFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('request_type', typeFilter)
      if (dateFrom)               q = q.gte('assessment_date', dateFrom)
      if (siteSearch.trim())      q = q.ilike('site_name', `%${siteSearch.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const highCount     = rows.filter(r => r.overall_risk_level?.toLowerCase() === 'high' || r.overall_risk_level?.toLowerCase() === 'critical').length
  const completedCount= rows.filter(r => r.status?.toLowerCase() === 'completed').length
  const reviewedCount = rows.filter(r => r.reviewed_by).length
  const requestTypes  = [...new Set(rows.map(r => r.request_type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Site Risk Assessment Log</h1>
              <p className="text-sm text-muted-foreground">Completed site risk assessments with hazard checklist, controls, and overall risk level</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Assessments', value: rows.length,      colour: 'text-gray-700' },
            { label: 'High/Critical Risk',value: highCount,        colour: 'text-red-700' },
            { label: 'Completed',         value: completedCount,   colour: 'text-emerald-700' },
            { label: 'Reviewed',          value: reviewedCount,    colour: 'text-indigo-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={siteSearch} onChange={e => setSiteSearch(e.target.value)} placeholder="Search site name…" className="w-52" />
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Risk level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              {['critical','high','medium','low'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {['completed','pending','reviewed'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Request type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {requestTypes.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
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
                  <TableHead>Site Name</TableHead>
                  <TableHead>Risk Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Request Type</TableHead>
                  <TableHead>Assessed By</TableHead>
                  <TableHead>Assessment Date</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-medium text-sm">{row.site_name}</TableCell>
                      <TableCell><Badge className={riskBadge(row.overall_risk_level)}>{row.overall_risk_level}</Badge></TableCell>
                      <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                      <TableCell className="text-sm">{row.request_type}</TableCell>
                      <TableCell className="text-sm">{row.assessed_by ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.assessment_date)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Record ID:</span> {row.id}</div>
                          {row.site_address && <div><span className="font-medium">Address:</span> {row.site_address}</div>}
                          {(row.gps_latitude != null && row.gps_longitude != null) && (
                            <div><span className="font-medium">GPS:</span> {row.gps_latitude}, {row.gps_longitude}</div>
                          )}
                          {row.job_reference   && <div><span className="font-medium">Job ref:</span> {row.job_reference}</div>}
                          {row.zone_id         && <div><span className="font-medium">Zone:</span> {row.zone_id}</div>}
                          {(() => { const hazards = activeHazards(row); return hazards.length > 0 ? <div><span className="font-medium">Hazards:</span> {hazards.join(', ')}{row.hazard_other_description ? ` — ${row.hazard_other_description}` : ''}</div> : null })()}
                          {row.controls_in_place   && <div><span className="font-medium">Controls:</span> {row.controls_in_place}</div>}
                          {row.additional_controls && <div><span className="font-medium">Additional controls:</span> {row.additional_controls}</div>}
                          {row.ppe_required?.length ? <div><span className="font-medium">PPE required:</span> {row.ppe_required.join(', ')}</div> : null}
                          <div className="flex flex-wrap gap-3 mt-1">
                            {row.first_aid_available != null      && <span className={row.first_aid_available      ? 'text-emerald-700' : 'text-gray-500'}>First aid: {row.first_aid_available      ? '✓' : '✗'}</span>}
                            {row.communication_coverage != null   && <span className={row.communication_coverage   ? 'text-emerald-700' : 'text-gray-500'}>Comms coverage: {row.communication_coverage   ? '✓' : '✗'}</span>}
                            {row.emergency_plan_sighted != null   && <span className={row.emergency_plan_sighted   ? 'text-emerald-700' : 'text-gray-500'}>Emergency plan: {row.emergency_plan_sighted   ? '✓' : '✗'}</span>}
                            {row.signage_adequate != null         && <span className={row.signage_adequate         ? 'text-emerald-700' : 'text-gray-500'}>Signage: {row.signage_adequate         ? '✓' : '✗'}</span>}
                            {row.site_access_clear != null        && <span className={row.site_access_clear        ? 'text-emerald-700' : 'text-gray-500'}>Access clear: {row.site_access_clear        ? '✓' : '✗'}</span>}
                            {row.safe_parking_available != null   && <span className={row.safe_parking_available   ? 'text-emerald-700' : 'text-gray-500'}>Safe parking: {row.safe_parking_available   ? '✓' : '✗'}</span>}
                          </div>
                          {row.reviewed_by && <div><span className="font-medium">Reviewed by:</span> {row.reviewed_by} at {fmtDate(row.reviewed_at)}</div>}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)} &nbsp; <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
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
