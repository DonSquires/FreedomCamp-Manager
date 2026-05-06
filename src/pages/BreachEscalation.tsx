/**
 * BreachEscalation — B-60
 *
 * Escalation-focused admin view of dispatch_jobs where escalation_level >= 1
 * or sla_breached = true.
 *
 * Features:
 *  - KPI cards: Level 1 / Level 2 / Level 3+ / SLA Breached
 *  - Expandable row: full job detail, address, assignee, notes
 *  - Filters: escalation level, job type, status, date range, job# search
 *  - Colour-coded escalation badges
 *  - Link to /dispatch for the full dispatch view
 *
 * Route: /breach-escalation  — admin / admin_officer / master
 * dispatch_jobs is fully typed in database.ts
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldAlert, Loader2, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, MapPin, Clock, ExternalLink, Zap,
} from 'lucide-react'

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

// ─── Types ────────────────────────────────────────────────────────────────────

type DispatchJob = Database['public']['Tables']['dispatch_jobs']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escalationColour(level: number) {
  if (level >= 3) return 'text-red-700 bg-red-100 dark:bg-red-900/30'
  if (level === 2) return 'text-orange-700 bg-orange-100 dark:bg-orange-900/30'
  return 'text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BreachEscalation() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [levelFilter, setLevelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [jobTypeFilter, setJobTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: jobs = [], isLoading, error, refetch } = useQuery<DispatchJob[]>({
    queryKey: ['breach_escalation', orgId, levelFilter, statusFilter, jobTypeFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('dispatch_jobs')
        .select('*')
        .eq('organization_id', orgId as string)
        .or('escalation_level.gte.1,sla_breached.eq.true')
        .order('escalation_level', { ascending: false })
        .order('created_at', { ascending: false })

      if (statusFilter  !== 'all') q = q.eq('status', statusFilter)
      if (jobTypeFilter !== 'all') q = q.eq('job_type', jobTypeFilter)
      if (dateFrom)                q = q.gte('created_at', dateFrom)
      if (dateTo)                  q = q.lte('created_at', dateTo + 'T23:59:59')
      if (levelFilter !== 'all') {
        const lvl = parseInt(levelFilter)
        if (lvl >= 3) q = q.gte('escalation_level', 3)
        else          q = q.eq('escalation_level', lvl)
      }

      const { data, error } = await q.limit(300)
      if (error) throw error
      return data as DispatchJob[]
    },
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = jobs.filter(j => {
    if (!search) return true
    const q = search.toLowerCase()
    return (j.job_number?.toLowerCase().includes(q) ?? false) || (j.title.toLowerCase().includes(q))
  })

  const kpi = {
    level1:      jobs.filter(j => j.escalation_level === 1).length,
    level2:      jobs.filter(j => j.escalation_level === 2).length,
    level3plus:  jobs.filter(j => j.escalation_level >= 3).length,
    slaBreached: jobs.filter(j => j.sla_breached).length,
  }

  const jobTypes = [...new Set(jobs.map(j => j.job_type))].sort()

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Breach Escalation</h1>
              <p className="text-sm text-muted-foreground">Dispatch jobs with active escalation or SLA breaches</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/dispatch"><ExternalLink className="h-4 w-4 mr-2" /> Full Dispatch</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-yellow-500" /> Level 1</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-yellow-600">{kpi.level1}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-orange-500" /> Level 2</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-orange-600">{kpi.level2}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-red-500" /> Level 3+</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-red-600">{kpi.level3plus}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-red-500" /> SLA Breached</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-red-700">{kpi.slaBreached}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-xs">Search</Label>
                <Input placeholder="Job # or title…" value={search} onChange={e => setSearch(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Escalation Level</Label>
                <Select value={levelFilter} onValueChange={setLevelFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All levels</SelectItem>
                    <SelectItem value="1">Level 1</SelectItem>
                    <SelectItem value="2">Level 2</SelectItem>
                    <SelectItem value="3">Level 3+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="dispatched">Dispatched</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="en_route">En Route</SelectItem>
                    <SelectItem value="on_scene">On Scene</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Job Type</Label>
                <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {jobTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center"><AlertCircle className="h-5 w-5" /> Failed to load jobs.</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No escalated jobs match your filters.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Job #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Escalation</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(job => {
                  const expanded = expandedId === job.id
                  return (
                    <>
                      <TableRow
                        key={job.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : job.id)}
                      >
                        <TableCell className="py-2">{expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        <TableCell className="font-mono text-xs">{job.job_number ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate" title={job.title}>{job.title}</TableCell>
                        <TableCell className="text-xs">{job.job_type}</TableCell>
                        <TableCell>
                          {job.escalation_level > 0 ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${escalationColour(job.escalation_level)}`}>
                              <Zap className="h-3 w-3" /> L{job.escalation_level}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {job.sla_breached ? (
                            <Badge variant="destructive" className="text-xs">SLA Breached</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">OK</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{job.status}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(parseISO(job.created_at), 'dd MMM yyyy')}
                        </TableCell>
                      </TableRow>

                      {expanded && (
                        <TableRow key={`${job.id}-detail`} className="bg-muted/30">
                          <TableCell colSpan={8} className="py-4 px-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">Address</p>
                                <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{job.address ?? '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">Priority / SLA</p>
                                <p>{job.priority} — {job.response_sla_minutes ? `${job.response_sla_minutes}min SLA` : 'No SLA'}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">Assigned To</p>
                                <p className="font-mono">{job.assigned_to ?? <span className="text-muted-foreground italic">Unassigned</span>}</p>
                              </div>
                              {job.description && (
                                <div className="md:col-span-3">
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Description</p>
                                  <p className="bg-background rounded border p-2 whitespace-pre-line">{job.description}</p>
                                </div>
                              )}
                              {job.escalated_at && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Escalated At</p>
                                  <p className="text-muted-foreground">{format(parseISO(job.escalated_at), 'dd MMM yyyy HH:mm')}</p>
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
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
