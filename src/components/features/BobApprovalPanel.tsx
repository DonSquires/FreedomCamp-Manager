import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type PendingSelfHealingLog = {
  id: string
  service_name: string | null
  error_message: string | null
  target_variable: string | null
  patch_value: string | null
  status: string
  created_at: string | null
}

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
  const [logs, setLogs] = useState<PendingSelfHealingLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)

  const activeUserName = useMemo(() => {
    const fullName = String(user?.full_name ?? '').trim()
    if (fullName.length > 0) return fullName
    const firstName = String(user?.first_name ?? '').trim()
    if (firstName.length > 0) return firstName
    return String(user?.email ?? 'Unknown reviewer')
  }, [user?.email, user?.first_name, user?.full_name])

  const loadPendingLogs = useCallback(async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setIsRefreshing(true)
      else setIsLoading(true)

      const { data, error } = await (((supabase as any).from('self_healing_logs')) as any)
        .select('id, service_name, error_message, target_variable, patch_value, status, created_at')
        .eq('status', 'PENDING_HUMAN_REVIEW')
        .order('created_at', { ascending: false })

      if (error) throw error

      setLogs((data ?? []) as PendingSelfHealingLog[])
    } catch (error: any) {
      console.error('[BobApprovalPanel] Failed to load pending logs', error)
      toast.error(error?.message ?? 'Failed to load pending approvals')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadPendingLogs(false)
  }, [loadPendingLogs])

  const rejectPatch = useCallback(async (log: PendingSelfHealingLog) => {
    try {
      setActioningId(log.id)

      const { error } = await (((supabase as any).from('self_healing_logs')) as any)
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
  }, [loadPendingLogs])

  const approveAndDeploy = useCallback(async (log: PendingSelfHealingLog) => {
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
  }, [activeUserName, loadPendingLogs])

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
