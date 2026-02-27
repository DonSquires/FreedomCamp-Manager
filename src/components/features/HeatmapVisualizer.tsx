/**
 * HeatmapVisualizer Component
 * Breach density heatmap visualization
 */

import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Flame,
  MapPin,
  TrendingUp,
  Filter,
  Calendar,
} from 'lucide-react'

interface HeatmapDataPoint {
  lat: number
  lng: number
  intensity: number
  count: number
  zoneId?: string
  zoneName?: string
}

interface HeatmapVisualizerProps {
  data: HeatmapDataPoint[]
  title?: string
  description?: string
  dateRange?: { from: string; to: string }
  onDateRangeChange?: (range: { from: string; to: string }) => void
}

export function HeatmapVisualizer({
  data,
  title = 'Breach Density Heatmap',
  description = 'Visual representation of breach concentrations',
  dateRange,
  onDateRangeChange,
}: HeatmapVisualizerProps) {
  const [intensityThreshold, setIntensityThreshold] = useState(0)
  const [showLabels, setShowLabels] = useState(true)

  // Calculate heatmap statistics
  const stats = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        totalPoints: 0,
        maxIntensity: 0,
        avgIntensity: 0,
        hotspots: [],
      }
    }

    const totalPoints = data.length
    const maxIntensity = Math.max(...data.map(d => d.intensity))
    const avgIntensity = data.reduce((sum, d) => sum + d.intensity, 0) / totalPoints

    // Identify top 3 hotspots
    const hotspots = [...data]
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 3)

    return {
      totalPoints,
      maxIntensity,
      avgIntensity,
      hotspots,
    }
  }, [data])

  // Filter data by threshold
  const filteredData = useMemo(() => {
    return data.filter(d => d.intensity >= intensityThreshold)
  }, [data, intensityThreshold])

  const getHeatColor = (intensity: number) => {
    const normalized = intensity / (stats.maxIntensity || 1)
    
    if (normalized < 0.2) return '#3b82f6' // blue - low
    if (normalized < 0.4) return '#10b981' // green - moderate
    if (normalized < 0.6) return '#f59e0b' // yellow - elevated
    if (normalized < 0.8) return '#f97316' // orange - high
    return '#ef4444' // red - critical
  }

  const getIntensityLabel = (intensity: number) => {
    const normalized = intensity / (stats.maxIntensity || 1)
    
    if (normalized < 0.2) return 'Low'
    if (normalized < 0.4) return 'Moderate'
    if (normalized < 0.6) return 'Elevated'
    if (normalized < 0.8) return 'High'
    return 'Critical'
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">
              {description}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {filteredData.length} point{filteredData.length !== 1 ? 's' : ''}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLabels(!showLabels)}
            >
              {showLabels ? 'Hide Labels' : 'Show Labels'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{stats.totalPoints}</div>
            <div className="text-xs text-muted-foreground">Total Points</div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{stats.maxIntensity}</div>
            <div className="text-xs text-muted-foreground">Max Intensity</div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{stats.avgIntensity.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Avg Intensity</div>
          </div>
        </div>

        {/* Heatmap visualization placeholder */}
        <div className="relative bg-muted rounded-lg overflow-hidden" style={{ height: '400px' }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Flame className="h-16 w-16 mx-auto mb-4 text-orange-500 opacity-20" />
              <p className="text-muted-foreground">
                Heatmap visualization ready
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {filteredData.length} data points • Max intensity: {stats.maxIntensity}
              </p>
            </div>
          </div>

          {/* Simulated heatmap points */}
          <div className="absolute inset-0 p-4">
            <div className="grid grid-cols-4 gap-2 h-full">
              {filteredData.slice(0, 16).map((point, idx) => (
                <div
                  key={idx}
                  className="rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{
                    backgroundColor: getHeatColor(point.intensity),
                    opacity: 0.8,
                  }}
                >
                  {showLabels && point.count}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Intensity threshold slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Intensity Threshold</label>
            <Badge variant="outline">{intensityThreshold}</Badge>
          </div>
          <input
            type="range"
            min="0"
            max={stats.maxIntensity}
            value={intensityThreshold}
            onChange={(e) => setIntensityThreshold(Number(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Top hotspots */}
        {stats.hotspots.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Top Hotspots
            </div>
            <div className="space-y-2">
              {stats.hotspots.map((hotspot, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: getHeatColor(hotspot.intensity) }}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <div className="font-medium">
                        {hotspot.zoneName || `Zone ${hotspot.zoneId?.substring(0, 8)}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {hotspot.lat.toFixed(4)}, {hotspot.lng.toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge style={{ backgroundColor: getHeatColor(hotspot.intensity) }}>
                      {getIntensityLabel(hotspot.intensity)}
                    </Badge>
                    <div className="text-xs text-muted-foreground mt-1">
                      {hotspot.count} incident{hotspot.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="border-t pt-4">
          <div className="text-sm font-medium mb-2">Intensity Scale</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-6 rounded" style={{
              background: 'linear-gradient(to right, #3b82f6, #10b981, #f59e0b, #f97316, #ef4444)',
            }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
            <span>Low</span>
            <span>Moderate</span>
            <span>Elevated</span>
            <span>High</span>
            <span>Critical</span>
          </div>
        </div>

        {/* Date range filter */}
        {dateRange && onDateRangeChange && (
          <div className="border-t pt-4">
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Date Range
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">From</label>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => onDateRangeChange({ ...dateRange, from: e.target.value })}
                  className="w-full mt-1 p-2 border rounded"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">To</label>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(e) => onDateRangeChange({ ...dateRange, to: e.target.value })}
                  className="w-full mt-1 p-2 border rounded"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
