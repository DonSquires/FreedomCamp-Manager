/**
 * useWearableSOS.ts
 *
 * Provides SOS triggering for wearable / Apple Watch integration (B-14).
 *
 * Usage:
 *   const { triggerSOS, isLoading, lastTriggeredAt, cooldownRemaining } = useWearableSOS()
 *
 * - Captures the officer's current GPS location (if permission granted)
 * - Posts to the `wearable-sos` edge function
 * - Enforces a 60-second cooldown to prevent accidental double-triggers
 * - Returns cooldownRemaining (seconds) so the UI can show a countdown
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'

const SOS_COOLDOWN_MS = 60_000 // 60 seconds

interface UseWearableSOSResult {
  triggerSOS: (deviceType?: 'apple_watch' | 'ble_button' | 'web') => Promise<void>
  isLoading: boolean
  lastTriggeredAt: Date | null
  /** Seconds remaining in cooldown; 0 when ready */
  cooldownRemaining: number
}

export function useWearableSOS(): UseWearableSOSResult {
  const { user } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)
  const [lastTriggeredAt, setLastTriggeredAt] = useState<Date | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick down the cooldown counter
  useEffect(() => {
    if (lastTriggeredAt) {
      const tick = () => {
        const elapsed = Date.now() - lastTriggeredAt.getTime()
        const remaining = Math.max(0, Math.ceil((SOS_COOLDOWN_MS - elapsed) / 1000))
        setCooldownRemaining(remaining)
        if (remaining === 0 && cooldownRef.current) {
          clearInterval(cooldownRef.current)
          cooldownRef.current = null
        }
      }
      tick()
      cooldownRef.current = setInterval(tick, 1000)
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [lastTriggeredAt])

  const triggerSOS = useCallback(
    async (deviceType: 'apple_watch' | 'ble_button' | 'web' = 'web') => {
      if (!user?.id || !user?.organization_id) {
        toast.error('Unable to send SOS — not logged in')
        return
      }

      if (cooldownRemaining > 0) {
        toast.warning(`SOS is on cooldown. Please wait ${cooldownRemaining}s.`)
        return
      }

      setIsLoading(true)

      // Try to get current GPS location
      let location: { lat: number; lon: number } | undefined
      try {
        if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              maximumAge: 30_000,
            })
          )
          location = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        }
      } catch {
        // Location unavailable — continue without it
      }

      try {
        const result = await edgeFunctions.triggerWearableSOS({
          user_id:         user.id,
          organization_id: user.organization_id,
          location,
          device_type:     deviceType,
        })

        if (result?.data?.success || result?.data?.alert_id) {
          setLastTriggeredAt(new Date())
          toast.warning('🆘 SOS sent — supervisors have been alerted', {
            duration: 8000,
          })
        } else {
          toast.error('SOS failed — please call emergency services directly')
        }
      } catch (err) {
        console.error('[useWearableSOS] trigger failed:', err)
        toast.error('SOS failed — please call emergency services directly')
      } finally {
        setIsLoading(false)
      }
    },
    [user?.id, user?.organization_id, cooldownRemaining]
  )

  return { triggerSOS, isLoading, lastTriggeredAt, cooldownRemaining }
}
