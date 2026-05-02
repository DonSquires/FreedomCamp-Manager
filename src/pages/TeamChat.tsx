import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Activity,
  AlertTriangle,
  CalendarCheck2,
  ClipboardCheck,
  MapPin,
  MessageSquare,
  Navigation,
  Shield,
  Upload,
  Users,
  Languages,
  Loader2,
} from 'lucide-react'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { formatDateTime } from '@/lib/utils'

interface Participant {
  id: string
  first_name: string
  last_name: string
  role: string
  organization_id: string | null
}

interface ChatMessage {
  id: string
  body: string
  senderId: string
  senderName: string
  senderRole: string
  recipientId: string | null
  recipientRole: 'admin' | 'direct' | null
  orgId: string | null
  createdAt: string
}

interface TranslationResult {
  translated_text: string
  target_language: string
  detected_source?: string | null
  translation_confidence?: number
  confidence_reason?: string
  provider?: string
  fallback?: boolean
}

interface OfficerContextProps {
  userId: string | null
  title?: string
  organizationId: string | null
}

const TRANSLATION_LANGUAGE_OPTIONS = [
  { value: 'en-NZ', label: 'English (NZ)' },
  { value: 'mi-NZ', label: 'Te Reo Maori' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'tl-PH', label: 'Filipino (Tagalog)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'ar-SA', label: 'Arabic' },
] as const

const TEAM_CHAT_TRANSLATION_PREF_KEY = 'team-chat-translation-pref-v1'

function OfficerContextPanel({ userId, title = 'Officer context', organizationId }: OfficerContextProps) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const dayStart = nzDateToUTCStart(today)
  const dayEnd = nzDateToUTCEnd(today)

  // Latest location (reuse live RPC)
  const { data: locationData, isLoading: loadingLocation } = useQuery({
    queryKey: ['support-location', userId, organizationId],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).rpc('get_live_officer_locations', {
        p_organization_id: organizationId,
      }) as any)
      if (error) throw error
      return (data || []).find((row: any) => row.user_id === userId) ?? null
    },
    enabled: !!userId,
    staleTime: 30000,
  })

  // Welfare status (latest alert)
  const { data: welfareData, isLoading: loadingWelfare } = useQuery({
    queryKey: ['support-welfare', userId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('officer_welfare_alerts') as any)
        .select('id, alert_type, triggered_at, resolved_at, notes')
        .eq('officer_id', userId)
        .order('triggered_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return null
      return data
    },
    enabled: !!userId,
  })

  // Today roster
  const { data: roster, isLoading: loadingRoster } = useQuery({
    queryKey: ['support-roster', userId, today],
    queryFn: async () => {
      const { data } = await (supabase.from('roster_shifts') as any)
        .select('id, shift_date, start_time, end_time, status, position_title, service_type, client_site:client_sites(name)')
        .eq('officer_id', userId)
        .eq('shift_date', today)
        .in('status', ['published', 'confirmed', 'in_progress'])
        .order('start_time', { ascending: true })
        .limit(1)
        .maybeSingle()
      return data
    },
    enabled: !!userId,
  })

  // Jobs completed + most recent observation/scan
  const { data: workStats, isLoading: loadingWork } = useQuery({
    queryKey: ['support-work', userId, today],
    queryFn: async () => {
      const [countRes, latestRes] = await Promise.all([
        (supabase.from('observations') as any)
          .select('observation_id', { count: 'exact', head: true })
          .eq('officer_id', userId)
          .gte('recorded_at', dayStart)
          .lte('recorded_at', dayEnd),
        (supabase.from('observations') as any)
          .select('observation_id, recorded_at, plate_number, zone:zones(name)')
          .eq('officer_id', userId)
          .order('recorded_at', { ascending: false })
          .limit(1),
      ])

      return {
        count: countRes.count ?? 0,
        latest: latestRes.data?.[0] ?? null,
      }
    },
    enabled: !!userId,
  })

  if (!userId) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Select a message sender to see their context.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Location */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MapPin className="h-4 w-4 text-primary" />
            Live location
          </div>
          <Card className="bg-muted">
            <CardContent className="p-3 text-sm">
              {loadingLocation ? (
                <span className="text-muted-foreground">Loading latest location…</span>
              ) : locationData ? (
                <div className="space-y-1">
                  <div className="font-semibold">{locationData.last_scan_zone || 'Unknown location'}</div>
                  <div className="text-xs text-muted-foreground">
                    {locationData.last_gps_latitude?.toFixed(6)}, {locationData.last_gps_longitude?.toFixed(6)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last GPS update: {locationData.last_gps_update ? formatDateTime(locationData.last_gps_update) : 'Unknown'}
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <Activity className="h-3.5 w-3.5 text-green-600" />
                    {locationData.recent_scans ? `${locationData.recent_scans} scan${locationData.recent_scans === 1 ? '' : 's'} today` : 'No recent activity'}
                  </div>
                  {locationData.last_gps_latitude && locationData.last_gps_longitude && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        window.open(
                          `https://www.google.com/maps?q=${locationData.last_gps_latitude},${locationData.last_gps_longitude}`,
                          '_blank'
                        )
                      }}
                    >
                      <Navigation className="h-4 w-4 mr-2" />
                      Open in Maps
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">No recent GPS updates</span>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Welfare */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Shield className="h-4 w-4 text-primary" />
            Welfare status
          </div>
          <Card className="bg-muted">
            <CardContent className="p-3 text-sm">
              {loadingWelfare ? (
                <span className="text-muted-foreground">Loading welfare status…</span>
              ) : welfareData ? (
                <div className="space-y-1">
                  <Badge variant={welfareData.resolved_at ? 'outline' : 'destructive'} className="capitalize">
                    {welfareData.alert_type.replace(/_/g, ' ')}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    Triggered: {formatDateTime(welfareData.triggered_at)}
                  </div>
                  {welfareData.resolved_at && (
                    <div className="text-xs text-muted-foreground">
                      Resolved: {formatDateTime(welfareData.resolved_at)}
                    </div>
                  )}
                  {welfareData.notes && (
                    <div className="text-xs text-muted-foreground">Notes: {welfareData.notes}</div>
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground">No active welfare alerts</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Roster */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarCheck2 className="h-4 w-4 text-primary" />
            Current roster
          </div>
          <Card className="bg-muted">
            <CardContent className="p-3 text-sm">
              {loadingRoster ? (
                <span className="text-muted-foreground">Loading roster…</span>
              ) : roster ? (
                <div className="space-y-1">
                  <div className="font-semibold">{roster.position_title || 'On shift'}</div>
                  <div className="text-xs text-muted-foreground">
                    {roster.service_type || 'General duty'} — {roster.status}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {roster.start_time || 'N/A'} → {roster.end_time || 'N/A'}
                  </div>
                  {roster.client_site?.name && (
                    <div className="text-xs text-muted-foreground">Site: {roster.client_site.name}</div>
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground">No rostered shift today</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Work */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Jobs & scans
          </div>
          <Card className="bg-muted">
            <CardContent className="p-3 text-sm">
              {loadingWork ? (
                <span className="text-muted-foreground">Loading activity…</span>
              ) : (
                <div className="space-y-2">
                  <div className="text-lg font-bold">{workStats?.count ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Jobs completed today</div>
                  <Separator className="my-2" />
                  {workStats?.latest ? (
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Most recent</div>
                      <div className="font-semibold">
                        Plate {workStats.latest.plate_number || 'Unknown'}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Activity className="h-3.5 w-3.5" />
                        {formatDateTime(workStats.latest.recorded_at)}
                      </div>
                      {workStats.latest.zone?.name && (
                        <div className="text-xs text-muted-foreground">Zone: {workStats.latest.zone.name}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm">No scans recorded today</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

export default function TeamChat() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { organizationId } = useGlobalFiltersStore()
  // Chat target is managed locally — PTT radio is a completely separate system
  type LocalTarget = { type: 'admin' } | { type: 'user'; user: Participant }
  const [target, setTarget] = useState<LocalTarget>({ type: 'admin' })
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inspectUserId, setInspectUserId] = useState<string | null>(null)
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const [translationTarget, setTranslationTarget] = useState<string>('en-NZ')
  const [autoTranslateIncoming, setAutoTranslateIncoming] = useState<boolean>(false)
  const [translationPrefsHydrated, setTranslationPrefsHydrated] = useState(false)
  const [translatedById, setTranslatedById] = useState<Record<string, TranslationResult>>({})
  const [draftTranslationMeta, setDraftTranslationMeta] = useState<TranslationResult | null>(null)
  const [isTranslatingDraft, setIsTranslatingDraft] = useState(false)
  const [translatingMessageIds, setTranslatingMessageIds] = useState<Record<string, boolean>>({})
  const targetUserRef = useRef<Participant | null>(null)

  const effectiveOrgId = useMemo(
    () =>
      user?.role === 'master' || user?.role === 'grand_master'
        ? organizationId || user?.organization_id || null
        : user?.organization_id || null,
    [organizationId, user?.organization_id, user?.role],
  )

  // Fetch members within org for direct chats
  const { data: members = [] } = useQuery<Participant[]>({
    queryKey: ['team-chat-members', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('user_profiles') as any)
        .select('id, first_name, last_name, role, organization_id')
        .eq('is_active', true)
        .eq('organization_id', effectiveOrgId)
        .order('first_name')
      if (error) throw error
      return (data || []) as Participant[]
    },
    enabled: !!effectiveOrgId,
  })

  const safetyScopedOrgIds = useMemo(() => {
    if (!user) return [] as string[]
    const ids = [user.organization_id, ...(user.extra_organization_ids || []), ...(user.authorized_work_locations || [])]
    return Array.from(new Set(ids.filter(Boolean) as string[]))
  }, [user])

  const { data: systemMessages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['team-chat-system-messages', user?.id, user?.role, safetyScopedOrgIds],
    enabled: !!user,
    staleTime: 20_000,
    refetchInterval: 45_000,
    queryFn: async () => {
      if (!user) return []

      const now = new Date().toISOString()
      const [alertsRes, acksRes] = await Promise.all([
        ((supabase as any).from('public_safety_alerts') as any)
          .select('id, title, message, scope, severity, target_organization_ids, created_at')
          .eq('status', 'active')
          .lte('starts_at', now)
          .or(`expires_at.is.null,expires_at.gte.${now}`),
        ((supabase as any).from('public_safety_alert_acknowledgements') as any)
          .select('alert_id')
          .eq('user_id', user.id),
      ])

      if (alertsRes.error) throw alertsRes.error
      if (acksRes.error) throw acksRes.error

      const acked = new Set(((acksRes.data || []) as any[]).map((row) => row.alert_id))
      const alertMessages: ChatMessage[] = ((alertsRes.data || []) as any[])
        .filter((row) => {
          if (acked.has(row.id)) return false
          if (row.scope === 'national') return true
          const targets = Array.isArray(row.target_organization_ids) ? row.target_organization_ids : []
          return targets.some((id: string) => safetyScopedOrgIds.includes(id))
        })
        .map((row) => ({
          id: `system-alert-${row.id}`,
          body: `[${String(row.severity || '').toUpperCase()}] ${row.title}\n${row.message}\nAcknowledge this alert from the banner above to clear it.`,
          senderId: 'system',
          senderName: 'System Safety Feed',
          senderRole: 'system',
          recipientId: null,
          recipientRole: 'admin',
          orgId: effectiveOrgId,
          createdAt: row.created_at || now,
        }))

      const isApprover = user.role === 'master' || user.role === 'grand_master'
      if (!isApprover) {
        return alertMessages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      }

      const [pendingBulletinsRes, pendingAlertsRes] = await Promise.all([
        ((supabase as any).from('external_intel_bulletins') as any)
          .select('id, title, created_at')
          .eq('approval_status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5),
        ((supabase as any).from('public_safety_alerts') as any)
          .select('id, title, severity, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (pendingBulletinsRes.error) throw pendingBulletinsRes.error
      if (pendingAlertsRes.error) throw pendingAlertsRes.error

      const approvalMessages: ChatMessage[] = [
        ...((pendingBulletinsRes.data || []) as any[]).map((row) => ({
          id: `system-pending-bulletin-${row.id}`,
          body: `Approval needed: external intelligence bulletin "${row.title}" is pending review in Intel Approvals.`,
          senderId: 'system',
          senderName: 'System Approval Queue',
          senderRole: 'system',
          recipientId: null,
          recipientRole: 'admin' as const,
          orgId: effectiveOrgId,
          createdAt: row.created_at || now,
        })),
        ...((pendingAlertsRes.data || []) as any[]).map((row) => ({
          id: `system-pending-alert-${row.id}`,
          body: `Approval needed: ${String(row.severity || '').toUpperCase()} safety alert "${row.title}" is pending activation.`,
          senderId: 'system',
          senderName: 'System Approval Queue',
          senderRole: 'system',
          recipientId: null,
          recipientRole: 'admin' as const,
          orgId: effectiveOrgId,
          createdAt: row.created_at || now,
        })),
      ]

      return [...alertMessages, ...approvalMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
  })

  const combinedMessages = useMemo(() => {
    const merged = [...messages, ...systemMessages]
    const byId = new Map<string, ChatMessage>()
    for (const msg of merged) byId.set(msg.id, msg)
    return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [messages, systemMessages])

  // Keep local target in sync with available members
  useEffect(() => {
    targetUserRef.current = target.type === 'user' ? target.user : null
    setInspectUserId(target.type === 'user' ? target.user.id : null)
  }, [target])

  useEffect(() => {
    const current = targetUserRef.current
    if (!current) return
    const match = members.find((m) => m.id === current.id)
    if (!match) {
      setTarget({ type: 'admin' })
      setInspectUserId(null)
      return
    }
    const changed =
      match.first_name !== current.first_name ||
      match.last_name !== current.last_name ||
      match.role !== current.role ||
      match.organization_id !== current.organization_id
    if (changed) {
      setTarget({ type: 'user', user: match })
    }
  }, [members, setTarget])

  // Real-time channel for org chat (broadcast only, no persistence)
  useEffect(() => {
    if (!effectiveOrgId || !user?.id) return

    const ch = supabase.channel(`org-chat-${effectiveOrgId}`, {
      config: { broadcast: { self: true } },
    })

    ch.on('broadcast', { event: 'message' }, (payload) => {
      const msg = payload.payload as ChatMessage
      if (!msg?.id) return
      // Scope to org to avoid crosstalk
      if (msg.orgId && msg.orgId !== effectiveOrgId) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      })
    })

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') setChannel(ch)
    })

    return () => {
      supabase.removeChannel(ch)
      setChannel(null)
    }
  }, [effectiveOrgId, user?.id])

  const currentConversationLabel =
    target.type === 'admin'
      ? 'Admin support'
      : `${target.user.first_name} ${target.user.last_name}`

  const filteredMessages = useMemo(() => {
    if (target.type === 'admin') {
      return combinedMessages.filter((m) => {
        if (m.senderRole === 'system') return true
        if (m.recipientRole === 'admin') {
          // Show all admin-directed messages, plus admin replies to specific users
          if (user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master' || user?.role === 'grand_master') return true
          return m.senderId === user?.id
        }
        return false
      })
    }

    // Direct chat
    const otherId = target.user.id
    return combinedMessages.filter(
      (m) =>
        m.recipientRole === 'direct' &&
        ((m.senderId === user?.id && m.recipientId === otherId) ||
          (m.senderId === otherId && m.recipientId === user?.id)),
    )
  }, [combinedMessages, target, user?.id, user?.role])

  useEffect(() => {
    let cancelled = false
    setTranslationPrefsHydrated(false)

    const hydratePrefs = async () => {
      // App default for NZ-only rollout.
      let nextTargetLanguage = 'en-NZ'
      let nextAutoTranslateIncoming = false

      // Device-local fallback for first paint/offline.
      try {
        const raw = localStorage.getItem(TEAM_CHAT_TRANSLATION_PREF_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.targetLanguage === 'string' && parsed.targetLanguage.trim()) {
            nextTargetLanguage = parsed.targetLanguage.trim()
          }
          if (typeof parsed?.autoTranslateIncoming === 'boolean') {
            nextAutoTranslateIncoming = parsed.autoTranslateIncoming
          }
        }
      } catch {
        // Ignore malformed local preference payloads.
      }

      if (!cancelled) {
        setTranslationTarget(nextTargetLanguage)
        setAutoTranslateIncoming(nextAutoTranslateIncoming)
      }

      if (!user?.id) {
        if (!cancelled) setTranslationPrefsHydrated(true)
        return
      }

      // User-scoped preference (not organization-scoped).
      const { data, error } = await (supabase.from('user_profiles') as any)
        .select('notification_preferences')
        .eq('id', user.id)
        .single()

      if (!cancelled && !error) {
        const prefs = (data?.notification_preferences as Record<string, any> | null) ?? {}
        const translation = (prefs.translation as Record<string, any> | undefined) ?? {}

        const dbTargetLanguage = typeof translation.target_language === 'string' ? translation.target_language.trim() : ''
        const dbAutoTranslate = typeof translation.auto_translate_incoming === 'boolean'
          ? translation.auto_translate_incoming
          : null

        if (dbTargetLanguage) {
          setTranslationTarget(dbTargetLanguage)
        }
        if (dbAutoTranslate !== null) {
          setAutoTranslateIncoming(dbAutoTranslate)
        }
      }

      if (!cancelled) setTranslationPrefsHydrated(true)
    }

    void hydratePrefs()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!translationPrefsHydrated) return

    try {
      localStorage.setItem(
        TEAM_CHAT_TRANSLATION_PREF_KEY,
        JSON.stringify({
          targetLanguage: translationTarget,
          autoTranslateIncoming,
        }),
      )
    } catch {
      // Ignore storage write errors.
    }

    if (!user?.id) return

    const timer = setTimeout(async () => {
      const { data } = await (supabase.from('user_profiles') as any)
        .select('notification_preferences')
        .eq('id', user.id)
        .single()

      const currentPrefs = (data?.notification_preferences as Record<string, any> | null) ?? {}
      const nextPrefs = {
        ...currentPrefs,
        translation: {
          ...(currentPrefs.translation || {}),
          target_language: translationTarget,
          auto_translate_incoming: autoTranslateIncoming,
          primary_language: 'en-NZ',
          region: 'NZ',
        },
      }

      await (supabase.from('user_profiles') as any)
        .update({ notification_preferences: nextPrefs } as never)
        .eq('id', user.id)
    }, 350)

    return () => clearTimeout(timer)
  }, [user?.id, translationTarget, autoTranslateIncoming, translationPrefsHydrated])

  const translateText = useCallback(async (text: string, targetLanguage: string): Promise<TranslationResult> => {
    const { data, error } = await edgeFunctions.translateMessage({
      text,
      target_language: targetLanguage,
    })

    if (error || !data) {
      throw new Error('Translation unavailable right now')
    }

    const translated = String((data as any)?.translated_text || '').trim()
    if (!translated) {
      throw new Error('Translation returned an empty response')
    }

    return {
      translated_text: translated,
      target_language: String((data as any)?.target_language || targetLanguage),
      detected_source: typeof (data as any)?.detected_source === 'string' ? (data as any).detected_source : null,
      translation_confidence: typeof (data as any)?.translation_confidence === 'number' ? (data as any).translation_confidence : undefined,
      confidence_reason: typeof (data as any)?.confidence_reason === 'string' ? (data as any).confidence_reason : undefined,
      provider: typeof (data as any)?.provider === 'string' ? (data as any).provider : undefined,
      fallback: (data as any)?.fallback === true,
    }
  }, [])

  const translateDraft = async () => {
    const draft = message.trim()
    if (!draft) return
    setIsTranslatingDraft(true)
    try {
      const translated = await translateText(draft, translationTarget)
      setMessage(translated.translated_text)
      setDraftTranslationMeta(translated)
    } catch (err: any) {
      console.error('Draft translation failed:', err)
    } finally {
      setIsTranslatingDraft(false)
    }
  }

  const translateIncomingMessage = useCallback(async (msg: ChatMessage) => {
    if (!msg.body?.trim()) return
    if (translatedById[msg.id]) return

    setTranslatingMessageIds((prev) => ({ ...prev, [msg.id]: true }))
    try {
      const translated = await translateText(msg.body, translationTarget)
      setTranslatedById((prev) => ({ ...prev, [msg.id]: translated }))
    } catch (err: any) {
      console.error('Incoming message translation failed:', err)
    } finally {
      setTranslatingMessageIds((prev) => {
        const next = { ...prev }
        delete next[msg.id]
        return next
      })
    }
  }, [translateText, translatedById, translationTarget])

  useEffect(() => {
    if (!autoTranslateIncoming) return
    const next = filteredMessages.find(
      (msg) =>
        msg.senderId !== user?.id &&
        msg.senderRole !== 'system' &&
        !!msg.body?.trim() &&
        !translatedById[msg.id] &&
        !translatingMessageIds[msg.id],
    )

    if (!next) return
    void translateIncomingMessage(next)
  }, [
    autoTranslateIncoming,
    filteredMessages,
    translatedById,
    translatingMessageIds,
    translateIncomingMessage,
    user?.id,
  ])

  const sendMessage = async () => {
    if (!message.trim() || !user) return
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      body: message.trim(),
      senderId: user.id,
      senderName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User',
      senderRole: user.role,
      recipientId: target.type === 'user' ? target.user.id : null,
      recipientRole: target.type === 'admin' ? 'admin' : 'direct',
      orgId: effectiveOrgId,
      createdAt: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, msg])
    setMessage('')

    if (channel) {
      await channel.send({ type: 'broadcast', event: 'message', payload: msg })
    }
  }

  return (
    <AppLayout
      title="Team Chat"
      description="Message your organisation and quickly open a live support view for the sender. Your selected contact is remembered for push-to-talk."
    >
      <GlobalFilterRibbon />

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_360px] gap-4">
        {/* Conversation list */}
        <Card className="h-[calc(100vh-200px)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              Conversations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant={target.type === 'admin' ? 'default' : 'outline'}
              className="w-full justify-start"
              onClick={() => {
                setTarget({ type: 'admin' })
                setInspectUserId(null)
              }}
            >
              <Shield className="h-4 w-4 mr-2" />
              Admin Support
            </Button>

            <Separator />

            <div className="text-xs uppercase text-muted-foreground tracking-wide">Team</div>
            <ScrollArea className="h-[calc(100vh-340px)]">
              <div className="space-y-2">
                {members.map((member) => (
                  <Button
                    key={member.id}
                    variant={target.type === 'user' && target.user.id === member.id ? 'default' : 'ghost'}
                    className="w-full justify-start text-left"
                    onClick={() => {
                      setTarget({ type: 'user', user: member })
                      setInspectUserId(member.id)
                    }}
                  >
                    <Users className="h-4 w-4 mr-2" />
                    <div className="flex flex-col items-start">
                      <span className="font-medium">
                        {member.first_name} {member.last_name}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat window */}
        <Card className="h-[calc(100vh-200px)] flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">{currentConversationLabel}</CardTitle>
              <div className="text-xs text-muted-foreground">
                Messages stay in your organisation. Admin can pop open a live context view from any message.
              </div>
            </div>
            {target.type === 'user' && (
              <Button size="sm" variant="outline" onClick={() => setInspectUserId(target.user.id)}>
                <ClipboardCheck className="h-4 w-4 mr-2" />
                View context
              </Button>
            )}
          </CardHeader>

          <Separator />

          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-3">
              {filteredMessages.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">
                  No messages yet. Say kia ora to start the conversation.
                </div>
              )}

              {filteredMessages.map((msg) => {
                const isMine = msg.senderId === user?.id
                const isSystem = msg.senderRole === 'system'
                const translatedMeta = translatedById[msg.id]
                const translatedBody = translatedMeta?.translated_text
                const isTranslatingMessage = !!translatingMessageIds[msg.id]
                const translationLowConfidence = (translatedMeta?.translation_confidence ?? 1) < 0.7 || translatedMeta?.fallback === true
                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-xl rounded-lg px-3 py-2 shadow-sm border ${
                        isSystem ? 'bg-amber-50 border-amber-200 text-amber-950' : isMine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs opacity-80 mb-1">
                        {!isMine && <strong>{msg.senderName}</strong>}
                        <span>{formatDateTime(msg.createdAt)}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{msg.body}</div>
                      {translatedBody && (
                        <div className={`mt-2 rounded-md border p-2 text-xs whitespace-pre-wrap ${translationLowConfidence ? 'border-amber-300/50 bg-amber-50 text-amber-950' : 'border-emerald-300/40 bg-emerald-50/80 text-emerald-950'}`}>
                          <div>{translatedBody}</div>
                          {(translatedMeta?.confidence_reason || translatedMeta?.detected_source || translatedMeta?.translation_confidence != null) && (
                            <div className="mt-1 text-[10px] opacity-80">
                              {translatedMeta?.translation_confidence != null ? `Confidence ${(translatedMeta.translation_confidence * 100).toFixed(0)}%` : 'Confidence unknown'}
                              {translatedMeta?.detected_source ? ` · Source ${translatedMeta.detected_source}` : ''}
                              {translatedMeta?.confidence_reason ? ` · ${translatedMeta.confidence_reason}` : ''}
                            </div>
                          )}
                        </div>
                      )}
                      {!isMine && !isSystem && (
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => translateIncomingMessage(msg)}
                            disabled={isTranslatingMessage}
                          >
                            {isTranslatingMessage ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Languages className="h-3.5 w-3.5 mr-1" />}
                            {translatedBody ? 'Refresh translation' : 'Translate'}
                          </Button>
                        </div>
                      )}
                      {!isMine && target.type === 'admin' && (user?.role === 'admin' || user?.role === 'master' || user?.role === 'admin_officer') && (
                        <div className="mt-2">
                          <Button size="sm" variant="secondary" onClick={() => setInspectUserId(msg.senderId)}>
                            <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                            Open sender context
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>

          <Separator />

          {/* Push-to-Talk lives on the /radio page — click Radio in nav */}

          <div className="p-4 space-y-2">
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">Translator</div>
                <div className="flex items-center gap-2">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={translationTarget} onValueChange={setTranslationTarget}>
                    <SelectTrigger className="h-8 w-[170px]">
                      <SelectValue placeholder="Target language" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSLATION_LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded border bg-background/70 px-2 py-1.5">
                <div className="text-xs text-muted-foreground">Auto-translate incoming</div>
                <Switch checked={autoTranslateIncoming} onCheckedChange={setAutoTranslateIncoming} />
              </div>
              <div className="text-xs text-muted-foreground">
                Translate draft text before sending or translate incoming messages inline.
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Bob document helper</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTarget({ type: 'admin' })
                    setMessage('Please help me upload a document. Tell me the accepted formats and where this file should go.')
                  }}
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Ask upload guidance
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/import-data')}
                >
                  Open Import Data
                </Button>
                {(user?.role === 'master' || user?.role === 'grand_master') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/intel-approvals')}
                  >
                    Open Intel Approvals
                  </Button>
                )}
              </div>
            </div>

            <Textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value)
                setDraftTranslationMeta(null)
              }}
              placeholder={
                target.type === 'admin'
                  ? 'Message the admin team…'
                  : `Message ${target.user.first_name}…`
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
            />
            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Realtime chat is scoped to your organisation. Messages are broadcast and not persisted.
                {draftTranslationMeta && ((draftTranslationMeta.translation_confidence ?? 1) < 0.7 || draftTranslationMeta.fallback) && (
                  <span className="ml-2 text-amber-700">Draft translation may need human review.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={translateDraft} disabled={!message.trim() || isTranslatingDraft} variant="outline">
                  {isTranslatingDraft ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Languages className="h-4 w-4 mr-1" />}
                  Translate Draft
                </Button>
                <Button onClick={sendMessage} disabled={!message.trim()}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Context panel */}
        <OfficerContextPanel userId={inspectUserId} organizationId={effectiveOrgId} />
      </div>
    </AppLayout>
  )
}
