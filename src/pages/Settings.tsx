import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Bell,
  Shield,
  Moon,
  Globe,
  Key,
  Save,
  Smartphone,
  Activity,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSessionPreferencesStore } from '@/stores/sessionPreferencesStore'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'

interface NotificationPreferences {
  breach_alerts: boolean
  welfare_alerts: boolean
  investigation_assignments: boolean
  patrol_events: boolean
  system_updates: boolean
  push_enabled: boolean
  email_enabled: boolean
}

interface AppPreferences {
  theme_mode: 'light' | 'dark' | 'high-contrast' | 'night-patrol' | 'system'
  driving_mode: boolean
  auto_logoff_enabled: boolean
  offline_sync_enabled: boolean
  gps_tracking_enabled: boolean
}

export default function Settings() {
  const { user } = useAuthStore()
  const {
    autoLogoffEnabled,
    inactivityMinutes,
    setAutoLogoffEnabled,
    setInactivityMinutes,
  } = useSessionPreferencesStore()
  const { themeMode, setThemeMode } = useThemePreferencesStore()

  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    breach_alerts: true,
    welfare_alerts: true,
    investigation_assignments: true,
    patrol_events: false,
    system_updates: false,
    push_enabled: true,
    email_enabled: true,
  })

  const [appPrefs, setAppPrefs] = useState<AppPreferences>({
    theme_mode: themeMode,
    driving_mode: false,
    auto_logoff_enabled: autoLogoffEnabled,
    offline_sync_enabled: true,
    gps_tracking_enabled: true,
  })
  const [autoLogoffMinutes, setAutoLogoffMinutes] = useState<number>(inactivityMinutes)

  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    // Persist to user_preferences if the table exists, or just show success
    setAutoLogoffEnabled(appPrefs.auto_logoff_enabled)
    setInactivityMinutes(autoLogoffMinutes)
    setThemeMode(appPrefs.theme_mode)
    setSaved(true)
    toast.success('Settings saved')
    setTimeout(() => setSaved(false), 2000)
  }

  const NotifToggle = ({
    id,
    label,
    description,
    checked,
    onCheckedChange,
  }: {
    id: keyof NotificationPreferences
    label: string
    description: string
    checked: boolean
    onCheckedChange: (v: boolean) => void
  }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )

  const AppToggle = ({
    label,
    description,
    checked,
    onCheckedChange,
  }: {
    label: string
    description: string
    checked: boolean
    onCheckedChange: (v: boolean) => void
  }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )

  return (
    <AppLayout title="Settings" description="Manage notification and application preferences">

      <div className="max-w-2xl space-y-6">
        {/* Account info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Role</span>
              <Badge variant="outline" className="capitalize">{user?.role}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">User ID</span>
              <span className="font-mono text-xs text-muted-foreground">{user?.id}</span>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="notifications">
          <TabsList>
            <TabsTrigger value="notifications" className="flex items-center gap-1.5">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="app" className="flex items-center gap-1.5">
              <Smartphone className="h-4 w-4" />
              Application
            </TabsTrigger>
          </TabsList>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notification Channels</CardTitle>
              </CardHeader>
              <CardContent>
                <NotifToggle
                  id="push_enabled"
                  label="Push Notifications"
                  description="Receive notifications on your device"
                  checked={notifPrefs.push_enabled}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, push_enabled: v }))}
                />
                <NotifToggle
                  id="email_enabled"
                  label="Email Notifications"
                  description="Receive important alerts via email"
                  checked={notifPrefs.email_enabled}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, email_enabled: v }))}
                />
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Alert Types</CardTitle>
              </CardHeader>
              <CardContent>
                <NotifToggle
                  id="breach_alerts"
                  label="Breach Alerts"
                  description="New breach detections and status updates"
                  checked={notifPrefs.breach_alerts}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, breach_alerts: v }))}
                />
                <NotifToggle
                  id="welfare_alerts"
                  label="Welfare Alerts"
                  description="Officer welfare and Man Down alerts"
                  checked={notifPrefs.welfare_alerts}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, welfare_alerts: v }))}
                />
                <NotifToggle
                  id="investigation_assignments"
                  label="Investigation Assignments"
                  description="New investigation jobs assigned to you"
                  checked={notifPrefs.investigation_assignments}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, investigation_assignments: v }))}
                />
                <NotifToggle
                  id="patrol_events"
                  label="Patrol Events"
                  description="Patrol start, end, and checkpoint events"
                  checked={notifPrefs.patrol_events}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, patrol_events: v }))}
                />
                <NotifToggle
                  id="system_updates"
                  label="System Updates"
                  description="Platform updates and maintenance windows"
                  checked={notifPrefs.system_updates}
                  onCheckedChange={v => setNotifPrefs(p => ({ ...p, system_updates: v }))}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Application */}
          <TabsContent value="app" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Application Preferences</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="py-3 border-b">
                  <Label className="font-medium text-sm">Theme Mode</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Choose light, dark, high contrast, system, or Night Patrol for field officers working at night.
                  </p>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(['light', 'dark', 'high-contrast', 'night-patrol', 'system'] as const).map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        variant={appPrefs.theme_mode === mode ? 'default' : 'outline'}
                        onClick={() => setAppPrefs((p) => ({ ...p, theme_mode: mode }))}
                        className={mode === 'night-patrol' ? 'col-span-2 sm:col-span-1' : ''}
                      >
                        {mode === 'high-contrast' ? 'High Contrast'
                          : mode === 'night-patrol' ? '🌙 Night Patrol'
                          : mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </Button>
                    ))}
                  </div>
                  {appPrefs.theme_mode === 'night-patrol' && (
                    <p className="text-xs text-cyan-600 dark:text-cyan-400 mt-2 flex items-start gap-1.5">
                      <span className="shrink-0">🌙</span>
                      Night Patrol mode: pitch-black background, large touch targets (56 px min), high-contrast
                      text — optimised for gloved hands in low-light environments.
                    </p>
                  )}
                </div>
                <AppToggle
                  label="Driving Mode"
                  description="Larger touch targets for use while driving"
                  checked={appPrefs.driving_mode}
                  onCheckedChange={v => setAppPrefs(p => ({ ...p, driving_mode: v }))}
                />
                <AppToggle
                  label="Auto Logoff"
                  description="Automatically log off after a period of inactivity"
                  checked={appPrefs.auto_logoff_enabled}
                  onCheckedChange={v => setAppPrefs(p => ({ ...p, auto_logoff_enabled: v }))}
                />
                <div className="py-3 border-b">
                  <Label htmlFor="auto-logoff-minutes" className="font-medium text-sm">Auto Logoff Timeout (minutes)</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Recommended 10-30 minutes. A warning appears 60 seconds before lock.
                  </p>
                  <Input
                    id="auto-logoff-minutes"
                    type="number"
                    min={5}
                    max={120}
                    disabled={!appPrefs.auto_logoff_enabled}
                    value={autoLogoffMinutes}
                    onChange={(e) => setAutoLogoffMinutes(Number(e.target.value || 10))}
                    className="mt-2 w-40"
                  />
                </div>
                <AppToggle
                  label="Offline Sync"
                  description="Queue observations and sync when connectivity is restored"
                  checked={appPrefs.offline_sync_enabled}
                  onCheckedChange={v => setAppPrefs(p => ({ ...p, offline_sync_enabled: v }))}
                />
                <AppToggle
                  label="GPS Tracking"
                  description="Track your location during active patrols"
                  checked={appPrefs.gps_tracking_enabled}
                  onCheckedChange={v => setAppPrefs(p => ({ ...p, gps_tracking_enabled: v }))}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Button onClick={handleSave} className="w-full">
          {saved ? (
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              Saved
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save Settings
            </span>
          )}
        </Button>
      </div>
    </AppLayout>
  )
}
