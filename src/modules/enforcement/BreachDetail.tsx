import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useBreach, useResolveBreach } from '@/hooks/useBreaches'
import { useBreachAlertCase, useCreateCaseFromBreach, useEnforcementTimeline } from '@/hooks/useEnforcementB4'
import { useFeatureFlag } from '@/hooks/useOperationalCases'
import { useAuthStore } from '@/stores/authStore'

const EVENT_TYPE_LABELS: Record<string, string> = {
  enforcement_initiated: 'Initiated',
  enforcement_warning_issued: 'Warning Issued',
  enforcement_ticket_issued: 'Ticket Issued',
  enforcement_apprehension: 'Apprehension',
  enforcement_completed: 'Completed',
  enforcement_cancelled: 'Cancelled',
}

const EVENT_TYPE_COLOURS: Record<string, string> = {
  enforcement_initiated: 'bg-blue-100 text-blue-800',
  enforcement_warning_issued: 'bg-yellow-100 text-yellow-800',
  enforcement_ticket_issued: 'bg-orange-100 text-orange-800',
  enforcement_apprehension: 'bg-red-100 text-red-800',
  enforcement_completed: 'bg-green-100 text-green-800',
  enforcement_cancelled: 'bg-gray-100 text-gray-600',
}

interface BreachDetailProps {
  breachId: string
}

export default function BreachDetail({ breachId }: BreachDetailProps) {
  const { user } = useAuthStore()
  const { data: breach, isLoading } = useBreach(breachId)
  const resolveBreach = useResolveBreach()

  // Phase B: enforcement timeline (feature-flagged)
  const { data: timelineEnabled } = useFeatureFlag('FF_PHASE_B_ENFORCEMENT_TIMELINE')
  const { data: breachCase, isLoading: caseLoading } = useBreachAlertCase(breachId)
  const { data: timeline = [], isLoading: timelineLoading } = useEnforcementTimeline(breachCase?.case_id ?? undefined)
  const createCase = useCreateCaseFromBreach()

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading breach detail...</p>
  }

  if (!breach) {
    return <p className="text-sm text-muted-foreground">No breach selected.</p>
  }

  const status = breach.status || 'pending'
  const notes =
    breach.resolution_notes ||
    breach.admin_review_notes ||
    (typeof breach.breach_details === 'object' && breach.breach_details && 'notes' in breach.breach_details
      ? String(breach.breach_details.notes)
      : null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Breach Detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Plate</p>
              <p className="text-sm font-medium">{breach.plate_number || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Status</p>
              <div className="mt-1">
                <Badge variant={status === 'resolved' ? 'outline' : 'secondary'}>{status}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Type</p>
              <p className="text-sm">{breach.breach_type || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Zone</p>
              <p className="text-sm">{breach.zone?.name || 'Unassigned'}</p>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase text-muted-foreground">Created</p>
            <p className="text-sm">{breach.created_at ? new Date(breach.created_at).toLocaleString() : 'Unknown'}</p>
          </div>

          <div>
            <p className="text-xs uppercase text-muted-foreground">Notes</p>
            <p className="text-sm text-muted-foreground">{notes || 'No notes provided.'}</p>
          </div>

          {status !== 'resolved' && (
            <Button
              onClick={() => {
                if (!user?.id) return
                resolveBreach.mutate({ breachId, userId: user.id })
              }}
              disabled={resolveBreach.isPending || !user?.id}
            >
              {resolveBreach.isPending ? 'Resolving...' : 'Mark Resolved'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Phase B: Enforcement Timeline (FF_PHASE_B_ENFORCEMENT_TIMELINE) */}
      {timelineEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enforcement Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {caseLoading ? (
              <p className="text-sm text-muted-foreground">Loading case...</p>
            ) : !breachCase?.case_id ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No operational case linked to this breach.</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createCase.isPending}
                  onClick={() => createCase.mutate(breachId)}
                >
                  {createCase.isPending ? 'Creating case...' : 'Create Enforcement Case'}
                </Button>
              </div>
            ) : timelineLoading ? (
              <p className="text-sm text-muted-foreground">Loading timeline...</p>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No enforcement events recorded yet.</p>
            ) : (
              <ol className="relative border-l border-border pl-4 space-y-4">
                {timeline.map((event) => (
                  <li key={event.id} className="relative">
                    <div className="absolute -left-[1.125rem] top-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={EVENT_TYPE_COLOURS[event.event_type] || 'bg-gray-100 text-gray-800'}>
                        {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {event.event_timestamp ? new Date(event.event_timestamp).toLocaleString() : '—'}
                      </span>
                    </div>
                    {(event.action_taken || event.outcome || event.evidence_notes) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[event.action_taken, event.outcome, event.evidence_notes].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}