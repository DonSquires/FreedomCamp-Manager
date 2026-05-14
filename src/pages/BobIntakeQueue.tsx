import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime } from '@/lib/utils'
import { buildHistoricalImportAuditPayload, recordHistoricalImportAudit } from '@/lib/historicalImportAudit'
import { BrainCircuit, CheckCircle2, Clock3, ExternalLink, FileWarning, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

type IntakeStatus = 'draft' | 'staged' | 'historical_started' | 'imported' | 'review_pending' | 'actioned' | 'failed'

interface IntakeRow {
  id: string
  assistant_name: string
  purpose: string
  file_name: string
  file_kind: string
  source_system: string | null
  operator_notes: string | null
  extracted_text: string | null
  recommended_table: string | null
  recommendation_score: number | null
  status: IntakeStatus
  action_target_table: string | null
  action_target_id: string | null
  action_summary: string | null
  file_public_url: string | null
  created_at: string
  organization_id: string
}

const STATUS_OPTIONS: IntakeStatus[] = ['draft', 'staged', 'historical_started', 'imported', 'review_pending', 'actioned', 'failed']

export default function BobIntakeQueue() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [notesById, setNotesById] = useState<Record<string, string>>({})

  const accessibleOrgIds = useMemo(() => {
    if (!user) return [] as string[]
    return Array.from(new Set([user.organization_id, ...(user.extra_organization_ids || []), ...(user.authorized_work_locations || [])].filter(Boolean) as string[]))
  }, [user])

  const { data: rows = [], isLoading } = useQuery<IntakeRow[]>({
    queryKey: ['bob-intake-queue', user?.id, user?.role, accessibleOrgIds, statusFilter],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = ((supabase as any).from('ai_import_intakes') as any)
        .select('id, assistant_name, purpose, file_name, file_kind, source_system, operator_notes, extracted_text, recommended_table, recommendation_score, status, action_target_table, action_target_id, action_summary, file_public_url, created_at, organization_id')
        .order('created_at', { ascending: false })
        .limit(100)

      if (user?.role !== 'master' && user?.role !== 'grand_master') {
        if (!accessibleOrgIds.length) return []
        query = query.in('organization_id', accessibleOrgIds)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as IntakeRow[]
    },
  })

  const updateStatus = useMutation({
    mutationFn: async (params: { id: string; status: IntakeStatus }) => {
      const existing = rows.find((row) => row.id === params.id)
      const summary = notesById[params.id]?.trim() || existing?.action_summary || null
      const { error } = await ((supabase as any).from('ai_import_intakes') as any)
        .update({ status: params.status, action_summary: summary })
        .eq('id', params.id)
      if (error) throw error

      await recordHistoricalImportAudit(supabase, buildHistoricalImportAuditPayload({
        organizationId: existing?.organization_id || user?.organization_id || '',
        performedBy: user?.id || null,
        intakeId: params.id,
        oldStatus: existing?.status || null,
        newStatus: params.status,
        actionTargetTable: existing?.action_target_table || null,
        actionTargetId: existing?.action_target_id || null,
        actionSummary: summary,
        fileName: existing?.file_name || null,
        fileKind: existing?.file_kind || null,
        sourceSystem: existing?.source_system || null,
        extraOldValues: {
          recommended_table: existing?.recommended_table || null,
          recommendation_score: existing?.recommendation_score ?? null,
        },
        extraNewValues: {
          reviewed_from_queue: true,
        },
      }))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bob-intake-queue'] })
      toast.success('Bob intake updated')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update Bob intake')
    },
  })

  return (
    <AppLayout title="Bob Intake Queue" description="Review Bob intake packages, staged document analysis, and downstream action status.">
      <GlobalFilterRibbon />

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BrainCircuit className="h-4 w-4 text-primary" />
          Bob review queue
        </div>
        <div className="w-[220px]">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>{status.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Loading Bob intake queue...</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No Bob intake items match this filter.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{row.file_name}</span>
                    <Badge variant="outline">{row.file_kind}</Badge>
                    <Badge>{row.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatDateTime(row.created_at)}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Purpose</div>
                    <div className="font-medium">{row.purpose.replace(/_/g, ' ')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Suggested table</div>
                    <div className="font-medium">{row.recommended_table || 'Unassigned'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Confidence</div>
                    <div className="font-medium">{row.recommendation_score ?? 'n/a'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Action target</div>
                    <div className="font-medium">{row.action_target_table || 'Pending review'}</div>
                  </div>
                </div>

                {row.operator_notes && (
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">{row.operator_notes}</div>
                )}

                {row.extracted_text && (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Extracted preview</div>
                    <pre className="whitespace-pre-wrap text-xs text-foreground max-h-32 overflow-auto">{row.extracted_text.slice(0, 1200)}</pre>
                  </div>
                )}

                <Textarea
                  value={notesById[row.id] ?? row.action_summary ?? ''}
                  onChange={(e) => setNotesById((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  placeholder="Review note or action summary"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: row.id, status: 'review_pending' })} disabled={updateStatus.isPending}>
                    <FileWarning className="h-4 w-4 mr-1" />
                    Stage for Review
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: row.id, status: 'actioned' })} disabled={updateStatus.isPending}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Approve Import
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: row.id, status: 'failed' })} disabled={updateStatus.isPending}>
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    Reject Import
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: row.id, status: 'historical_started' })} disabled={updateStatus.isPending}>
                    <Clock3 className="h-4 w-4 mr-1" />
                    Replay Import
                  </Button>
                  {row.file_public_url && (
                    <Button size="sm" variant="secondary" asChild>
                      <a href={row.file_public_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open File
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
