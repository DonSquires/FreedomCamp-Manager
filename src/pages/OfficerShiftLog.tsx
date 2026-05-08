/**
 * OfficerShiftLog — B-139
 *
 * Admin log and viewer for officer_shifts.
 * Displays all officer shift records with start/end times, approval status,
 * service type, GPS tracking flags, and shift feedback.
 *
 * Route: /officer-shifts-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Clock, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ShiftRow = Database['public']['Tables']['officer_shifts']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const APPROVAL_COLOURS: Record<string, string> = {
  approved: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  rejected: 'bg-rose-100 text-rose-800',
}

export default function OfficerShiftLog() {
  const [officerQuery, setOfficerQuery] = useState('')
  const [approvalFilter, setApprovalFilter] = useState('all')
  const [serviceFilter, setServiceFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ShiftRow[]>({
    queryKey: ['officer-shifts-log', officerQuery, approvalFilter, serviceFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('officer_shifts')
        .select('*')
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (officerQuery.trim()) q = q.ilike('officer_id', `%${officerQuery.trim()}%`)
      if (approvalFilter !== 'all') q = q.eq('approval_status', approvalFilter)
      if (serviceFilter !== 'all') q = q.eq('service_type', serviceFilter)
      if (dateFrom) q = q.gte('started_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeShifts = rows.filter(r => !r.ended_at).length
  const pendingApprovals = rows.filter(r => r.approval_status === 'pending').length
  const gpsTracked = rows.filter(r => r.gps_start_lat !== null).length
  const serviceTypes = [...new Set(rows.map(r => r.service_type).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Shift Log</h1>
              <p className="text-sm text-muted-foreground">Officer shift records with approval status, service type, and GPS tracking</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Shifts', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active Shifts', value: activeShifts, colour: 'text-sky-700' },
            { label: 'Pending Approval', value: pendingApprovals, colour: 'text-amber-700' },
            { label: 'GPS Tracked', value: gpsTracked, colour: 'text-emerald-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={officerQuery} onChange={e => setOfficerQuery(e.target.value)} placeholder="Search officer ID…" className="w-52" />
          <Select value={approvalFilter} onValueChange={setApprovalFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Approval status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Service type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {serviceTypes.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
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
                  <TableHead>Started At</TableHead>
                  <TableHead>Ended At</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Service Type</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Rating</TableHead>
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
                      <TableCell className="text-sm">{fmtDate(row.started_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.ended_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.officer_id}</TableCell>
                      <TableCell className="text-sm">{row.service_type ?? '—'}</TableCell>
                      <TableCell>
                        <Badge className={APPROVAL_COLOURS[row.approval_status] ?? 'bg-gray-100 text-gray-800'}>
                          {row.approval_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.shift_rating != null ? `${row.shift_rating}/5` : '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div><span className="font-medium">Zone:</span> {row.parent_zone_id ?? '—'} &nbsp; <span className="font-medium">Roster shift:</span> {row.roster_shift_id ?? '—'}</div>
                          <div><span className="font-medium">GPS start:</span> {row.gps_start_lat != null ? `${row.gps_start_lat}, ${row.gps_start_lng}` : '—'} &nbsp; <span className="font-medium">GPS end:</span> {row.gps_end_lat != null ? `${row.gps_end_lat}, ${row.gps_end_lng}` : '—'}</div>
                          <div><span className="font-medium">Approved by:</span> {row.approved_by ?? '—'} &nbsp; <span className="font-medium">Approved at:</span> {fmtDate(row.approved_at)}</div>
                          {row.end_reason && <div><span className="font-medium">End reason:</span> {row.end_reason}</div>}
                          {row.shift_feedback && <div><span className="font-medium">Feedback:</span> {row.shift_feedback}</div>}
                          {row.admin_notes && <div><span className="font-medium">Admin notes:</span> {row.admin_notes}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
