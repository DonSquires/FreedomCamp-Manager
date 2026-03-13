/**
 * GPSTracker Component
 * Live officer location tracking
 */

import { formatDateTime } from '@/lib/utils'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Navigation,
  MapPin,
  Activity,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

interface OfficerLocation {
  userId: string
  userName: string
  userRole: string
  latitude: number
  longitude: number
  accuracy: number
  timestamp: Date
  activity?: string
  zoneId?: string
  zoneName?: string
}

interface GPSTrackerProps {
  officers: OfficerLocation[]
  currentUserId?: string
  onRefresh?: () => void
  autoRefresh?: boolean
  refreshInterval?: number
}

export function GPSTracker({
  officers,
  currentUserId,
  onRefresh,
  autoRefresh = true,
  refreshInterval = 30000, // 30 seconds
}: GPSTrackerProps) {
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return

    const interval = setInterval(() => {
      onRefresh()
      setLastUpdate(new Date())
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [autoRefresh, onRefresh, refreshInterval])

  const getActivityBadge = (activity?: string) => {
    if (!activity) return null

    const activityColors: Record<string, string> = {
      patrol: 'bg-blue-600',
      investigation: 'bg-purple-600',
      enforcement: 'bg-red-600',
      break: 'bg-gray-600',
    }

    return (
      <Badge className={activityColors[activity] || 'bg-gray-600'}>
        {activity.toUpperCase()}
      </Badge>
    )
  }

  const getAccuracyBadge = (accuracy: number) => {
    if (accuracy <= 10) {
      return <Badge className="bg-green-600">High Accuracy</Badge>
    } else if (accuracy <= 50) {
      return <Badge variant="secondary">Medium Accuracy</Badge>
    } else {
      return <Badge variant="outline">Low Accuracy</Badge>
    }
  }

  const getTimeSince = (timestamp: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 1000)
    
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  const isStale = (timestamp: Date) => {
    const minutes = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000)
    return minutes > 15 // Consider stale if older than 15 minutes
  }

  const handleManualRefresh = () => {
    if (onRefresh) {
      onRefresh()
      setLastUpdate(new Date())
      toast.success('Location data refreshed')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="h-5 w-5" />
              Officer GPS Tracking
            </CardTitle>
            <CardDescription className="mt-1">
              Real-time officer location monitoring
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {officers.length} officer{officers.length !== 1 ? 's' : ''} tracked
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Last update indicator */}
        <div className="flex items-center justify-between text-sm text-muted-foreground border-b pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>Last updated: {getTimeSince(lastUpdate)}</span>
          </div>
          {autoRefresh && (
            <Badge variant="outline" className="text-xs">
              Auto-refresh: {refreshInterval / 1000}s
            </Badge>
          )}
        </div>

        {/* Officer list */}
        {officers && officers.length > 0 ? (
          <div className="space-y-2">
            {officers.map((officer) => {
              const stale = isStale(officer.timestamp)
              const isSelected = selectedOfficer === officer.userId
              const isCurrent = currentUserId === officer.userId

              return (
                <button
                  key={officer.userId}
                  className={`w-full text-left p-4 border rounded-lg hover:bg-muted/50 transition-colors ${
                    isSelected ? 'bg-primary/10 border-primary' : ''
                  } ${stale ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedOfficer(isSelected ? null : officer.userId)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className={`h-5 w-5 ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <div className="font-medium">
                          {officer.userName}
                          {isCurrent && (
                            <Badge variant="outline" className="ml-2 text-xs">You</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {officer.userRole.replace('_', ' ').toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {getActivityBadge(officer.activity)}
                      {stale && (
                        <Badge variant="outline" className="text-xs">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Stale
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Location details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Coordinates:</span>
                      <span className="font-mono">
                        {officer.latitude.toFixed(6)}, {officer.longitude.toFixed(6)}
                      </span>
                    </div>

                    {officer.zoneName && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Current Zone:</span>
                        <span className="font-medium">{officer.zoneName}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Accuracy:</span>
                      <div className="flex items-center gap-2">
                        <span>{officer.accuracy.toFixed(1)}m</span>
                        {getAccuracyBadge(officer.accuracy)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Last ping:</span>
                      <span>{getTimeSince(officer.timestamp)}</span>
                    </div>
                  </div>

                  {/* Expanded details when selected */}
                  {isSelected && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <div className="text-xs">
                        <div className="font-medium mb-1">Timestamp:</div>
                        <div className="text-muted-foreground">
                          {formatDateTime(new Date(officer.timestamp).toISOString())}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(
                            `https://www.google.com/maps?q=${officer.latitude},${officer.longitude}`,
                            '_blank'
                          )
                        }}
                      >
                        <MapPin className="h-4 w-4 mr-2" />
                        View on Google Maps
                      </Button>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Navigation className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No officers currently tracked</p>
            <p className="text-sm mt-1">
              Officers will appear here when they start GPS tracking
            </p>
          </div>
        )}

        {/* Tracking info */}
        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p>• GPS accuracy depends on device and environment</p>
          <p>• Locations update every {refreshInterval / 1000} seconds</p>
          <p>• Stale locations are older than 15 minutes</p>
        </div>
      </CardContent>
    </Card>
  )
}
