import { useState, type ReactElement } from 'react'
import { AlertTriangle, Heart, FileText, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Alert {
  id: string
  type: 'breach' | 'welfare' | 'incident' | 'system'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  timestamp: string
  read?: boolean
  organizationId?: string
}

interface UnifiedAlertQueueProps {
  alerts: Alert[]
  onAcknowledge?: (alertId: string) => void
  onViewDetails?: (alertId: string) => void
  maxVisible?: number
  className?: string
}

function getRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const severityStyles: Record<Alert['severity'], string> = {
  critical: 'border-l-red-500 bg-red-50',
  high: 'border-l-orange-500 bg-orange-50',
  medium: 'border-l-yellow-500 bg-yellow-50',
  low: 'border-l-gray-300 bg-gray-50',
}

const severityBadge: Record<Alert['severity'], string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-700',
}

const typeIcon: Record<Alert['type'], ReactElement> = {
  breach: <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />,
  welfare: <Heart className="h-4 w-4 text-pink-500 flex-shrink-0" />,
  incident: <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />,
  system: <Bell className="h-4 w-4 text-gray-500 flex-shrink-0" />,
}

export function UnifiedAlertQueue({
  alerts,
  onAcknowledge,
  onViewDetails,
  maxVisible = 10,
  className,
}: UnifiedAlertQueueProps) {
  const visible = alerts.slice(0, maxVisible)

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
          <Bell className="h-8 w-8 opacity-40" />
          <span className="text-sm">No active alerts</span>
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[520px] space-y-2 pr-1">
          {visible.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'border-l-4 rounded-r-md px-3 py-2 flex items-start gap-3',
                severityStyles[alert.severity]
              )}
            >
              {/* Unread dot */}
              <div className="mt-1 flex-shrink-0">
                {!alert.read ? (
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                ) : (
                  <span className="inline-block h-2 w-2" />
                )}
              </div>

              {typeIcon[alert.type]}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      'text-xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide',
                      severityBadge[alert.severity]
                    )}
                  >
                    {alert.severity}
                  </span>
                  <span className="text-xs text-gray-500 capitalize">{alert.type}</span>
                  <span className="text-xs text-gray-400 ml-auto">{getRelativeTime(alert.timestamp)}</span>
                </div>
                <p className="text-sm text-gray-800 mt-0.5 leading-snug">{alert.message}</p>
              </div>

              <div className="flex flex-col gap-1 flex-shrink-0">
                {onAcknowledge && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2"
                    onClick={() => onAcknowledge(alert.id)}
                  >
                    Acknowledge
                  </Button>
                )}
                {onViewDetails && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs px-2"
                    onClick={() => onViewDetails(alert.id)}
                  >
                    Details
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
