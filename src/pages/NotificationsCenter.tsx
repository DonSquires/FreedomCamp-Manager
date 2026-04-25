/**
 * NotificationsCenter — Unified notification inbox and admin broadcast panel.
 *
 * Features:
 *   • Notification inbox (unread / all, with mark-as-read / delete)
 *   • Admin broadcast — send a push notification to all officers, or to a
 *     specific role subset (officer | admin_officer | all)
 *   • Notification preferences (per-category toggles)
 */

import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  Send,
  AlertTriangle,
  Info,
  Shield,
  Users,
  RefreshCw,
  BellRing,
  MessageSquare,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import {
  useNotifications,
  useNotificationCount,
} from '@/hooks/useNotifications'
import { useOfficerNotifications } from '@/hooks/useOfficerNotifications'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BroadcastForm {
  title: string
  body: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  targetRole: 'all' | 'officer' | 'admin_officer' | 'admin'
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800 border-red-200',
  high:   'bg-orange-100 text-orange-800 border-orange-200',
  normal: 'bg-blue-100 text-blue-800 border-blue-200',
  low:    'bg-gray-100 text-gray-700 border-gray-200',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  breach_alert:             <AlertTriangle className="h-4 w-4 text-red-500" />,
  investigation_assigned:   <Shield className="h-4 w-4 text-purple-500" />,
  flagged_vehicle:          <AlertTriangle className="h-4 w-4 text-orange-500" />,
  welfare_alert:            <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  system_alert:             <Info className="h-4 w-4 text-blue-500" />,
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationsCenter() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id
  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role ?? '')

  const [unreadOnly, setUnreadOnly] = useState(false)
  const [broadcastForm, setBroadcastForm] = useState<BroadcastForm>({
    title: '',
    body: '',
    priority: 'normal',
    targetRole: 'all',
  })
  const [sending, setSending] = useState(false)

  // ── Data hooks ──────────────────────────────────────────────────────────────

  const { notifications = [], isLoading, markAsRead, markAllAsRead, deleteNotification } =
    useNotifications({ read: unreadOnly ? false : undefined, limit: 100 })

  const { data: unreadCount = 0 } = useNotificationCount()

  const { preferences, updatePreferences } = useOfficerNotifications()

  // Count of users per role for broadcast summary
  const { data: roleCounts } = useQuery({
    queryKey: ['role-counts', orgId],
    queryFn: async () => {
      if (!orgId) return {} as Record<string, number>
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('role')
        .eq('organization_id', orgId)
        .eq('is_active', true)
      if (error || !data) return {} as Record<string, number>
      const counts: Record<string, number> = {}
      for (const row of data as Array<{ role: string }>) {
        counts[row.role] = (counts[row.role] || 0) + 1
      }
      return counts
    },
    enabled: !!orgId && isAdmin,
  })

  // ── Broadcast mutation ──────────────────────────────────────────────────────

  const handleBroadcast = async () => {
    if (!broadcastForm.title.trim() || !broadcastForm.body.trim()) {
      toast.error('Title and message body are required')
      return
    }
    if (!orgId) {
      toast.error('Select an organisation first')
      return
    }
    setSending(true)
    try {
      // Get target user IDs
      let query = (supabase as any)
        .from('user_profiles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_active', true)

      if (broadcastForm.targetRole !== 'all') {
        query = query.eq('role', broadcastForm.targetRole)
      }

      const { data: targets, error: fetchErr } = await query
      if (fetchErr) throw fetchErr
      if (!targets || targets.length === 0) {
        toast.warning('No active users found for the selected role')
        return
      }

      // Insert notifications directly (faster than calling edge fn N times)
      const rows = (targets as Array<{ id: string }>).map(t => ({
        user_id: t.id,
        type: 'system_alert',
        title: broadcastForm.title.trim(),
        body: broadcastForm.body.trim(),
        data: { broadcast: true, sent_by: user?.id },
        priority: broadcastForm.priority,
        read: false,
        delivered: false,
      }))

      const { error: insertErr } = await (supabase as any)
        .from('notifications')
        .insert(rows)
      if (insertErr) throw insertErr

      toast.success(`Broadcast sent to ${targets.length} user${targets.length !== 1 ? 's' : ''}`)
      setBroadcastForm({ title: '', body: '', priority: 'normal', targetRole: 'all' })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notification-count'] })
    } catch (err: any) {
      toast.error(err.message || 'Failed to send broadcast')
    } finally {
      setSending(false)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const recipientCount = () => {
    if (!roleCounts) return '—'
    if (broadcastForm.targetRole === 'all') {
      return Object.values(roleCounts).reduce((a, b) => a + b, 0)
    }
    return roleCounts[broadcastForm.targetRole] || 0
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Notifications"
      description="Inbox, broadcast, and notification preferences"
    >
      <GlobalFilterRibbon />

      <div className="space-y-6 p-4">

        <Tabs defaultValue="inbox">
          <TabsList className="mb-4 grid grid-cols-2 sm:grid-cols-3 h-auto gap-2 bg-transparent p-0">
            <TabsTrigger value="inbox" className="flex items-center gap-2 rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5">
              <Bell className="h-4 w-4" />
              Inbox
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="broadcast" className="flex items-center gap-2 rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5">
                <Send className="h-4 w-4" />
                Broadcast
              </TabsTrigger>
            )}
            <TabsTrigger value="preferences" className="flex items-center gap-2 rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5">
              <BellRing className="h-4 w-4" />
              Preferences
            </TabsTrigger>
          </TabsList>

          {/* ── Inbox ──────────────────────────────────────────────── */}
          <TabsContent value="inbox">
            <Card className="border-2 border-slate-200">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bell className="h-5 w-5" />
                      Notification Inbox
                    </CardTitle>
                    <CardDescription>
                      {unreadCount > 0
                        ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                        : 'All caught up!'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        id="unread-only"
                        checked={unreadOnly}
                        onCheckedChange={setUnreadOnly}
                      />
                      <Label htmlFor="unread-only" className="text-sm cursor-pointer">
                        Unread only
                      </Label>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['notifications'] })}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Refresh
                    </Button>
                    {unreadCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => markAllAsRead.mutate()}
                        disabled={markAllAsRead.isPending}
                      >
                        <CheckCheck className="h-3.5 w-3.5 mr-1" />
                        Mark all read
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
                ) : notifications.length === 0 ? (
                  <div className="py-10 flex flex-col items-center text-muted-foreground gap-2">
                    <BellOff className="h-8 w-8 opacity-40" />
                    <p className="text-sm">
                      {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['notifications'] })}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Refresh Inbox
                    </Button>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {notifications.map(n => (
                      <li
                        key={n.id}
                        className={`p-3 sm:p-4 rounded-2xl border-2 flex items-start gap-3 ${!n.read ? 'bg-blue-50/70 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {TYPE_ICONS[n.type] ?? <Info className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-medium truncate ${!n.read ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {n.title}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-[10px] shrink-0 ${PRIORITY_COLORS[n.priority] || PRIORITY_COLORS.normal}`}
                            >
                              {n.priority}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {formatDateTime(n.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!n.read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-lg"
                              title="Mark as read"
                              onClick={() => markAsRead.mutate(n.id)}
                            >
                              <CheckCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-lg text-destructive hover:text-destructive"
                            title="Delete"
                            onClick={() => deleteNotification.mutate(n.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Broadcast ──────────────────────────────────────────── */}
          {isAdmin && (
            <TabsContent value="broadcast">
              <Card className="border-2 border-slate-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="h-5 w-5" />
                    Send Broadcast Notification
                  </CardTitle>
                  <CardDescription>
                    Send an in-app notification to all officers, or a specific role group.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="bc-role">Target Role</Label>
                      <Select
                        value={broadcastForm.targetRole}
                        onValueChange={v => setBroadcastForm(f => ({ ...f, targetRole: v as BroadcastForm['targetRole'] }))}
                      >
                        <SelectTrigger id="bc-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All active users</SelectItem>
                          <SelectItem value="officer">Officers only</SelectItem>
                          <SelectItem value="admin_officer">Admin Officers only</SelectItem>
                          <SelectItem value="admin">Admins only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="bc-priority">Priority</Label>
                      <Select
                        value={broadcastForm.priority}
                        onValueChange={v => setBroadcastForm(f => ({ ...f, priority: v as BroadcastForm['priority'] }))}
                      >
                        <SelectTrigger id="bc-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="urgent">🔴 Urgent</SelectItem>
                          <SelectItem value="high">🟠 High</SelectItem>
                          <SelectItem value="normal">🔵 Normal</SelectItem>
                          <SelectItem value="low">⚪ Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="bc-title">Notification Title *</Label>
                    <Input
                      id="bc-title"
                      placeholder="e.g. Zone Closure — Lake Reserve"
                      value={broadcastForm.title}
                      onChange={e => setBroadcastForm(f => ({ ...f, title: e.target.value }))}
                      maxLength={120}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="bc-body">Message Body *</Label>
                    <Textarea
                      id="bc-body"
                      placeholder="Describe the alert or update officers need to know…"
                      rows={4}
                      value={broadcastForm.body}
                      onChange={e => setBroadcastForm(f => ({ ...f, body: e.target.value }))}
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      {broadcastForm.body.length}/500
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>
                        Recipients:{' '}
                        <strong className="text-foreground">{recipientCount()}</strong>{' '}
                        active user{recipientCount() !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Button
                      onClick={handleBroadcast}
                      disabled={
                        sending ||
                        !broadcastForm.title.trim() ||
                        !broadcastForm.body.trim()
                      }
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {sending ? 'Sending…' : 'Send Broadcast'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Preferences ────────────────────────────────────────── */}
          <TabsContent value="preferences">
            <Card className="border-2 border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BellRing className="h-5 w-5" />
                  Notification Preferences
                </CardTitle>
                <CardDescription>
                  Choose which events you want to be notified about.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!preferences ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Loading preferences…
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {(
                      [
                        { key: 'breach_alerts',             label: 'Breach Alerts',               desc: 'Notify when new breach alerts are triggered in your zones' },
                        { key: 'investigation_assignments', label: 'Investigation Assignments',    desc: 'Notify when an investigation job is assigned to you' },
                        { key: 'flagged_vehicle_alerts',    label: 'Flagged Vehicle Alerts',       desc: 'Notify when a flagged vehicle is detected' },
                        { key: 'welfare_alerts',            label: 'Welfare Check Alerts',         desc: 'Notify when a welfare alert is raised for an officer' },
                        { key: 'system_alerts',             label: 'System & Broadcast Alerts',   desc: 'Receive admin broadcasts and system notices' },
                      ] as Array<{ key: keyof typeof preferences; label: string; desc: string }>
                    ).map(({ key, label, desc }) => (
                      <li key={key} className="p-3 rounded-xl border border-slate-200 bg-white flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                        </div>
                        <Switch
                          checked={!!preferences[key]}
                          onCheckedChange={val =>
                            updatePreferences.mutate({ [key]: val })
                          }
                          disabled={updatePreferences.isPending}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
