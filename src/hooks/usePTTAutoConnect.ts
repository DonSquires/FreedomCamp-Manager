/**
 * usePTTAutoConnect Hook
 * 
 * Automatically connects to PTT when user logs in and maintains
 * the connection throughout the session. This ensures PTT is always
 * available for receiving and sending calls.
 */

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { usePTTStore } from '@/stores/pttStore'
import {
  startPTTBackgroundService,
  stopPTTBackgroundService,
  requestNotificationPermission,
} from '@/lib/pttBackground'

/**
 * Hook to auto-connect PTT on login
 * Place this in App.tsx or a high-level authenticated component
 */
export function usePTTAutoConnect(): void {
  const { user, isAuthenticated, loading } = useAuthStore()
  const connectionStatus = usePTTStore((s) => s.connectionStatus)
  const hasStarted = useRef(false)

  useEffect(() => {
    // Wait until the auth check has fully resolved before starting PTT.
    // Without this guard, PTT may attempt to connect with a stale/expired
    // token (persisted from a previous session) before the Supabase session
    // has been verified, which causes 401 errors from ptt-signaling-token.
    if (loading) return

    // Start PTT service when user is authenticated
    if (isAuthenticated && user?.organization_id && !hasStarted.current) {
      hasStarted.current = true
      
      // Request notification permission first
      requestNotificationPermission().then(() => {
        // Start the PTT background service
        startPTTBackgroundService()
      })
    }

    // Stop PTT service when user logs out
    if (!isAuthenticated && hasStarted.current) {
      hasStarted.current = false
      stopPTTBackgroundService()
    }

    // Cleanup on unmount
    return () => {
      // Don't stop on unmount - service should persist
      // Only stop on explicit logout (handled above)
    }
  }, [loading, isAuthenticated, user?.organization_id])

  // Log connection status changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      console.log('🎤 PTT: Ready to receive calls')
    } else if (connectionStatus === 'error') {
      console.warn('🎤 PTT: Connection error')
    }
  }, [connectionStatus])
}

/**
 * Hook to get PTT status for display in UI
 */
export function usePTTStatus() {
  const connectionStatus = usePTTStore((s) => s.connectionStatus)
  const channelName = usePTTStore((s) => s.channelName)
  const speakerName = usePTTStore((s) => s.speakerName)
  const presence = usePTTStore((s) => s.presence)
  const error = usePTTStore((s) => s.error)

  return {
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting' || connectionStatus === 'reconnecting',
    hasError: connectionStatus === 'error' || !!error,
    channelName,
    speakerName,
    onlineCount: presence.filter((p) => p.status === 'online').length,
    error,
  }
}
