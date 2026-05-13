import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { usePatrols } from './hooks'

export default function LiveMonitor() {
  const { data: patrols, isLoading } = usePatrols({ status: 'active' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Patrol Monitor</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading active patrols...</p>
        ) : patrols && patrols.length > 0 ? (
          <div className="space-y-2">
            {patrols.slice(0, 20).map((patrol) => (
              <div key={patrol.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{patrol.officer_name}</p>
                  <p className="text-xs text-muted-foreground">{patrol.zone_name}</p>
                </div>
                <div className="text-right">
                  <Badge>Active</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Started {patrol.started_at ? new Date(patrol.started_at).toLocaleTimeString() : 'unknown'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active patrols right now.</p>
        )}
      </CardContent>
    </Card>
  )
}
