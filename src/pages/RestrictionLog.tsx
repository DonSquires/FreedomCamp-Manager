/**
 * RestrictionLog — B-150
 *
 * Admin log and viewer for restrictions.
 * Displays geo-restriction boundaries defined for the organization —
 * name, restriction type, and metadata — without rendering raw geometry.
 *
 * Route: /restrictions-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ShieldOff, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type RestrictionRow = Database['public']['Tables']['restrictions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function RestrictionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter,  setTypeFilter]  = useState('all')
  const [expanded,    setExpanded]    = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RestrictionRow[]>({
    queryKey: ['restrictions-log', orgId, searchQuery, typeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('restrictions')
        .select('id, name, restriction_type, meta_data, created_at, updated_at, organization_id')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (searchQuery.trim()) q = q.ilike('name', `%${searchQuery.trim()}%`)
      if (typeFilter !== 'all') q = q.eq('restriction_type', typeFilter)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as RestrictionRow[]
    },
  })

  const types          = [...new Set(rows.map(r => r.restriction_type).filter(Boolean))].sort()
  const withMeta       = rows.filter(r => r.meta_data && Object.keys(r.meta_data as object).length > 0).length
  const recentCount    = rows.filter(r => {
    if (!r.updated_at) return false
    const d = new Date(r.updated_at)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return d >= thirtyDaysAgo
  }).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldOff className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Restriction Log</h1>
              <p className="text-sm text-muted-foreground">Geo-restriction boundaries by type with metadata audit detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Restrictions', value: rows.length,    colour: 'text-gray-700' },
            { label: 'Types',              value: types.length,   colour: 'text-rose-700' },
            { label: 'With Metadata',      value: withMeta,       colour: 'text-amber-700' },
            { label: 'Updated Last 30d',   value: recentCount,    colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search restriction name…" className="w-64" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Restriction type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Geometry</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-medium text-sm">{row.name}</TableCell>
                      <TableCell><Badge className="bg-rose-100 text-rose-800">{row.restriction_type}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground italic">Spatial (view on map)</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={6} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Restriction ID:</span> {row.id}</div>
                          <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                          {row.meta_data != null && Object.keys(row.meta_data as object).length > 0 && (
                            <div>
                              <span className="font-medium">Metadata:</span>
                              <pre className="mt-1 whitespace-pre-wrap break-all bg-muted rounded p-2">{JSON.stringify(row.meta_data, null, 2)}</pre>
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
