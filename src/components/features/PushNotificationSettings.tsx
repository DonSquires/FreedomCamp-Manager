import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import {
  subscribeWebPush,
  unsubscribeWebPush,
  isNotificationSupported,
} from '@/lib/pushNotifications'
import {
  Bell, BellOff, AlertTriangle, Shield, FileText, CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import { toast } from 'sonner'

export function PushNotificationSettings() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [pushEnabled, setPushEnabled] = useState(false)
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default')

  const { data: preferences } = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const { data, error } = await supabase
        .from('user_profiles')
        .select('notification_preferences, push_token, push_subscription')
        .eq('id', user.id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!user?.id,
  })

  useEffect(() => {
    if ('Notification' in window) {
      setPermissionStatus(Notification.permission)
    }
    // Push is enabled when either a web subscription or an Expo token is stored
    const hasSub   = !!(preferences as any)?.push_subscription
    const hasToken = !!(preferences as any)?.push_token
    setPushEnabled(hasSub || hasToken)
  }, [preferences])

  const updatePreferencesMutation = useMutation({
    mutationFn: async (newPreferences: any) => {
      const { error } = await supabase.from('user_profiles')
        .update({ notification_preferences: newPreferences })
        .eq('id', user?.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', user?.id] })
      toast.success('Notification preferences updated')
    },
    onError: (error: any) => {
      toast.error(`Failed to update preferences: ${error.message}`)
    },
  })

  const handleTogglePreference = (key: string, value: boolean) => {
    const currentPrefs = (preferences as any)?.notification_preferences || {}
    updatePreferencesMutation.mutate({ ...currentPrefs, [key]: value })
  }

  const handleEnablePush = async () => {
    if (!isNotificationSupported()) {
      toast.error('Push notifications are not supported in this browser')
      return
    }
    if (!user?.id) return

    try {
      const permission = await Notification.requestPermission()
      setPermissionStatus(permission)
      if (permission !== 'granted') {
        toast.error('Notification permission denied')
        return
      }

      // Try Web Push (VAPID) first, fall back to placeholder if VAPID key not set
      const ok = await subscribeWebPush(user.id)
      if (ok) {
        setPushEnabled(true)
        queryClient.invalidateQueries({ queryKey: ['notification-preferences', user.id] })
        toast.success('Push notifications enabled — you will receive alerts even when the app is closed')
      } else {
        toast.error('Failed to enable push notifications. Ensure VITE_VAPID_PUBLIC_KEY is set.')
      }
    } catch (err: any) {
      toast.error(`Failed to enable push: ${err.message}`)
    }
  }

  const handleDisablePush = async () => {
    if (!user?.id) return
    try {
      await unsubscribeWebPush(user.id)
      setPushEnabled(false)
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', user.id] })
      toast.success('Push notifications disabled')
    } catch (err: any) {
      toast.error(`Failed to disable push: ${err.message}`)
    }
  }

  const currentPrefs = (preferences as any)?.notification_preferences || {}
  const isWebPush = !!(preferences as any)?.push_subscription

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push Notification Settings
        </CardTitle>
        <CardDescription>
          Receive alerts even when the app is closed — welfare reminders, breach
          alerts, shift notifications and more.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Push enable/disable */}
        <div className="flex items-start justify-between p-4 border rounded-lg">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Background Push Notifications</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Welfare check-in reminders, shift updates and breach alerts
              delivered to this device even when the app is closed.
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {permissionStatus === 'granted' && pushEnabled && (
                <Badge className="bg-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {isWebPush ? 'Web Push Active' : 'Enabled'}
                </Badge>
              )}
              {permissionStatus === 'denied' && (
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Blocked by browser
                </Badge>
              )}
            </div>
          </div>
          {permissionStatus !== 'denied' && (
            <div>
              {pushEnabled ? (
                <Button variant="outline" onClick={handleDisablePush}>
                  <BellOff className="h-4 w-4 mr-2" />
                  Disable
                </Button>
              ) : (
                <Button onClick={handleEnablePush}>
                  <Bell className="h-4 w-4 mr-2" />
                  Enable
                </Button>
              )}
            </div>
          )}
        </div>

        {permissionStatus === 'denied' && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
              <div className="text-sm text-red-900 dark:text-red-100">
                <div className="font-medium">Notifications blocked</div>
                <div className="mt-1">
                  Open your browser settings and allow notifications for this site,
                  then click Enable above.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notification type preferences */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="font-medium">Notification Types</h3>

          {[
            { key: 'welfare_alerts',            icon: Clock,          color: 'text-emerald-600', label: 'Welfare Check-in Reminders', desc: '10-min, 5-min, and overdue welfare alerts' },
            { key: 'shift_alerts',              icon: Bell,           color: 'text-blue-600',    label: 'Shift Availability',          desc: 'Notify when a new shift is posted for you' },
            { key: 'breach_alerts',             icon: AlertTriangle,  color: 'text-red-600',     label: 'Breach Alerts',               desc: 'Compliance violations detected on patrol' },
            { key: 'flagged_vehicle_alerts',    icon: Shield,         color: 'text-yellow-600',  label: 'Flagged Vehicle Alerts',       desc: 'Known problem vehicles detected in your area' },
            { key: 'investigation_assignments', icon: FileText,       color: 'text-indigo-600',  label: 'Investigation Assignments',    desc: 'New investigation jobs assigned to you' },
            { key: 'system_alerts',             icon: Bell,           color: 'text-gray-600',    label: 'System Alerts',               desc: 'Important system updates and announcements' },
          ].map(({ key, icon: Icon, color, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${color}`} />
                <div>
                  <Label htmlFor={key} className="cursor-pointer">{label}</Label>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              </div>
              <Switch
                id={key}
                checked={currentPrefs[key] !== false}
                onCheckedChange={(checked) => handleTogglePreference(key, checked)}
                disabled={!pushEnabled}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
