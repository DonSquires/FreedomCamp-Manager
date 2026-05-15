import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import CameraCapture from '@/components/CameraCapture'
import { parseBobCommand, processEvidenceCapture } from '@/services/bobIntentParser'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  ArrowRight,
  BrainCircuit,
  Building2,
  Clock3,
  MessageSquare,
  PanelLeft,
  Plus,
  Radio,
  Send,
  Shield,
  SquarePen,
  Users,
  Waves,
  Camera,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

type ChatMode = 'bob' | 'team'

type Participant = {
  id: string
  first_name: string
  last_name: string
  role: string
  organization_id: string | null
}

type TeamTarget =
  | { type: 'admin' }
  | { type: 'user'; user: Participant }

type ChatThreadMessage = {
  id: string
  body: string
  senderId: string
  senderName: string
  senderRole: 'system' | string
  recipientId: string | null
  recipientRole: 'admin' | 'direct' | 'bob'
  orgId: string | null
  createdAt: string
  channel: ChatMode
}

function createId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeMessage(params: Omit<ChatThreadMessage, 'id' | 'createdAt'> & { createdAt?: string }): ChatThreadMessage {
  return {
    ...params,
    id: createId(),
    createdAt: params.createdAt ?? new Date().toISOString(),
  }
}

function buildBobHistory(messages: ChatThreadMessage[]) {
  return messages.map((message) => ({
    role: message.senderRole === 'system' ? 'system' : message.senderId === 'bob-agent' ? 'assistant' : 'user',
    content: message.body,
  }))
}

export default function ChatStudio() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { organizationId } = useGlobalFiltersStore()
  const [mode, setMode] = useState<ChatMode>('bob')
  const [teamTarget, setTeamTarget] = useState<TeamTarget>({ type: 'admin' })
  const [inputText, setInputText] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [bobThread, setBobThread] = useState<ChatThreadMessage[]>([
    makeMessage({
      channel: 'bob',
      senderId: 'bob-agent',
      senderName: 'Bob',
      senderRole: 'assistant',
      recipientId: null,
      recipientRole: 'bob',
      orgId: null,
      body: 'Standing by. What roster, compliance, or site action do you want me to run?',
    }),
  ])
  const [teamMessages, setTeamMessages] = useState<ChatThreadMessage[]>([])
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const effectiveOrgId = useMemo(
    () => user?.organization_id || organizationId || null,
    [organizationId, user?.organization_id],
  )

  const { data: members = [] } = useQuery<Participant[]>({
    queryKey: ['chat-studio-members', effectiveOrgId],
    enabled: !!effectiveOrgId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('user_profiles') as any)
        .select('id, first_name, last_name, role, organization_id')
        .eq('is_active', true)
        .eq('organization_id', effectiveOrgId)
        .order('first_name')
      if (error) throw error
      return (data || []) as Participant[]
    },
  })

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bobThread, teamMessages, mode])

  useEffect(() => {
    if (!effectiveOrgId || !user?.id) return

    const ch = supabase.channel(`unified-chat-${effectiveOrgId}`, {
      config: { broadcast: { self: true } },
    })

    ch.on('broadcast', { event: 'team-message' }, (payload) => {
      const msg = payload.payload as ChatThreadMessage
      if (!msg?.id) return
      if (msg.orgId && msg.orgId !== effectiveOrgId) return
      if (msg.channel !== 'team') return

      setTeamMessages((prev) => {
        if (prev.some((item) => item.id === msg.id)) return prev
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

  const visibleTeamMessages = useMemo(() => {
    if (teamTarget.type === 'admin') {
      return teamMessages.filter((msg) => msg.recipientRole === 'admin' || msg.senderRole === 'system')
    }

    const otherId = teamTarget.user.id
    return teamMessages.filter(
      (msg) =>
        msg.recipientRole === 'direct' &&
        ((msg.senderId === user?.id && msg.recipientId === otherId) ||
          (msg.senderId === otherId && msg.recipientId === user?.id)),
    )
  }, [teamMessages, teamTarget, user?.id])

  const visibleBobMessages = bobThread

  const currentModeLabel = mode === 'bob' ? 'Bob Command Center' : 'Team Channels'
  const currentPlaceholder = mode === 'bob'
    ? 'Message Bob or specify a command...'
    : teamTarget.type === 'admin'
      ? 'Message the admin team...'
      : `Message ${teamTarget.user.first_name} ${teamTarget.user.last_name}...`

  const addLocalBobReply = useCallback((body: string) => {
    setBobThread((prev) => [...prev, makeMessage({
      channel: 'bob',
      senderId: 'bob-agent',
      senderName: 'Bob',
      senderRole: 'assistant',
      recipientId: user?.id ?? null,
      recipientRole: 'bob',
      orgId: effectiveOrgId,
      body,
    })])
  }, [effectiveOrgId, user?.id])

  const sendBobCommand = useCallback(async () => {
    const trimmed = inputText.trim()
    if (!trimmed) return

    const userMsg = makeMessage({
      channel: 'bob',
      senderId: user?.id ?? 'unknown-user',
      senderName: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'You',
      senderRole: user?.role || 'user',
      recipientId: 'bob-agent',
      recipientRole: 'bob',
      orgId: effectiveOrgId,
      body: trimmed,
    })

    const nextThread = [...bobThread, userMsg]
    setBobThread(nextThread)
    setInputText('')

    try {
      // Route through intent parser first for roster, site, and compliance intents
      const parseResult = await parseBobCommand(
        trimmed,
        user?.first_name || 'Officer',
        effectiveOrgId || undefined
      )

      // If parser found a structured action, use that reply
      if (parseResult.success && parseResult.actionType !== 'general_note') {
        addLocalBobReply(parseResult.reply)
        return
      }

      // Otherwise, escalate to Bob's full conversation engine
      const { data, error } = await edgeFunctions.bobGateway({
        messages: buildBobHistory(nextThread),
        provider: 'auto',
        context: {
          currentRoute: '/team-chat',
          interfaceMode: 'unified_chat_hub',
          orgId: effectiveOrgId,
        },
      })

      if (error) throw new Error(error)

      const replyText = String(
        data?.response || data?.raw_response || data?.message || data?.text || 'Command acknowledged.',
      ).trim()

      addLocalBobReply(replyText || 'Command acknowledged.')
    } catch (err: any) {
      toast.error('Bob could not process that command right now.', { description: err?.message || 'Please retry.' })
      addLocalBobReply('Bob is temporarily unavailable, but the command has been captured for retry.')
    }
  }, [addLocalBobReply, bobThread, effectiveOrgId, inputText, user?.first_name, user?.id, user?.last_name, user?.role])

  const handleImageCapture = useCallback(async (base64Data: string, fileBlob: Blob) => {
    setCameraOpen(false)

    try {
      const result = await processEvidenceCapture(fileBlob, {
        incidentType: 'OPERATIONAL_EVIDENCE',
        location: 'Field Operations',
        officer: user?.first_name || 'Officer',
        orgId: effectiveOrgId || undefined,
      })

      if (result.success) {
        addLocalBobReply(result.reply)
        const userMsg = makeMessage({
          channel: 'bob',
          senderId: user?.id ?? 'unknown-user',
          senderName: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'You',
          senderRole: user?.role || 'user',
          recipientId: 'bob-agent',
          recipientRole: 'bob',
          orgId: effectiveOrgId,
          body: '[📸 Evidence image captured and indexed]',
        })
        setBobThread((prev) => [...prev, userMsg])
      } else {
        toast.error('Image processing failed', { description: result.reply })
      }
    } catch (err: any) {
      toast.error('Camera error', { description: err?.message || 'Could not process image.' })
    }
  }, [addLocalBobReply, effectiveOrgId, user?.first_name, user?.id, user?.last_name, user?.role])

  const sendTeamMessage = useCallback(async () => {
    const trimmed = inputText.trim()
    if (!trimmed || !user) return

    const recipientRole = teamTarget.type === 'admin' ? 'admin' : 'direct'
    const teamMessage = makeMessage({
      channel: 'team',
      senderId: user.id,
      senderName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'You',
      senderRole: user.role,
      recipientId: teamTarget.type === 'user' ? teamTarget.user.id : null,
      recipientRole,
      orgId: effectiveOrgId,
      body: trimmed,
    })

    setTeamMessages((prev) => [...prev, teamMessage])
    setInputText('')

    if (channel) {
      await channel.send({ type: 'broadcast', event: 'team-message', payload: teamMessage })
    }
  }, [channel, effectiveOrgId, inputText, teamTarget, user])

  const handleSend = useCallback(async () => {
    if (mode === 'bob') {
      await sendBobCommand()
      return
    }

    await sendTeamMessage()
  }, [mode, sendBobCommand, sendTeamMessage])

  const quickBobCommands = [
    'Add Cari Llewellyn to the Richmond Mall patrol roster tomorrow from 0700 to 1500.',
    'Create a new client site for Salisbury Warehouse Hub.',
    'Assess the latest noise complaint and draft the compliance report.',
    'Assign the available asset to the active patrol and confirm dispatch coverage.',
  ]

  const activeMessages = mode === 'bob' ? visibleBobMessages : visibleTeamMessages

  return (
    <AppLayout
      title="Unified Chat Hub"
      description="One place for Bob commands, roster changes, compliance actions, and direct team messages."
    >
      <GlobalFilterRibbon />

      <div className="grid min-h-[calc(100vh-180px)] gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <Card className="border-slate-200/70 bg-slate-950 text-slate-50 shadow-xl shadow-slate-900/10">
          <CardHeader className="space-y-3 border-b border-slate-800/80 bg-gradient-to-r from-slate-950 via-slate-950 to-slate-900">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BrainCircuit className="h-4 w-4 text-cyan-300" />
                Bob Command Center
              </CardTitle>
              <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-200 border-emerald-500/20">
                Active Staging
              </Badge>
            </div>
            <div className="text-xs text-slate-300/80">Provisioning, rostering, compliance, and field actions.</div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Mode</div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={mode === 'bob' ? 'default' : 'outline'}
                  className={mode === 'bob' ? 'bg-cyan-500 text-white hover:bg-cyan-600' : 'border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800'}
                  onClick={() => setMode('bob')}
                >
                  <Radio className="mr-2 h-4 w-4" />
                  Bob
                </Button>
                <Button
                  variant={mode === 'team' ? 'default' : 'outline'}
                  className={mode === 'team' ? 'bg-rose-500 text-white hover:bg-rose-600' : 'border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800'}
                  onClick={() => setMode('team')}
                >
                  <Users className="mr-2 h-4 w-4" />
                  Team
                </Button>
              </div>
            </div>

            <Separator className="bg-slate-800" />

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Channels</div>
              <Button
                variant={mode === 'team' && teamTarget.type === 'admin' ? 'default' : 'outline'}
                className="w-full justify-start border-slate-700 bg-slate-900 text-left text-slate-50 hover:bg-slate-800"
                onClick={() => {
                  setMode('team')
                  setTeamTarget({ type: 'admin' })
                }}
              >
                <Shield className="mr-2 h-4 w-4" />
                Admin Support
              </Button>

              <div className="space-y-1">
                {members.slice(0, 5).map((member) => (
                  <Button
                    key={member.id}
                    variant={mode === 'team' && teamTarget.type === 'user' && teamTarget.user.id === member.id ? 'default' : 'ghost'}
                    className="w-full justify-start text-left text-slate-100 hover:bg-slate-900"
                    onClick={() => {
                      setMode('team')
                      setTeamTarget({ type: 'user', user: member })
                    }}
                  >
                    <MessageSquare className="mr-2 h-4 w-4" />
                    <span className="truncate">{member.first_name} {member.last_name}</span>
                  </Button>
                ))}
              </div>
            </div>

            <Separator className="bg-slate-800" />

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Quick Bob commands</div>
              {quickBobCommands.map((command) => (
                <Button
                  key={command}
                  variant="outline"
                  className="h-auto w-full justify-start whitespace-normal border-slate-700 bg-slate-900 px-3 py-2 text-left text-slate-100 hover:bg-slate-800"
                  onClick={() => {
                    setMode('bob')
                    setInputText(command)
                  }}
                >
                  <SquarePen className="mr-2 h-4 w-4 shrink-0" />
                  <span className="text-sm leading-snug">{command}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-[calc(100vh-180px)] flex-col border-slate-200/70 bg-white shadow-xl shadow-slate-900/5">
          <CardHeader className="space-y-4 border-b bg-gradient-to-r from-slate-50 via-white to-cyan-50/40">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  <PanelLeft className="h-3.5 w-3.5" />
                  {currentModeLabel}
                </div>
                <CardTitle className="mt-2 text-2xl tracking-tight text-slate-900">
                  {mode === 'bob' ? 'Command Bob in one thread' : 'Talk to your team directly'}
                </CardTitle>
                <div className="mt-1 text-sm text-slate-600">
                  {mode === 'bob'
                    ? 'Send roster, site, patrol, compliance, and asset requests to Bob without jumping between screens.'
                    : 'Use the side channels for direct peer-to-peer coordination while Bob stays one tap away.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                  <Clock3 className="mr-1 h-3 w-3" />
                  Live
                </Badge>
                <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-800">
                  <Waves className="mr-1 h-3 w-3" />
                  Realtime
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/import-data')}>
                <ArrowRight className="mr-2 h-4 w-4" />
                Open Import Data
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/roster')}>
                <Building2 className="mr-2 h-4 w-4" />
                View Rosters
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/dispatch')}>
                <Radio className="mr-2 h-4 w-4" />
                Open Dispatch
              </Button>
            </div>
          </CardHeader>

          <ScrollArea className="flex-1 px-4 py-4">
            <div className="space-y-3">
              {activeMessages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  {mode === 'bob'
                    ? 'No Bob commands yet. Ask for a roster update, client site, patrol assessment, or asset assignment.'
                    : 'No team messages yet. Switch to Admin Support or pick a teammate to start a direct thread.'}
                </div>
              ) : activeMessages.map((msg) => {
                const isMine = msg.senderId === user?.id
                const isBob = msg.channel === 'bob'
                const isSystem = msg.senderRole === 'system'

                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[min(42rem,92%)] rounded-2xl border px-4 py-3 shadow-sm ${
                        isBob
                          ? 'border-cyan-200 bg-cyan-50 text-slate-900'
                          : isSystem
                            ? 'border-amber-200 bg-amber-50 text-amber-950'
                            : isMine
                              ? 'border-sky-200 bg-sky-600 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] opacity-70">
                        <span>{isBob ? 'Bob' : msg.senderName}</span>
                        <span>•</span>
                        <span>{formatDateTime(msg.createdAt)}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-6">{msg.body}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={threadEndRef} />
            </div>
          </ScrollArea>

          <Separator />

          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                {mode === 'bob' ? 'Bob intent lane' : 'Team channel lane'}
              </Badge>
              {mode === 'team' && (
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  {teamTarget.type === 'admin' ? 'Admin support' : `${teamTarget.user.first_name} ${teamTarget.user.last_name}`}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              {mode === 'bob' && (
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                  onClick={() => setCameraOpen(true)}
                  aria-label="Capture evidence image"
                  title="Capture photo for evidence"
                >
                  <Camera className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                onClick={() => navigate('/import-data')}
                aria-label="Open import tools"
              >
                <Plus className="h-4 w-4" />
              </button>

              <Textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder={currentPlaceholder}
                className="min-h-[56px] flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
              />

              <Button
                className={mode === 'bob' ? 'bg-cyan-600 text-white hover:bg-cyan-700' : 'bg-rose-600 text-white hover:bg-rose-700'}
                onClick={() => void handleSend()}
                disabled={!inputText.trim()}
              >
                <Send className="mr-2 h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        </Card>

        <Card className="border-slate-200/80 bg-white shadow-xl shadow-slate-900/5">
          <CardHeader className="border-b bg-slate-50">
            <CardTitle className="flex items-center gap-2 text-base">
              <PanelLeft className="h-4 w-4" />
              Side Panel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Peer communications</div>
              <div className="text-sm text-slate-700">
                Keep direct contact threads here while Bob handles provisioning, rostering, and compliance in the main lane.
              </div>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setMode('team')
                  setTeamTarget({ type: 'admin' })
                }}
              >
                <Shield className="mr-2 h-4 w-4" />
                Admin Support
              </Button>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Operational shortcuts</div>
              <Button variant="ghost" className="w-full justify-start" onClick={() => navigate('/roster')}>
                <Users className="mr-2 h-4 w-4" />
                Roster planning
              </Button>
              <Button variant="ghost" className="w-full justify-start" onClick={() => navigate('/dispatch')}>
                <Radio className="mr-2 h-4 w-4" />
                Dispatch control
              </Button>
              <Button variant="ghost" className="w-full justify-start" onClick={() => navigate('/operations-map')}>
                <Waves className="mr-2 h-4 w-4" />
                Live monitoring
              </Button>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Bob-ready prompts</div>
              <div className="text-sm text-slate-700">
                Ask Bob to assess noise files, create a report, assign assets, or provision a client site from here.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {cameraOpen && (
        <CameraCapture
          onImageCaptured={handleImageCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </AppLayout>
  )
}