import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RealtimeChannel } from '@supabase/supabase-js'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { useChatTargetStore, ChatTarget } from '@/stores/chatTargetStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
  Users,
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

type ConversationTarget = ChatTarget

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

interface OfficerContextProps {
  userId: string | null
  title?: string
  organizationId: string | null
}

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
                  <div className="font-semibold">{locationData.zone_name || 'Unknown zone'}</div>
                  <div className="text-xs text-muted-foreground">
                    {locationData.gps_latitude?.toFixed(6)}, {locationData.gps_longitude?.toFixed(6)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last activity: {locationData.last_activity_at ? formatDateTime(locationData.last_activity_at) : 'Unknown'}
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <Activity className="h-3.5 w-3.5 text-green-600" />
                    {locationData.activity_type || 'No recent activity'}
                  </div>
                  {locationData.gps_latitude && locationData.gps_longitude && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        window.open(
                          `https://www.google.com/maps?q=${locationData.gps_latitude},${locationData.gps_longitude}`,
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
  const { organizationId } = useGlobalFiltersStore()
  const { target, setTarget } = useChatTargetStore()
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inspectUserId, setInspectUserId] = useState<string | null>(null)
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)

  const effectiveOrgId = useMemo(
    () => (user?.role === 'master' ? organizationId || null : user?.organization_id || null),
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

  // Keep persisted target in sync with available members (for push-to-talk + chat)
  useEffect(() => {
    if (target.type === 'user') {
      const match = members.find((m) => m.id === target.user.id)
      if (!match) {
        setTarget({ type: 'admin' })
        setInspectUserId(null)
        return
      }
      const changed =
        match.first_name !== target.user.first_name ||
        match.last_name !== target.user.last_name ||
        match.role !== target.user.role ||
        match.organization_id !== target.user.organization_id
      if (changed) {
        setTarget({ type: 'user', user: match })
      }
      setInspectUserId((prev) => prev || match.id)
    } else {
      setInspectUserId(null)
    }
  }, [members, setTarget, target])

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
      return messages.filter((m) => {
        if (m.recipientRole === 'admin') {
          // Show all admin-directed messages, plus admin replies to specific users
          if (user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master') return true
          return m.senderId === user?.id
        }
        return false
      })
    }

    // Direct chat
    const otherId = target.user.id
    return messages.filter(
      (m) =>
        m.recipientRole === 'direct' &&
        ((m.senderId === user?.id && m.recipientId === otherId) ||
          (m.senderId === otherId && m.recipientId === user?.id)),
    )
  }, [messages, target, user?.id, user?.role])

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
                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-xl rounded-lg px-3 py-2 shadow-sm border ${
                        isMine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs opacity-80 mb-1">
                        {!isMine && <strong>{msg.senderName}</strong>}
                        <span>{formatDateTime(msg.createdAt)}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{msg.body}</div>
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

          <div className="p-4 space-y-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
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
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="hidden"
                  aria-hidden
                  value={target.type === 'user' ? target.user.id : 'admin'}
                  readOnly
                />
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
