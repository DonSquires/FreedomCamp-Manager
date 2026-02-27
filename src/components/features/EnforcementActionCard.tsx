/**
 * EnforcementActionCard Component
 * Single enforcement action display with status and details
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FileText,
  Calendar,
  MapPin,
  User,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Edit,
} from 'lucide-react'

interface EnforcementAction {
  id: string
  action_type: string
  status: string
  plate_number: string
  zone_name: string
  recorded_at: string
  delivery_method?: string
  recipient_name?: string
  assigned_to?: {
    first_name: string
    last_name: string
  }
  notes?: string
  delivered_at?: string
  completed_at?: string
}

interface EnforcementActionCardProps {
  action: EnforcementAction
  onViewDetails?: () => void
  onEdit?: () => void
  onComplete?: () => void
  showActions?: boolean
  compact?: boolean
}

export function EnforcementActionCard({
  action,
  onViewDetails,
  onEdit,
  onComplete,
  showActions = true,
  compact = false,
}: EnforcementActionCardProps) {
  const getStatusIcon = () => {
    switch (action.status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />
      default:
        return <AlertTriangle className="h-5 w-5 text-gray-600" />
    }
  }

  const getStatusBadge = () => {
    switch (action.status) {
      case 'completed':
        return <Badge className="bg-green-600">Completed</Badge>
      case 'pending':
        return <Badge className="bg-yellow-600">Pending</Badge>
      case 'delivered':
        return <Badge className="bg-blue-600">Delivered</Badge>
      case 'assigned':
        return <Badge variant="secondary">Assigned</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="outline">{action.status}</Badge>
    }
  }

  const getActionTypeLabel = () => {
    switch (action.action_type) {
      case 'warning':
        return 'Warning Notice'
      case 'notice_to_vacate':
        return 'Notice to Vacate'
      case 'tow_request':
        return 'Tow Request'
      case 'referral':
        return 'Escalation Referral'
      default:
        return action.action_type
    }
  }

  const getActionTypeColor = () => {
    switch (action.action_type) {
      case 'warning':
        return 'border-yellow-500'
      case 'notice_to_vacate':
        return 'border-orange-500'
      case 'tow_request':
        return 'border-red-500'
      case 'referral':
        return 'border-purple-500'
      default:
        return 'border-gray-300'
    }
  }

  if (compact) {
    return (
      <Card className={`${getActionTypeColor()}`}>
        <CardContent className="pt-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              {getStatusIcon()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">
                    {getActionTypeLabel()}
                  </span>
                  {getStatusBadge()}
                </div>
                <div className="text-sm text-muted-foreground">
                  {action.plate_number} • {action.zone_name}
                </div>
              </div>
            </div>
            {onViewDetails && (
              <Button variant="ghost" size="sm" onClick={onViewDetails}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={`${getActionTypeColor()}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {getStatusIcon()}
            <div>
              <CardTitle className="text-lg">{getActionTypeLabel()}</CardTitle>
              <CardDescription className="mt-1">
                Action #{action.id.substring(0, 8)}
              </CardDescription>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Vehicle and zone */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-lg">{action.plate_number}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>{action.zone_name}</span>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t text-sm">
          <div>
            <div className="text-muted-foreground mb-1">Created</div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3 w-3" />
              <span>{new Date(action.recorded_at).toLocaleDateString()}</span>
            </div>
          </div>

          {action.delivered_at && (
            <div>
              <div className="text-muted-foreground mb-1">Delivered</div>
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span>{new Date(action.delivered_at).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {action.completed_at && (
            <div>
              <div className="text-muted-foreground mb-1">Completed</div>
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span>{new Date(action.completed_at).toLocaleDateString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Assignment */}
        {action.assigned_to && (
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Assigned to:</span>
            <span className="font-medium">
              {action.assigned_to.first_name} {action.assigned_to.last_name}
            </span>
          </div>
        )}

        {/* Delivery method */}
        {action.delivery_method && (
          <div className="text-sm">
            <span className="text-muted-foreground">Delivery:</span>{' '}
            <span className="font-medium">{action.delivery_method}</span>
            {action.recipient_name && ` to ${action.recipient_name}`}
          </div>
        )}

        {/* Notes */}
        {action.notes && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="text-muted-foreground mb-1">Notes</div>
            <div>{action.notes}</div>
          </div>
        )}

        {/* Actions */}
        {showActions && (
          <div className="flex gap-2 pt-3 border-t">
            {onViewDetails && (
              <Button variant="outline" size="sm" onClick={onViewDetails}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Details
              </Button>
            )}
            {onEdit && action.status === 'pending' && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            {onComplete && action.status === 'pending' && (
              <Button size="sm" onClick={onComplete}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Complete
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
