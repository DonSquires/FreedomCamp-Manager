/**
 * ComplianceAuditLog — B-91
 *
 * Log viewer for compliance_audit_log — officer compliance check history.
 *
 * Features:
 *  - KPI cards: Total / Compliant / Blocked / Unique Officers
 *  - Filters: check_type (dynamic), compliance_status (dynamic), date from
 *  - Table: user_id, check_type badge, compliance_status badge, can_enforce,
 *           can_work, timestamp, blocked_reason
 *  - Expandable row: full blocked_reason text
 *
 * Route: /compliance-audit-log — admin/admin_officer/master
 */

import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  BadgeCheck, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type AuditRow = Database['public']['Tables']['compliance_audit_log']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function statusBadge(status: string) {
  if (status === 'compliant')   return 'bg-green-100 text-green-800'
  if (status === 'blocked')     return 'bg-red-100 text-red-800'
  if (status === 'warning')     return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-700'
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val === null) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <Badge className={val ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ComplianceAuditLog() {
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom,     setDateFrom]     = useState('')
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<AuditRow[]>({
    queryKey: ['compliance-audit-log', typeFilter, statusFilter, dateFrom],
    queryFn: async () => {
      // compliance_audit_log has no organization_id column — query is global (admin-only route)
      let q = supabase
        .from('compliance_audit_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(500)

      if (typeFilter   !== 'all') q = q.eq('check_type', typeFilter)
      if (statusFilter !== 'all') q = q.eq('compliance_status', statusFilter)
      if (dateFrom)               q = q.gte('timestamp', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const checkTypes     = [...new Set(rows.map(r => r.check_type).filter(Boolean))].sort()
  const statusTypes    = [...new Set(rows.map(r => r.compliance_status).filter(Boolean))].sort()
  const uniqueOfficers = new Set(rows.map(r => r.user_id).filter(Boolean)).size
  const compliant      = rows.filter(r => r.compliance_status === 'compliant').length
  const blocked        = rows.filter(r => r.compliance_status === 'blocked').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BadgeCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Compliance Audit Log</h1>
              <p className="text-sm text-muted-foreground">Officer compliance check history and enforcement eligibility</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Checks',     value: rows.length,    colour: 'text-gray-700' },
            { label: 'Compliant',        value: compliant,      colour: 'text-green-700' },
            { label: 'Blocked',          value: blocked,        colour: 'text-red-700' },
            { label: 'Unique Officers',  value: uniqueOfficers, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Check type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All check types</SelectItem>
              {checkTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusTypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No compliance audit records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Officer</TableHead>
                  <TableHead>Check Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Can Enforce</TableHead>
                  <TableHead>Can Work</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.user_id ? `${row.user_id.slice(0, 8)}…` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-blue-100 text-blue-800">{row.check_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.compliance_status)}>
                            {row.compliance_status}
                          </Badge>
                        </TableCell>
                        <TableCell>{boolBadge(row.can_enforce)}</TableCell>
                        <TableCell>{boolBadge(row.can_work)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.timestamp)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <p className="font-medium text-sm mb-1">Blocked Reason</p>
                            <p className="text-sm text-muted-foreground">
                              {row.blocked_reason ?? 'No blocked reason recorded.'}
                            </p>
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
