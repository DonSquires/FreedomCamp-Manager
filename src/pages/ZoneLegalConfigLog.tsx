import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Scale, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ZoneLegalConfigRow = Database['public']['Tables']['zone_legal_config']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

export default function ZoneLegalConfigLog() {
  const { user } = useAuthStore()
  const [selfContainedFilter, setSelfContainedFilter] = useState('all')
  const [enforcementFilter, setEnforcementFilter] = useState('all')
  const [zoneQuery, setZoneQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneLegalConfigRow[]>({
    queryKey: ['zone-legal-config-log', selfContainedFilter, enforcementFilter, zoneQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('zone_legal_config')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (selfContainedFilter === 'required') q = q.eq('self_contained_required', true)
      if (selfContainedFilter === 'not_required') q = q.eq('self_contained_required', false)
      if (enforcementFilter !== 'all') q = q.eq('enforcement_type', enforcementFilter)
      if (zoneQuery.trim()) q = q.ilike('zone_id', `%${zoneQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const scRequired = rows.filter((r) => r.self_contained_required).length
  const withFine = rows.filter((r) => Number(r.fine_amount ?? 0) > 0).length
  const withVacateWindow = rows.filter((r) => Number(r.vacate_hours ?? 0) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Legal Config Log</h1>
              <p className="text-sm text-muted-foreground">Legal enforcement and compliance settings from zone_legal_config</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Configs', value: rows.length, color: 'text-gray-700' },
            { label: 'SC Required', value: scRequired, color: 'text-sky-700' },
            { label: 'With Fine', value: withFine, color: 'text-amber-700' },
            { label: 'Vacate Hours Set', value: withVacateWindow, color: 'text-rose-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={selfContainedFilter} onValueChange={setSelfContainedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="SC requirement" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="required">Required</SelectItem>
              <SelectItem value="not_required">Not Required</SelectItem>
            </SelectContent>
          </Select>
          <Select value={enforcementFilter} onValueChange={setEnforcementFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Enforcement" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="infringement">Infringement</SelectItem>
              <SelectItem value="trespass">Trespass</SelectItem>
            </SelectContent>
          </Select>
          <Input value={zoneQuery} onChange={(e) => setZoneQuery(e.target.value)} placeholder="Zone ID…" className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No zone legal config records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Zone ID</TableHead>
                  <TableHead>Enforcement</TableHead>
                  <TableHead>Fine (NZD)</TableHead>
                  <TableHead>Vacate (hrs)</TableHead>
                  <TableHead>SC Required</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs font-mono">{row.zone_id ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.enforcement_type ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.fine_amount ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.vacate_hours ?? '—'}</TableCell>
                      <TableCell>{row.self_contained_required ? <Badge className="bg-green-100 text-green-800 text-xs">Required</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Config ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Authority:</span> {row.enforcement_authority ?? '—'}</div>
                            <div><span className="font-medium">Max Stay:</span> {row.max_stay_nights ?? '—'}</div>
                            <div><span className="font-medium">Consecutive Nights:</span> {row.max_consecutive_nights ?? '—'}</div>
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.legal_description && <div><span className="font-medium">Legal Description:</span> {row.legal_description}</div>}
                          {row.breach_template && <div><span className="font-medium">Breach Template:</span> {row.breach_template}</div>}
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
