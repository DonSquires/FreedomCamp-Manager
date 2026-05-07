import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
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
import type { Database } from '@/types/database'

type ComplianceResult = Database['public']['Tables']['compliance_results']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ComplianceResultLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [compliantFilter, setCompliantFilter] = useState('all')
  const [exemptFilter, setExemptFilter] = useState('all')
  const [violationTypeFilter, setViolationTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ComplianceResult[]>({
    queryKey: ['compliance-results-log', orgId, compliantFilter, exemptFilter, violationTypeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('compliance_results')
        .select('*')
        .eq('organization_id', orgId!)
        .order('evaluated_at', { ascending: false })
        .limit(600)

      if (compliantFilter === 'yes') q = q.eq('is_compliant', true)
      if (compliantFilter === 'no') q = q.eq('is_compliant', false)
      if (exemptFilter === 'yes') q = q.eq('is_exempt', true)
      if (exemptFilter === 'no') q = q.eq('is_exempt', false)
      if (violationTypeFilter !== 'all') q = q.eq('violation_type', violationTypeFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const violationTypes = useMemo(() => [...new Set(rows.map((r) => r.violation_type).filter(Boolean))].sort(), [rows])
  const compliantCount = rows.filter((r) => r.is_compliant).length
  const exemptCount = rows.filter((r) => r.is_exempt).length
  const afterHoursCount = rows.filter((r) => r.after_hours_violation).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Compliance Result Log</h1>
              <p className="text-sm text-muted-foreground">Rule evaluation outcomes and violation reasoning</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Results', value: rows.length, color: 'text-slate-700' },
            { label: 'Compliant', value: compliantCount, color: 'text-green-700' },
            { label: 'Exempt', value: exemptCount, color: 'text-indigo-700' },
            { label: 'After-hours Violations', value: afterHoursCount, color: 'text-red-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={compliantFilter} onValueChange={setCompliantFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Compliant" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Compliant only</SelectItem>
              <SelectItem value="no">Non-compliant only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={exemptFilter} onValueChange={setExemptFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Exempt" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Exempt only</SelectItem>
              <SelectItem value="no">Non-exempt</SelectItem>
            </SelectContent>
          </Select>
          <Select value={violationTypeFilter} onValueChange={setViolationTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Violation type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {violationTypes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No compliance results found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Evaluated</TableHead>
                  <TableHead>Compliant</TableHead>
                  <TableHead>Exempt</TableHead>
                  <TableHead>Violation Type</TableHead>
                  <TableHead>Vehicle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.evaluated_at)}</TableCell>
                        <TableCell>{row.is_compliant ? <Badge className="bg-green-100 text-green-800 text-xs">Yes</Badge> : <Badge className="bg-red-100 text-red-800 text-xs">No</Badge>}</TableCell>
                        <TableCell>{row.is_exempt ? <Badge className="bg-indigo-100 text-indigo-800 text-xs">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell className="text-sm">{row.violation_type ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.vehicle_id?.slice(0, 8) ?? '—'}…</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Org: {row.organization_id ?? '—'}</span>
                              <span>Zone: {row.zone_id ?? '—'}</span>
                              <span>GPS distance: {row.gps_distance_meters ?? '—'} m</span>
                              <span>Consecutive nights: {row.gps_verified_consecutive_nights ?? '—'}</span>
                              <span>Updated: {fmtDate(row.updated_at)}</span>
                            </div>
                            {row.violation_reasons && row.violation_reasons.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Violation Reasons</p>
                                <p className="text-sm text-muted-foreground">{row.violation_reasons.join(', ')}</p>
                              </div>
                            )}
                            {row.exemption_reason && (
                              <div>
                                <p className="font-medium text-sm mb-1">Exemption Reason</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.exemption_reason}</p>
                              </div>
                            )}
                            {row.matrix_snapshot && (
                              <div>
                                <p className="font-medium text-sm mb-1">Matrix Snapshot</p>
                                <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40">{JSON.stringify(row.matrix_snapshot, null, 2)}</pre>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
