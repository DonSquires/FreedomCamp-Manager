/**
 * FaceRecordLog — B-154
 *
 * Admin log and viewer for the face_records table.
 * Displays face-detection records with detection method, embedding quality,
 * face count, and cross-references to incidents, observations, and person records.
 * Supports officer/method/quality/date filters and an expandable detail row
 * for coordinates, notes, and photo link.
 *
 * Route: /face-records-log — admin/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ScanFace, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type FaceRecordRow = Database['public']['Tables']['face_records']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function qualityLabel(q: number | null): string {
  if (q == null) return '—'
  return q.toFixed(3)
}

export default function FaceRecordLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [methodFilter, setMethodFilter] = useState('all')
  const [labelFilter,  setLabelFilter]  = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<FaceRecordRow[]>({
    queryKey: ['face-records-log', orgId, methodFilter, labelFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('face_records')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (methodFilter !== 'all') q = q.eq('detection_method', methodFilter)
      if (labelFilter.trim())     q = q.ilike('label', `%${labelFilter.trim()}%`)
      if (dateFrom)               q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const withPersonRecord = rows.filter(r => r.person_record_id).length
  const withIncident     = rows.filter(r => r.incident_id).length
  const totalFaces       = rows.reduce((sum, r) => sum + (r.face_count ?? 0), 0)
  const methods          = [...new Set(rows.map(r => r.detection_method).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScanFace className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Face Record Log</h1>
              <p className="text-sm text-muted-foreground">Face-detection records with quality scores, cross-references, and photo links</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records',        value: rows.length,        colour: 'text-gray-700' },
            { label: 'Total Faces Detected', value: totalFaces,         colour: 'text-violet-700' },
            { label: 'Linked to Person',     value: withPersonRecord,   colour: 'text-sky-700' },
            { label: 'Linked to Incident',   value: withIncident,       colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={labelFilter} onChange={e => setLabelFilter(e.target.value)} placeholder="Search label…" className="w-48" />
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Detection method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {methods.map(m => <SelectItem key={m} value={m!}>{m}</SelectItem>)}
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
                  <TableHead>Label</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Faces</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Incident</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm">{row.label ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.detection_method ?? '—'}</TableCell>
                      <TableCell className="text-sm text-center">{row.face_count}</TableCell>
                      <TableCell className="text-sm font-mono">{qualityLabel(row.embedding_quality)}</TableCell>
                      <TableCell>
                        <Badge className={row.person_record_id ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-700'}>
                          {row.person_record_id ? 'Linked' : 'None'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.incident_id ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-700'}>
                          {row.incident_id ? 'Linked' : 'None'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Record ID:</span> {row.id}</div>
                          {row.officer_id       && <div><span className="font-medium">Officer:</span> {row.officer_id}</div>}
                          {row.observation_id   && <div><span className="font-medium">Observation:</span> {row.observation_id}</div>}
                          {row.person_record_id && <div><span className="font-medium">Person record:</span> {row.person_record_id}</div>}
                          {row.incident_id      && <div><span className="font-medium">Incident:</span> {row.incident_id}</div>}
                          {row.zone_id          && <div><span className="font-medium">Zone:</span> {row.zone_id}</div>}
                          {(row.latitude != null && row.longitude != null) && (
                            <div><span className="font-medium">Coords:</span> {row.latitude}, {row.longitude}</div>
                          )}
                          {row.photo_url && (
                            <div>
                              <span className="font-medium">Photo:</span>{' '}
                              <a href={row.photo_url} target="_blank" rel="noreferrer" className="text-sky-600 underline break-all">{row.photo_url}</a>
                            </div>
                          )}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
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
