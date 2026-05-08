import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Map, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type RestrictionRow = Database['public']['Tables']['restrictions']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function hasMetadata(value: unknown) {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return true
  return Array.isArray(value) ? value.length > 0 : Object.keys(value as Record<string, unknown>).length > 0
}

export default function RestrictionLog() {
  const [typeFilter, setTypeFilter] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [orgQuery, setOrgQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RestrictionRow[]>({
    queryKey: ['restrictions-log', typeFilter, nameQuery, orgQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('restrictions')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all') q = q.eq('restriction_type', typeFilter)
      if (nameQuery.trim()) q = q.ilike('name', `%${nameQuery.trim()}%`)
      if (orgQuery.trim()) q = q.ilike('organization_id', `%${orgQuery.trim()}%`)
      if (dateFrom) q = q.gte('updated_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const uniqueTypes = new Set(rows.map((r) => r.restriction_type)).size
  const uniqueOrgs = new Set(rows.map((r) => r.organization_id)).size
  const withMetadata = rows.filter((r) => hasMetadata(r.meta_data)).length
  const types = ['all', ...Array.from(new Set(rows.map((r) => r.restriction_type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Map className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Restriction Log</h1>
              <p className="text-sm text-muted-foreground">Spatial restriction records by type, organisation, and metadata payload</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Restrictions', value: rows.length, colour: 'text-gray-700' },
            { label: 'Unique Types', value: uniqueTypes, colour: 'text-blue-700' },
            { label: 'Unique Orgs', value: uniqueOrgs, colour: 'text-indigo-700' },
            { label: 'With Metadata', value: withMetadata, colour: 'text-emerald-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Restriction type" /></SelectTrigger>
            <SelectContent>
              {types.map((type) => (
                <SelectItem key={type} value={type}>{type === 'all' ? 'All types' : type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search name…"
            className="w-44"
          />
          <Input
            value={orgQuery}
            onChange={(e) => setOrgQuery(e.target.value)}
            placeholder="Search organisation ID…"
            className="w-56"
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
            <p>No restrictions found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Updated</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Metadata</TableHead>
                  <TableHead>Geom</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.restriction_type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.organization_id.slice(0, 8)}…</TableCell>
                      <TableCell>
                        <Badge className={hasMetadata(row.meta_data) ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}>
                          {hasMetadata(row.meta_data) ? 'Present' : 'Empty'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.geom ? 'Yes' : 'No'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Restriction ID:</span> {row.id}</div>
                            <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                            <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                            <div><span className="font-medium">Organisation:</span> {row.organization_id}</div>
                            <div><span className="font-medium">Type:</span> {row.restriction_type}</div>
                          </div>
                          <div>
                            <span className="font-medium">Metadata:</span>
                            <pre className="mt-1 overflow-auto max-h-32 text-xs bg-muted rounded p-2">
                              {JSON.stringify(row.meta_data, null, 2)}
                            </pre>
                          </div>
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
