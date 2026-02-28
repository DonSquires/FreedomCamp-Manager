import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'

interface TrafficLightStatusProps {
  status: 'allowed' | 'restricted' | 'prohibited' | 'unknown'
  jurisdiction?: string
  restrictionType?: string
  details?: string
  className?: string
}

export function TrafficLightStatus({ 
  status, 
  jurisdiction, 
  restrictionType, 
  details,
  className = '' 
}: TrafficLightStatusProps) {
  const configs = {
    allowed: {
      color: 'bg-green-500',
      textColor: 'text-green-700',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      icon: CheckCircle,
      label: 'Allowed',
      description: 'Freedom camping permitted at this location',
    },
    restricted: {
      color: 'bg-orange-500',
      textColor: 'text-orange-700',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
      icon: AlertTriangle,
      label: 'Restricted',
      description: 'Special conditions apply (e.g., day use only, self-contained required)',
    },
    prohibited: {
      color: 'bg-red-500',
      textColor: 'text-red-700',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      icon: XCircle,
      label: 'Prohibited',
      description: 'Freedom camping not allowed at this location',
    },
    unknown: {
      color: 'bg-gray-500',
      textColor: 'text-gray-700',
      bgColor: 'bg-gray-50',
      borderColor: 'border-gray-200',
      icon: HelpCircle,
      label: 'Unknown',
      description: 'Unable to determine compliance status',
    },
  }

  const config = configs[status]
  const Icon = config.icon

  return (
    <Card className={`${config.borderColor} border-2 ${className}`}>
      <CardContent className={`p-6 ${config.bgColor}`}>
        <div className="flex items-start gap-4">
          {/* Traffic Light Circle */}
          <div className="flex flex-col gap-2">
            <div className={`h-16 w-16 rounded-full ${config.color} animate-pulse flex items-center justify-center shadow-lg`}>
              <Icon className="h-8 w-8 text-white" />
            </div>
          </div>

          {/* Status Info */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge className={`${config.textColor} ${config.bgColor} border ${config.borderColor}`}>
                {config.label.toUpperCase()}
              </Badge>
              {restrictionType && (
                <Badge variant="outline" className="text-xs">
                  {restrictionType.replace('_', ' ').toUpperCase()}
                </Badge>
              )}
            </div>

            <p className={`text-sm font-medium ${config.textColor}`}>
              {config.description}
            </p>

            {jurisdiction && (
              <p className="text-xs text-gray-600">
                <span className="font-semibold">Jurisdiction:</span> {jurisdiction}
              </p>
            )}

            {details && (
              <p className="text-xs text-gray-600 mt-2 border-t pt-2">
                {details}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
