/**
 * PhotoRecoveryAuditLog — B-128
 *
 * Admin log for photo_recovery_audit_log recovery actions and outcomes.
 *
 * Features:
 *  - KPIs: Total / Success / Failed / Unique Plates
 *  - Filters: success / action search / plate search / date-from
 *  - Expandable row: error_message + source_ref + meta JSON
 *
 * Route: /photo-recovery-audit-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Images, RefreshCw, AlertCircle, Loader2,
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

type RecoveryRow = Database['public']['Tables']['photo_recovery_audit_log']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function PhotoRecoveryAuditLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [successFilter, setSuccessFilter] = useState('all')
  const [actionQuery, setActionQuery] = useState('')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<RecoveryRow[]>({
    queryKey: ['photo-recovery-audit-log', orgId, successFilter, actionQuery, plateQuery, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('photo_recovery_audit_log')
        .select('*')
        .eq('organization_id', orgId!)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (successFilter === 'yes') q = q.eq('success', true)
      if (successFilter === 'no') q = q.eq('success', false)
      if (actionQuery.trim()) q = q.ilike('action', `%${actionQuery.trim()}%`)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('recorded_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const successCount = rows.filter(r => r.success).length
  const failedCount = rows.filter(r => !r.success).length
  const uniquePlates = new Set(rows.map(r => r.plate_number).filter(Boolean)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Images className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Photo Recovery Audit Log</h1>
              <p className="text-sm text-muted-foreground">Recovery action history for missing or repaired photo evidence</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Actions', value: rows.length, colour: 'text-gray-700' },
            { label: 'Succeeded', value: successCount, colour: 'text-green-700' },
            { label: 'Failed', value: failedCount, colour: 'text-red-700' },
            { label: 'Unique Plates', value: uniquePlates, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={actionQuery} onChange={e => setActionQuery(e.target.value)} placeholder="Search action…" className="w-44" />
          <Input value={plateQuery} onChange={e => setPlateQuery(e.target.value)} placeholder="Search plate…" className="w-44" />
          <Select value={successFilter} onValueChange={setSuccessFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Result" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="yes">Success only</SelectItem>
              <SelectItem value="no">Failed only</SelectItem>
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No audit rows found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Recorded At</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Observation</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.recorded_at)}</TableCell>
                        <TableCell className="font-medium text-sm">{row.action}</TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.observation_id ? `${row.observation_id.slice(0, 8)}…` : '—'}</TableCell>
                        <TableCell>
                          <Badge className={row.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {row.success ? 'success' : 'failed'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.source ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">Audit ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Actor:</span> <span className="font-mono text-xs">{row.actor_label ?? row.actor_id ?? '—'}</span></div>
                                <div><span className="font-medium">Photo Bytes:</span> <span>{row.photo_bytes ?? '—'}</span></div>
                                <div><span className="font-medium">Occurred At:</span> <span className="text-muted-foreground">{fmtDate(row.occurred_at)}</span></div>
                                <div><span className="font-medium">Photo URL:</span> <span className="font-mono text-xs">{row.photo_url ?? '—'}</span></div>
                                <div><span className="font-medium">Source Ref:</span> <span className="font-mono text-xs">{row.source_ref ?? '—'}</span></div>
                              </div>
                              {row.photo_hash && (
                                <div><span className="font-medium">Photo Hash:</span> <span className="font-mono text-xs text-muted-foreground break-all">{row.photo_hash}</span></div>
                              )}
                              {row.error_message && (
                                <div>
                                  <p className="font-medium mb-1">Error Message:</p>
                                  <p className="text-red-700 bg-red-50 rounded p-3">{row.error_message}</p>
                                </div>
                              )}
                              {row.meta && (
                                <div>
                                  <p className="font-medium mb-1">Metadata:</p>
                                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-32">{JSON.stringify(row.meta, null, 2)}</pre>
                                </div>
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
