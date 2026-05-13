import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DetailPanelLayout } from '@/components/shared/DetailPanelLayout'
import { usePatrolDetail, useUpdatePatrolStatus } from './hooks'

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  scheduled: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
}

export default function PatrolDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: patrol, isLoading } = usePatrolDetail(id)
  const updateStatus = useUpdatePatrolStatus()

  const actions = useMemo(() => {
    if (!patrol?.id) return []

    const nextActions = []

    if (patrol.status === 'scheduled') {
      nextActions.push({
        label: 'Start Patrol',
        onClick: () => updateStatus.mutate({ patrolId: patrol.id, status: 'active' }),
      })
      nextActions.push({
        label: 'Cancel',
        onClick: () => updateStatus.mutate({ patrolId: patrol.id, status: 'cancelled' }),
        variant: 'destructive' as const,
      })
    }

    if (patrol.status === 'active') {
      nextActions.push({
        label: 'Complete Patrol',
        onClick: () => updateStatus.mutate({ patrolId: patrol.id, status: 'completed' }),
      })
    }

    return nextActions
  }, [patrol, updateStatus])

  return (
    <DetailPanelLayout
      title={patrol ? `Patrol ${patrol.id.slice(0, 8)}` : 'Patrol Detail'}
      subtitle={patrol ? `${patrol.officer_name} • ${patrol.zone_name}` : 'Loading patrol'}
      loading={isLoading}
      onBack={() => navigate('/patrols')}
      actions={actions}
      tabs={[
        {
          id: 'overview',
          label: 'Overview',
          component: patrol ? (
            <Card>
              <CardHeader>
                <CardTitle>Patrol Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Status</p>
                  <div className="mt-2">
                    <Badge variant={STATUS_VARIANTS[patrol.status || 'scheduled'] || 'secondary'}>
                      {patrol.status || 'unknown'}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Officer</p>
                  <p className="mt-2 text-sm font-medium">{patrol.officer_name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Scheduled Start</p>
                  <p className="mt-2 text-sm">
                    {patrol.scheduled_start_time ? new Date(patrol.scheduled_start_time).toLocaleString() : 'Not set'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Scheduled End</p>
                  <p className="mt-2 text-sm">
                    {patrol.scheduled_end_time ? new Date(patrol.scheduled_end_time).toLocaleString() : 'Not set'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Actual Start</p>
                  <p className="mt-2 text-sm">
                    {patrol.started_at ? new Date(patrol.started_at).toLocaleString() : 'Not started'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Actual End</p>
                  <p className="mt-2 text-sm">
                    {patrol.ended_at ? new Date(patrol.ended_at).toLocaleString() : 'Not finished'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null,
        },
        {
          id: 'notes',
          label: 'Notes',
          component: (
            <Card>
              <CardHeader>
                <CardTitle>Operational Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {patrol?.notes?.trim() || 'No notes recorded for this patrol.'}
                </p>
              </CardContent>
            </Card>
          ),
        },
      ]}
    />
  )
}