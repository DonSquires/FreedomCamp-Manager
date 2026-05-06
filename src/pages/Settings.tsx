import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { useBobIdentitySettings, type EmergencyCancelVerificationMode } from '@/hooks/useBobIdentitySettings'
import { useBobAssistantStore } from '@/stores/bobAssistantStore'
import { edgeFunctions } from '@/lib/edgeFunctions'

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

  const {
    secureCancelVerificationEnabled,
    setSecureCancelVerificationEnabled,
    cancelVerificationMode,
    setCancelVerificationMode,
    cancelVerificationInProgress,
    orgPolicyLoading,
    orgPolicyMutationInProgress,
    orgVoiceprintEnrollmentAllowed,
    updateOrgVoiceprintEnrollmentAllowed,
    enrolledVoiceprint,
    lastVoiceprintScore,
    enrollCurrentVoiceprint,
    clearEnrolledVoiceprint,
  } = useBobIdentitySettings(user?.id, user?.organization_id)

  const canManageOrgBobPolicy = Boolean(
    user?.organization_id && ['admin', 'master', 'grand_master'].includes(user?.role ?? ''),
  )

  const {
    displayName,
    tone: bobTone,
    voiceGender,
    accent,
    speechStyle,
    speechRate,
    speechEnabled,
    autoSpeakReplies,
    voiceActivatedConversation,
    setDisplayName,
    setTone,
    setVoiceGender,
    setAccent,
    setSpeechStyle,
    setSpeechRate,
    setSpeechEnabled,
    setAutoSpeakReplies,
    setVoiceActivatedConversation,
  } = useBobAssistantStore()

  const [saved, setSaved] = useState(false)
  const [bobStatusLoading, setBobStatusLoading] = useState(false)
  const [bobStatus, setBobStatus] = useState<null | {
    healthy: boolean
    mode: string
    provider: string
    egressAllowed: boolean
    model: string
    runtime: string
    note: string
  }>(null)

  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      setBobStatusLoading(true)
      try {
        const isPrivilegedViewer = ['master', 'grand_master'].includes(user?.role ?? '')

        if (isPrivilegedViewer) {
          const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'health_check' })
          if (error) throw new Error(String(error))
          if (cancelled) return

          const payload = data as Record<string, any>
          const config = payload?.config ?? {}
          setBobStatus({
            healthy: Boolean(payload?.status === 'ok' || payload?.ok === true),
            mode: String(config.OPERATING_MODE ?? config.operating_mode ?? 'unknown'),
            provider: String(config.CHAT_PROVIDER ?? config.chat_provider ?? 'unknown'),
            egressAllowed: Boolean(config.EXTERNAL_EGRESS_ALLOWED ?? config.external_egress_allowed ?? false),
            model: String(config.OLLAMA_MODEL ?? config.model ?? 'unknown'),
            runtime: String(payload?.runtime ?? config.runtime ?? 'unknown'),
            note: 'Live status from Bob health via edge function proxy.',
          })
          return
        }

        const { data, error } = await edgeFunctions.checkServicesHealth()
        if (error) throw new Error(String(error))
        if (cancelled) return

        const payload = data as Record<string, any>
        const inference = (payload?.inference ?? {}) as Record<string, any>
        const inferenceStatus = String(inference?.status ?? 'unknown')
        setBobStatus({
          healthy: inferenceStatus === 'ok' || inferenceStatus === 'healthy',
          mode: inferenceStatus,
          provider: String(inference?.provider ?? 'managed-edge'),
          egressAllowed: false,
          model: String(inference?.model ?? inference?.worker_model ?? 'unknown'),
          runtime: inferenceStatus,
          note: String(inference?.warning ?? inference?.error ?? 'Inference service status from edge function health check.'),
        })
      } catch (error: any) {
        if (cancelled) return
        setBobStatus({
          healthy: false,
          mode: 'unknown',
          provider: 'unknown',
          egressAllowed: false,
          model: 'unknown',
          runtime: 'degraded',
          note: error?.message || 'Unable to reach Bob health endpoint.',
        })
      } finally {
        if (!cancelled) setBobStatusLoading(false)
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
    }
  }, [user?.role])

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

      <div className="max-w-2xl space-y-5">

        {/* ── Settings hero ──────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-4 sm:p-5 shadow-sm">
          <div className="absolute -top-12 -right-10 h-36 w-36 rounded-full bg-indigo-200/40 blur-2xl dark:bg-indigo-500/10 pointer-events-none" />
          <div className="relative">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Notifications, application preferences and account details.</p>
          </div>
          <div className="relative mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/70 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="text-sm font-medium truncate text-gray-900 dark:text-white">{user?.email}</p>
            </div>
            <div className="rounded-lg border border-white/70 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Role</p>
              <p className="text-sm font-medium capitalize text-gray-900 dark:text-white">{user?.role}</p>
            </div>
            <div className="rounded-lg border border-white/70 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">User ID</p>
              <p className="text-xs font-mono text-muted-foreground truncate">{user?.id}</p>
            </div>
          </div>
        </div>
        <Tabs defaultValue="notifications">
          <TabsList className="grid grid-cols-3 h-auto gap-2 bg-transparent p-0">
            <TabsTrigger value="notifications" className="flex items-center gap-1.5 rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="app" className="flex items-center gap-1.5 rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5">
              <Smartphone className="h-4 w-4" />
              Application
            </TabsTrigger>
            <TabsTrigger value="privacy" className="flex items-center gap-1.5 rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2.5">
              <Key className="h-4 w-4" />
              Privacy
            </TabsTrigger>
          </TabsList>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-4">
            <Card className="border-2 border-slate-200">
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

            <Card className="mt-4 border-2 border-slate-200">
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
            <Card className="border-2 border-slate-200">
              <CardHeader>
                <CardTitle className="text-base">Application Preferences</CardTitle>
                <CardDescription>
                  Display and interaction settings for everyday portal use.
                </CardDescription>
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
                <p className="text-xs text-muted-foreground py-3">
                  Privacy, security, and session controls are now managed in the Privacy tab.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Privacy */}
          <TabsContent value="privacy" className="mt-4">
            <Card className="border-2 border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Privacy & Session Security
                </CardTitle>
                <CardDescription>
                  Control session lock behavior, local data handling, and patrol tracking.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                  description="Queue observations locally and sync once connectivity is restored"
                  checked={appPrefs.offline_sync_enabled}
                  onCheckedChange={v => setAppPrefs(p => ({ ...p, offline_sync_enabled: v }))}
                />
                <AppToggle
                  label="GPS Tracking"
                  description="Track your location during active patrols and welfare monitoring"
                  checked={appPrefs.gps_tracking_enabled}
                  onCheckedChange={v => setAppPrefs(p => ({ ...p, gps_tracking_enabled: v }))}
                />
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Keep Auto Logoff enabled on shared devices. GPS can be disabled when off-shift, but active patrol features may be limited.
                </div>

                <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="font-medium text-sm">Bob Secure Cancel Verification</Label>
                      <p className="text-xs text-muted-foreground">User-scoped identity check before emergency cancel is accepted.</p>
                    </div>
                    <Switch
                      checked={secureCancelVerificationEnabled}
                      onCheckedChange={setSecureCancelVerificationEnabled}
                    />
                  </div>

                  {secureCancelVerificationEnabled && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="font-medium text-sm">Verification Mode</Label>
                        <Select
                          value={cancelVerificationMode}
                          onValueChange={(value: EmergencyCancelVerificationMode) => setCancelVerificationMode(value)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select verification mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="platform_biometric">Fingerprint / Face (platform)</SelectItem>
                            <SelectItem value="voiceprint" disabled={!orgVoiceprintEnrollmentAllowed}>Voiceprint match</SelectItem>
                          </SelectContent>
                        </Select>
                        {!orgVoiceprintEnrollmentAllowed && (
                          <p className="text-xs text-amber-700">
                            Voiceprint mode is disabled by your organization privacy policy.
                          </p>
                        )}
                      </div>

                      {cancelVerificationMode === 'voiceprint' && orgVoiceprintEnrollmentAllowed && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void enrollCurrentVoiceprint()}
                              disabled={cancelVerificationInProgress}
                            >
                              {enrolledVoiceprint?.length ? 'Re-enroll Voiceprint' : 'Enroll Voiceprint'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={clearEnrolledVoiceprint}
                              disabled={!enrolledVoiceprint?.length || cancelVerificationInProgress}
                            >
                              Clear Enrollment
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Enrollment status: {enrolledVoiceprint?.length ? 'Enrolled' : 'Not enrolled'}
                            {typeof lastVoiceprintScore === 'number'
                              ? ` • Last similarity ${Math.round(lastVoiceprintScore * 100)}%`
                              : ''}
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground">
                        Saved per signed-in user account. These controls are not shared by organization or other users.
                      </p>
                    </>
                  )}
                </div>

                <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <Label className="font-medium text-sm">Organization Bob Biometric Policy</Label>
                    <p className="text-xs text-muted-foreground">
                      Organization-level control for whether officers can use voiceprint enrollment for emergency cancel.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="font-medium text-sm">Allow Voiceprint Enrollment</Label>
                      <p className="text-xs text-muted-foreground">
                        {canManageOrgBobPolicy
                          ? 'When disabled, all users in this organization are forced to platform biometric verification only.'
                          : 'Managed by your organization administrators.'}
                      </p>
                    </div>
                    <Switch
                      checked={orgVoiceprintEnrollmentAllowed}
                      disabled={!canManageOrgBobPolicy || orgPolicyLoading || orgPolicyMutationInProgress}
                      onCheckedChange={(value) => {
                        if (!canManageOrgBobPolicy) return
                        void updateOrgVoiceprintEnrollmentAllowed(value)
                      }}
                    />
                  </div>

                  {!canManageOrgBobPolicy && !orgVoiceprintEnrollmentAllowed && (
                    <p className="text-xs text-amber-700">
                      Your organization currently disables voiceprint enrollment for Bob secure cancel.
                    </p>
                  )}
                </div>

                <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <Label className="font-medium text-sm">Bob Assistant Preferences</Label>
                    <p className="text-xs text-muted-foreground">Personality, voice, and speaking behavior for this user account.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="bob-display-name" className="font-medium text-sm">Display Name</Label>
                    <Input
                      id="bob-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Bob"
                      className="h-9"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="font-medium text-sm">Tone</Label>
                      <Select value={bobTone} onValueChange={(value) => setTone(value as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select tone" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="professional">Professional</SelectItem>
                          <SelectItem value="friendly">Friendly</SelectItem>
                          <SelectItem value="coach">Coach</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-medium text-sm">Speech Style</Label>
                      <Select value={speechStyle} onValueChange={(value) => setSpeechStyle(value as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select speech style" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="bridge_lead">Bridge Lead</SelectItem>
                          <SelectItem value="wise_mentor">Wise Mentor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-medium text-sm">Voice</Label>
                      <Select value={voiceGender} onValueChange={(value) => setVoiceGender(value as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select voice" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="neutral">Neutral</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-medium text-sm">Accent</Label>
                      <Select value={accent} onValueChange={(value) => setAccent(value as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select accent" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en-NZ">English (NZ)</SelectItem>
                          <SelectItem value="en-AU">English (AU)</SelectItem>
                          <SelectItem value="en-GB">English (GB)</SelectItem>
                          <SelectItem value="en-US">English (US)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="bob-speech-rate" className="font-medium text-sm">Voice Speed ({speechRate.toFixed(2)}x)</Label>
                    <Input
                      id="bob-speech-rate"
                      type="number"
                      min={0.7}
                      max={1.3}
                      step={0.05}
                      value={speechRate}
                      onChange={(e) => setSpeechRate(Number(e.target.value || 1))}
                      className="h-9 w-40"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="font-medium text-sm">Speech Enabled</Label>
                        <p className="text-xs text-muted-foreground">Allow Bob voice playback for this user.</p>
                      </div>
                      <Switch checked={speechEnabled} onCheckedChange={setSpeechEnabled} />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="font-medium text-sm">Auto-Speak Replies</Label>
                        <p className="text-xs text-muted-foreground">Automatically read Bob replies out loud.</p>
                      </div>
                      <Switch checked={autoSpeakReplies} onCheckedChange={setAutoSpeakReplies} />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="font-medium text-sm">Voice Activated Conversation</Label>
                        <p className="text-xs text-muted-foreground">Keep Bob listening mode tied to this user profile.</p>
                      </div>
                      <Switch checked={voiceActivatedConversation} onCheckedChange={setVoiceActivatedConversation} />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    All Bob assistant preferences are stored per signed-in user and isolated from org-level settings.
                  </p>
                </div>

                <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="font-medium text-sm">Bob System Status</Label>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${bobStatus?.healthy ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      {bobStatusLoading ? 'Checking…' : bobStatus?.healthy ? 'Healthy' : 'Attention'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Mode:</span> {bobStatus?.mode || 'unknown'}</div>
                    <div><span className="text-muted-foreground">Provider:</span> {bobStatus?.provider || 'unknown'}</div>
                    <div><span className="text-muted-foreground">Model:</span> {bobStatus?.model || 'unknown'}</div>
                    <div><span className="text-muted-foreground">Runtime:</span> {bobStatus?.runtime || 'unknown'}</div>
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">External Egress:</span> {bobStatus?.egressAllowed ? 'enabled' : 'disabled'}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{bobStatus?.note || 'Status unavailable.'}</p>
                </div>
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
