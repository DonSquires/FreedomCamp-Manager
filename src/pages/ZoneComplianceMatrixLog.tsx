/**
 * ZoneComplianceMatrixLog — B-141
 *
 * Admin viewer for zone_compliance_matrix.
 * Displays zone compliance rule configurations including max consecutive nights,
 * monthly limits, self-contained requirements, and allowed-days policies.
 *
 * Route: /zone-compliance-matrix-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ShieldCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type MatrixRow = Database['public']['Tables']['zone_compliance_matrix']['Row']

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

export default function ZoneComplianceMatrixLog() {
  const [zoneQuery, setZoneQuery] = useState('')
  const [dayVisitFilter, setDayVisitFilter] = useState('all')
  const [selfContainedFilter, setSelfContainedFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<MatrixRow[]>({
    queryKey: ['zone-compliance-matrix-log', zoneQuery, dayVisitFilter, selfContainedFilter],
    queryFn: async () => {
      let q = supabase
        .from('zone_compliance_matrix')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (zoneQuery.trim()) q = q.ilike('zone_id', `%${zoneQuery.trim()}%`)
      if (dayVisitFilter === 'yes') q = q.eq('day_visit_only', true)
      if (dayVisitFilter === 'no') q = q.eq('day_visit_only', false)
      if (selfContainedFilter === 'yes') q = q.eq('self_contained_required', true)
      if (selfContainedFilter === 'no') q = q.eq('self_contained_required', false)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const dayVisitOnly = rows.filter(r => r.day_visit_only).length
  const selfContainedRequired = rows.filter(r => r.self_contained_required).length
  const homelessExemption = rows.filter(r => r.homeless_exemption).length
  const requiresCsc = rows.filter(r => r.requires_csc).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Compliance Matrix</h1>
              <p className="text-sm text-muted-foreground">Zone compliance rule configurations including stay limits, self-contained requirements, and day-visit policies</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Rules', value: rows.length, colour: 'text-gray-700' },
            { label: 'Day-Visit Only', value: dayVisitOnly, colour: 'text-amber-700' },
            { label: 'Self-Contained Required', value: selfContainedRequired, colour: 'text-sky-700' },
            { label: 'Homeless Exemption', value: homelessExemption, colour: 'text-purple-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={zoneQuery} onChange={e => setZoneQuery(e.target.value)} placeholder="Search zone ID…" className="w-52" />
          <Select value={dayVisitFilter} onValueChange={setDayVisitFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Day-visit only" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              <SelectItem value="yes">Day-visit only</SelectItem>
              <SelectItem value="no">Overnight allowed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selfContainedFilter} onValueChange={setSelfContainedFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Self-contained required" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              <SelectItem value="yes">Self-contained required</SelectItem>
              <SelectItem value="no">Not required</SelectItem>
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
                  <TableHead>Zone</TableHead>
                  <TableHead>Max Nights</TableHead>
                  <TableHead>Nights/Month</TableHead>
                  <TableHead>Day-Visit Only</TableHead>
                  <TableHead>Self-Contained</TableHead>
                  <TableHead>Homeless Exempt</TableHead>
                  <TableHead>Requires CSC</TableHead>
                  <TableHead>Version</TableHead>
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
                      <TableCell className="text-sm text-right">{row.max_consecutive_nights ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.nights_per_month ?? '—'}</TableCell>
                      <TableCell>{boolBadge(row.day_visit_only, 'Yes', 'No')}</TableCell>
                      <TableCell>{boolBadge(row.self_contained_required, 'Required', 'Not required')}</TableCell>
                      <TableCell>{boolBadge(row.homeless_exemption, 'Exempt', 'No')}</TableCell>
                      <TableCell>{boolBadge(row.requires_csc, 'Required', 'No')}</TableCell>
                      <TableCell className="text-sm">{row.version ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={9} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id} &nbsp; <span className="font-medium">Org:</span> {row.organization_id ?? '—'}</div>
                          <div>
                            <span className="font-medium">Effective from:</span> {fmtDate(row.effective_from)} &nbsp;
                            <span className="font-medium">Effective to:</span> {fmtDate(row.effective_to)}
                          </div>
                          {row.allowed_days && row.allowed_days.length > 0 && (
                            <div><span className="font-medium">Allowed days:</span> {row.allowed_days.join(', ')}</div>
                          )}
                          {row.change_reason && <div><span className="font-medium">Change reason:</span> {row.change_reason}</div>}
                          {row.change_notes && <div><span className="font-medium">Notes:</span> {row.change_notes}</div>}
                          <div>
                            <span className="font-medium">Created:</span> {fmtDate(row.created_at)} &nbsp;
                            <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}
                          </div>
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
            {requiresCsc} zones require CSC &nbsp;·&nbsp; {rows.length} total compliance rules
          </p>
        )}
      </div>
    </AppLayout>
  )
}
