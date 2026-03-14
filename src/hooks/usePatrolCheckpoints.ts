/**
 * usePatrolCheckpoints
 * Data access and mutations for QR/NFC patrol checkpoints.
 * Supports Lone Worker Protocol (Health & Safety at Work Act 2015).
 *
 * Checkpoints can be:
 *  - manual:         admin-created QR/NFC checkpoints
 *  - geofence_zone:  auto-generated from zones with geofence data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { syncZoneCheckpoints } from '@/lib/geofence'
import { toast } from 'sonner'

interface PatrolCheckpoint {
  id: string
  organization_id: string
  zone_id: string | null
  name: string
  description: string | null
  location_lat: number | null
  location_lng: number | null
  qr_code: string
  nfc_tag_id: string | null
  is_active: boolean
  required_on_patrol: boolean
  check_in_radius_metres: number
  created_by: string | null
  checkpoint_type: 'manual' | 'geofence_zone'
  created_at: string
  updated_at: string
}

interface CheckpointVisit {
  id: string
  checkpoint_id: string
  officer_id: string
  patrol_id: string | null
  organization_id: string
  scan_method: 'qr_camera' | 'nfc' | 'manual_code' | 'url_deep_link'
  gps_latitude: number | null
  gps_longitude: number | null
  gps_accuracy: number | null
  gps_distance_from_checkpoint: number | null
  within_radius: boolean | null
  visited_at: string
  notes: string | null
  created_at: string
}

interface RecordVisitParams {
  checkpointId: string
  patrolId?: string | null
  scanMethod: CheckpointVisit['scan_method']
  gpsLatitude?: number | null
  gpsLongitude?: number | null
  gpsAccuracy?: number | null
  notes?: string
}

/** Haversine distance in metres between two GPS coordinates */
function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Fetch all active checkpoints for the current user's organisation */
export function usePatrolCheckpoints(options?: { zoneId?: string; requiredOnly?: boolean }) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-checkpoints', user?.organization_id, options],
    queryFn: async () => {
      if (!user?.organization_id) return []

      let query = (supabase as any)
        .from('patrol_checkpoints')
        .select('*')
        .eq('organization_id', user.organization_id)
        .eq('is_active', true)
        .order('name')

      if (options?.zoneId) {
        query = query.eq('zone_id', options.zoneId)
      }
      if (options?.requiredOnly) {
        query = query.eq('required_on_patrol', true)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as PatrolCheckpoint[]
    },
    enabled: !!user?.organization_id,
  })
}

/** Fetch recent checkpoint visits for the current officer */
export function useMyCheckpointVisits(limit = 20) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['checkpoint-visits-mine', user?.id, limit],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await (supabase as any)
        .from('checkpoint_visits')
        .select(`
          *,
          patrol_checkpoints (name, location_lat, location_lng)
        `)
        .eq('officer_id', user.id)
        .order('visited_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return (data ?? []) as (CheckpointVisit & { patrol_checkpoints: Pick<PatrolCheckpoint, 'name' | 'location_lat' | 'location_lng'> | null })[]
    },
    enabled: !!user?.id,
  })
}

/** Record a checkpoint visit after scanning a QR code */
export function useRecordCheckpointVisit() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: RecordVisitParams) => {
      if (!user?.id || !user?.organization_id) {
        throw new Error('Session expired. Please log in again.')
      }

      // Fetch checkpoint details to calculate GPS distance
      const { data: checkpointRaw, error: cpError } = await (supabase as any)
        .from('patrol_checkpoints')
        .select('id, name, location_lat, location_lng, check_in_radius_metres, organization_id')
        .eq('id', params.checkpointId)
        .single() as { data: PatrolCheckpoint | null; error: unknown }

      const checkpoint = checkpointRaw
      if (cpError || !checkpoint) {
        throw new Error('Checkpoint not found or inactive.')
      }

      // Calculate distance from checkpoint (if GPS available)
      let distance: number | null = null
      if (
        params.gpsLatitude != null &&
        params.gpsLongitude != null &&
        checkpoint.location_lat != null &&
        checkpoint.location_lng != null
      ) {
        distance = haversineMetres(
          params.gpsLatitude, params.gpsLongitude,
          checkpoint.location_lat, checkpoint.location_lng,
        )
      }

      // Compute within_radius in application layer (avoids per-row DB subquery)
      const withinRadius = distance != null
        ? distance <= checkpoint.check_in_radius_metres
        : null

      const { data: visitRaw, error } = await (supabase as any)
        .from('checkpoint_visits')
        .insert({
          checkpoint_id: params.checkpointId,
          officer_id: user.id,
          patrol_id: params.patrolId ?? null,
          organization_id: user.organization_id,
          scan_method: params.scanMethod,
          gps_latitude: params.gpsLatitude ?? null,
          gps_longitude: params.gpsLongitude ?? null,
          gps_accuracy: params.gpsAccuracy ?? null,
          gps_distance_from_checkpoint: distance,
          within_radius: withinRadius,
          notes: params.notes ?? null,
        })
        .select('id, visited_at, within_radius')
        .single() as { data: Pick<CheckpointVisit, 'id' | 'visited_at' | 'within_radius'> | null; error: { message: string; code: string } | null }

      if (error) throw error
      if (!visitRaw) throw new Error('Visit record not returned')

      return { visit: visitRaw, checkpoint }
    },
    onSuccess: ({ checkpoint, visit }) => {
      queryClient.invalidateQueries({ queryKey: ['checkpoint-visits-mine'] })
      const withinStr = visit.within_radius === true ? ' ✓ within radius' : visit.within_radius === false ? ' ⚠ outside radius' : ''
      toast.success(`Checked in: ${checkpoint.name}${withinStr}`)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Checkpoint check-in failed')
    },
  })
}

/**
 * Sync all geofenced zones as patrol checkpoints for the current organisation.
 * Calls the server-side sync_geofence_zone_checkpoints RPC which creates a
 * checkpoint (checkpoint_type = 'geofence_zone') for every active zone that
 * has location_lat/lng and doesn't already have one.
 */
export function useSyncZoneCheckpoints() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!user?.organization_id) {
        throw new Error('Session expired. Please log in again.')
      }
      return syncZoneCheckpoints(user.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrol-checkpoints'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Zone checkpoint sync failed')
    },
  })
}
