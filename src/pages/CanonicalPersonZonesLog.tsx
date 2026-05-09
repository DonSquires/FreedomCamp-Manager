import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { MapPin, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type CanonicalPersonZoneRow = Database['public']['Tables']['canonical_person_zones']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function CanonicalPersonZonesLog() {
  const { user } = useAuthStore()
  const [activeFilter, setActiveFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'trespass' | 'banned' | 'poi' | 'access_control' | 'flagged' | 'welfare'>('all')
  const [personQuery, setPersonQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalPersonZoneRow[]>({
    queryKey: ['canonical-person-zones-log', activeFilter, scopeFilter, personQuery, dateFrom, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('canonical_person_zones')
        .select('*')
        .order('added_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (scopeFilter !== 'all') q = q.eq('scope_type', scopeFilter)
      if (personQuery.trim()) q = q.ilike('person_id', `%${personQuery.trim()}%`)
      if (dateFrom) q = q.gte('added_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((r) => r.is_active).length
  const inactiveCount = rows.filter((r) => !r.is_active).length
  const uniqueZones = new Set(rows.map((r) => r.zone_id).filter(Boolean)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical Person Zones Log</h1>
              <p className="text-sm text-muted-foreground">Person-to-zone scope mappings used for access and operational restrictions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Inactive', value: inactiveCount, color: 'text-red-700' },
            { label: 'Unique Zones', value: uniqueZones, color: 'text-emerald-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={(value) => setScopeFilter(value as 'all' | 'trespass' | 'banned' | 'poi' | 'access_control' | 'flagged' | 'welfare')}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Scope type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value="trespass">Trespass</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
              <SelectItem value="poi">POI</SelectItem>
              <SelectItem value="access_control">Access Control</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="welfare">Welfare</SelectItem>
            </SelectContent>
          </Select>
          <Input value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} placeholder="Person ID…" className="w-44" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No canonical person-zone records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Added</TableHead>
                  <TableHead>Person ID</TableHead>
                  <TableHead>Zone ID</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.added_at)}</TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[120px]">{row.person_id ?? '—'}</TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[120px]">{row.zone_id ?? '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.scope_type ?? '—'}</Badge></TableCell>
                      <TableCell>{row.is_active ? <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge> : <Badge className="bg-red-100 text-red-800 text-xs">Inactive</Badge>}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.expires_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Added By:</span> {row.added_by ?? '—'}</div>
                          </div>
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
