import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, XCircle, Navigation, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface LocationAuthorizationStatusProps {
  organizationId: string
  latitude: number
  longitude: number
  refreshInterval?: number // milliseconds
  onStatusChange?: (status: LocationStatus) => void
}

interface LocationStatus {
  inside: boolean
  distance_m: number | null
  nearest_point?: {
    latitude: number
    longitude: number
  }
  checked_at: string
}

// PostgREST error code for "function not found in schema cache" (HTTP 404)
const PGRST_FUNCTION_NOT_FOUND = 'PGRST202'

export function LocationAuthorizationStatus({
  organizationId,
  latitude,
  longitude,
  refreshInterval = 10000, // 10 seconds default
  onStatusChange,
}: LocationAuthorizationStatusProps) {
  const [status, setStatus] = useState<LocationStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // When the RPC doesn't exist yet in the DB, hide the component silently
  const [unavailable, setUnavailable] = useState(false)

  const checkLocation = async () => {
    if (!latitude || !longitude || !organizationId || unavailable) return

    setChecking(true)
    setError(null)

    try {
      const { data, error: rpcError } = await (supabase as any).rpc('check_location_in_org', {
        org_id: organizationId,
        lon: longitude,
        lat: latitude,
      })

      if (rpcError) {
        // Function not yet deployed to this database — hide quietly, stop polling
        if (rpcError.code === PGRST_FUNCTION_NOT_FOUND) {
          setUnavailable(true)
          return
        }
        throw rpcError
      }

      const d = data as any
      const newStatus: LocationStatus = {
        inside: d?.inside || false,
        distance_m: d?.distance_m || null,
        nearest_point: d?.nearest_point ? {
          latitude: d.nearest_point.coordinates[1],
          longitude: d.nearest_point.coordinates[0],
        } : undefined,
        checked_at: new Date().toISOString(),
      }

      setStatus(newStatus)
      onStatusChange?.(newStatus)
    } catch (err: any) {
      console.error('Location check failed:', err)
      setError(err.message || 'Failed to check location')
    } finally {
      setChecking(false)
    }
  }

  // Check on mount and when coordinates change
  useEffect(() => {
    checkLocation()
  }, [latitude, longitude, organizationId])

  // Auto-refresh — stops automatically once unavailable is set
  useEffect(() => {
    if (!refreshInterval || unavailable) return

    const interval = setInterval(checkLocation, refreshInterval)
    return () => clearInterval(interval)
  }, [refreshInterval, latitude, longitude, organizationId, unavailable])

  // RPC not deployed yet — hide the component silently, no error shown
  if (unavailable) return null

  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
            <span className="text-sm">Checking location...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isInside = status.inside
  const distance = status.distance_m

  return (
    <Card className={`border-2 ${isInside ? 'border-green-200 dark:border-green-800' : 'border-orange-200 dark:border-orange-800'}`}>
      <CardContent className={`p-4 ${isInside ? 'bg-green-50 dark:bg-green-950' : 'bg-orange-50 dark:bg-orange-950'}`}>
        <div className="space-y-3">
          {/* Status Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isInside ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-orange-600" />
              )}
              <span className={`font-semibold ${isInside ? 'text-green-700 dark:text-green-300' : 'text-orange-700 dark:text-orange-300'}`}>
                {isInside ? 'Inside Jurisdiction' : 'Outside Jurisdiction'}
              </span>
            </div>
            <Badge variant="outline" className={isInside ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}>
              {isInside ? 'Authorized' : 'Not Authorized'}
            </Badge>
          </div>

          {/* Distance Info */}
          {!isInside && distance !== null && (
            <div className="flex items-start gap-2 text-sm">
              <Navigation className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className={`${isInside ? 'text-green-700 dark:text-green-300' : 'text-orange-700 dark:text-orange-300'}`}>
                <p className="font-medium">
                  {distance < 1000 
                    ? `${Math.round(distance)}m from boundary`
                    : `${(distance / 1000).toFixed(1)}km from boundary`
                  }
                </p>
                <p className="text-xs mt-1">
                  Move {distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`} to enter jurisdiction
                </p>
              </div>
            </div>
          )}

          {/* Current Position */}
          <div className="text-xs text-gray-600 dark:text-gray-400 border-t pt-2">
            <p>Current: {latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
            <p>Checked: {new Date(status.checked_at).toLocaleTimeString()}</p>
          </div>

          {/* Warning for Outside Jurisdiction */}
          {!isInside && (
            <div className="bg-orange-100 dark:bg-orange-900 border border-orange-300 dark:border-orange-700 rounded p-2 text-xs text-orange-800 dark:text-orange-200">
              ⚠️ You are outside your authorized patrol area. Scans outside jurisdiction may not be enforceable.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
