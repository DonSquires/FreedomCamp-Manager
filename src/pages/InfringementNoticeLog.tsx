/**
 * InfringementNoticeLog — B-155
 *
 * Admin log and viewer for the infringement_notices table.
 * Displays issued infringement notices with notice number, type, status,
 * plate, recipient, amount, issued/due dates. Supports status/type/plate/date
 * filters and an expandable detail row for legal basis, service method,
 * evidence, and payment/court-referral metadata.
 *
 * Route: /infringement-notices-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { FileWarning, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type InfringementNoticeRow = Database['public']['Tables']['infringement_notices']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtMoney(cents: number | null) {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

const STATUS_COLOURS: Record<string, string> = {
  issued:       'bg-sky-100 text-sky-800',
  paid:         'bg-green-100 text-green-800',
  overdue:      'bg-red-100 text-red-800',
  withdrawn:    'bg-gray-100 text-gray-700',
  court:        'bg-amber-100 text-amber-800',
}
function statusBadge(v: string) {
  return STATUS_COLOURS[v?.toLowerCase()] ?? 'bg-gray-100 text-gray-700'
}

export default function InfringementNoticeLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [searchQuery,  setSearchQuery]  = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<InfringementNoticeRow[]>({
    queryKey: ['infringement-notices-log', orgId, statusFilter, typeFilter, searchQuery, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('infringement_notices')
        .select('*')
        .eq('organization_id', orgId!)
        .order('issued_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')   q = q.eq('notice_type', typeFilter)
      if (dateFrom)               q = q.gte('issued_at', dateFrom)
      if (searchQuery.trim())     q = q.or(`plate_number.ilike.%${searchQuery.trim()}%,notice_number.ilike.%${searchQuery.trim()}%,recipient_name.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const paidCount     = rows.filter(r => r.status?.toLowerCase() === 'paid').length
  const overdueCount  = rows.filter(r => r.status?.toLowerCase() === 'overdue').length
  const totalRevCents = rows.filter(r => r.status?.toLowerCase() === 'paid').reduce((sum, r) => sum + (r.amount_cents ?? 0), 0)
  const types         = [...new Set(rows.map(r => r.notice_type).filter(Boolean))].sort()
  const statuses      = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileWarning className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Infringement Notice Log</h1>
              <p className="text-sm text-muted-foreground">Issued infringement notices with status, amount, recipient, and evidence metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Notices', value: rows.length,                  colour: 'text-gray-700' },
            { label: 'Paid',          value: paidCount,                    colour: 'text-emerald-700' },
            { label: 'Overdue',       value: overdueCount,                 colour: 'text-red-700' },
            { label: 'Revenue (paid)',value: fmtMoney(totalRevCents),      colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate, notice #, recipient…" className="w-60" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Notice type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Notice #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs font-semibold">{row.notice_number}</TableCell>
                      <TableCell className="text-sm">{row.notice_type ?? '—'}</TableCell>
                      <TableCell><Badge className={statusBadge(row.status)}>{row.status}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-[10rem] truncate">{row.recipient_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtMoney(row.amount_cents)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.issued_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.due_date)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={9} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Notice ID:</span> {row.id}</div>
                          {row.offence_description && <div><span className="font-medium">Offence:</span> {row.offence_description}</div>}
                          {row.offence_location    && <div><span className="font-medium">Location:</span> {row.offence_location}</div>}
                          {row.offence_date        && <div><span className="font-medium">Offence date:</span> {fmtDate(row.offence_date)}</div>}
                          {row.legal_basis         && <div><span className="font-medium">Legal basis:</span> {row.legal_basis}</div>}
                          {row.service_method      && <div><span className="font-medium">Service method:</span> {row.service_method}</div>}
                          {row.served_at           && <div><span className="font-medium">Served at:</span> {fmtDate(row.served_at)}</div>}
                          {row.issued_by           && <div><span className="font-medium">Issued by:</span> {row.issued_by}</div>}
                          {row.recipient_address   && <div><span className="font-medium">Recipient address:</span> {row.recipient_address}</div>}
                          {row.recipient_email     && <div><span className="font-medium">Recipient email:</span> {row.recipient_email}</div>}
                          {row.payment_reference   && <div><span className="font-medium">Payment ref:</span> {row.payment_reference}</div>}
                          {row.payment_deadline    && <div><span className="font-medium">Payment deadline:</span> {fmtDate(row.payment_deadline)}</div>}
                          {row.reminder_sent_at    && <div><span className="font-medium">Reminder sent:</span> {fmtDate(row.reminder_sent_at)}</div>}
                          {row.court_referral_date && <div><span className="font-medium">Court referral:</span> {fmtDate(row.court_referral_date)}</div>}
                          {row.withdrawn_reason    && <div><span className="font-medium">Withdrawn reason:</span> {row.withdrawn_reason}</div>}
                          {row.breach_alert_id     && <div><span className="font-medium">Breach alert:</span> {row.breach_alert_id}</div>}
                          {row.notice_pdf_url && (
                            <div>
                              <span className="font-medium">PDF:</span>{' '}
                              <a href={row.notice_pdf_url} target="_blank" rel="noreferrer" className="text-sky-600 underline break-all">{row.notice_pdf_url}</a>
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
