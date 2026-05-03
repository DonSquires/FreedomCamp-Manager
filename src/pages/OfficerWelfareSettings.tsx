import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Heart,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Bell,
  Shield,
  Settings2,
  Activity,
  Navigation,
  Search,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface WelfareSettings {
  id: string
  organization_id: string
  user_id: string
  auto_logoff_enabled: boolean
  welfare_check_enabled: boolean
  inactivity_warning_time: number
  auto_logoff_time: number
  gps_inactivity_threshold: number
  admin_escalation_time: number
  critical_escalation_time: number
  investigation_exception_enabled: boolean
  check_in_interval_minutes: number
  user_profile: {
    first_name: string
    last_name: string
    email: string
    role: string
  } | null
}

interface WelfareAlert {
  id: string
  officer_id: string
  alert_type: string
  created_at: string | null
  last_activity_at: string
  acknowledgement_notes: string | null
  resolution_notes: string | null
  triggered_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  notes: string | null
  officer: {
    first_name: string
    last_name: string
  } | null
  acknowledged_by_user: {
    first_name: string
    last_name: string
  } | null
}

const ALERT_META: Record<string, { label: string; color: string; bg: string }> = {
  inactivity:              { label: 'Inactivity',       color: '#b45309', bg: '#fffbeb' },
  gps_lost:                { label: 'GPS Lost',         color: '#dc2626', bg: '#fef2f2' },
  manual:                  { label: 'Manual',           color: '#1d4ed8', bg: '#eff6ff' },
  investigation_overdue:   { label: 'Job Overdue',      color: '#7c3aed', bg: '#f5f3ff' },
  man_down:                { label: '⚠ MAN DOWN',       color: '#dc2626', bg: '#fee2e2' },
}

export default function OfficerWelfareSettings() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<WelfareSettings | null>(null)
  const [editForm, setEditForm] = useState<Partial<WelfareSettings>>({})

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id

  // ── Realtime subscription — instantly surface man-down alerts ──────────────
  useEffect(() => {
    if (!orgId) return
    const channel = supabase
      .channel(`welfare-alerts-realtime-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'officer_welfare_alerts',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const alertType = (payload.new as any)?.alert_type
          const officerName = (payload.new as any)?.officer_name ?? 'An officer'
          if (alertType === 'man_down') {
            toast.error(`🚨 MAN DOWN — ${officerName}`, {
              duration: 0,
              description: 'Immediate response required. Check the Welfare Alerts tab.',
            })
          } else if (alertType === 'welfare_check') {
            toast.warning(`⚠ Welfare check overdue — ${officerName}`)
          }
          queryClient.invalidateQueries({ queryKey: ['welfare-alerts', orgId] })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orgId, queryClient])
  const { data: allSettings = [], isLoading: loadingSettings, isFetching: fetchingSettings } = useQuery({
    queryKey: ['welfare-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('officer_welfare_settings')
        .select(`
          id, organization_id, user_id,
          auto_logoff_enabled, welfare_check_enabled,
          inactivity_warning_time, auto_logoff_time,
          gps_inactivity_threshold, admin_escalation_time, critical_escalation_time,
          investigation_exception_enabled, check_in_interval_minutes,
          user_profile:user_profiles!user_id(first_name, last_name, email, role)
        `)
        .eq('organization_id', orgId!)
        .order('user_id')

      if (error) throw error
      return (data || []) as unknown as WelfareSettings[]
    },
    enabled: !!orgId,
    refetchInterval: 30000,
  })

  // Fetch active welfare alerts
  const { data: activeAlerts = [], isLoading: loadingAlerts, isFetching: fetchingAlerts } = useQuery({
    queryKey: ['welfare-alerts', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('officer_welfare_alerts')
        .select(`
          id, officer_id, alert_type, created_at, last_activity_at,
          acknowledged_at, resolved_at, acknowledgement_notes, resolution_notes,
          officer:user_profiles!officer_id(first_name, last_name),
          acknowledged_by_user:user_profiles!acknowledged_by(first_name, last_name)
        `)
        .eq('organization_id', orgId!)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      return (data || []).map((row: any) => ({
        ...row,
        triggered_at: row.created_at ?? row.last_activity_at,
        notes: row.resolution_notes ?? row.acknowledgement_notes ?? null,
      })) as WelfareAlert[]
    },
    enabled: !!orgId,
    refetchInterval: 15000,
  })

  // Acknowledge alert
  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await (supabase.from('officer_welfare_alerts') as any)
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user!.id,
        })
        .eq('id', alertId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alert acknowledged')
      queryClient.invalidateQueries({ queryKey: ['welfare-alerts'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Resolve alert
  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await (supabase.from('officer_welfare_alerts') as any)
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', alertId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alert resolved')
      queryClient.invalidateQueries({ queryKey: ['welfare-alerts'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Save settings
  const saveSettings = useMutation({
    mutationFn: async (settings: Partial<WelfareSettings> & { id: string }) => {
      // Destructure out joined/computed fields that are not DB columns
      const { id, user_profile: _userProfile, ...rest } = settings as any
      const { error } = await (supabase.from('officer_welfare_settings') as any)
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Settings saved')
      setEditTarget(null)
      queryClient.invalidateQueries({ queryKey: ['welfare-settings'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const handleEdit = (s: WelfareSettings) => {
    setEditTarget(s)
    setEditForm({ ...s })
  }

  const filteredSettings = allSettings.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    const p = s.user_profile
    return (
      p?.first_name?.toLowerCase().includes(q) ||
      p?.last_name?.toLowerCase().includes(q) ||
      p?.email?.toLowerCase().includes(q)
    )
  })

  const manDown = activeAlerts.filter(a => a.alert_type === 'man_down')
  const otherAlerts = activeAlerts.filter(a => a.alert_type !== 'man_down')

  return (
    <AppLayout title="Officer Welfare" description="Configure welfare thresholds and monitor active alerts">
      <GlobalFilterRibbon />

      {/* Man Down banner */}
      {manDown.length > 0 && (
        <div className="mb-4 p-4 rounded-lg border-2 border-red-500 bg-red-50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-red-600 animate-pulse" />
            <div>
              <div className="font-bold text-red-700 text-lg">MAN DOWN ALERT — {manDown.length} officer{manDown.length > 1 ? 's' : ''}</div>
              <div className="text-sm text-red-600">
                {manDown.map(a => `${a.officer?.first_name} ${a.officer?.last_name}`).join(', ')} — immediate assistance required
              </div>
            </div>
          </div>
          <Badge variant="destructive" className="text-sm">CRITICAL</Badge>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Officers Configured', value: allSettings.length, icon: <User className="h-5 w-5 text-blue-600" /> },
          { label: 'Active Alerts', value: activeAlerts.length, icon: <Bell className="h-5 w-5 text-orange-500" /> },
          { label: 'Man Down', value: manDown.length, icon: <AlertTriangle className="h-5 w-5 text-red-600" /> },
          { label: 'Welfare Check On', value: allSettings.filter(s => s.welfare_check_enabled).length, icon: <Heart className="h-5 w-5 text-green-600" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts" className="flex items-center gap-1.5">
            <Bell className="h-4 w-4" />
            Active Alerts
            {activeAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                {activeAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1.5">
            <Settings2 className="h-4 w-4" />
            Officer Settings
          </TabsTrigger>
        </TabsList>

        {/* Active alerts tab */}
        <TabsContent value="alerts" className="mt-4 space-y-3">
          {fetchingAlerts && !loadingAlerts && (
            <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
              Refreshing welfare alerts
            </div>
          )}
          {loadingAlerts ? (
            <div className="text-center py-8 text-muted-foreground">Loading alerts…</div>
          ) : activeAlerts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-12 w-12 mx-auto text-green-400 mb-3" />
                <p className="text-lg font-semibold">All clear</p>
                <p className="text-sm text-muted-foreground">No active welfare alerts</p>
              </CardContent>
            </Card>
          ) : (
            activeAlerts.map(alert => {
              const meta = ALERT_META[alert.alert_type] || ALERT_META.manual
              return (
                <Card key={alert.id} style={{ borderColor: meta.color, backgroundColor: meta.bg }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold" style={{ color: meta.color }}>{meta.label}</span>
                          <span className="font-semibold">
                            {alert.officer?.first_name} {alert.officer?.last_name}
                          </span>
                          {alert.acknowledged_at && (
                            <Badge variant="outline" className="text-xs">
                              Acknowledged by {alert.acknowledged_by_user?.first_name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Triggered {formatDateTime(alert.triggered_at)}
                        </div>
                        {alert.notes && (
                          <p className="text-sm">{alert.notes}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {!alert.acknowledged_at && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acknowledgeAlert.mutate(alert.id)}
                          >
                            <Bell className="h-3.5 w-3.5 mr-1" />
                            Acknowledge
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => resolveAlert.mutate(alert.id)}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Resolve
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        {/* Settings tab */}
        <TabsContent value="settings" className="mt-4">
          {fetchingSettings && !loadingSettings && (
            <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 mb-3">
              Refreshing officer settings
            </div>
          )}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search officers…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loadingSettings ? (
            <div className="text-center py-8 text-muted-foreground">Loading settings…</div>
          ) : filteredSettings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-lg font-semibold text-muted-foreground">No welfare settings configured</p>
                <p className="text-sm text-muted-foreground">Settings are created automatically when officers first log in</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredSettings.map(s => (
                <Card key={s.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">
                            {s.user_profile?.first_name} {s.user_profile?.last_name}
                          </span>
                          <Badge variant="outline" className="text-xs capitalize">
                            {s.user_profile?.role}
                          </Badge>
                          {s.welfare_check_enabled ? (
                            <Badge variant="default" className="text-xs bg-green-600">Welfare On</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Welfare Off</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.user_profile?.email}</div>
                        <div className="flex gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Warn: {s.inactivity_warning_time}m
                          </span>
                          <span className="flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            Auto-logoff: {s.auto_logoff_time}m
                          </span>
                          <span className="flex items-center gap-1">
                            <Navigation className="h-3 w-3" />
                            GPS threshold: {s.gps_inactivity_threshold}m
                          </span>
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Escalate: {s.admin_escalation_time}m
                          </span>
                          {s.welfare_check_enabled && (
                            <span className="flex items-center gap-1 text-red-600">
                              <Shield className="h-3 w-3" />
                              Man-Down enabled
                            </span>
                          )}
                          {s.check_in_interval_minutes > 0 && (
                            <span className="flex items-center gap-1 text-green-700">
                              <CheckCircle className="h-3 w-3" />
                              Check-in: {s.check_in_interval_minutes}m
                            </span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleEdit(s)}>
                        <Settings2 className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Settings Dialog */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit Welfare Settings — {editTarget?.user_profile?.first_name} {editTarget?.user_profile?.last_name}
            </DialogTitle>
            <DialogDescription>
              Configure auto-logoff and welfare check thresholds for this officer.
            </DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <Label>Welfare Checks Enabled</Label>
                <Switch
                  checked={!!editForm.welfare_check_enabled}
                  onCheckedChange={v => setEditForm(f => ({ ...f, welfare_check_enabled: v }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Auto-Logoff Enabled</Label>
                <Switch
                  checked={!!editForm.auto_logoff_enabled}
                  onCheckedChange={v => setEditForm(f => ({ ...f, auto_logoff_enabled: v }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Investigation Exception</Label>
                <Switch
                  checked={!!editForm.investigation_exception_enabled}
                  onCheckedChange={v => setEditForm(f => ({ ...f, investigation_exception_enabled: v }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Inactivity Warning (min)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editForm.inactivity_warning_time || ''}
                    onChange={e => setEditForm(f => ({ ...f, inactivity_warning_time: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Auto-Logoff (min)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editForm.auto_logoff_time || ''}
                    onChange={e => setEditForm(f => ({ ...f, auto_logoff_time: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>GPS Threshold (min)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editForm.gps_inactivity_threshold || ''}
                    onChange={e => setEditForm(f => ({ ...f, gps_inactivity_threshold: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Admin Escalate (min)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editForm.admin_escalation_time || ''}
                    onChange={e => setEditForm(f => ({ ...f, admin_escalation_time: parseInt(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                    I'm OK Check-in Interval (mins)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0 = disabled"
                    value={editForm.check_in_interval_minutes ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, check_in_interval_minutes: parseInt(e.target.value) || 0 }))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Officer must tap "I'm OK" within this interval. 0 disables scheduled check-ins.
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              onClick={() => saveSettings.mutate({ ...editForm, id: editTarget!.id } as any)}
              disabled={saveSettings.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
