import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Scale, RefreshCw, AlertCircle, Loader2,
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

type DisputeRow = Database['public']['Tables']['dispute_intake']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusTone(s: string | null) {
  switch (s) {
    case 'approved': return 'bg-green-100 text-green-800'
    case 'rejected': return 'bg-red-100 text-red-800'
    case 'under_review': return 'bg-blue-100 text-blue-800'
    case 'pending': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function DisputeIntakeLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [claimantQuery, setClaimantQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<DisputeRow[]>({
    queryKey: ['dispute-intake-log', orgId, statusFilter, plateQuery, claimantQuery],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispute_intake')
        .select('*')
        .eq('organization_id', orgId!)
        .order('submitted_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (claimantQuery.trim()) q = q.ilike('claimant_name', `%${claimantQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const homelessReviewCount = rows.filter(r => r.request_homeless_review).length
  const pendingCount = rows.filter(r => r.status === 'pending').length
  const withHardshipCount = rows.filter(r => !!r.hardship_context).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Dispute Intake Log</h1>
              <p className="text-sm text-muted-foreground">Infringement and enforcement disputes submitted by the public</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Disputes', value: rows.length, colour: 'text-gray-700' },
            { label: 'Pending', value: pendingCount, colour: 'text-yellow-700' },
            { label: 'Homeless Review Requested', value: homelessReviewCount, colour: 'text-violet-700' },
            { label: 'Hardship Context', value: withHardshipCount, colour: 'text-orange-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={plateQuery}
            onChange={e => setPlateQuery(e.target.value)}
            placeholder="Filter by plate…"
            className="w-40"
          />
          <Input
            value={claimantQuery}
            onChange={e => setClaimantQuery(e.target.value)}
            placeholder="Filter by claimant…"
            className="w-48"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No disputes found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Claimant</TableHead>
                  <TableHead>Homeless Review</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.submitted_at)}</TableCell>
                        <TableCell><Badge className={statusTone(row.status)}>{row.status ?? '—'}</Badge></TableCell>
                        <TableCell className="font-mono text-sm">{row.plate_number ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.claimant_name ?? '—'}</TableCell>
                        <TableCell>
                          {row.request_homeless_review
                            ? <Badge className="bg-violet-100 text-violet-800">Requested</Badge>
                            : <span className="text-muted-foreground text-xs">No</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.submitted_via ?? '—'}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-4 text-sm">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div><span className="font-medium">ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                                <div><span className="font-medium">Assigned To:</span> <span className="font-mono text-xs">{row.assigned_to ?? '—'}</span></div>
                                <div><span className="font-medium">Email:</span> <span className="text-muted-foreground">{row.claimant_email ?? '—'}</span></div>
                                <div><span className="font-medium">Phone:</span> <span className="text-muted-foreground">{row.claimant_phone ?? '—'}</span></div>
                                <div><span className="font-medium">Source Ref:</span> <span className="font-mono text-xs">{row.source_reference ?? '—'}</span></div>
                                <div><span className="font-medium">Source Type:</span> <span className="text-muted-foreground">{row.source_type ?? '—'}</span></div>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Message:</p>
                                <p className="text-muted-foreground bg-muted rounded p-3 whitespace-pre-wrap">{row.message ?? '—'}</p>
                              </div>
                              {row.evidence_statement && (
                                <div>
                                  <p className="font-medium mb-1">Evidence Statement:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3 whitespace-pre-wrap">{row.evidence_statement}</p>
                                </div>
                              )}
                              {row.hardship_context && (
                                <div>
                                  <p className="font-medium mb-1">Hardship Context:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3 whitespace-pre-wrap">{row.hardship_context}</p>
                                </div>
                              )}
                              {row.admin_notes && (
                                <div>
                                  <p className="font-medium mb-1">Admin Notes:</p>
                                  <p className="text-muted-foreground bg-muted rounded p-3 whitespace-pre-wrap">{row.admin_notes}</p>
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
