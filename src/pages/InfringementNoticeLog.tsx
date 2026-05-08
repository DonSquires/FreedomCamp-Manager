import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Receipt, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type InfringementRow = Database['public']['Tables']['infringement_notices']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMoney(value: number | null) {
  if (value === null || value === undefined) return '—'
  return `$${(value / 100).toFixed(2)}`
}

export default function InfringementNoticeLog() {
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [plateQuery, setPlateQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<InfringementRow[]>({
    queryKey: ['infringement-notices-log', statusFilter, typeFilter, plateQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('infringement_notices')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all') q = q.eq('notice_type', typeFilter)
      if (plateQuery.trim()) q = q.ilike('plate_number', `%${plateQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const paidCount = rows.filter((r) => r.status === 'paid').length
  const withdrawnCount = rows.filter((r) => r.status === 'withdrawn').length
  const overdueCount = rows.filter((r) => r.status !== 'paid' && r.payment_deadline && new Date(r.payment_deadline) < new Date()).length
  const statuses = ['all', ...Array.from(new Set(rows.map((r) => r.status).filter(Boolean)))]
  const types = ['all', ...Array.from(new Set(rows.map((r) => r.notice_type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Infringement Notice Log</h1>
              <p className="text-sm text-muted-foreground">Notice lifecycle and payment state for FCA infringement notices</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Notices', value: rows.length, color: 'text-gray-700' },
            { label: 'Paid', value: paidCount, color: 'text-green-700' },
            { label: 'Withdrawn', value: withdrawnCount, color: 'text-slate-700' },
            { label: 'Overdue', value: overdueCount, color: 'text-red-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Notice type" /></SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={plateQuery}
            onChange={(e) => setPlateQuery(e.target.value)}
            placeholder="Search plate…"
            className="w-40"
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
            <p>No infringement notices found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Notice #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Amount</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.notice_number}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.notice_type ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtMoney(row.amount_cents ?? null)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Recipient:</span> {row.recipient_name ?? '—'}</div>
                            <div><span className="font-medium">Issued at:</span> {fmtDate(row.issued_at)}</div>
                            <div><span className="font-medium">Payment deadline:</span> {fmtDate(row.payment_deadline)}</div>
                            <div><span className="font-medium">Served at:</span> {fmtDate(row.served_at)}</div>
                            <div><span className="font-medium">Service method:</span> {row.service_method ?? '—'}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                          </div>
                          {row.offence_description && <div><span className="font-medium">Offence:</span> {row.offence_description}</div>}
                          {row.offence_location && <div><span className="font-medium">Location:</span> {row.offence_location}</div>}
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
