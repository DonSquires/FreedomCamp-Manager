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
import { CheckCircle2, Clock3, FileWarning, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

type ReviewStatus = 'pending' | 'acknowledged' | 'completed'

interface LivePlanReviewRow {
  id: string
  organization_id: string
  plan_id: string
  source_type: 'incident' | 'hs_report' | 'poi_report' | 'voi_report'
  source_table: string
  source_id: string
  zone_id: string | null
  client_site_id: string | null
  event_at: string
  status: ReviewStatus
  notes: string | null
  created_at: string
  plan: {
    id: string
    title: string
    plan_type: string
    assignment_scope: string
    field_staff_can_view: boolean
    status: string
  } | null
  zone: { name: string } | null
  client_site: { name: string } | null
}

const STATUS_OPTIONS: Array<'all' | ReviewStatus> = ['all', 'pending', 'acknowledged', 'completed']

export default function OpsLivePlanReviewQueue() {
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>('all')
  const [notesById, setNotesById] = useState<Record<string, string>>({})

  const canUpdate =
    user?.role === 'admin' ||
    user?.role === 'admin_officer' ||
    user?.role === 'master' ||
    user?.role === 'grand_master'

  const { data: rows = [], isLoading } = useQuery<LivePlanReviewRow[]>({
    queryKey: ['ops-live-plan-reviews', user?.id, user?.role, statusFilter],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = ((((supabase as any).from('ops_live_plan_reviews')) as any)
        .select(
          `
          id,
          organization_id,
          plan_id,
          source_type,
          source_table,
          source_id,
          zone_id,
          client_site_id,
          event_at,
          status,
          notes,
          created_at,
          plan:ops_live_plans!plan_id(id, title, plan_type, assignment_scope, field_staff_can_view, status),
          zone:zones!zone_id(name),
          client_site:client_sites!client_site_id(name)
          `,
        ) as any)
        .order('event_at', { ascending: false })
        .limit(150)

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as LivePlanReviewRow[]
    },
  })

  const updateStatus = useMutation({
    mutationFn: async (params: { id: string; status: ReviewStatus }) => {
      const summary = notesById[params.id]?.trim() || null
      const { error } = await ((((supabase as any).from('ops_live_plan_reviews')) as any)
        .update({ status: params.status, notes: summary }) as any)
        .eq('id', params.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-live-plan-reviews'] })
      toast.success('Live plan review updated')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update live plan review')
    },
  })

  const stats = useMemo(() => {
    return {
      pending: rows.filter((row) => row.status === 'pending').length,
      acknowledged: rows.filter((row) => row.status === 'acknowledged').length,
      completed: rows.filter((row) => row.status === 'completed').length,
    }
  }, [rows])

  return (
    <AppLayout title="Live Plan Review Queue" description="Live operational documents requiring review after incident, H&S, POI, or VOI activity by zone/location.">
      <GlobalFilterRibbon />

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className="gap-1"><Clock3 className="h-3.5 w-3.5" /> Pending {stats.pending}</Badge>
          <Badge variant="secondary">Acknowledged {stats.acknowledged}</Badge>
          <Badge>Completed {stats.completed}</Badge>
        </div>

        <div className="w-[220px]">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | ReviewStatus)}>
            <SelectTrigger>
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>{status.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Loading live plan reviews...</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No live plan review events match this filter.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{row.plan?.title || 'Unknown plan'}</span>
                    <Badge variant="outline">{row.source_type.replace('_', ' ')}</Badge>
                    <Badge>{row.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatDateTime(row.event_at)}
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Plan Type</div>
                    <div className="font-medium">{row.plan?.plan_type || 'n/a'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Assignment Scope</div>
                    <div className="font-medium">{row.plan?.assignment_scope || 'n/a'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Zone</div>
                    <div className="font-medium">{row.zone?.name || 'n/a'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Client Site</div>
                    <div className="font-medium">{row.client_site?.name || 'n/a'}</div>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Source: {row.source_table} / {row.source_id}
                </div>

                <Textarea
                  value={notesById[row.id] ?? row.notes ?? ''}
                  onChange={(e) => setNotesById((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  placeholder="Review note"
                  disabled={!canUpdate}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatus.mutate({ id: row.id, status: 'acknowledged' })}
                    disabled={!canUpdate || updateStatus.isPending}
                  >
                    <FileWarning className="h-4 w-4 mr-1" />
                    Acknowledge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatus.mutate({ id: row.id, status: 'completed' })}
                    disabled={!canUpdate || updateStatus.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Mark Completed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatus.mutate({ id: row.id, status: 'pending' })}
                    disabled={!canUpdate || updateStatus.isPending}
                  >
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    Reopen Pending
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
