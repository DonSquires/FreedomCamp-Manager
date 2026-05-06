/**
 * HealthSafetyReports — B-64
 *
 * Admin review page for health & safety incident reports submitted by field
 * officers via the Field Officer Portal, Field Safety Bar, and Scan Detail Panel.
 *
 * Features:
 *  - KPI cards: Total, Critical, Open, Resolved
 *  - Filters: incident_type, severity, zone, date range, text search
 *  - Table: date, reported_by (user_profile), zone, incident_type, severity, status
 *  - Expandable row: full description + inline status update
 *  - Status workflow: open → under_review → resolved | closed
 *
 * Route: /health-safety-reports — admin / admin_officer / master
 * health_safety_reports is fully typed in database.ts
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronDown, ChevronUp, ClipboardCheck,
  Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

// ─── Types ─────────────────────────────────────────────────────────────────────

type HSReport = Database['public']['Tables']['health_safety_reports']['Row']

type HSReportWithProfile = HSReport & {
  zones: { name: string } | null
  user_profiles: { full_name: string | null } | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown']
const STATUSES: HSReport['status'][] = ['open', 'under_review', 'resolved', 'closed']

function severityColour(s: string | null) {
  switch (s) {
    case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
    case 'high':     return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    case 'medium':   return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
    case 'low':      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    default:         return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

function statusColour(s: string | null) {
  switch (s) {
    case 'resolved': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'closed':   return 'bg-gray-100 text-gray-700 dark:bg-gray-800'
    case 'under_review': return 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
    default:         return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function HealthSafetyReports() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [typeFilter, setTypeFilter]         = useState('all')
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [search, setSearch]                 = useState('')
  const [expandedId, setExpandedId]         = useState<string | null>(null)

  // ── Query ───────────────────────────────────────────────────────────────────

  const { data: reports = [], isLoading, error, refetch } = useQuery<HSReportWithProfile[]>({
    queryKey: ['health_safety_reports', orgId, severityFilter, statusFilter, typeFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('health_safety_reports')
        .select('*, zones(name), user_profiles!health_safety_reports_reported_by_fkey(full_name)')
        .eq('organization_id', orgId as string)
        .order('created_at', { ascending: false })
        .limit(400)

      if (severityFilter !== 'all') q = q.eq('severity', severityFilter)
      if (statusFilter !== 'all')   q = q.eq('status', statusFilter)
      if (typeFilter !== 'all')     q = q.eq('incident_type', typeFilter)
      if (dateFrom)                 q = q.gte('created_at', dateFrom)
      if (dateTo)                   q = q.lte('created_at', dateTo + 'T23:59:59')

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as HSReportWithProfile[]
    },
  })

  // ── Mutation: update status ─────────────────────────────────────────────────

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('health_safety_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Status updated')
      qc.invalidateQueries({ queryKey: ['health_safety_reports'] })
    },
    onError: () => toast.error('Failed to update status'),
  })

  // ── Derived filters ─────────────────────────────────────────────────────────

  const filtered = reports.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (r.description ?? '').toLowerCase().includes(q) ||
      (r.incident_type ?? '').toLowerCase().includes(q) ||
      (r.zones?.name ?? '').toLowerCase().includes(q) ||
      (r.user_profiles?.full_name ?? '').toLowerCase().includes(q)
    )
  })

  // ── KPIs ────────────────────────────────────────────────────────────────────

  const kpiTotal    = reports.length
  const kpiCritical = reports.filter(r => r.severity === 'critical').length
  const kpiOpen     = reports.filter(r => r.status === 'open' || r.status === 'under_review').length
  const kpiResolved = reports.filter(r => r.status === 'resolved' || r.status === 'closed').length

  // ── Unique incident types for filter ───────────────────────────────────────

  const incidentTypes = Array.from(new Set(reports.map(r => r.incident_type).filter(Boolean))) as string[]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Health & Safety Reports"
      description="Review and action health & safety incident reports submitted by field officers"
    >
      <div className="space-y-4">

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Reports',  value: kpiTotal,    icon: ClipboardCheck, colour: 'text-slate-600' },
            { label: 'Critical',       value: kpiCritical, icon: ShieldAlert,    colour: 'text-red-600' },
            { label: 'Open / Review',  value: kpiOpen,     icon: AlertTriangle,  colour: 'text-amber-600' },
            { label: 'Resolved',       value: kpiResolved, icon: ClipboardCheck, colour: 'text-green-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label} className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${colour}`} />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${colour}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Type, zone, officer…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Severity</Label>
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    {SEVERITIES.map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {STATUSES.map(s => (
                      <SelectItem key={s as string} value={s as string} className="capitalize">{(s as string).replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Incident Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {incidentTypes.map(t => (
                      <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1 flex flex-col">
                <Label className="text-xs">To</Label>
                <div className="flex items-center gap-2">
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm flex-1" />
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                    onClick={() => refetch()} title="Refresh"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-12 gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" /> Failed to load reports
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                No reports match your filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Date</TableHead>
                    <TableHead>Officer</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Incident Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const isOpen = expandedId === r.id
                    return (
                      <>
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isOpen ? null : r.id)}
                        >
                          <TableCell>
                            {isOpen
                              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {r.created_at ? format(parseISO(r.created_at), 'dd MMM yyyy HH:mm') : '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.user_profiles?.full_name ?? 'Unknown'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.zones?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm capitalize">
                            {(r.incident_type ?? '—').replace(/_/g, ' ')}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs capitalize ${severityColour(r.severity)}`}>
                              {r.severity ?? 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs capitalize ${statusColour(r.status)}`}>
                              {(r.status ?? 'open').replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Select
                              value={r.status ?? 'open'}
                              onValueChange={val => updateStatus.mutate({ id: r.id, status: val })}
                            >
                              <SelectTrigger className="h-7 text-xs w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUSES.map(s => (
                                  <SelectItem key={s as string} value={s as string} className="capitalize text-xs">
                                    {(s as string).replace('_', ' ')}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>

                        {isOpen && (
                          <TableRow key={`${r.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={8} className="py-3 px-6">
                              <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                              <p className="text-sm">{r.description ?? 'No description provided.'}</p>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  )
}
