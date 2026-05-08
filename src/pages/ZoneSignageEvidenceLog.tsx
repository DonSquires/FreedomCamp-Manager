import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Signpost, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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

type ZoneSignageEvidenceRow = Database['public']['Tables']['zone_signage_evidence']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

export default function ZoneSignageEvidenceLog() {
  const [currentFilter, setCurrentFilter] = useState('all')
  const [signageFilter, setSignageFilter] = useState('all')
  const [zoneQuery, setZoneQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneSignageEvidenceRow[]>({
    queryKey: ['zone-signage-evidence-log', currentFilter, signageFilter, zoneQuery],
    queryFn: async () => {
      let q = supabase
        .from('zone_signage_evidence')
        .select('*')
        .order('captured_at', { ascending: false })
        .limit(500)

      if (currentFilter === 'current') q = q.eq('is_current', true)
      if (currentFilter === 'not_current') q = q.eq('is_current', false)
      if (signageFilter !== 'all') q = q.eq('signage_type', signageFilter)
      if (zoneQuery.trim()) q = q.ilike('zone_id', `%${zoneQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const currentCount = rows.filter((r) => r.is_current).length
  const withPhoto = rows.filter((r) => !!r.photo_url).length
  const withGps = rows.filter((r) => r.gps_latitude !== null && r.gps_longitude !== null).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Signpost className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Signage Evidence Log</h1>
              <p className="text-sm text-muted-foreground">Evidence records for zone signage capture and verification</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Evidence', value: rows.length, color: 'text-gray-700' },
            { label: 'Current', value: currentCount, color: 'text-green-700' },
            { label: 'With Photo', value: withPhoto, color: 'text-sky-700' },
            { label: 'With GPS', value: withGps, color: 'text-orange-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={currentFilter} onValueChange={setCurrentFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Current state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="current">Current</SelectItem>
              <SelectItem value="not_current">Not Current</SelectItem>
            </SelectContent>
          </Select>
          <Select value={signageFilter} onValueChange={setSignageFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Signage type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="entry">Entry</SelectItem>
              <SelectItem value="rules">Rules</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
            </SelectContent>
          </Select>
          <Input value={zoneQuery} onChange={(e) => setZoneQuery(e.target.value)} placeholder="Zone ID…" className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No zone signage evidence records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured</TableHead>
                  <TableHead>Zone ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Photo</TableHead>
                  <TableHead>GPS</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.captured_at)}</TableCell>
                      <TableCell className="text-xs font-mono">{row.zone_id ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.signage_type ?? '—'}</TableCell>
                      <TableCell>{row.is_current ? <Badge className="bg-green-100 text-green-800 text-xs">Current</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}</TableCell>
                      <TableCell>{row.photo_url ? <Badge className="bg-sky-100 text-sky-800 text-xs">Photo</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      <TableCell>{row.gps_latitude !== null && row.gps_longitude !== null ? <Badge className="bg-orange-100 text-orange-800 text-xs">GPS</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Evidence ID:</span> {row.id}</div>
                            <div><span className="font-medium">Captured By:</span> {row.captured_by ?? '—'}</div>
                            <div><span className="font-medium">Created At:</span> {fmtDate(row.created_at)}</div>
                            <div><span className="font-medium">GPS Latitude:</span> {row.gps_latitude ?? '—'}</div>
                            <div><span className="font-medium">GPS Longitude:</span> {row.gps_longitude ?? '—'}</div>
                            <div><span className="font-medium">Photo SHA:</span> {row.photo_sha256 ?? '—'}</div>
                          </div>
                          {row.photo_url && <div><span className="font-medium">Photo URL:</span> {row.photo_url}</div>}
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
