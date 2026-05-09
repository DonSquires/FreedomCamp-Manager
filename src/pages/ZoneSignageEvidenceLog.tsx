/**
 * ZoneSignageEvidenceLog — B-174
 *
 * Admin viewer for zone_signage_evidence.
 * Displays signage photo evidence per zone including GPS coordinates,
 * signage type, current status, and capture details.
 *
 * Route: /zone-signage-evidence-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Camera, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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
import { Input } from '@/components/ui/input'
import type { Database } from '@/types/database'

type ZoneSignageEvidenceRow = Database['public']['Tables']['zone_signage_evidence']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val == null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge className={val ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

export default function ZoneSignageEvidenceLog() {
  const [signageTypeFilter, setSignageTypeFilter] = useState('all')
  const [currentFilter, setCurrentFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneSignageEvidenceRow[]>({
    queryKey: ['zone-signage-evidence-log', signageTypeFilter, currentFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('zone_signage_evidence')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (signageTypeFilter !== 'all') q = q.eq('signage_type', signageTypeFilter)
      if (currentFilter === 'current') q = q.eq('is_current', true)
      if (currentFilter === 'archived') q = q.eq('is_current', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const { data: signageTypes = [] } = useQuery<string[]>({
    queryKey: ['zone-signage-evidence-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zone_signage_evidence')
        .select('signage_type')
      if (error) throw error
      const unique = Array.from(new Set((data ?? []).map(r => r.signage_type).filter(Boolean))) as string[]
      return unique
    },
  })

  const currentCount = rows.filter(r => r.is_current).length
  const withGps = rows.filter(r => r.gps_latitude != null && r.gps_longitude != null).length
  const withNotes = rows.filter(r => r.notes).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Camera className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Signage Evidence</h1>
              <p className="text-sm text-muted-foreground">Photo evidence of zone signage including GPS coordinates, signage type, and capture details</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Evidence', value: rows.length, colour: 'text-gray-700' },
            { label: 'Current', value: currentCount, colour: 'text-emerald-700' },
            { label: 'With GPS', value: withGps, colour: 'text-sky-700' },
            { label: 'With Notes', value: withNotes, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={signageTypeFilter} onValueChange={setSignageTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Signage type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {signageTypes.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={currentFilter} onValueChange={setCurrentFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="current">Current</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-44" />
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
                  <TableHead>Zone ID</TableHead>
                  <TableHead>Signage Type</TableHead>
                  <TableHead>GPS</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Captured At</TableHead>
                  <TableHead>Captured By</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="font-mono text-xs">{row.zone_id}</TableCell>
                      <TableCell className="text-sm">{row.signage_type ?? '—'}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {row.gps_latitude != null && row.gps_longitude != null
                          ? `${row.gps_latitude.toFixed(5)}, ${row.gps_longitude.toFixed(5)}`
                          : '—'}
                      </TableCell>
                      <TableCell>{boolBadge(row.is_current, 'Current', 'Archived')}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.captured_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.captured_by ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          {row.photo_url && (
                            <div>
                              <span className="font-medium">Photo:</span>{' '}
                              <a href={row.photo_url} className="text-sky-600 underline" target="_blank" rel="noopener noreferrer">{row.photo_url}</a>
                            </div>
                          )}
                          {row.photo_sha256 && <div><span className="font-medium">SHA-256:</span> <span className="font-mono">{row.photo_sha256}</span></div>}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {currentCount} current &nbsp;·&nbsp; {rows.length} total signage evidence records
          </p>
        )}
      </div>
    </AppLayout>
  )
}
