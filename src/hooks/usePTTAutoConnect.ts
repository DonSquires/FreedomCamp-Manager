/**
 * usePTTAutoConnect Hook
 * 
 * Automatically connects to PTT when user logs in and maintains
 * the connection throughout the session. This ensures PTT is always
 * available for receiving and sending calls.
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { usePTTStore } from '@/stores/pttStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import {
  startPTTBackgroundService,
  stopPTTBackgroundService,
  suspendPTTBackgroundReconnect,
  resumePTTBackgroundReconnect,
  requestNotificationPermission,
} from '@/lib/pttBackground'

/**
 * Hook to auto-connect PTT on login
 * Place this in App.tsx or a high-level authenticated component
 */
export function usePTTAutoConnect(): void {
  const { user, isAuthenticated, loading } = useAuthStore()
  const selectedOrganizationId = useGlobalFiltersStore((s) => s.organizationId)
  const connectionStatus = usePTTStore((s) => s.connectionStatus)
  const hasStarted = useRef(false)
  const location = useLocation()

  const operationalOrganizationId =
    user?.role === 'master' || user?.role === 'grand_master'
      ? selectedOrganizationId || user?.organization_id || null
      : user?.organization_id || null

  // Background org-channel PTT should only auto-start for field-operational
  // users. Platform/master users access CRM, pricing, and admin surfaces that
  // must not depend on radio infrastructure being available.
  const shouldAutoStartBackgroundPTT =
    user?.role === 'officer' || user?.role === 'admin_officer'

  const isRadioRoute = location.pathname === '/radio'

  useEffect(() => {
    // Wait until the auth check has fully resolved before starting PTT.
    // Without this guard, PTT may attempt to connect with a stale/expired
    // token (persisted from a previous session) before the Supabase session
    // has been verified, which causes 401 errors from ptt-signaling-token.
    if (loading) return

    // While on /radio the full radio console manages channel selection.
    // Suspend the background reconnect loop so it doesn't override the
    // operator's channel choice — but keep the WebSocket alive so PTT
    // never actually disconnects during navigation.
    if (isRadioRoute) {
      if (hasStarted.current) {
        suspendPTTBackgroundReconnect()
      }
      return
    }

    // Leaving /radio: resume background reconnect management.
    if (hasStarted.current) {
      resumePTTBackgroundReconnect()
    }

    // Start PTT service when user is authenticated
    if (isAuthenticated && shouldAutoStartBackgroundPTT && operationalOrganizationId && !hasStarted.current) {
      hasStarted.current = true
      
      // Request notification permission first
      requestNotificationPermission().then(() => {
        // Start the PTT background service
        startPTTBackgroundService()
      })
    }

    if (isAuthenticated && !shouldAutoStartBackgroundPTT && hasStarted.current) {
      hasStarted.current = false
      stopPTTBackgroundService()
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
  }, [loading, isAuthenticated, operationalOrganizationId, isRadioRoute, shouldAutoStartBackgroundPTT])

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
