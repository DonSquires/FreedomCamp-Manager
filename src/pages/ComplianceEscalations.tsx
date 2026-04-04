import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useNotifications } from '@/hooks/useNotifications'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { useBobCollaboration } from '@/hooks/useBobCollaboration'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle, CheckCheck, Download, Save, ShieldAlert } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

interface EscalationRow {
  id: string
  title: string
  body: string
  data: Record<string, any> | null
  read: boolean
  created_at: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
}

function isEscalation(row: EscalationRow): boolean {
  const data = row.data || {}
  return (
    data.source === 'onspace-ai-chat' ||
    data.escalation_reason === 'possible_criminal_or_privacy_breach' ||
    data.requires_code_fix_approval === true
  )
}

export default function ComplianceEscalations() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const { askBob } = useBobCollaboration()
  const { markAsRead, markAllAsRead } = useNotifications({ read: undefined, limit: 200 })
  const [keywordDraft, setKeywordDraft] = useState('')

  const { data: escalations = [], isLoading } = useQuery<EscalationRow[]>({
    queryKey: ['compliance-escalations', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await (supabase.from('notifications') as any)
        .select('id, title, body, data, read, created_at, priority, type')
        .eq('user_id', user.id)
        .eq('type', 'system_alert')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error
      return ((data ?? []) as EscalationRow[]).filter(isEscalation)
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  })

  const unreadCount = useMemo(() => escalations.filter((row) => !row.read).length, [escalations])

  const { data: policyRow } = useQuery<{ id: string; escalation_keywords: string[] } | null>({
    queryKey: ['bob-policy-controls'],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('bob_policy_controls') as any)
        .select('id, escalation_keywords')
        .eq('singleton_key', 'default')
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as { id: string; escalation_keywords: string[] } | null
    },
    enabled: !!user?.id,
  })

  const parsedKeywords = useMemo(() => {
    const source = keywordDraft.trim() || (policyRow?.escalation_keywords ?? []).join(', ')
    return source
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
  }, [keywordDraft, policyRow?.escalation_keywords])

  const savePolicyMutation = useMutation({
    mutationFn: async () => {
      if (!parsedKeywords.length) throw new Error('At least one escalation keyword is required')
      const payload = {
        singleton_key: 'default',
        escalation_keywords: parsedKeywords,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await ((supabase as any).from('bob_policy_controls') as any)
        .upsert(payload, { onConflict: 'singleton_key' })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bob-policy-controls'] })
      setKeywordDraft('')
      toast.success('Escalation keywords updated')
    },
    onError: (e: any) => toast.error(e?.message || 'Could not save escalation keywords'),
  })

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data: audits, error: auditError } = await (supabase.from('audit_log') as any)
        .select('id, action, entity_type, entity_id, performed_by, organization_id, new_values, created_at')
        .in('action', [
          'bob_user_data_request_blocked',
          'bob_user_data_request_allowed',
          'bob_user_data_request_grand_master_override',
        ])
        .order('created_at', { ascending: false })
        .limit(500)

      if (auditError) throw auditError

      const exportDoc = {
        export_type: 'compliance_escalation_legal_pack',
        exported_at: new Date().toISOString(),
        exported_by: user?.id ?? null,
        escalation_count: escalations.length,
        unread_count: unreadCount,
        escalations,
        privacy_audit_entries: audits ?? [],
      }

      const json = JSON.stringify(exportDoc, null, 2)
      const bytes = new TextEncoder().encode(json)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')

      const { error: logError } = await (supabase.from('audit_log') as any).insert({
        action: 'compliance_escalation_export',
        entity_type: 'compliance_escalation_legal_pack',
        entity_id: user?.id ?? null,
        performed_by: user?.id ?? null,
        organization_id: user?.organization_id ?? null,
        new_values: {
          sha256: hash,
          escalation_count: escalations.length,
          privacy_audit_count: (audits ?? []).length,
          exported_at: new Date().toISOString(),
        },
      })
      if (logError) throw logError

      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `compliance-escalations-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)

      return hash
    },
    onSuccess: (hash) => {
      toast.success(`Legal export generated (SHA-256: ${String(hash).slice(0, 12)}...)`)
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to export legal pack'),
  })

  return (
    <AppLayout title="Compliance Escalations" description="Grand Master escalation feed for privacy, integrity, and policy-risk events.">
      <GlobalFilterRibbon />

      <div className="space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-600" />
              Escalation Inbox
              {unreadCount > 0 && <Badge variant="destructive">{unreadCount}</Badge>}
            </CardTitle>
            <CardDescription>
              Auto-escalated events from Bob policy guard and code-fix approval workflow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllAsRead.mutate()}
                disabled={markAllAsRead.isPending || unreadCount === 0}
              >
                <CheckCheck className="h-4 w-4 mr-1" /> Mark all as read
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending || escalations.length === 0}
              >
                <Download className="h-4 w-4 mr-1" /> Export legal pack
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Escalation Keyword Policy</CardTitle>
            <CardDescription>
              Configure Bob's escalation trigger keywords. Comma separated list, centrally enforced at chat policy layer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={keywordDraft || (policyRow?.escalation_keywords ?? []).join(', ')}
              onChange={(e) => setKeywordDraft(e.target.value)}
              placeholder="illegal, privacy breach, tamper"
            />
            <div className="text-xs text-muted-foreground">
              Effective keywords: {parsedKeywords.join(', ') || 'none'}
            </div>
            <Button size="sm" onClick={() => savePolicyMutation.mutate()} disabled={savePolicyMutation.isPending}>
              <Save className="h-4 w-4 mr-1" /> Save policy
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">Loading escalations...</CardContent>
          </Card>
        ) : escalations.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">No compliance escalations found.</CardContent>
          </Card>
        ) : (
          escalations.map((row) => {
            const data = row.data || {}
            const escalationType = data.requires_code_fix_approval
              ? 'Code change approval required'
              : data.escalation_reason === 'possible_criminal_or_privacy_breach'
              ? 'Potential criminal/privacy breach'
              : 'Policy escalation'

            const bobPrompt = [
              'Self-heal review request from Compliance Escalations.',
              `Escalation title: ${row.title}`,
              `Escalation type: ${escalationType}`,
              `Priority: ${row.priority}`,
              `Body: ${row.body}`,
              `Data: ${JSON.stringify(data).slice(0, 2000)}`,
              'Return: blocker assessment, likely root cause, safe remediation steps, and verification checks.',
            ].join(' ')

            return (
              <Card key={row.id} className={!row.read ? 'border-red-300 bg-red-50/30' : ''}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    {row.title}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    <Badge variant="outline">{escalationType}</Badge>
                    <span>{formatDateTime(row.created_at)}</span>
                    {!row.read && <Badge variant="destructive">Unread</Badge>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm">{row.body}</p>
                  {data.message_preview && (
                    <div className="rounded border bg-background p-2 text-xs text-muted-foreground">
                      Preview: {String(data.message_preview)}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {!row.read && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => markAsRead.mutate(row.id)}
                        disabled={markAsRead.isPending}
                      >
                        <CheckCheck className="h-4 w-4 mr-1" /> Mark read
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        askBob({
                          title: `Self-heal escalation review: ${row.title}`,
                          prompt: bobPrompt,
                          source: 'system',
                          summary: `Escalation ${row.id} requires remediation guidance`,
                          autoSubmit: true,
                          returnRoute: '/compliance-escalations',
                          metadata: {
                            escalation_id: row.id,
                            escalation_priority: row.priority,
                            escalation_type: escalationType,
                          },
                        })
                      }}
                    >
                      Ask Bob (Self-Heal)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </AppLayout>
  )
}
