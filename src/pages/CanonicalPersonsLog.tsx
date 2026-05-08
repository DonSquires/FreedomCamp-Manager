import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { User, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type CanonicalPersonRow = Database['public']['Tables']['canonical_persons']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function CanonicalPersonsLog() {
  const { user } = useAuthStore()
  const [riskFilter, setRiskFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all')
  const [flagFilter, setFlagFilter] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalPersonRow[]>({
    queryKey: ['canonical-persons-log', riskFilter, flagFilter, nameQuery, dateFrom, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('canonical_persons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (riskFilter !== 'all') q = q.eq('risk_level', riskFilter)
      if (flagFilter === 'flagged') q = q.eq('is_flagged', true)
      if (flagFilter === 'not_flagged') q = q.eq('is_flagged', false)
      if (nameQuery.trim()) q = q.or(`full_name.ilike.%${nameQuery.trim()}%,first_name.ilike.%${nameQuery.trim()}%,last_name.ilike.%${nameQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const flaggedCount = rows.filter((r) => r.is_flagged).length
  const poiCount = rows.filter((r) => r.is_poi).length
  const highRiskCount = rows.filter((r) => r.risk_level === 'high').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <User className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical Persons Log</h1>
              <p className="text-sm text-muted-foreground">Canonical person records used for identity, risk, and access management</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Flagged', value: flaggedCount, color: 'text-red-700' },
            { label: 'POI', value: poiCount, color: 'text-amber-700' },
            { label: 'High Risk', value: highRiskCount, color: 'text-purple-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value as 'all' | 'low' | 'medium' | 'high' | 'critical')}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Risk level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risks</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={flagFilter} onValueChange={setFlagFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Flag state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="not_flagged">Not Flagged</SelectItem>
            </SelectContent>
          </Select>
          <Input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder="Search name…" className="w-44" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No canonical person records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Flagged</TableHead>
                  <TableHead>POI</TableHead>
                  <TableHead>Trespassed</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.risk_level ?? '—'}</Badge></TableCell>
                      <TableCell>{row.is_flagged ? <Badge className="bg-red-100 text-red-800 text-xs">Flagged</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      <TableCell>{row.is_poi ? <Badge className="bg-amber-100 text-amber-800 text-xs">Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      <TableCell>{row.is_trespassed ? <Badge className="bg-purple-100 text-purple-800 text-xs">Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Identity Status:</span> {row.identity_status ?? '—'}</div>
                            <div><span className="font-medium">DOB:</span> {row.date_of_birth ?? '—'}</div>
                            <div><span className="font-medium">Access Clearance:</span> {row.access_clearance_level ?? '—'}</div>
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.flagged_reason && <div><span className="font-medium">Flag Reason:</span> {row.flagged_reason}</div>}
                          {row.flagged_notes && <div><span className="font-medium">Flag Notes:</span> {row.flagged_notes}</div>}
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
