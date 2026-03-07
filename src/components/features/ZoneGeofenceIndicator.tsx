import { Badge } from '@/components/ui/badge'
import { Circle, Square, AlertTriangle } from 'lucide-react'

interface ZoneGeofenceIndicatorProps {
  geometry?: any
  className?: string
  compact?: boolean
}

function getGeometryType(geometry?: any): 'polygon' | 'circle' | 'none' {
  if (!geometry) return 'none'

  const g = geometry.type === 'Feature' ? geometry.geometry : geometry
  if (!g || !g.type) return 'none'

  if (g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'polygon') {
    return 'polygon'
  }

  if ((g.type === 'Point' && Number.isFinite(g.radius)) || g.type === 'circle') {
    return 'circle'
  }

  return 'none'
}

export function ZoneGeofenceIndicator({ geometry, className, compact = false }: ZoneGeofenceIndicatorProps) {
  const type = getGeometryType(geometry)

  if (compact) {
    if (type === 'polygon') {
      return (
        <Badge variant="outline" className={className || 'bg-emerald-50 text-emerald-700 text-xs'}>
          <Square className="h-3 w-3 mr-1" />
          Polygon
        </Badge>
      )
    }

    if (type === 'circle') {
      return (
        <Badge variant="outline" className={className || 'bg-sky-50 text-sky-700 text-xs'}>
          <Circle className="h-3 w-3 mr-1" />
          Circle
        </Badge>
      )
    }

    return (
      <Badge variant="outline" className={className || 'bg-amber-50 text-amber-700 text-xs'}>
        <AlertTriangle className="h-3 w-3 mr-1" />
        No Geofence
      </Badge>
    )
  }

  return (
    <div className={className || 'rounded-md border p-2 bg-white/70 dark:bg-gray-900/40'}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Geofence</span>
        {type === 'polygon' && (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-xs">
            <Square className="h-3 w-3 mr-1" />
            Polygon
          </Badge>
        )}
        {type === 'circle' && (
          <Badge variant="outline" className="bg-sky-50 text-sky-700 text-xs">
            <Circle className="h-3 w-3 mr-1" />
            Circle
          </Badge>
        )}
        {type === 'none' && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Missing
          </Badge>
        )}
      </div>

      <svg viewBox="0 0 120 44" className="w-full h-12 rounded border bg-gray-50 dark:bg-gray-800">
        <rect x="1" y="1" width="118" height="42" rx="5" fill="none" stroke="#d1d5db" strokeDasharray="3 2" />

        {type === 'polygon' && (
          <polygon
            points="18,32 36,10 70,14 102,26 82,35 40,34"
            fill="#10b98133"
            stroke="#059669"
            strokeWidth="2"
          />
        )}

        {type === 'circle' && (
          <circle cx="60" cy="22" r="13" fill="#0ea5e933" stroke="#0284c7" strokeWidth="2" />
        )}

        {type === 'none' && (
          <text x="60" y="26" textAnchor="middle" fontSize="9" fill="#6b7280">
            No boundary set
          </text>
        )}
      </svg>
    </div>
  )
}
