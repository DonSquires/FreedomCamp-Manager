/**
 * GeofenceWarningBanner
 *
 * Inline banner rendered inside any operational portal when the officer's
 * GPS position has drifted outside their assigned zone during a non-patrol
 * shift.  Shows a persistent warning and a "Leave" button.
 *
 * Usage: render at the top of FieldOfficerPortal, ParkingOfficerPortal, etc.
 * when `geofenceViolation === true` from `useShiftGate()`.
 */

import { MapPinOff } from 'lucide-react'

interface GeofenceWarningBannerProps {
  zoneName?: string | null
}

export function GeofenceWarningBanner({ zoneName }: GeofenceWarningBannerProps) {
  return (
    <div className="w-full flex items-start gap-3 bg-orange-50 border-b border-orange-200 px-4 py-3">
      <MapPinOff className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-orange-800">
          You are outside your assigned zone
        </p>
        <p className="text-xs text-orange-600 mt-0.5">
          Your supervisor has been notified.
          {zoneName ? ` Return to ${zoneName} to continue.` : ' Return to your assigned area to continue.'}
        </p>
      </div>
    </div>
  )
}
