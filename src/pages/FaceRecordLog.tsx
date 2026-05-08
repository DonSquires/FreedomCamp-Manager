import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Camera, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

function fmtNum(value: number | null, digits = 5) {
  if (value === null || value === undefined) return '—'
  return value.toFixed(digits)
}

export default function FaceRecordLog() {
  const { user } = useAuthStore()
  const [methodFilter, setMethodFilter] = useState('all')
  const [labelQuery, setLabelQuery] = useState('')
  const [personFilter, setPersonFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<FaceRecordRow[]>({
    queryKey: ['face-records-log', methodFilter, labelQuery, personFilter, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('face_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (methodFilter !== 'all') q = q.eq('detection_method', methodFilter)
      if (labelQuery.trim()) q = q.ilike('label', `%${labelQuery.trim()}%`)
      if (personFilter === 'linked') q = q.not('person_record_id', 'is', null)
      if (personFilter === 'unlinked') q = q.is('person_record_id', null)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const linkedCount = rows.filter((r) => Boolean(r.person_record_id)).length
  const withGpsCount = rows.filter((r) => r.latitude !== null && r.longitude !== null).length
  const labeledCount = rows.filter((r) => Boolean(r.label)).length
  const methods = ['all', ...Array.from(new Set(rows.map((r) => r.detection_method).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Camera className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Face Record Log</h1>
              <p className="text-sm text-muted-foreground">Face-recognition captures with person and incident links</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Labeled', value: labeledCount, color: 'text-blue-700' },
            { label: 'Person Linked', value: linkedCount, color: 'text-violet-700' },
            { label: 'With GPS', value: withGpsCount, color: 'text-emerald-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Detection method" /></SelectTrigger>
            <SelectContent>
              {methods.map((m) => (
                <SelectItem key={m} value={m}>{m === 'all' ? 'All methods' : m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={personFilter} onValueChange={setPersonFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Person link" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="linked">Person linked</SelectItem>
              <SelectItem value="unlinked">Unlinked</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value)}
            placeholder="Search label…"
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
            <p>No face records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Faces</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Person</TableHead>
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
                      <TableCell className="text-sm">{row.label ?? '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.detection_method ?? '—'}</Badge></TableCell>
                      <TableCell className="text-sm">{row.face_count}</TableCell>
                      <TableCell className="text-sm">{fmtNum(row.embedding_quality, 3)}</TableCell>
                      <TableCell>
                        {row.person_record_id ? <Badge className="bg-violet-100 text-violet-800">Linked</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Incident:</span> {row.incident_id ?? '—'}</div>
                            <div><span className="font-medium">Observation:</span> {row.observation_id ?? '—'}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Latitude:</span> {fmtNum(row.latitude)}</div>
                            <div><span className="font-medium">Longitude:</span> {fmtNum(row.longitude)}</div>
                          </div>
                          <div className="truncate"><span className="font-medium">Photo URL:</span> {row.photo_url}</div>
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
