/**
 * useShakeDetection.ts
 * 
 * React hook for shake-to-alert panic trigger.
 * When user shakes phone rapidly, triggers a countdown then duress alert.
 * 
 * Usage:
 *   const { enabled, startDetection, stopDetection } = useShakeDetection({
 *     onShakeAlert: () => triggerDuressAlert('shake')
 *   })
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeviceStore } from '@/stores/deviceStore'
import {
  startShakeDetection,
  stopShakeDetection,
  requestDevicePermissions,
  type ShakeEvent,
} from '@/lib/deviceIntegration'
import { toast } from 'sonner'

interface UseShakeDetectionOptions {
  /** Called when shake alert is confirmed after countdown */
  onShakeAlert?: (event: ShakeEvent) => void
  /** Number of shakes required to trigger (default: 5) */
  requiredShakes?: number
  /** Sensitivity level */
  sensitivity?: 'low' | 'medium' | 'high'
  /** Countdown seconds before alert sends (default: 5) */
  countdownSeconds?: number
  /** Auto-start detection on mount */
  autoStart?: boolean
  /** Show toast notifications */
  showToasts?: boolean
}

export function useShakeDetection(options: UseShakeDetectionOptions = {}) {
  const {
    requiredShakes = 5,
    sensitivity = 'medium',
    countdownSeconds = 5,
    autoStart = false,
    showToasts = true,
  } = options
  
  const { shakeDetection, setShakeDetection, setPermissions, permissionsGranted } = useDeviceStore()
  const onShakeAlertRef = useRef(options.onShakeAlert)
  
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingEventRef = useRef<ShakeEvent | null>(null)
  
  // Keep callback ref updated
  useEffect(() => {
    onShakeAlertRef.current = options.onShakeAlert
  }, [options.onShakeAlert])
  
  const cancelCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setCountdown(null)
    pendingEventRef.current = null
    
    if (showToasts) {
      toast.success('Shake alert cancelled')
    }
  }, [showToasts])
  
  const handleShakeDetected = useCallback((event: ShakeEvent) => {
    // Start countdown
    pendingEventRef.current = event
    setCountdown(countdownSeconds)
    
    if (showToasts) {
      toast.warning(`🚨 SHAKE DETECTED — Sending alert in ${countdownSeconds}s`, {
        duration: 0,
        id: 'shake-countdown',
        description: 'Shake again or tap to cancel',
        action: {
          label: 'Cancel',
          onClick: cancelCountdown,
        },
      })
    }
    
    // Start countdown
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          // Time's up - send alert
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current)
            countdownIntervalRef.current = null
          }
          
          if (pendingEventRef.current) {
            if (showToasts) {
              toast.dismiss('shake-countdown')
              toast.error('🚨 DURESS ALERT SENT', {
                description: 'Help is being dispatched to your location',
                duration: 10000,
              })
            }
            onShakeAlertRef.current?.(pendingEventRef.current)
          }
          
          pendingEventRef.current = null
          return null
        }
        
        // Update countdown toast
        if (showToasts) {
          toast.warning(`🚨 SHAKE DETECTED — Sending alert in ${prev - 1}s`, {
            duration: 0,
            id: 'shake-countdown',
            description: 'Shake again or tap to cancel',
            action: {
              label: 'Cancel',
              onClick: cancelCountdown,
            },
          })
        }
        
        return prev - 1
      })
    }, 1000)
  }, [countdownSeconds, cancelCountdown, showToasts])
  
  const startDetection = useCallback(async () => {
    // Request permissions first
    if (!permissionsGranted.motion) {
      const perms = await requestDevicePermissions()
      setPermissions({ motion: perms.motion })
      
      if (!perms.motion) {
        if (showToasts) {
          toast.error('Motion permission denied', {
            description: 'Shake detection requires motion sensor access',
          })
        }
        return false
      }
    }
    
    const success = startShakeDetection(handleShakeDetected, requiredShakes, sensitivity)
    
    if (success && showToasts) {
      toast.success('Shake detection enabled', {
        description: `${requiredShakes} shakes to trigger alert`,
      })
    }
    
    return success
  }, [requiredShakes, sensitivity, handleShakeDetected, permissionsGranted.motion, setPermissions, showToasts])
  
  const stopDetection = useCallback(() => {
    stopShakeDetection()
    cancelCountdown()
    
    if (showToasts) {
      toast.info('Shake detection disabled')
    }
  }, [cancelCountdown, showToasts])
  
  const toggleDetection = useCallback(async () => {
    if (shakeDetection.enabled) {
      stopDetection()
      return false
    } else {
      return await startDetection()
    }
  }, [shakeDetection.enabled, startDetection, stopDetection])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
      }
      if (shakeDetection.enabled) {
        stopShakeDetection()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && !shakeDetection.enabled) {
      startDetection()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount
  
  return {
    enabled: shakeDetection.enabled,
    sensitivity: shakeDetection.sensitivity,
    requiredShakes: shakeDetection.requiredShakes,
    lastShake: shakeDetection.lastShakeEvent,
    countdown,
    isCountingDown: countdown !== null,
    startDetection,
    stopDetection,
    toggleDetection,
    cancelCountdown,
    setRequiredShakes: (shakes: number) => {
      setShakeDetection({ requiredShakes: shakes })
      if (shakeDetection.enabled) {
        stopShakeDetection()
        startShakeDetection(handleShakeDetected, shakes, sensitivity)
      }
    },
    setSensitivity: (sens: 'low' | 'medium' | 'high') => {
      setShakeDetection({ sensitivity: sens })
      if (shakeDetection.enabled) {
        stopShakeDetection()
        startShakeDetection(handleShakeDetected, requiredShakes, sens)
      }
    },
  }
}
