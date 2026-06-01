/**
 * GeofenceWarningBanner
 *
 * Inline banner rendered inside any operational portal when the officer's
 * GPS position has drifted outside their assigned zone during a non-patrol
 * shift.  Shows a persistent warning and a "Leave" button.
 *
 * Also rendered when no geofence is configured for the zone, prompting the
 * officer to manually confirm their onsite/offsite status.
 *
 * Usage: render at the top of FieldOfficerPortal, ParkingOfficerPortal, etc.
 * when `geofenceViolation === true` from `useShiftGate()`.
 */

import { useState } from 'react'
import { MapPinOff, MapPin, LogOut, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface GeofenceWarningBannerProps {
  zoneName?: string | null
  /** When true the zone has no geofence configured — show a manual confirm prompt */
  noGeofence?: boolean
  /** The patrol_id to associate the override event with */
  patrolId?: string | null
  /** Called after a successful manual override to let parent update state */
  onOnsiteConfirmed?: () => void
  onOffsiteConfirmed?: () => void
}

export function GeofenceWarningBanner({
  zoneName,
  noGeofence = false,
  patrolId,
  onOnsiteConfirmed,
  onOffsiteConfirmed,
}: GeofenceWarningBannerProps) {
  const { user } = useAuthStore()
  const [isLogging, setIsLogging] = useState(false)

  async function recordOverrideEvent(eventType: 'override_onsite' | 'override_offsite') {
    if (!patrolId || !user?.organization_id) return
    setIsLogging(true)
    try {
      // Attempt to capture current GPS for the event record
      let gpsLat: number | null = null
      let gpsLng: number | null = null
      let gpsAccuracy: number | null = null
      try {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              gpsLat = pos.coords.latitude
              gpsLng = pos.coords.longitude
              gpsAccuracy = pos.coords.accuracy ?? null
              resolve()
            },
            () => resolve(),
            { timeout: 3000, maximumAge: 10000 },
          )
        })
      } catch {
        // GPS unavailable — log without coordinates
      }

      const { error } = await (supabase as any).from('patrol_location_events').insert({
        patrol_id: patrolId,
        organization_id: user.organization_id,
        officer_id: user.id,
        event_type: eventType,
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        gps_accuracy_m: gpsAccuracy,
        is_manual_override: true,
        override_reason: noGeofence ? 'no_geofence_configured' : 'officer_manual_confirm',
      })

      if (error) throw error

      if (eventType === 'override_onsite') {
        toast.success('Marked as onsite')
        onOnsiteConfirmed?.()
      } else {
        toast.success('Marked as departed')
        onOffsiteConfirmed?.()
      }
    } catch {
      toast.error('Could not save location event. Please try again.')
    } finally {
      setIsLogging(false)
    }
  }

  // ── No-geofence variant: prompt to manually confirm onsite/offsite ─────────
  if (noGeofence) {
    return (
      <div className="w-full flex items-start gap-3 bg-blue-50 border-b border-blue-200 px-4 py-3">
        <ShieldQuestion className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-blue-800">
            No geofence configured{zoneName ? ` for ${zoneName}` : ''}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Please confirm your location manually so your arrival time is recorded correctly.
          </p>
          {patrolId && (
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                disabled={isLogging}
                onClick={() => recordOverrideEvent('override_onsite')}
              >
                <MapPin className="h-3 w-3 mr-1" />
                I'm Onsite
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-gray-300 text-gray-700 hover:bg-gray-100"
                disabled={isLogging}
                onClick={() => recordOverrideEvent('override_offsite')}
              >
                <LogOut className="h-3 w-3 mr-1" />
                I've Departed
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Standard geofence violation banner ────────────────────────────────────
  return (
    <div className="w-full flex items-start gap-3 bg-orange-50 border-b border-orange-200 px-4 py-3">
      <MapPinOff className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-orange-800">
          You are outside your assigned zone
        </p>
        <p className="text-xs text-orange-600 mt-0.5">
          Your supervisor has been notified.
          {zoneName ? ` Return to ${zoneName} to continue.` : ' Return to your assigned area to continue.'}
        </p>
        {patrolId && (
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-100"
              disabled={isLogging}
              onClick={() => recordOverrideEvent('override_offsite')}
            >
              <LogOut className="h-3 w-3 mr-1" />
              Override — Mark Departed
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

