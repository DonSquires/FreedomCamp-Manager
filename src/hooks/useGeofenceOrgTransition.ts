import { useEffect, useMemo, useRef } from 'react'
import { detectCurrentZones } from '@/lib/geofence'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'

type UseGeofenceOrgTransitionOptions = {
  enabled?: boolean
  intervalMs?: number
}

/**
 * Keeps global org/zone filters in sync with the user's current geofence.
 * This is used by specialist officer portals so jurisdiction transitions
 * automatically switch organization context.
 */
export function useGeofenceOrgTransition(options?: UseGeofenceOrgTransitionOptions) {
  const enabled = options?.enabled ?? true
  const intervalMs = options?.intervalMs ?? 30_000

  const user = useAuthStore((state) => state.user)
  const { organizationId, zoneId, setOrganization, setZone } = useGlobalFiltersStore()
  const runningRef = useRef(false)

  const organizationScope = useMemo(() => {
    const ids = new Set<string>()
    if (user?.organization_id) ids.add(user.organization_id)
    if (user?.employer_organization_id) ids.add(user.employer_organization_id)
    user?.authorized_work_locations?.forEach((id) => ids.add(id))
    user?.extra_organization_ids?.forEach((id) => ids.add(id))
    return Array.from(ids)
  }, [user?.organization_id, user?.employer_organization_id, user?.authorized_work_locations, user?.extra_organization_ids])

  useEffect(() => {
    if (!enabled || !user?.id || organizationScope.length === 0) return

    const syncFromGeofence = async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
          })
        })

        const zones = await detectCurrentZones(
          position.coords.latitude,
          position.coords.longitude,
          organizationScope,
        )

        const primaryZone = zones[0] ?? null
        if (primaryZone) {
          if (primaryZone.id !== zoneId) {
            setZone(primaryZone.id, primaryZone.name)
          }
          if (primaryZone.organization_id && primaryZone.organization_id !== organizationId) {
            setOrganization(primaryZone.organization_id, null)
          }
        } else if (zoneId) {
          setZone(null, 'Other Location')
        }
      } catch {
        // Ignore location/geofence errors; specialist workflows remain usable.
      } finally {
        runningRef.current = false
      }
    }

    const initialDelay = setTimeout(() => void syncFromGeofence(), 1500)
    const interval = setInterval(() => void syncFromGeofence(), intervalMs)
    return () => {
      clearTimeout(initialDelay)
      clearInterval(interval)
    }
  }, [enabled, intervalMs, user?.id, organizationScope, zoneId, organizationId, setOrganization, setZone])
}
