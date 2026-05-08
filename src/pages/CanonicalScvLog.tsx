import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ShieldCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type CanonicalScvRow = Database['public']['Tables']['canonical_scv']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-800',
  pending: 'bg-amber-100 text-amber-800',
  revoked: 'bg-gray-100 text-gray-700',
}

function statusBadge(status: string | null) {
  return STATUS_COLOURS[status?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

export default function CanonicalScvLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalScvRow[]>({
    queryKey: ['canonical-scv-log', orgId, searchQuery, statusFilter, sourceFilter, dateFrom],
    enabled: !!user,
    queryFn: async () => {
      // For non-master users scope by plates seen in their org's observations
      let plates: string[] | null = null
      if (user?.role !== 'master' && orgId) {
        const { data: obs, error: obsErr } = await supabase
          .from('observations')
          .select('plate_number')
          .eq('organization_id', orgId)
        if (obsErr) throw obsErr
        plates = [...new Set((obs ?? []).map((o) => o.plate_number).filter(Boolean))] as string[]
        if (plates.length === 0) return []
      }

      let q = supabase
        .from('canonical_scv')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (plates) q = q.in('plate_number', plates)
      if (statusFilter !== 'all') q = q.eq('certificate_status', statusFilter)
      if (sourceFilter !== 'all') q = q.eq('source', sourceFilter)
      if (dateFrom) q = q.gte('updated_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`plate_number.ilike.%${term}%,vin.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => r.certificate_status === 'active').length
  const expiredCount = rows.filter(r => r.certificate_status === 'expired').length
  const scCount = rows.filter(r => r.is_self_contained).length
  const sources = [...new Set(rows.map(r => r.source).filter(Boolean))].sort()
  const statuses = [...new Set(rows.map(r => r.certificate_status).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical SCV Log</h1>
              <p className="text-sm text-muted-foreground">Self-contained vehicle certificate registry with status, expiry, and source metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, colour: 'text-gray-700' },
            { label: 'Self-Contained', value: scCount, colour: 'text-green-700' },
            { label: 'Active Certs', value: activeCount, colour: 'text-blue-700' },
            { label: 'Expired Certs', value: expiredCount, colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate or VIN…" className="w-56" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
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
                  <TableHead>VIN</TableHead>
                  <TableHead>Self-Contained</TableHead>
                  <TableHead>Cert Status</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.plate_number}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.plate_number ? null : row.plate_number)}>
                      <TableCell className="font-mono text-xs">{row.plate_number}</TableCell>
                      <TableCell className="font-mono text-xs">{row.vin ?? '—'}</TableCell>
                      <TableCell><Badge className={row.is_self_contained ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>{row.is_self_contained ? 'yes' : 'no'}</Badge></TableCell>
                      <TableCell><Badge className={statusBadge(row.certificate_status)}>{row.certificate_status ?? '—'}</Badge></TableCell>
                      <TableCell className="text-sm">{fmtDate(row.certificate_expiry)}</TableCell>
                      <TableCell className="text-sm">{row.source ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.plate_number ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.plate_number && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Issue date:</span> {fmtDate(row.certificate_issue_date)} &nbsp; <span className="font-medium">Verified at:</span> {fmtDate(row.verified_at)}</div>
                          <div><span className="font-medium">Max occupants:</span> {row.max_occupants ?? '—'}</div>
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)} &nbsp; <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
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
