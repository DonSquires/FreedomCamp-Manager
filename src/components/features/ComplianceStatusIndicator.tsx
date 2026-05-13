/**
 * ComplianceStatusIndicator Component
 * Visual compliance status with detailed breakdown
 */

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { 
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Shield,
} from 'lucide-react'

interface ComplianceStatusIndicatorProps {
  status: 'compliant' | 'breach' | 'warning' | 'pending' | 'exempt'
  statusReason?: string
  nightsStayed?: number
  maxNights?: number
  consecutiveNights?: number
  maxConsecutive?: number
  showProgress?: boolean
  showDetails?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function ComplianceStatusIndicator({
  status,
  statusReason,
  nightsStayed,
  maxNights,
  consecutiveNights,
  maxConsecutive,
  showProgress = true,
  showDetails = true,
  size = 'md',
}: ComplianceStatusIndicatorProps) {
  const getStatusIcon = () => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'md' ? 'h-5 w-5' : 'h-6 w-6'
    
    switch (status) {
      case 'compliant':
        return <CheckCircle2 className={`${iconSize} text-green-600`} />
      case 'breach':
        return <XCircle className={`${iconSize} text-red-600`} />
      case 'warning':
        return <AlertTriangle className={`${iconSize} text-yellow-600`} />
      case 'exempt':
        return <Shield className={`${iconSize} text-blue-600`} />
      case 'pending':
        return <Clock className={`${iconSize} text-gray-600`} />
    }
  }

  const getStatusBadge = () => {
    switch (status) {
      case 'compliant':
        return <Badge className="bg-green-600">Compliant</Badge>
      case 'breach':
        return <Badge variant="destructive">Breach</Badge>
      case 'warning':
        return <Badge className="bg-yellow-600">Warning</Badge>
      case 'exempt':
        return <Badge className="bg-blue-600">Exempt</Badge>
      case 'pending':
        return <Badge variant="outline">Pending Review</Badge>
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'compliant':
        return 'border-green-500 bg-green-50 dark:bg-green-900/20'
      case 'breach':
        return 'border-red-500 bg-red-50 dark:bg-red-900/20'
      case 'warning':
        return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
      case 'exempt':
        return 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
      case 'pending':
        return 'border-gray-300 bg-gray-50 dark:bg-[#1A1A1A]/20'
    }
  }

  const getProgressColor = () => {
    const percentage = nightsStayed && maxNights ? (nightsStayed / maxNights) * 100 : 0
    
    if (percentage >= 90) return 'bg-red-600'
    if (percentage >= 75) return 'bg-yellow-600'
    return 'bg-green-600'
  }

  const nightsPercentage = nightsStayed && maxNights ? (nightsStayed / maxNights) * 100 : 0
  const consecutivePercentage = consecutiveNights && maxConsecutive 
    ? (consecutiveNights / maxConsecutive) * 100 
    : 0

  if (size === 'sm') {
    return (
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        {getStatusBadge()}
      </div>
    )
  }

  return (
    <Card className={getStatusColor()}>
      <CardContent className="pt-4 space-y-3">
        {/* Status header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <div>
              <div className="font-medium">
                {status === 'compliant' && 'Compliant'}
                {status === 'breach' && 'Breach Detected'}
                {status === 'warning' && 'Warning Level'}
                {status === 'exempt' && 'Exempt Status'}
                {status === 'pending' && 'Pending Review'}
              </div>
              {statusReason && (
                <div className="text-sm text-muted-foreground mt-1">
                  {statusReason}
                </div>
              )}
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Progress bars */}
        {showProgress && (nightsStayed !== undefined || consecutiveNights !== undefined) && (
          <div className="space-y-3 pt-3 border-t">
            {nightsStayed !== undefined && maxNights !== undefined && (
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Monthly stays</span>
                  <span className="font-medium">
                    {nightsStayed} / {maxNights} nights
                  </span>
                </div>
                <Progress value={nightsPercentage} className={getProgressColor()} />
              </div>
            )}

            {consecutiveNights !== undefined && maxConsecutive !== undefined && (
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Consecutive stays</span>
                  <span className="font-medium">
                    {consecutiveNights} / {maxConsecutive} nights
                  </span>
                </div>
                <Progress value={consecutivePercentage} className={getProgressColor()} />
              </div>
            )}
          </div>
        )}

        {/* Details */}
        {showDetails && status === 'breach' && (
          <div className="p-3 bg-red-100 dark:bg-red-900/40 rounded-lg border border-red-200 dark:border-red-800">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
              <div className="text-sm text-red-900 dark:text-red-100">
                <div className="font-medium">Enforcement required</div>
                <div className="mt-1">
                  Immediate action needed to address compliance violation
                </div>
              </div>
            </div>
          </div>
        )}

        {showDetails && status === 'warning' && (
          <div className="p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
              <div className="text-sm text-yellow-900 dark:text-yellow-100">
                <div className="font-medium">Approaching limit</div>
                <div className="mt-1">
                  Vehicle nearing compliance threshold - monitor closely
                </div>
              </div>
            </div>
          </div>
        )}

        {showDetails && status === 'exempt' && (
          <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <div className="font-medium">Exempt from enforcement</div>
                <div className="mt-1">
                  Vehicle has exemption status - no action required
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
