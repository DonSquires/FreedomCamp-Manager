import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePatrols } from './hooks'

export default function Analytics() {
  const { data: patrols, isLoading } = usePatrols()

  const total = patrols?.length || 0
  const active = patrols?.filter((p) => p.status === 'active').length || 0
  const completed = patrols?.filter((p) => p.status === 'completed').length || 0
  const scheduled = patrols?.filter((p) => p.status === 'scheduled').length || 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patrol Analytics</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading analytics...</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{total}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">{active}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{completed}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Scheduled</p>
              <p className="text-2xl font-bold">{scheduled}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
