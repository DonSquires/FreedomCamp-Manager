import { useState, useEffect, useRef, useCallback } from 'react'

// Geolocation tracking hook — wraps the browser Geolocation API
interface GeoCoords {
  latitude: number
  longitude: number
  accuracy: number | null
  heading: number | null
  speed: number | null
  altitude: number | null
}

interface LocationState {
  coords: GeoCoords | null
  timestamp: number | null
  error: string | null
  isTracking: boolean
  permissionGranted: boolean
}

export function useGlobalLocationTracking(options?: {
  highAccuracy?: boolean
  /** How stale a cached GPS position can be before the browser must acquire a fresh one (ms). */
  positionCacheMs?: number
  autoStart?: boolean
}) {
  const { highAccuracy = true, positionCacheMs = 15_000, autoStart = false } = options ?? {}

  const [state, setState] = useState<LocationState>({
    coords: null,
    timestamp: null,
    error: null,
    isTracking: false,
    permissionGranted: false,
  })

  const watchIdRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setState(prev => ({ ...prev, isTracking: false }))
  }, [])

  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) {
      setState(prev => ({ ...prev, error: 'Geolocation not supported' }))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState(prev => ({
          ...prev,
          permissionGranted: true,
          isTracking: true,
          error: null,
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            altitude: position.coords.altitude,
          },
          timestamp: position.timestamp,
        }))
      },
      (err) => {
        setState(prev => ({ ...prev, error: err.message, permissionGranted: false }))
      },
      { enableHighAccuracy: highAccuracy, timeout: 15_000, maximumAge: 0 }    )

    const id = navigator.geolocation.watchPosition(
      (position) => {
        setState(prev => ({
          ...prev,
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            altitude: position.coords.altitude,
          },
          timestamp: position.timestamp,
          error: null,
          isTracking: true,
        }))
      },
      (err) => {
        setState(prev => ({ ...prev, error: err.message }))
      },
      { enableHighAccuracy: highAccuracy, timeout: 15_000, maximumAge: positionCacheMs }
    )
    watchIdRef.current = id
  }, [highAccuracy, positionCacheMs])

  useEffect(() => {
    if (autoStart) startTracking()
    return () => stopTracking()
  }, [autoStart, startTracking, stopTracking])

  return {
    ...state,
    startTracking,
    stopTracking,
  }
}
