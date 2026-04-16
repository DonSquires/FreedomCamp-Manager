/**
 * DispatchedJobsList — WILSAR-style Master List of Despatched Jobs
 *
 * Searchable/filterable master list of all dispatched jobs:
 * Search by Dispatch No, Docket No, date range, Client ID, site, zone,
 * job type, alarm type, bureau ID, suburb, region.
 * Shows status, response time, assigned officer.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Search, RefreshCw, Clock, User, MapPin, AlertTriangle, CheckCircle,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_TYPE_LABELS: Record<string, string> = {
  alarm_response: 'Alarm Response', permanent_patrol: 'Permanent Patrol',
  casual_patrol: 'Casual Patrol', escort: 'Escort', key_collection: 'Key Collection',
  key_return: 'Key Return', let_in: 'Let In', let_out: 'Let Out', lockup: 'Lockup',
  open: 'Open', alarm_reset: 'Alarm Reset', first_line_one_guard: 'First Line One Guard',
  first_line_two_guard: 'First Line Two Guard', second_line_response: 'Second Line Response',
  cash_in_transit: 'Cash In Transit', patrol: 'Patrol', welfare_check: 'Welfare Check',
  noise_complaint: 'Noise Complaint', freedom_camping: 'Freedom Camping', parking: 'Parking',
  medical: 'Medical', fire: 'Fire', suspicious_activity: 'Suspicious Activity',
  lock_unlock: 'Lock/Unlock', property_check: 'Property Check', vandalism: 'Vandalism',
  general: 'General', other: 'Other',
}

const ALARM_TYPE_LABELS: Record<string, string> = {
  intruder_alarm: 'Intruder Alarm', duress_hold_up: 'Duress / Hold Up',
  animal_control: 'Animal Control', cardreader_fault: 'Cardreader Fault',
  late_to_close: 'Late to Close', lock_broken: 'Lock Broken', noise: 'Noise',
  parking: 'Parking', traffic: 'Traffic', vandalism: 'Vandalism',
  alarm_reset: 'Alarm Reset', other: 'Other',
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:      { label: 'Pending',      className: 'text-gray-600 border-gray-300' },
  dispatched:   { label: 'Dispatched',   className: 'text-blue-700 border-blue-300' },
  acknowledged: { label: 'Acknowledged', className: 'text-indigo-700 border-indigo-300' },
  en_route:     { label: 'En Route',     className: 'text-cyan-700 border-cyan-300' },
  on_scene:     { label: 'On Scene',     className: 'text-green-700 border-green-300' },
  completed:    { label: 'Completed',    className: 'text-emerald-700 border-emerald-300' },
  cancelled:    { label: 'Cancelled',    className: 'text-gray-400 border-gray-200' },
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DispatchedJob {
  id: string
  job_number: string
  job_type: string
  alarm_type: string | null
  priority: string
  status: string
  title: string
  address: string | null
  caller_name: string | null
  created_at: string
  dispatched_at: string | null
  on_scene_at: string | null
  completed_at: string | null
  response_sla_minutes: number
  sla_breached: boolean
  assigned_officer: { first_name: string; last_name: string } | null
  client_site: { name: string; client_code: string | null; city: string | null; bureau_id: string | null } | null
  zone: { name: string } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function responseTime(job: DispatchedJob): string {
  if (!job.dispatched_at) return '—'
  const end = job.on_scene_at ? new Date(job.on_scene_at) : new Date()
  const mins = Math.floor((end.getTime() - new Date(job.dispatched_at).getTime()) / 60_000)
  return `${mins}m`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispatchedJobsList() {
  const { user } = useAuthStore()
  const { organizationId: filterOrgId } = useGlobalFiltersStore()
  const orgId = filterOrgId || user?.organization_id

  // Search criteria
  const [tab, setTab] = useState<'search' | 'results'>('search')
  const [dispatchNo, setDispatchNo] = useState('')
  const [clientId, setClientId] = useState('')
  const [site, setSite] = useState('')
  const [jobType, setJobType] = useState('')
  const [alarmType, setAlarmType] = useState('')
  const [bureauId, setBureauId] = useState('')
  const [suburb, setSuburb] = useState('')
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState('')
  const [showMode, setShowMode] = useState<'active' | 'all_excl_cancelled' | 'all'>('all')

  const [searched, setSearched] = useState(false)

  const { data: jobs = [], isLoading, refetch } = useQuery<DispatchedJob[]>({
    queryKey: ['dispatched-jobs-list', orgId, dispatchNo, clientId, site, jobType, alarmType, bureauId, suburb, dateFrom, dateTo, showMode, searched],
    queryFn: async () => {
      if (!searched) return []

      let q = (supabase as any)
        .from('dispatch_jobs')
        .select(`
          id, job_number, job_type, alarm_type, priority, status, title, address,
          caller_name, created_at, dispatched_at, on_scene_at, completed_at,
          response_sla_minutes, sla_breached,
          assigned_officer:user_profiles!assigned_to(first_name, last_name),
          client_site:client_sites!client_site_id(name, client_code, city, bureau_id),
          zone:zones!zone_id(name)
        `)
        .order('created_at', { ascending: false })
        .limit(500)

      if (user?.role !== 'master') q = q.eq('organization_id', orgId ?? '')
      if (showMode === 'active') q = q.in('status', ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene'])
      if (showMode === 'all_excl_cancelled') q = q.neq('status', 'cancelled')
      if (dispatchNo) q = q.ilike('job_number', `%${dispatchNo}%`)
      if (jobType) q = q.eq('job_type', jobType)
      if (alarmType) q = q.eq('alarm_type', alarmType)
      if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`)
      if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error

      let result = (data ?? []) as DispatchedJob[]

      // Client-side filters that need joined data
      if (clientId) result = result.filter(j => (j.client_site?.client_code ?? '').toLowerCase().includes(clientId.toLowerCase()))
      if (site) result = result.filter(j => (j.client_site?.name ?? '').toLowerCase().includes(site.toLowerCase()))
      if (bureauId) result = result.filter(j => (j.client_site?.bureau_id ?? '').toLowerCase().includes(bureauId.toLowerCase()))
      if (suburb) result = result.filter(j => (j.client_site?.city ?? '').toLowerCase().includes(suburb.toLowerCase()))

      return result
    },
    enabled: !!orgId,
  })

  function handleSearch() {
    setSearched(true)
    setTab('results')
    refetch()
  }

  function handleClear() {
    setDispatchNo(''); setClientId(''); setSite(''); setJobType('')
    setAlarmType(''); setBureauId(''); setSuburb('')
    setDateFrom(new Date().toISOString().split('T')[0]); setDateTo('')
    setShowMode('all'); setSearched(false); setTab('search')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Master List of Despatched Jobs" description="Search all dispatch jobs by any criteria">
      <GlobalFilterRibbon />
      <div className="space-y-4">
        <Tabs value={tab} onValueChange={v => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="results">Results {searched && jobs.length > 0 && `(${jobs.length})`}</TabsTrigger>
          </TabsList>

          {/* ── Search tab ────────────────────────────────────────────────── */}
          <TabsContent value="search">
            <Card>
              <CardContent className="p-4 space-y-4">
                {/* Show mode */}
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium text-muted-foreground">Show Active Only:</span>
                  {[
                    { value: 'active', label: 'Yes' },
                    { value: 'all_excl_cancelled', label: 'All (excluding Cancelled)' },
                    { value: 'all', label: 'All (including Cancelled)' },
                  ].map(o => (
                    <label key={o.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="showMode" checked={showMode === o.value} onChange={() => setShowMode(o.value as any)} className="accent-blue-600" />
                      {o.label}
                    </label>
                  ))}
                </div>

                {/* Row 1 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Dispatch No.</Label>
                    <Input placeholder="J-20260415-…" value={dispatchNo} onChange={e => setDispatchNo(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Job Type</Label>
                    <Select value={jobType || '__all__'} onValueChange={v => setJobType(v === '__all__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All</SelectItem>
                        {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Alarm Type</Label>
                    <Select value={alarmType || '__all__'} onValueChange={v => setAlarmType(v === '__all__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All</SelectItem>
                        {Object.entries(ALARM_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bureau ID</Label>
                    <Input placeholder="NZ-STD" value={bureauId} onChange={e => setBureauId(e.target.value)} />
                  </div>
                </div>

                {/* Row 2 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Response Date (from)</Label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Response Date (to)</Label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Client ID</Label>
                    <Input placeholder="NA394" value={clientId} onChange={e => setClientId(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Suburb</Label>
                    <Input placeholder="Nelson" value={suburb} onChange={e => setSuburb(e.target.value)} />
                  </div>
                </div>

                {/* Row 3 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Site</Label>
                    <Input placeholder="Site name…" value={site} onChange={e => setSite(e.target.value)} />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSearch} className="gap-1.5 bg-blue-700 hover:bg-blue-800">
                    <Search className="h-4 w-4" /> Search
                  </Button>
                  <Button variant="outline" onClick={handleClear}>Clear Criteria</Button>
                  <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Limit records to:</span>
                    <span className="font-medium">500</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Results tab ───────────────────────────────────────────────── */}
          <TabsContent value="results">
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="text-center py-10 text-muted-foreground">Searching…</div>
                ) : !searched ? (
                  <div className="text-center py-10 text-muted-foreground">
                    Use the Search tab to find dispatched jobs.
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">No jobs match your search criteria.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-700 hover:bg-blue-700">
                        <TableHead className="text-white font-semibold">Dispatch No.</TableHead>
                        <TableHead className="text-white font-semibold">Client ID</TableHead>
                        <TableHead className="text-white font-semibold">Site</TableHead>
                        <TableHead className="text-white font-semibold">Job Type</TableHead>
                        <TableHead className="text-white font-semibold">Alarm Type</TableHead>
                        <TableHead className="text-white font-semibold">Status</TableHead>
                        <TableHead className="text-white font-semibold">Officer</TableHead>
                        <TableHead className="text-white font-semibold">Created</TableHead>
                        <TableHead className="text-white font-semibold">Response</TableHead>
                        <TableHead className="text-white font-semibold">SLA</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job, i) => {
                        const sc = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending
                        return (
                          <TableRow key={job.id} className={i % 2 === 0 ? '' : 'bg-muted/30'}>
                            <TableCell className="font-mono text-xs font-semibold text-blue-700">{job.job_number}</TableCell>
                            <TableCell className="font-mono text-xs">{job.client_site?.client_code ?? '—'}</TableCell>
                            <TableCell className="text-sm max-w-[160px] truncate">{job.client_site?.name ?? job.address ?? '—'}</TableCell>
                            <TableCell className="text-xs">{JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</TableCell>
                            <TableCell className="text-xs">{job.alarm_type ? (ALARM_TYPE_LABELS[job.alarm_type] ?? job.alarm_type) : '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${sc.className}`}>{sc.label}</Badge>
                              {job.sla_breached && <Badge variant="destructive" className="ml-1 text-xs">SLA</Badge>}
                            </TableCell>
                            <TableCell className="text-xs">
                              {job.assigned_officer
                                ? `${job.assigned_officer.first_name} ${job.assigned_officer.last_name}`
                                : <span className="text-muted-foreground italic">Unassigned</span>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(job.created_at)}</TableCell>
                            <TableCell className="text-xs font-mono">{responseTime(job)}</TableCell>
                            <TableCell>
                              {job.sla_breached
                                ? <AlertTriangle className="h-4 w-4 text-red-500" />
                                : <CheckCircle className="h-4 w-4 text-green-500" />}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {searched && !isLoading && (
              <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
                <span>{jobs.length} record{jobs.length !== 1 ? 's' : ''}</span>
                <Button size="sm" variant="ghost" onClick={() => refetch()} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
