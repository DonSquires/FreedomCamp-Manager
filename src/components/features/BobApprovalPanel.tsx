import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Mic, RefreshCw, Square, WandSparkles, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { Database } from '@/types/database'

type HealPatchRow = Database['public']['Tables']['heal_patches']['Row']

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

const OTA_PRESET_MESSAGES = [
  'Fix notification deep-link routing for approvals and Bob chat',
  'Fix push tap behavior for background and cold-start app launches',
  'Fix approval panel refresh behavior after OTA command execution',
]

const OTA_QUICK_FIX_MESSAGES = {
  notifications:
    'Fix high-priority push notifications so alerts are delivered reliably in foreground, background, and when the app is closed.',
  deepLinks:
    'Fix deep-link navigation so tapping a notification opens the exact target screen, including approvals and Bob chat.',
  approvalPanel:
    'Fix approval panel sync so new mobile build and OTA review records appear instantly and consistently without manual refresh.',
  other:
    'Please apply a mobile OTA hotfix for: ',
} as const

function getBobManagerUrl(): string {
  const envUrl = String(import.meta.env.VITE_BOB_MANAGER_URL ?? '').trim()
  if (envUrl.length > 0) {
    return envUrl.replace(/\/$/, '')
  }
  return 'http://localhost:3000'
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Unknown time'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'

  return date.toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland',
  })
}

export function BobApprovalPanel() {
  const { user } = useAuthStore()
  const isGrandMaster = user?.role === 'grand_master'
  const [logs, setLogs] = useState<HealPatchRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [hotfixMessage, setHotfixMessage] = useState('')
  const [isTriggeringOta, setIsTriggeringOta] = useState(false)
  const [isListening, setIsListening] = useState(false)

  const activeUserName = useMemo(() => {
    const fullName = String(user?.full_name ?? '').trim()
    if (fullName.length > 0) return fullName
    const firstName = String(user?.first_name ?? '').trim()
    if (firstName.length > 0) return firstName
    return String(user?.email ?? 'Unknown reviewer')
  }, [user?.email, user?.first_name, user?.full_name])

  const loadPendingLogs = useCallback(async (isManualRefresh = false) => {
    if (!isGrandMaster) {
      setLogs([])
      setIsLoading(false)
      setIsRefreshing(false)
      return
    }

    try {
      if (isManualRefresh) setIsRefreshing(true)
      else setIsLoading(true)

      const { data, error } = await supabase
        .from('heal_patches')
        .select('id, service_name, error_message, target_variable, patch_value, status, created_at')
        .eq('status', 'PENDING_HUMAN_REVIEW')
        .order('created_at', { ascending: false })

      if (error) throw error

      setLogs((data ?? []) as HealPatchRow[])
    } catch (error: any) {
      console.error('[BobApprovalPanel] Failed to load pending logs', error)
      toast.error(error?.message ?? 'Failed to load pending approvals')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [isGrandMaster])

  useEffect(() => {
    loadPendingLogs(false)
  }, [loadPendingLogs])

  useEffect(() => {
    if (!isGrandMaster) {
      setLogs([])
      return
    }

    const channel = supabase
      .channel('public:heal_patches')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'heal_patches' },
        (payload) => {
          const next = (payload.new ?? null) as HealPatchRow | null
          const previous = (payload.old ?? null) as HealPatchRow | null

          setLogs((current) => {
            if (payload.eventType === 'DELETE') {
              return current.filter((entry) => entry.id !== previous?.id)
            }

            if (!next || next.status !== 'PENDING_HUMAN_REVIEW') {
              return current.filter((entry) => entry.id !== (next?.id ?? previous?.id))
            }

            if (current.some((entry) => entry.id === next.id)) {
              return current.map((entry) => (entry.id === next.id ? next : entry))
            }

            return [next, ...current]
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isGrandMaster])

  const rejectPatch = useCallback(async (log: HealPatchRow) => {
    if (!isGrandMaster) {
      toast.error('Only grand masters can manage Bob patch approvals')
      return
    }

    try {
      setActioningId(log.id)

      const { error } = await supabase
        .from('heal_patches')
        .update({ status: 'REJECTED_BY_HUMAN' })
        .eq('id', log.id)
        .eq('status', 'PENDING_HUMAN_REVIEW')

      if (error) throw error

      toast.success('Patch rejected')
      await loadPendingLogs(true)
    } catch (error: any) {
      console.error('[BobApprovalPanel] Reject failed', error)
      toast.error(error?.message ?? 'Failed to reject patch')
    } finally {
      setActioningId(null)
    }
  }, [isGrandMaster, loadPendingLogs])

  const approveAndDeploy = useCallback(async (log: HealPatchRow) => {
    if (!isGrandMaster) {
      toast.error('Only grand masters can approve Bob patch deployments')
      return
    }

    try {
      setActioningId(log.id)

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token

      const response = await fetch(`${getBobManagerUrl()}/api/approve-patch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          logId: log.id,
          patchId: log.id,
          approvedBy: activeUserName,
          approverName: activeUserName,
          projectId: import.meta.env.VITE_RAILWAY_PROJECT_ID,
          environmentId: import.meta.env.VITE_RAILWAY_ENVIRONMENT_ID,
          serviceId: import.meta.env.VITE_RAILWAY_SERVICE_ID,
        }),
      })

      if (!response.ok) {
        const payload = await response.text()
        throw new Error(payload || `Approval failed (${response.status})`)
      }

      toast.success('Patch approved and deployment requested')
      await loadPendingLogs(true)
    } catch (error: any) {
      console.error('[BobApprovalPanel] Approve failed', error)
      toast.error(error?.message ?? 'Failed to approve and deploy patch')
    } finally {
      setActioningId(null)
    }
  }, [activeUserName, isGrandMaster, loadPendingLogs])

  const triggerOtaHotfix = useCallback(async () => {
    if (!isGrandMaster) {
      toast.error('Only grand masters can trigger Bob OTA hotfix actions')
      return
    }

    const message = hotfixMessage.trim()
    if (!message) {
      toast.error('Please enter an OTA hotfix message')
      return
    }

    try {
      setIsTriggeringOta(true)

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token

      const response = await fetch(`${getBobManagerUrl()}/api/mobile/ota-hotfix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ message }),
      })

      if (!response.ok) {
        const payload = await response.text()
        throw new Error(payload || `OTA hotfix failed (${response.status})`)
      }

      toast.success('OTA hotfix command queued for human review')
      setHotfixMessage('')
      await loadPendingLogs(true)
    } catch (error: any) {
      console.error('[BobApprovalPanel] OTA hotfix failed', error)
      toast.error(error?.message ?? 'Failed to trigger OTA hotfix')
    } finally {
      setIsTriggeringOta(false)
    }
  }, [hotfixMessage, isGrandMaster, loadPendingLogs])

  const startVoiceCapture = useCallback(() => {
    if (!isGrandMaster) {
      toast.error('Only grand masters can trigger Bob voice controls')
      return
    }

    const speechWindow = window as WindowWithSpeechRecognition
    const SpeechRecognitionCtor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition

    if (!SpeechRecognitionCtor) {
      toast.error('Voice capture is not supported in this browser. Please type your message.')
      return
    }

    try {
      const recognition = new SpeechRecognitionCtor()
      recognition.lang = 'en-NZ'
      recognition.interimResults = false
      recognition.maxAlternatives = 1

      recognition.onresult = (event) => {
        const transcript = String(event?.results?.[0]?.[0]?.transcript ?? '').trim()
        if (!transcript) {
          toast.error('No speech detected. Please try again.')
          return
        }

        setHotfixMessage((current) => {
          if (!current.trim()) return transcript
          return `${current.trim()} ${transcript}`
        })
      }

      recognition.onerror = () => {
        toast.error('Voice capture failed. Please try again or type your message.')
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      setIsListening(true)
      recognition.start()
    } catch {
      setIsListening(false)
      toast.error('Unable to start voice capture. Please type your message.')
    }
  }, [isGrandMaster])

  const applyQuickFixMessage = useCallback((message: string) => {
    if (!isGrandMaster) {
      toast.error('Only grand masters can use Bob quick-fix controls')
      return
    }

    setHotfixMessage(message)
    toast.success('Quick fix message loaded. Press Trigger OTA Hotfix when ready.')
  }, [isGrandMaster])

  if (!isGrandMaster) {
    return null
  }

  return (
    <Card className="border-2">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg">AI Patch Approval Dashboard</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pending human review items from self-healing logs.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => loadPendingLogs(true)}
          disabled={isRefreshing || isLoading}
          className="gap-2"
        >
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <p className="text-sm font-medium">Mobile OTA Hotfix (Natural Language)</p>
          <p className="text-xs text-muted-foreground">
            Tell Bob what you want in plain English. Use a quick preset, type naturally, or use voice dictation.
          </p>
          <div className="rounded-md border bg-background/80 p-3 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick Fix</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyQuickFixMessage(OTA_QUICK_FIX_MESSAGES.notifications)}
                disabled={isTriggeringOta || isListening}
                className="gap-2"
              >
                Notifications
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyQuickFixMessage(OTA_QUICK_FIX_MESSAGES.deepLinks)}
                disabled={isTriggeringOta || isListening}
                className="gap-2"
              >
                Deep Links
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyQuickFixMessage(OTA_QUICK_FIX_MESSAGES.approvalPanel)}
                disabled={isTriggeringOta || isListening}
                className="gap-2"
              >
                Approval Panel
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyQuickFixMessage(OTA_QUICK_FIX_MESSAGES.other)}
                disabled={isTriggeringOta || isListening}
                className="gap-2"
              >
                Other
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {OTA_PRESET_MESSAGES.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHotfixMessage(preset)}
                disabled={isTriggeringOta}
                className="gap-2"
              >
                <WandSparkles className="h-3.5 w-3.5" />
                {preset}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={hotfixMessage}
              onChange={(event) => setHotfixMessage(event.target.value)}
              placeholder="Example: Fix push notifications so tapping opens the exact approval page"
              disabled={isTriggeringOta || isListening}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void startVoiceCapture()}
              disabled={isTriggeringOta || isListening}
              className="gap-2"
            >
              {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {isListening ? 'Listening...' : 'Speak'}
            </Button>
            <Button
              type="button"
              onClick={() => void triggerOtaHotfix()}
              disabled={isTriggeringOta || isListening}
              className="gap-2"
            >
              {isTriggeringOta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Trigger OTA Hotfix
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pending approvals...
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-md border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No pending patch approvals.
          </div>
        ) : (
          logs.map((log) => {
            const busy = actioningId === log.id

            return (
              <div key={log.id} className="rounded-lg border bg-background p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium leading-none">
                      {log.service_name || 'Unknown service'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(log.created_at)}
                    </p>
                  </div>
                  <Badge variant="secondary">{log.status}</Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Error Message</p>
                  <pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
                    {log.error_message || 'No error message captured'}
                  </pre>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Target Variable</p>
                    <pre className="rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
                      {log.target_variable || 'N/A'}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Proposed Patch Value</p>
                    <pre className="rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
                      {log.patch_value || 'N/A'}
                    </pre>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => rejectPatch(log)}
                    disabled={busy}
                    className="gap-2"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Reject Patch
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => approveAndDeploy(log)}
                    disabled={busy}
                    className="gap-2"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve & Deploy
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
