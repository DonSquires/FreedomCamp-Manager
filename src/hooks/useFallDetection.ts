/**
 * useFallDetection.ts
 * 
 * React hook for fall detection using device accelerometer.
 * Triggers duress alert when a fall is detected and no response received.
 * 
 * Usage:
 *   const { enabled, startDetection, stopDetection, lastFall } = useFallDetection({
 *     onFallDetected: (event) => triggerDuressAlert('fall_detection')
 *   })
 */

import { useCallback, useEffect, useRef } from 'react'
import { useDeviceStore } from '@/stores/deviceStore'
import { 
  startFallDetection, 
  stopFallDetection, 
  requestDevicePermissions,
  type FallEvent 
} from '@/lib/deviceIntegration'
import { toast } from 'sonner'

interface UseFallDetectionOptions {
  /** Called when a fall is detected */
  onFallDetected?: (event: FallEvent) => void
  /** Sensitivity level for detection */
  sensitivity?: 'low' | 'medium' | 'high'
  /** Auto-start detection on mount */
  autoStart?: boolean
  /** Show toast notifications */
  showToasts?: boolean
}

export function useFallDetection(options: UseFallDetectionOptions = {}) {
  const { sensitivity = 'medium', autoStart = false, showToasts = true } = options
  
  const { fallDetection, setFallDetection, setPermissions, permissionsGranted } = useDeviceStore()
  const onFallDetectedRef = useRef(options.onFallDetected)
  
  // Keep callback ref updated
  useEffect(() => {
    onFallDetectedRef.current = options.onFallDetected
  }, [options.onFallDetected])
  
  const handleFallDetected = useCallback((event: FallEvent) => {
    if (showToasts) {
      toast.error('🚨 FALL DETECTED — Are you OK?', {
        duration: 0,
        description: 'Tap "I\'m OK" to cancel alert, or help will be dispatched.',
        action: {
          label: "I'm OK",
          onClick: () => {
            toast.success('Fall alert cancelled')
          },
        },
      })
    }
    
    onFallDetectedRef.current?.(event)
  }, [showToasts])
  
  const startDetection = useCallback(async () => {
    // Request permissions first
    if (!permissionsGranted.motion) {
      const perms = await requestDevicePermissions()
      setPermissions({ motion: perms.motion })
      
      if (!perms.motion) {
        if (showToasts) {
          toast.error('Motion permission denied', {
            description: 'Fall detection requires motion sensor access',
          })
        }
        return false
      }
    }
    
    const success = startFallDetection(handleFallDetected, sensitivity)
    
    if (success && showToasts) {
      toast.success('Fall detection enabled', {
        description: `Sensitivity: ${sensitivity}`,
      })
    }
    
    return success
  }, [sensitivity, handleFallDetected, permissionsGranted.motion, setPermissions, showToasts])
  
  const stopDetection = useCallback(() => {
    stopFallDetection()
    
    if (showToasts) {
      toast.info('Fall detection disabled')
    }
  }, [showToasts])
  
  const toggleDetection = useCallback(async () => {
    if (fallDetection.enabled) {
      stopDetection()
      return false
    } else {
      return await startDetection()
    }
  }, [fallDetection.enabled, startDetection, stopDetection])
  
  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && !fallDetection.enabled) {
      startDetection()
    }
    
    // Cleanup on unmount
    return () => {
      if (fallDetection.enabled) {
        stopFallDetection()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount/unmount
  
  return {
    enabled: fallDetection.enabled,
    sensitivity: fallDetection.sensitivity,
    lastFall: fallDetection.lastFallEvent,
    fallCount: fallDetection.fallCount,
    startDetection,
    stopDetection,
    toggleDetection,
    setSensitivity: (sens: 'low' | 'medium' | 'high') => {
      setFallDetection({ sensitivity: sens })
      if (fallDetection.enabled) {
        // Restart with new sensitivity
        stopFallDetection()
        startFallDetection(handleFallDetected, sens)
      }
    },
  }
}
