/**
 * BreachAdvisoryCard Component
 * Quick breach summary with actions
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  AlertTriangle,
  Calendar,
  MapPin,
  Flag,
  FileText,
  TrendingUp,
  ExternalLink,
} from 'lucide-react'

interface BreachAdvisoryCardProps {
  plateNumber: string
  breachType: string
  breachReason: string
  breachDate: string
  zoneId: string
  zoneName: string
  nightsStayed?: number
  consecutiveNights?: number
  priority?: 'low' | 'medium' | 'high'
  onViewDetails?: () => void
  onCreateWarning?: () => void
  onCreateNotice?: () => void
  showActions?: boolean
}

export function BreachAdvisoryCard({
  plateNumber,
  breachType,
  breachReason,
  breachDate,
  zoneId,
  zoneName,
  nightsStayed,
  consecutiveNights,
  priority = 'medium',
  onViewDetails,
  onCreateWarning,
  onCreateNotice,
  showActions = true,
}: BreachAdvisoryCardProps) {
  const getPriorityColor = () => {
    switch (priority) {
      case 'high':
        return 'border-red-500 bg-red-50 dark:bg-red-900/20'
      case 'medium':
        return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
      case 'low':
        return 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
    }
  }

  const getPriorityBadge = () => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive">High Priority</Badge>
      case 'medium':
        return <Badge variant="secondary">Medium Priority</Badge>
      case 'low':
        return <Badge variant="outline">Low Priority</Badge>
    }
  }

  return (
    <Card className={getPriorityColor()}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Breach Advisory
            </CardTitle>
            <CardDescription className="mt-1">
              Compliance violation detected
            </CardDescription>
          </div>
          {getPriorityBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Plate number */}
        <div>
          <div className="text-3xl font-bold">{plateNumber}</div>
        </div>

        {/* Breach details */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Flag className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <div className="font-medium">{breachType}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {breachReason}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>
              Detected: {new Date(breachDate).toLocaleDateString()} at{' '}
              {new Date(breachDate).toLocaleTimeString()}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span>{zoneName}</span>
          </div>
        </div>

        {/* Stay metrics */}
        {(nightsStayed !== undefined || consecutiveNights !== undefined) && (
          <div className="flex gap-4 pt-3 border-t">
            {nightsStayed !== undefined && (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-2xl font-bold">{nightsStayed}</div>
                  <div className="text-xs text-muted-foreground">
                    nights this month
                  </div>
                </div>
              </div>
            )}
            {consecutiveNights !== undefined && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-2xl font-bold">{consecutiveNights}</div>
                  <div className="text-xs text-muted-foreground">
                    consecutive nights
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {showActions && (
          <div className="flex flex-col gap-2 pt-4 border-t">
            {onViewDetails && (
              <Button variant="outline" onClick={onViewDetails}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Full Details
              </Button>
            )}
            
            <div className="flex gap-2">
              {onCreateWarning && (
                <Button
                  variant="secondary"
                  onClick={onCreateWarning}
                  className="flex-1"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Issue Warning
                </Button>
              )}
              {onCreateNotice && (
                <Button
                  variant="default"
                  onClick={onCreateNotice}
                  className="flex-1"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Notice to Vacate
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
