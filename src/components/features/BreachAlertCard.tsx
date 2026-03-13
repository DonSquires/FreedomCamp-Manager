/**
 * BreachAlertCard Component
 * Real-time breach notification card
 */

import { formatDate, formatDateTime } from '@/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { 
  AlertTriangle,
  MapPin,
  Calendar,
  Bell,
  BellOff,
  X,
  ExternalLink,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'

interface BreachAlert {
  id: string
  plate_number: string
  breach_type: string
  breach_details: any
  zone_id: string
  zones?: {
    name: string
  }
  status: string
  created_at: string
  notification_sent: boolean
  due_date?: string
}

interface BreachAlertCardProps {
  alert: BreachAlert
  onDismiss?: (alertId: string) => void
  onViewDetails?: (alertId: string) => void
  showActions?: boolean
  compact?: boolean
}

export function BreachAlertCard({
  alert,
  onDismiss,
  onViewDetails,
  showActions = true,
  compact = false,
}: BreachAlertCardProps) {
  const queryClient = useQueryClient()

  // Acknowledge/dismiss alert mutation
  const dismissAlertMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ status: 'acknowledged' })
        .eq('id', alert.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Alert acknowledged')
      if (onDismiss) {
        onDismiss(alert.id)
      }
    },
    onError: (error: any) => {
      toast.error(`Failed to dismiss alert: ${error.message}`)
    },
  })

  // Toggle notification mutation
  const toggleNotificationMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ notification_sent: !alert.notification_sent })
        .eq('id', alert.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success(alert.notification_sent ? 'Notification disabled' : 'Notification enabled')
    },
    onError: (error: any) => {
      toast.error(`Failed to toggle notification: ${error.message}`)
    },
  })

  const getPriorityColor = () => {
    // Determine priority based on breach type
    const highPriority = ['overstay_monthly', 'overstay_consecutive', 'no_csc']
    if (highPriority.includes(alert.breach_type)) {
      return 'border-red-500 bg-red-50 dark:bg-red-900/20'
    }
    return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
  }

  const isOverdue = alert.due_date && new Date(alert.due_date) < new Date()

  if (compact) {
    return (
      <Card className={getPriorityColor()}>
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium truncate">{alert.plate_number}</span>
                <Badge variant="destructive" className="text-xs">
                  {alert.breach_type}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {(alert.zones as any)?.name || 'Unknown zone'}
              </div>
            </div>
            {onViewDetails && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewDetails(alert.id)}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={getPriorityColor()}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-red-600" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl font-bold">{alert.plate_number}</span>
                <Badge variant="destructive">
                  {alert.breach_type.replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                Alert #{alert.id.substring(0, 8)}
              </div>
            </div>
          </div>

          {alert.notification_sent ? (
            <Badge className="bg-green-600">
              <Bell className="h-3 w-3 mr-1" />
              Notified
            </Badge>
          ) : (
            <Badge variant="outline">
              <BellOff className="h-3 w-3 mr-1" />
              Not Notified
            </Badge>
          )}
        </div>

        {/* Details */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span>{(alert.zones as any)?.name || 'Unknown zone'}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>Detected: {formatDateTime(alert.created_at)}</span>
          </div>

          {alert.due_date && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                Due: {formatDate(alert.due_date)}
                {isOverdue && (
                  <Badge variant="destructive" className="ml-2 text-xs">
                    OVERDUE
                  </Badge>
                )}
              </span>
            </div>
          )}

          {alert.breach_details && (
            <div className="p-2 bg-muted rounded text-xs mt-2">
              {typeof alert.breach_details === 'string' 
                ? alert.breach_details 
                : JSON.stringify(alert.breach_details, null, 2)
              }
            </div>
          )}
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex gap-2 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleNotificationMutation.mutate()}
              disabled={toggleNotificationMutation.isPending}
            >
              {alert.notification_sent ? (
                <>
                  <BellOff className="h-4 w-4 mr-2" />
                  Disable Alerts
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Enable Alerts
                </>
              )}
            </Button>

            {onViewDetails && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onViewDetails(alert.id)}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Details
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismissAlertMutation.mutate()}
              disabled={dismissAlertMutation.isPending}
              className="ml-auto"
            >
              <X className="h-4 w-4 mr-2" />
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
