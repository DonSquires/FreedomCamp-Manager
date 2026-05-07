/**
 * ComplianceResultLog — B-120
 *
 * Detailed per-observation compliance evaluation results.
 * Shows GPS-verified consecutive night counts, matrix snapshots,
 * violation types, and exemption reasons.
 *
 * Features:
 *  - KPIs: Total / Non-Compliant / GPS-Verified / Exempt
 *  - Filters: is_compliant / is_exempt / violation_type / date-from
 *  - Expandable row: violation_reasons + GPS evidence + matrix snapshot
 *
 * Route: /compliance-results-log — admin / admin_officer / master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ClipboardCheck, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

type ComplianceResultRow = Database['public']['Tables']['compliance_results']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ComplianceResultLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [compliantFilter, setCompliantFilter] = useState('all')
  const [exemptFilter, setExemptFilter] = useState('all')
  const [violationTypeQuery, setViolationTypeQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ComplianceResultRow[]>({
    queryKey: ['compliance-results-log', orgId, compliantFilter, exemptFilter, violationTypeQuery, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('compliance_results')
        .select('*')
        .eq('organization_id', orgId!)
        .order('evaluated_at', { ascending: false })
        .limit(500)

      if (compliantFilter === 'yes') q = q.eq('is_compliant', true)
      if (compliantFilter === 'no') q = q.eq('is_compliant', false)
      if (exemptFilter === 'yes') q = q.eq('is_exempt', true)
      if (exemptFilter === 'no') q = q.eq('is_exempt', false)
      if (violationTypeQuery.trim()) q = q.ilike('violation_type', `%${violationTypeQuery.trim()}%`)
      if (dateFrom) q = q.gte('evaluated_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const nonCompliantCount = rows.filter(r => !r.is_compliant).length
  const gpsVerifiedCount = rows.filter(r => r.stay_confirmed_by_gps).length
  const exemptCount = rows.filter(r => r.is_exempt).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-6 w-6 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold">Compliance Result Log</h1>
              <p className="text-sm text-muted-foreground">Per-observation compliance evaluations with GPS evidence and matrix snapshots</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Results', value: rows.length, colour: 'text-gray-700' },
            { label: 'Non-Compliant', value: nonCompliantCount, colour: 'text-red-700' },
            { label: 'GPS-Verified', value: gpsVerifiedCount, colour: 'text-blue-700' },
            { label: 'Exempt', value: exemptCount, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={compliantFilter} onValueChange={setCompliantFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Compliant?" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="yes">Compliant only</SelectItem>
              <SelectItem value="no">Non-compliant only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={exemptFilter} onValueChange={setExemptFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Exempt?" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Exempt only</SelectItem>
              <SelectItem value="no">Non-exempt only</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={violationTypeQuery}
            onChange={e => setViolationTypeQuery(e.target.value)}
            placeholder="Filter violation type…"
            className="w-48"
          />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Evaluated At</TableHead>
                  <TableHead>Compliant</TableHead>
                  <TableHead>Violation Type</TableHead>
                  <TableHead>GPS Nights</TableHead>
                  <TableHead>After Hours</TableHead>
                  <TableHead>Exempt</TableHead>
                  <TableHead>FC Act Exempt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 ${row.is_compliant === false ? 'bg-red-50/30' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.evaluated_at)}</TableCell>
                        <TableCell>
                          {row.is_compliant
                            ? <Badge className="bg-green-100 text-green-800">Yes</Badge>
                            : <Badge className="bg-red-100 text-red-800">No</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.violation_type ?? '—'}</TableCell>
                        <TableCell className="text-sm font-mono">{row.gps_verified_consecutive_nights ?? '—'}</TableCell>
                        <TableCell>{row.after_hours_violation ? <Badge className="bg-orange-100 text-orange-800">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell>{row.is_exempt ? <Badge className="bg-violet-100 text-violet-800">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell>{row.fc_act_exempt ? <Badge className="bg-blue-100 text-blue-800">Yes</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Result ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Observation:</span> <span className="font-mono text-xs">{row.observation_id ?? '—'}</span></div>
                                <div><span className="font-medium">Vehicle:</span> <span className="font-mono text-xs">{row.vehicle_id ?? '—'}</span></div>
                                <div><span className="font-medium">Zone:</span> <span className="font-mono text-xs">{row.zone_id ?? '—'}</span></div>
                                <div><span className="font-medium">Matrix ID:</span> <span className="font-mono text-xs">{row.matrix_id ?? '—'}</span></div>
                                <div><span className="font-medium">Matrix Version:</span> <span className="text-muted-foreground">{row.matrix_version ?? '—'}</span></div>
                                <div><span className="font-medium">GPS Distance:</span> <span className="text-muted-foreground">{row.gps_distance_meters != null ? `${row.gps_distance_meters}m` : '—'}</span></div>
                                <div><span className="font-medium">GPS Stay Confirmed:</span> <span className="text-muted-foreground">{row.stay_confirmed_by_gps ? 'Yes' : 'No'}</span></div>
                              </div>
                              {row.violation_reasons && (
                                <div>
                                  <p className="font-medium mb-1">Violation Reasons:</p>
                                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-32">{JSON.stringify(row.violation_reasons, null, 2)}</pre>
                                </div>
                              )}
                              {row.exemption_reason && (
                                <div><span className="font-medium">Exemption Reason:</span> <span className="text-muted-foreground">{row.exemption_reason}</span></div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
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
