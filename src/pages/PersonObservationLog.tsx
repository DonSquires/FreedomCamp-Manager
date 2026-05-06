/**
 * PersonObservationLog — B-102
 *
 * Log viewer for person_observations — officer field observations of persons.
 *
 * Features:
 *  - KPI cards: Total / Alert Generated / Avg Match Confidence / Minor Records
 *  - Filters: observation_type (dynamic), alert_generated toggle, date from, plate search
 *  - Table: observation_type badge, recorded_at, zone_id, plate_number,
 *           identification_method, alert_types badges, match confidence bar
 *  - Expandable row: person_id, canonical_person_id, officer_notes,
 *                    GPS, gps_accuracy, geofence_validated, metadata, evidence photos
 *
 * Route: /person-observations-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Eye, RefreshCw, AlertCircle, Loader2,
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

type PersonObservation = Database['public']['Tables']['person_observations']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function obsTypeBadge(type: string) {
  if (type === 'breach')     return 'bg-red-100 text-red-800'
  if (type === 'welfare')    return 'bg-blue-100 text-blue-800'
  if (type === 'patrol')     return 'bg-teal-100 text-teal-800'
  if (type === 'checkpoint') return 'bg-purple-100 text-purple-800'
  return 'bg-gray-100 text-gray-700'
}

function alertTypeBadge(t: string) {
  if (t === 'trespass') return 'bg-red-200 text-red-900'
  if (t === 'poi')      return 'bg-orange-100 text-orange-800'
  if (t === 'banned')   return 'bg-red-100 text-red-800'
  if (t === 'welfare')  return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PersonObservationLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [obsTypeFilter,   setObsTypeFilter]   = useState('all')
  const [alertFilter,     setAlertFilter]     = useState('all')
  const [dateFrom,        setDateFrom]        = useState('')
  const [plateSearch,     setPlateSearch]     = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<PersonObservation[]>({
    queryKey: ['person-observations-log', orgId, obsTypeFilter, alertFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('person_observations')
        .select('*')
        .eq('organization_id', orgId!)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (obsTypeFilter !== 'all') q = q.eq('observation_type', obsTypeFilter)
      if (alertFilter   === 'yes') q = q.eq('alert_generated', true)
      if (dateFrom)                q = q.gte('recorded_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered      = plateSearch
    ? rows.filter(r => r.plate_number?.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  const alertCount    = filtered.filter(r => r.alert_generated).length
  const minorCount    = filtered.filter(r => r.is_minor_record).length
  const confValues    = filtered.map(r => r.match_confidence).filter((c): c is number => c != null)
  const avgConf       = confValues.length > 0
    ? ((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100).toFixed(0) + '%'
    : '—'
  const obsTypes      = [...new Set(rows.map(r => r.observation_type).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Person Observation Log</h1>
              <p className="text-sm text-muted-foreground">Officer field observations of persons at zone locations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Observations', value: filtered.length, colour: 'text-gray-700' },
            { label: 'Alert Generated',    value: alertCount,       colour: 'text-red-700' },
            { label: 'Avg Match Conf.',    value: avgConf,          colour: 'text-purple-700' },
            { label: 'Minor Records',      value: minorCount,       colour: 'text-orange-700' },
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
          <Select value={obsTypeFilter} onValueChange={setObsTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Observation type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {obsTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={alertFilter} onValueChange={setAlertFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Alert" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All observations</SelectItem>
              <SelectItem value="yes">Alert generated</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <Input
            placeholder="Search plate…"
            value={plateSearch}
            onChange={e => setPlateSearch(e.target.value)}
            className="w-40"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No person observations found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Type</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>ID Method</TableHead>
                  <TableHead>Alerts</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const expanded = expandedId === row.id
                  const confPct  = row.match_confidence != null ? Math.round(row.match_confidence * 100) : null
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${row.alert_generated ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell>
                          <Badge className={obsTypeBadge(row.observation_type)}>{row.observation_type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.recorded_at)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.zone_id.slice(0, 8)}…
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {row.plate_number ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.identification_method ?? '—'}
                        </TableCell>
                        <TableCell>
                          {row.alert_types && row.alert_types.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.alert_types.map((t, i) => (
                                <Badge key={i} className={`text-xs ${alertTypeBadge(t)}`}>{t}</Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {confPct != null ? (
                            <div className="flex items-center gap-2 min-w-[80px]">
                              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="h-1.5 rounded-full bg-purple-500"
                                  style={{ width: `${confPct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-9 text-right">{confPct}%</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.person_id           && <span>Person: {row.person_id.slice(0, 8)}…</span>}
                              {row.canonical_person_id && <span>Canonical: {row.canonical_person_id.slice(0, 8)}…</span>}
                              {row.recorded_by         && <span>Recorded by: {row.recorded_by.slice(0, 8)}…</span>}
                              {row.gps_latitude != null && (
                                <span>GPS: {row.gps_latitude.toFixed(5)}, {row.gps_longitude?.toFixed(5) ?? '?'}</span>
                              )}
                              {row.gps_accuracy != null && <span>GPS accuracy: {row.gps_accuracy}m</span>}
                              {row.geofence_validated != null && (
                                <span>Geofence validated: {row.geofence_validated ? 'Yes' : 'No'}</span>
                              )}
                              {row.is_minor_record && <span className="text-orange-700 font-medium">⚠ Minor record</span>}
                            </div>
                            {row.officer_notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Officer Notes</p>
                                <p className="text-sm text-muted-foreground">{row.officer_notes}</p>
                              </div>
                            )}
                            {row.metadata && Object.keys(row.metadata as object).length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Metadata</p>
                                <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">
                                  {JSON.stringify(row.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                            {row.evidence_photos && row.evidence_photos.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Evidence Photos ({row.evidence_photos.length})</p>
                                <div className="flex flex-wrap gap-2">
                                  {row.evidence_photos.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-blue-600 underline">
                                      Photo {i + 1}
                                    </a>
                                  ))}
                                </div>
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
