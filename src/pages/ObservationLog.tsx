import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Eye, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ObservationRow = Database['public']['Tables']['observations']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function complianceBadge(isCompliant: boolean | null) {
  if (isCompliant === true) return 'bg-green-100 text-green-800'
  if (isCompliant === false) return 'bg-rose-100 text-rose-800'
  return 'bg-gray-100 text-gray-700'
}

function photoValue(row: ObservationRow) {
  return row.photo_url || row.photo || null
}

export default function ObservationLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [breachTypeFilter, setBreachTypeFilter] = useState('all')
  const [complianceFilter, setComplianceFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ObservationRow[]>({
    queryKey: ['observations-log', orgId, searchQuery, breachTypeFilter, complianceFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select('*')
        .eq('organization_id', orgId!)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (breachTypeFilter !== 'all') q = q.eq('breach_type', breachTypeFilter)
      if (complianceFilter === 'compliant') q = q.eq('is_compliant', true)
      if (complianceFilter === 'non_compliant') q = q.eq('is_compliant', false)
      if (dateFrom) q = q.gte('recorded_at', dateFrom)
      if (searchQuery.trim()) q = q.ilike('plate_number', `%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const breachCount = rows.filter(r => r.is_breach === true).length
  const compliantCount = rows.filter(r => r.is_compliant === true).length
  const withPhotoCount = rows.filter(r => !!photoValue(r)).length
  const breachTypes = [...new Set(rows.map(r => r.breach_type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Observation Log</h1>
              <p className="text-sm text-muted-foreground">Vehicle observation records with breach state, processing metadata, and GPS evidence</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Observations', value: rows.length, colour: 'text-gray-700' },
            { label: 'Breaches', value: breachCount, colour: 'text-rose-700' },
            { label: 'Compliant', value: compliantCount, colour: 'text-green-700' },
            { label: 'With Photo', value: withPhotoCount, colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate…" className="w-44" />
          <Select value={breachTypeFilter} onValueChange={setBreachTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Breach type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All breach types</SelectItem>
              {breachTypes.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={complianceFilter} onValueChange={setComplianceFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Compliance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All observations</SelectItem>
              <SelectItem value="compliant">Compliant</SelectItem>
              <SelectItem value="non_compliant">Non-compliant</SelectItem>
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
                  <TableHead>Plate</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Compliance</TableHead>
                  <TableHead>Breach Type</TableHead>
                  <TableHead>Processing</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.observation_id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.observation_id ? null : row.observation_id)}>
                      <TableCell className="font-mono text-xs">{row.plate_number}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.recorded_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.zone_id}</TableCell>
                      <TableCell><Badge className={complianceBadge(row.is_compliant)}>{row.is_compliant === true ? 'compliant' : row.is_compliant === false ? 'non-compliant' : 'unknown'}</Badge></TableCell>
                      <TableCell className="text-sm">{row.breach_type ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.processing_status ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.observation_id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.observation_id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Observation ID:</span> {row.observation_id}</div>
                          <div><span className="font-medium">Recorded by:</span> {row.recorded_by ?? '—'} &nbsp; <span className="font-medium">Incident:</span> {row.incident_id ?? '—'}</div>
                          <div><span className="font-medium">Processing:</span> {row.processing_status ?? '—'} &nbsp; <span className="font-medium">Started:</span> {fmtDate(row.processing_started_at)} &nbsp; <span className="font-medium">Completed:</span> {fmtDate(row.processing_completed_at)}</div>
                          <div><span className="font-medium">Breach:</span> {row.is_breach === true ? 'yes' : row.is_breach === false ? 'no' : 'unknown'} &nbsp; <span className="font-medium">Reason:</span> {row.breach_reason ?? '—'}</div>
                          <div><span className="font-medium">Nights stayed:</span> {row.nights_stayed_this_month ?? '—'} &nbsp; <span className="font-medium">Self contained:</span> {row.self_contained == null ? '—' : row.self_contained ? 'yes' : 'no'}</div>
                          {(row.gps_latitude != null && row.gps_longitude != null) && <div><span className="font-medium">GPS:</span> {row.gps_latitude}, {row.gps_longitude} &nbsp; <span className="font-medium">Accuracy:</span> {row.gps_accuracy ?? '—'}</div>}
                          <div><span className="font-medium">Vehicle:</span> {[row.vehicle_year, row.vehicle_make, row.vehicle_model, row.vehicle_color].filter(Boolean).join(' ') || '—'}</div>
                          {row.officer_notes && <div><span className="font-medium">Officer notes:</span> {row.officer_notes}</div>}
                          {row.observation_notes && <div><span className="font-medium">Observation notes:</span> {row.observation_notes}</div>}
                          {row.processing_error && <div><span className="font-medium">Processing error:</span> {row.processing_error}</div>}
                          {photoValue(row) && (
                            <div>
                              <span className="font-medium">Photo:</span>{' '}
                              <a href={photoValue(row)!} target="_blank" rel="noreferrer" className="text-sky-600 underline break-all">{photoValue(row)}</a>
                            </div>
                          )}
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
