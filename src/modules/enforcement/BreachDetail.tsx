import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useBreach, useResolveBreach } from '@/hooks/useBreaches'
import { useAuthStore } from '@/stores/authStore'

interface BreachDetailProps {
  breachId: string
}

export default function BreachDetail({ breachId }: BreachDetailProps) {
  const { user } = useAuthStore()
  const { data: breach, isLoading } = useBreach(breachId)
  const resolveBreach = useResolveBreach()

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
  )
}