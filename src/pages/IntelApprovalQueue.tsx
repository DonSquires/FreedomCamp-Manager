import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Globe2, ShieldAlert, XCircle } from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

type Bulletin = {
  id: string
  organization_id: string | null
  title: string
  summary: string
  type: string
  metadata: any
  source_url: string | null
  approval_status: 'pending' | 'approved' | 'rejected'
  created_at: string
  poi_candidate: any
  voi_candidate: any
}

type SafetyAlert = {
  id: string
  title: string
  message: string
  severity: 'medium' | 'high' | 'critical'
  scope: 'regional' | 'national'
  status: 'pending' | 'active' | 'resolved' | 'rejected'
  created_at: string
  starts_at: string
  target_organization_ids: string[]
}

function severityBadge(severity: string) {
  if (severity === 'critical') return 'destructive'
  if (severity === 'high') return 'secondary'
  return 'outline'
}

export default function IntelApprovalQueue() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [promotePOIVOI, setPromotePOIVOI] = useState<Record<string, boolean>>({})
  const [globalPOIVOI, setGlobalPOIVOI] = useState<Record<string, boolean>>({})

  const isApprover = user?.role === 'master' || user?.role === 'grand_master'

  const { data: bulletins = [], isLoading: loadingBulletins } = useQuery<Bulletin[]>({
    queryKey: ['intel-approval-bulletins', user?.id],
    enabled: !!user && isApprover,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('external_intel_bulletins') as any)
        .select('id, organization_id, title, summary, type, metadata, source_url, approval_status, created_at, poi_candidate, voi_candidate')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data || []) as Bulletin[]
    },
  })

  const { data: safetyAlerts = [], isLoading: loadingSafetyAlerts } = useQuery<SafetyAlert[]>({
    queryKey: ['intel-approval-safety-alerts', user?.id],
    enabled: !!user && isApprover,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('public_safety_alerts') as any)
        .select('id, title, message, severity, scope, status, created_at, starts_at, target_organization_ids')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data || []) as SafetyAlert[]
    },
  })

  const { data: alertDraftByBulletin = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ['intel-bulletin-alert-drafts', bulletins.map((b) => b.id)],
    enabled: !!user && isApprover && bulletins.length > 0,
    queryFn: async () => {
      const bulletinIds = bulletins.map((b) => b.id)
      if (!bulletinIds.length) return new Set<string>()

      const { data, error } = await ((supabase as any).from('public_safety_alerts') as any)
        .select('source_bulletin_id, status')
        .in('source_bulletin_id', bulletinIds)
        .in('status', ['pending', 'active'])

      if (error) throw error

      const ids = new Set<string>()
      for (const row of (data || []) as any[]) {
        if (row.source_bulletin_id) ids.add(String(row.source_bulletin_id))
      }
      return ids
    },
  })

  const approveBulletin = useMutation({
    mutationFn: async (params: { id: string; decision: 'approve' | 'reject' }) => {
      const { error } = await (supabase as any).rpc('approve_external_intel_bulletin', {
        p_bulletin_id: params.id,
        p_decision: params.decision,
        p_note: notes[params.id] || null,
        p_promote_poi_voi: params.decision === 'approve' ? (promotePOIVOI[params.id] ?? true) : false,
        p_global_poi_voi: params.decision === 'approve' ? (globalPOIVOI[params.id] ?? true) : false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intel-approval-bulletins'] })
      queryClient.invalidateQueries({ queryKey: ['public-safety-alerts'] })
      toast.success('Bulletin decision recorded')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update bulletin')
    },
  })

  const approveSafetyAlert = useMutation({
    mutationFn: async (params: { id: string; decision: 'approve' | 'reject' }) => {
      const { error } = await (supabase as any).rpc('approve_public_safety_alert', {
        p_alert_id: params.id,
        p_decision: params.decision,
        p_note: notes[params.id] || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intel-approval-safety-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['public-safety-alerts'] })
      toast.success('Safety alert decision recorded')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update safety alert')
    },
  })

  const createSafetyAlertDraft = useMutation({
    mutationFn: async (bulletin: Bulletin) => {
      if (!user?.id) throw new Error('Missing user context')

      if (alertDraftByBulletin.has(bulletin.id)) {
        throw new Error('A pending or active safety alert already exists for this bulletin')
      }

      const metadata = bulletin.metadata || {}
      const allowedEventTypes = new Set([
        'amber_alert',
        'active_shooter',
        'national_security',
        'civil_defense',
        'severe_weather',
        'emergency_alert',
        'other',
      ])

      const rawSeverity = String(metadata.severity || '').toLowerCase()
      const severity = rawSeverity === 'critical' || rawSeverity === 'high' || rawSeverity === 'medium'
        ? rawSeverity
        : bulletin.type === 'security'
          ? 'high'
          : 'medium'

      const rawScope = String(metadata.scope || '').toLowerCase()
      const scope = rawScope === 'national' ? 'national' : 'regional'

      const rawEventType = String(metadata.event_type || '').toLowerCase()
      const eventType = allowedEventTypes.has(rawEventType)
        ? rawEventType
        : bulletin.type === 'security'
          ? 'emergency_alert'
          : 'other'

      const regionTags = Array.isArray(metadata.target_region_tags)
        ? metadata.target_region_tags.filter((tag: any) => typeof tag === 'string')
        : []

      const targetOrganizationIds = scope === 'national'
        ? []
        : bulletin.organization_id
          ? [bulletin.organization_id]
          : []

      const { error } = await ((supabase as any).from('public_safety_alerts') as any)
        .insert({
          organization_id: bulletin.organization_id,
          source_bulletin_id: bulletin.id,
          created_by: user.id,
          status: 'pending',
          event_type: eventType,
          severity,
          scope,
          title: `Intel Draft: ${bulletin.title}`,
          message: bulletin.summary,
          target_organization_ids: targetOrganizationIds,
          target_region_tags: regionTags,
          starts_at: new Date().toISOString(),
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intel-approval-safety-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intel-bulletin-alert-drafts'] })
      toast.success('Safety alert draft created from bulletin')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to create safety alert draft')
    },
  })

  const totalPending = useMemo(
    () => bulletins.length + safetyAlerts.length,
    [bulletins.length, safetyAlerts.length],
  )

  if (!isApprover) {
    return (
      <AppLayout title="Intel Approval Queue" description="Master and grand master approval workflow for external intelligence and safety alerts.">
        <GlobalFilterRibbon />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            This queue is only available to master or grand_master roles.
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Intel Approval Queue"
      description="Approve or reject external intelligence bulletins and public safety alerts before activation."
    >
      <GlobalFilterRibbon />

      <div className="mb-4 flex items-center gap-2 text-sm">
        <ShieldAlert className="h-4 w-4 text-primary" />
        <span className="text-muted-foreground">Pending decisions:</span>
        <Badge>{totalPending}</Badge>
      </div>

      <Tabs defaultValue="bulletins" className="space-y-4">
        <TabsList>
          <TabsTrigger value="bulletins">External Intel ({bulletins.length})</TabsTrigger>
          <TabsTrigger value="alerts">Safety Alerts ({safetyAlerts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="bulletins" className="space-y-3">
          {loadingBulletins && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading pending bulletins...</CardContent></Card>}
          {!loadingBulletins && bulletins.length === 0 && (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground text-center">
                No pending external intelligence bulletins.
              </CardContent>
            </Card>
          )}

          {bulletins.map((item) => {
            const hasCandidate = Boolean(item.poi_candidate?.full_name || item.voi_candidate?.plate_number)
            return (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between gap-3">
                    <span>{item.title}</span>
                    <Badge variant="outline">{item.type}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                    <span>Created: {formatDateTime(item.created_at)}</span>
                    {item.source_url ? (
                      <a className="underline" href={item.source_url} target="_blank" rel="noreferrer">
                        Source link
                      </a>
                    ) : (
                      <span>No source URL provided</span>
                    )}
                  </div>

                  {hasCandidate && (
                    <div className="rounded-md border p-3 bg-muted/40 space-y-2">
                      <div className="text-sm font-medium">POI/VOI Promotion</div>
                      {item.poi_candidate?.full_name && (
                        <div className="text-xs text-muted-foreground">POI candidate: {item.poi_candidate.full_name}</div>
                      )}
                      {item.voi_candidate?.plate_number && (
                        <div className="text-xs text-muted-foreground">VOI candidate: {item.voi_candidate.plate_number}</div>
                      )}

                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`promote-${item.id}`}
                          checked={promotePOIVOI[item.id] ?? true}
                          onCheckedChange={(checked) =>
                            setPromotePOIVOI((prev) => ({ ...prev, [item.id]: checked === true }))
                          }
                        />
                        <label htmlFor={`promote-${item.id}`}>Promote POI/VOI on approval</label>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`global-${item.id}`}
                          checked={globalPOIVOI[item.id] ?? true}
                          onCheckedChange={(checked) =>
                            setGlobalPOIVOI((prev) => ({ ...prev, [item.id]: checked === true }))
                          }
                        />
                        <label htmlFor={`global-${item.id}`} className="flex items-center gap-1">
                          <Globe2 className="h-3.5 w-3.5" />
                          Apply globally across organisations
                        </label>
                      </div>
                    </div>
                  )}

                  <Textarea
                    value={notes[item.id] || ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="Approval note (optional)"
                  />

                  <Separator />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Button
                      variant="secondary"
                      onClick={() => createSafetyAlertDraft.mutate(item)}
                      disabled={createSafetyAlertDraft.isPending || alertDraftByBulletin.has(item.id)}
                    >
                      {alertDraftByBulletin.has(item.id) ? 'Safety Alert Draft Exists' : 'Create Safety Alert Draft'}
                    </Button>

                    <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => approveBulletin.mutate({ id: item.id, decision: 'reject' })}
                      disabled={approveBulletin.isPending}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => approveBulletin.mutate({ id: item.id, decision: 'approve' })}
                      disabled={approveBulletin.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>

        <TabsContent value="alerts" className="space-y-3">
          {loadingSafetyAlerts && <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading pending safety alerts...</CardContent></Card>}
          {!loadingSafetyAlerts && safetyAlerts.length === 0 && (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground text-center">
                No pending safety alerts.
              </CardContent>
            </Card>
          )}

          {safetyAlerts.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-3">
                  <span>{item.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase">{item.scope}</Badge>
                    <Badge variant={severityBadge(item.severity) as any} className="capitalize">{item.severity}</Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{item.message}</p>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                  <span>Created: {formatDateTime(item.created_at)}</span>
                  <span>Starts: {formatDateTime(item.starts_at)}</span>
                  <span>Targets: {item.scope === 'national' ? 'All organisations' : item.target_organization_ids?.length || 0}</span>
                </div>

                <Textarea
                  value={notes[item.id] || ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="Approval note (optional)"
                />

                <Separator />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => approveSafetyAlert.mutate({ id: item.id, decision: 'reject' })}
                    disabled={approveSafetyAlert.isPending}
                  >
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                  <Button
                    onClick={() => approveSafetyAlert.mutate({ id: item.id, decision: 'approve' })}
                    disabled={approveSafetyAlert.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Activate Alert
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
