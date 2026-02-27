/**
 * RouteVisualizer Component
 * Patrol route display with timeline
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Route,
  MapPin,
  Clock,
  Navigation,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
} from 'lucide-react'

interface RoutePoint {
  latitude: number
  longitude: number
  timestamp: Date
  activity?: string
  notes?: string
  speed?: number
  heading?: number
}

interface RouteVisualizerProps {
  route: RoutePoint[]
  title?: string
  officerName?: string
  startTime?: Date
  endTime?: Date
  onPointClick?: (point: RoutePoint) => void
}

export function RouteVisualizer({
  route,
  title = 'Patrol Route',
  officerName,
  startTime,
  endTime,
  onPointClick,
}: RouteVisualizerProps) {
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [animationProgress, setAnimationProgress] = useState(0)

  const handlePlayPause = () => {
    setIsAnimating(!isAnimating)
  }

  const handleReset = () => {
    setIsAnimating(false)
    setAnimationProgress(0)
    setSelectedPointIndex(null)
  }

  // Calculate route statistics
  const stats = {
    totalPoints: route.length,
    totalDistance: 0, // Would calculate using haversine formula
    avgSpeed: route.reduce((sum, p) => sum + (p.speed || 0), 0) / (route.length || 1),
    duration: endTime && startTime 
      ? Math.floor((endTime.getTime() - startTime.getTime()) / 60000) // minutes
      : 0,
  }

  const getActivityColor = (activity?: string) => {
    switch (activity) {
      case 'observation':
        return '#3b82f6' // blue
      case 'enforcement':
        return '#ef4444' // red
      case 'investigation':
        return '#8b5cf6' // purple
      case 'break':
        return '#6b7280' // gray
      default:
        return '#10b981' // green (moving)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Route className="h-5 w-5" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">
              {officerName && `Officer: ${officerName}`}
              {startTime && ` • Started ${new Date(startTime).toLocaleTimeString()}`}
            </CardDescription>
          </div>
          <Badge variant="secondary">
            {route.length} point{route.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Route statistics */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">{stats.totalPoints}</div>
            <div className="text-xs text-muted-foreground">Points</div>
          </div>
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">{stats.totalDistance.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">km</div>
          </div>
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">{stats.avgSpeed.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground">km/h</div>
          </div>
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">{stats.duration}</div>
            <div className="text-xs text-muted-foreground">min</div>
          </div>
        </div>

        {/* Map visualization placeholder */}
        <div className="relative bg-muted rounded-lg overflow-hidden" style={{ height: '400px' }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Route className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-muted-foreground">
                Route visualization ready
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {route.length} GPS coordinates • {stats.duration} minutes
              </p>
            </div>
          </div>

          {/* Route line visualization */}
          <svg className="absolute inset-0 w-full h-full">
            <polyline
              points={route.map((p, i) => {
                const x = (i / route.length) * 100
                const y = 50 + Math.sin(i * 0.5) * 20
                return `${x}%,${y}%`
              }).join(' ')}
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              className="text-primary opacity-30"
            />
          </svg>

          {/* Animation controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/95 backdrop-blur-sm p-2 rounded-lg border">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePlayPause}
            >
              {isAnimating ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <div className="w-48 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${animationProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Route timeline */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          <div className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Route Timeline
          </div>
          {route.map((point, index) => {
            const isSelected = selectedPointIndex === index
            
            return (
              <button
                key={index}
                className={`w-full text-left p-3 border rounded-lg hover:bg-muted/50 transition-colors ${
                  isSelected ? 'bg-primary/10 border-primary' : ''
                }`}
                onClick={() => {
                  setSelectedPointIndex(isSelected ? null : index)
                  if (onPointClick) {
                    onPointClick(point)
                  }
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-3 h-3 rounded-full mt-1"
                      style={{ backgroundColor: getActivityColor(point.activity) }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        Point {index + 1}
                        {point.activity && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {point.activity}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(point.timestamp).toLocaleTimeString()}
                      </div>
                      {point.notes && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {point.notes}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{point.latitude.toFixed(6)}</div>
                    <div>{point.longitude.toFixed(6)}</div>
                    {point.speed !== undefined && (
                      <div className="mt-1">
                        <Navigation className="h-3 w-3 inline mr-1" />
                        {point.speed.toFixed(0)} km/h
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="border-t pt-4">
          <div className="text-sm font-medium mb-2">Activity Types</div>
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-600" />
              <span>Moving</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-600" />
              <span>Observation</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-600" />
              <span>Enforcement</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-600" />
              <span>Investigation</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-600" />
              <span>Break</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
