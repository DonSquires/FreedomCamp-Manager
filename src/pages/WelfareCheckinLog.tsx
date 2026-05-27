/**
 * WelfareCheckinLog — B-65
 *
 * Tabbed admin view for officer welfare check-ins and welfare alerts.
 *
 * Checkins tab (welfare_checkins):
 *  - KPIs: Total / Overdue
 *  - Table: officer_id, checked_in_at, is_overdue, overdue_minutes, GPS
 *
 * Alerts tab (officer_welfare_alerts):
 *  - KPIs: Open alerts / Acknowledged / Resolved
 *  - Table: officer_name, alert_type, status, escalation_level, last_activity_at
 *  - Acknowledge action (updates status + acknowledged_at + acknowledged_by)
 *
 * Route: /welfare-checkins — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  HeartPulse, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, Clock, Navigation,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type WelfareCheckin = Database['public']['Tables']['welfare_checkins']['Row']
type WelfareAlert   = Database['public']['Tables']['officer_welfare_alerts']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtCoords(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return '—'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

const ALERT_STATUS_COLOURS: Record<string, string> = {
  pending:      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  open:         'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  active:       'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  acknowledged: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  resolved:     'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WelfareCheckinLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()
  const [tab, setTab] = useState('checkins')

  // ── Checkins query ────────────────────────────────────────────────────────

  const { data: checkins = [], isLoading: loadingCheckins, refetch: refetchCheckins } = useQuery<WelfareCheckin[]>({
    queryKey: ['welfare-checkins', orgId],
    queryFn: async () => {
      let q = supabase
        .from('welfare_checkins')
        .select('*')
        .order('checked_in_at', { ascending: false })
        .limit(200)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Alerts query ──────────────────────────────────────────────────────────

  const { data: alerts = [], isLoading: loadingAlerts, refetch: refetchAlerts } = useQuery<WelfareAlert[]>({
    queryKey: ['welfare-alerts', orgId],
    queryFn: async () => {
      let q = supabase
        .from('officer_welfare_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Acknowledge mutation ──────────────────────────────────────────────────

  const acknowledge = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from('officer_welfare_alerts')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', alertId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['welfare-alerts'] })
      toast.success('Alert acknowledged')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Derived KPIs ─────────────────────────────────────────────────────────

  const overdueCount        = checkins.filter(c => c.is_overdue).length
  const activeAlerts        = alerts.filter(a => a.status === 'active' || a.status === 'pending' || a.status === 'open').length
  const acknowledgedAlerts  = alerts.filter(a => a.status === 'acknowledged').length
  const resolvedAlerts      = alerts.filter(a => a.status === 'resolved').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <HeartPulse className="h-7 w-7 text-pink-500" />
            <div>
              <h1 className="text-2xl font-bold">Welfare Check-in Log</h1>
              <p className="text-sm text-muted-foreground">Officer check-ins and welfare alerts</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => tab === 'checkins' ? refetchCheckins() : refetchAlerts()}
            disabled={loadingCheckins || loadingAlerts}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${(loadingCheckins || loadingAlerts) ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="checkins">
              Check-ins
              {overdueCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {overdueCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="alerts">
              Alerts
              {activeAlerts > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activeAlerts}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Checkins Tab ────────────────────────────────────────────── */}
          <TabsContent value="checkins" className="space-y-4 mt-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Check-ins</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <span className="text-2xl font-bold">{checkins.length}</span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <Clock className={`h-5 w-5 ${overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
                  <span className={`text-2xl font-bold ${overdueCount > 0 ? 'text-red-600' : ''}`}>{overdueCount}</span>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {loadingCheckins ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : checkins.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No check-ins recorded.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead>Checked In</TableHead>
                        <TableHead>Overdue?</TableHead>
                        <TableHead>Overdue (min)</TableHead>
                        <TableHead>GPS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {checkins.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs">{c.officer_id.slice(0, 8)}…</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(c.checked_in_at)}</TableCell>
                          <TableCell>
                            {c.is_overdue ? (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Overdue</Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">On Time</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {c.overdue_minutes != null ? `${c.overdue_minutes} min` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground flex items-center gap-1">
                            {c.gps_latitude != null && <Navigation className="h-3 w-3" />}
                            {fmtCoords(c.gps_latitude, c.gps_longitude)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Alerts Tab ──────────────────────────────────────────────── */}
          <TabsContent value="alerts" className="space-y-4 mt-4">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Active',       value: activeAlerts,       colour: 'text-red-600',   Icon: AlertCircle },
                { label: 'Acknowledged', value: acknowledgedAlerts,  colour: 'text-amber-600', Icon: Clock },
                { label: 'Resolved',     value: resolvedAlerts,      colour: 'text-green-600', Icon: CheckCircle2 },
              ].map(({ label, value, colour, Icon }) => (
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

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {loadingAlerts ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No welfare alerts.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead>Alert Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Escalation</TableHead>
                        <TableHead>Last Activity</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alerts.map(a => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{a.officer_name}</div>
                            {a.officer_phone && (
                              <div className="text-xs text-muted-foreground">{a.officer_phone}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm capitalize">
                            {a.alert_type.replace(/_/g, ' ')}
                          </TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${ALERT_STATUS_COLOURS[a.status ?? ''] ?? ''}`}>
                              {a.status ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {a.escalation_level != null ? `Level ${a.escalation_level}` : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {fmtDate(a.last_activity_at)}
                          </TableCell>
                          <TableCell>
                            {(a.status === 'active' || a.status === 'pending' || a.status === 'open') && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={acknowledge.isPending}
                                onClick={() => acknowledge.mutate(a.id)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
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
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
