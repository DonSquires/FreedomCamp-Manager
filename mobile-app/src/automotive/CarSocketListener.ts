/**
 * CarSocketListener — Supabase Realtime → Android Auto bridge
 *
 * Subscribes to the Supabase `incidents` table using a Realtime channel and
 * forwards CRITICAL / HIGH severity inserts to the car screen via
 * `pushIncidentToCarScreen`.
 *
 * Call `startCarSocketListener()` after the user authenticates.
 * Call `stopCarSocketListener()` on sign-out or background termination.
 */

import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import {
  pushIncidentToCarScreen,
  clearCarIncidents,
  type CarIncident,
} from './CarIncidentScreen'

// Environment variables supplied by Expo's app.config.js / eas.json
const SUPABASE_URL: string =
  (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? ''
const SUPABASE_ANON_KEY: string =
  (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string) ?? ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[CarSocketListener] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. ' +
      'The automotive realtime feed will not start.'
  )
}

const _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
let _channel: RealtimeChannel | null = null

type IncidentRow = {
  id: string
  location?: string
  zone_name?: string
  severity?: string
  description?: string
  created_at?: string
}

function rowToCarIncident(row: IncidentRow): CarIncident {
  return {
    id: row.id,
    location: row.location ?? row.zone_name ?? 'Unknown location',
    severity: (row.severity as CarIncident['severity']) ?? 'MEDIUM',
    description: row.description ?? '',
    timestamp: row.created_at ?? new Date().toISOString(),
  }
}

/** Start listening for live incidents and pushing them to the car screen. */
export function startCarSocketListener(): void {
  if (_channel) return // already running

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return

  _channel = _client
    .channel('car-incidents-feed')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'incidents',
        filter: 'severity=in.(CRITICAL,HIGH)',
      },
      (payload) => {
        const incident = rowToCarIncident(payload.new as IncidentRow)
        pushIncidentToCarScreen(incident)
      }
    )
    .subscribe((status) => {
      console.log('[CarSocketListener] Realtime channel status:', status)
    })
}

/** Stop listening and clear the car screen incident list. */
export function stopCarSocketListener(): void {
  if (_channel) {
    _client.removeChannel(_channel).catch(() => {})
    _channel = null
  }
  clearCarIncidents()
}
