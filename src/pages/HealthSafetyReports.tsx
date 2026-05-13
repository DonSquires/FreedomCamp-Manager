/**
 * HealthSafetyReports — B-64
 *
 * Admin UI for viewing and managing health & safety incident reports.
 *
 * Features:
 *  - KPI cards: Total, Open, In Progress, Closed
 *  - Filters: status, severity, incident type, search
 *  - Table: incident_type, severity, status, reported_by, zone, created_at
 *  - Status workflow: open → in_progress → closed
 *
 * Route: /health-safety-reports — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ShieldAlert, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, Clock, XCircle, FileWarning,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

// ─── Types ────────────────────────────────────────────────────────────────────

type HSReport = Database['public']['Tables']['health_safety_reports']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low:      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

const STATUS_COLOURS: Record<string, string> = {
  open:        'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  closed:      'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-400',
}

const STATUS_NEXT: Record<string, string> = {
  open:        'in_progress',
  in_progress: 'closed',
}

const STATUS_LABEL: Record<string, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  closed:      'Closed',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function HealthSafetyReports() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]             = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterType, setFilterType]     = useState('all')

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: reports = [], isLoading, error, refetch } = useQuery<HSReport[]>({
    queryKey: ['health-safety-reports', orgId],
    queryFn: async () => {
      let q = supabase
        .from('health_safety_reports')
        .select('*')
        .order('created_at', { ascending: false })
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived / filtered ────────────────────────────────────────────────────

  const filtered = reports.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterSeverity !== 'all' && r.severity !== filterSeverity) return false
    if (filterType !== 'all' && r.incident_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        r.description?.toLowerCase().includes(s) ||
        r.incident_type?.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total       = reports.length
  const openCount   = reports.filter(r => r.status === 'open').length
  const inProgCount = reports.filter(r => r.status === 'in_progress').length
  const closedCount = reports.filter(r => r.status === 'closed').length

  const incidentTypes = Array.from(new Set(reports.map(r => r.incident_type).filter(Boolean)))

  // ── Status update mutation ────────────────────────────────────────────────

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('health_safety_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['health-safety-reports'] })
      toast.success('Status updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-7 w-7 text-orange-500" />
            <div>
              <h1 className="text-2xl font-bold">Health & Safety Reports</h1>
              <p className="text-sm text-muted-foreground">Incident reporting and status management</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',       value: total,       icon: FileWarning,   colour: 'text-slate-600' },
            { label: 'Open',        value: openCount,   icon: AlertCircle,   colour: 'text-blue-600' },
            { label: 'In Progress', value: inProgCount, icon: Clock,         colour: 'text-amber-600' },
            { label: 'Closed',      value: closedCount, icon: CheckCircle2,  colour: 'text-green-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
                <span className="text-2xl font-bold">{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search reports…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          {incidentTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Incident Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {incidentTypes.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No reports match your filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incident Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const nextStatus = STATUS_NEXT[r.status ?? '']
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium capitalize">
                          {r.incident_type?.replace(/_/g, ' ') ?? '—'}
                        </TableCell>
                        <TableCell>
                          {r.severity ? (
                            <Badge className={`capitalize ${SEVERITY_COLOURS[r.severity] ?? ''}`}>
                              {r.severity}
                            </Badge>
                          ) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className={`capitalize ${STATUS_COLOURS[r.status ?? ''] ?? ''}`}>
                            {STATUS_LABEL[r.status ?? ''] ?? r.status ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">
                          {r.description ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {fmtDate(r.created_at)}
                        </TableCell>
                        <TableCell>
                          {nextStatus && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updateStatus.isPending}
                              onClick={() => updateStatus.mutate({ id: r.id, status: nextStatus })}
                            >
                              {nextStatus === 'in_progress' ? (
                                <><Clock className="h-3.5 w-3.5 mr-1" />Start</>
                              ) : (
                                <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Close</>
                              )}
                            </Button>
                          )}
                          {r.status === 'closed' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <XCircle className="h-3.5 w-3.5" /> Closed
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
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
