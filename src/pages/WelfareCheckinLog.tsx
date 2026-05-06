/**
 * WelfareCheckinLog — B-65
 *
 * Admin view of officer welfare check-in records from the welfare_checkins table.
 * Cross-linked with officer_welfare_alerts so supervisors can see which check-ins
 * generated alerts or remain overdue.
 *
 * Features:
 *  - KPI cards: Check-ins today, Overdue check-ins, Active welfare alerts, Avg overdue (min)
 *  - Filters: officer name, is_overdue, date range
 *  - Check-ins table: officer, checked_in_at, is_overdue, overdue_minutes, GPS
 *  - Active welfare alerts panel: alert_type, officer_name, escalation_level, status
 *  - Acknowledge alert action
 *
 * Route: /welfare-checkins — admin / admin_officer / master
 * welfare_checkins and officer_welfare_alerts are fully typed in database.ts
 */

import { useState } from 'react'
import { format, isToday, parseISO } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, CheckCircle2, HeartPulse, Loader2, MapPin, RefreshCw, ShieldAlert,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Checkin = Database['public']['Tables']['welfare_checkins']['Row']
type WelfareAlert = Database['public']['Tables']['officer_welfare_alerts']['Row']

type CheckinWithProfile = Checkin & {
  user_profiles: { full_name: string | null } | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function alertStatusColour(s: string | null) {
  switch (s) {
    case 'resolved':    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'acknowledged': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'escalated':   return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
    default:            return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function WelfareCheckinLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [overdueFilter, setOverdueFilter] = useState('all')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [search, setSearch]               = useState('')

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: checkins = [], isLoading: loadingCheckins, refetch: refetchCheckins } =
    useQuery<CheckinWithProfile[]>({
      queryKey: ['welfare_checkins', orgId, overdueFilter, dateFrom, dateTo],
      enabled: !!orgId,
      queryFn: async () => {
        let q = supabase
          .from('welfare_checkins')
          .select('*, user_profiles!welfare_checkins_officer_id_fkey(full_name)')
          .eq('organization_id', orgId as string)
          .order('checked_in_at', { ascending: false })
          .limit(400)

        if (overdueFilter === 'overdue')     q = q.eq('is_overdue', true)
        if (overdueFilter === 'on_time')     q = q.eq('is_overdue', false)
        if (dateFrom)                        q = q.gte('checked_in_at', dateFrom)
        if (dateTo)                          q = q.lte('checked_in_at', dateTo + 'T23:59:59')

        const { data, error } = await q
        if (error) throw error
        return (data ?? []) as unknown as CheckinWithProfile[]
      },
    })

  const { data: alerts = [], isLoading: loadingAlerts, refetch: refetchAlerts } =
    useQuery<WelfareAlert[]>({
      queryKey: ['officer_welfare_alerts', orgId],
      enabled: !!orgId,
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('officer_welfare_alerts')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(200)
        if (error) throw error
        return data ?? []
      },
    })

  // ── Mutation: acknowledge alert ─────────────────────────────────────────────

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('officer_welfare_alerts')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alert acknowledged')
      qc.invalidateQueries({ queryKey: ['officer_welfare_alerts'] })
    },
    onError: () => toast.error('Failed to acknowledge alert'),
  })

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredCheckins = checkins.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (c.user_profiles?.full_name ?? '').toLowerCase().includes(q)
  })

  const todayCheckins    = checkins.filter(c => isToday(parseISO(c.checked_in_at))).length
  const overdueCheckins  = checkins.filter(c => c.is_overdue).length
  const activeAlerts     = alerts.filter(a => a.status !== 'resolved').length
  const avgOverdue = overdueCheckins > 0
    ? Math.round(checkins.filter(c => c.is_overdue && c.overdue_minutes != null)
        .reduce((s, c) => s + (c.overdue_minutes ?? 0), 0) / overdueCheckins)
    : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Welfare Check-in Log"
      description="Officer welfare check-in records and active welfare alerts"
    >
      <div className="space-y-4">

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Check-ins Today',    value: todayCheckins,   icon: HeartPulse,   colour: 'text-emerald-600' },
            { label: 'Overdue Check-ins',  value: overdueCheckins, icon: AlertTriangle, colour: 'text-amber-600' },
            { label: 'Active Alerts',      value: activeAlerts,    icon: ShieldAlert,  colour: 'text-red-600' },
            { label: 'Avg Overdue (min)',   value: avgOverdue,      icon: Activity,     colour: 'text-violet-600' },
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

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <Tabs defaultValue="checkins">
          <TabsList>
            <TabsTrigger value="checkins">Check-in Records</TabsTrigger>
            <TabsTrigger value="alerts">
              Welfare Alerts
              {activeAlerts > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold h-4 w-4">
                  {activeAlerts > 99 ? '99+' : activeAlerts}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Check-ins Tab ──────────────────────────────────────────────── */}
          <TabsContent value="checkins" className="space-y-3 mt-3">

            {/* Filters */}
            <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
              <CardContent className="pt-4 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Search Officer</Label>
                    <Input
                      placeholder="Officer name…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <Select value={overdueFilter} onValueChange={setOverdueFilter}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="overdue">Overdue only</SelectItem>
                        <SelectItem value="on_time">On time only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="flex items-end">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetchCheckins()} title="Refresh">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Table */}
            <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
              <CardContent className="p-0">
                {loadingCheckins ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : filteredCheckins.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                    No check-in records match your filters.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead>Checked In</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Overdue (min)</TableHead>
                        <TableHead>GPS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCheckins.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm font-medium">
                            {c.user_profiles?.full_name ?? 'Unknown officer'}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(parseISO(c.checked_in_at), 'dd MMM yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            {c.is_overdue ? (
                              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 text-xs">Overdue</Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 text-xs">On time</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {c.overdue_minutes != null ? `${c.overdue_minutes} min` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.gps_latitude != null && c.gps_longitude != null ? (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {c.gps_latitude.toFixed(5)}, {c.gps_longitude.toFixed(5)}
                              </span>
                            ) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Alerts Tab ─────────────────────────────────────────────────── */}
          <TabsContent value="alerts" className="space-y-3 mt-3">
            <Card className="border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-sm">
              <CardContent className="p-0">
                {loadingAlerts ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                    No welfare alerts found.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead>Alert Type</TableHead>
                        <TableHead>Escalation Level</TableHead>
                        <TableHead>Last Activity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alerts.map(a => (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm font-medium">{a.officer_name}</TableCell>
                          <TableCell className="text-sm capitalize">{a.alert_type.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-sm">{a.escalation_level ?? 1}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(parseISO(a.last_activity_at), 'dd MMM yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs capitalize ${alertStatusColour(a.status)}`}>
                              {(a.status ?? 'active').replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {a.status !== 'resolved' && a.status !== 'acknowledged' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                onClick={() => acknowledge.mutate(a.id)}
                                disabled={acknowledge.isPending}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Acknowledge
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => refetchAlerts()}>
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </AppLayout>
  )
}
