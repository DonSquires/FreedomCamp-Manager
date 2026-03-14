/**
 * Custom Hook: usePlateScans
 * ALPR scan results and driving mode scans management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface PlateScan {
  id: string
  organization_id: string
  zone_id: string
  scanned_by: string
  plate_number: string
  scan_mode: 'alpr' | 'manual' | 'driving'
  scanned_photo: string | null
  confidence_score: number | null
  gps_latitude: number | null
  gps_longitude: number | null
  ai_vehicle_make: string | null
  ai_vehicle_model: string | null
  ai_vehicle_color: string | null
  reviewed: boolean
  review_action: string | null
  flagged_vehicle_detected: boolean
  breach_detected: boolean
  violation_summary: string | null
  scanned_at: string
  created_at: string
  zone: {
    name: string
  }
  scanned_by_user: {
    first_name: string
    last_name: string
  }
}

interface CreateScanInput {
  zone_id: string
  plate_number: string
  scan_mode: 'alpr' | 'manual' | 'driving'
  scanned_photo?: string
  confidence_score?: number
  gps_latitude?: number
  gps_longitude?: number
  ai_vehicle_make?: string
  ai_vehicle_model?: string
  ai_vehicle_color?: string
}

interface ReviewScanInput {
  id: string
  action: 'create_observation' | 'ignore' | 'flag'
  notes?: string
}

export function usePlateScans(options?: {
  organizationId?: string
  zoneId?: string
  scannedBy?: string
  scanMode?: string
  reviewed?: boolean
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch plate scans
  const query = useQuery({
    queryKey: ['plate-scans', options],
    queryFn: async () => {
      let query = supabase
        .from('plate_scans')
        .select(`
          *,
          zone:zones(name),
          scanned_by_user:user_profiles!plate_scans_scanned_by_fkey(first_name, last_name)
        `)
        .order('scanned_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId)
      }

      // Filters
      if (options?.zoneId) {
        query = query.eq('zone_id', options.zoneId)
      }
      if (options?.scannedBy) {
        query = query.eq('scanned_by', options.scannedBy)
      }
      if (options?.scanMode) {
        query = query.eq('scan_mode', options.scanMode)
      }
      if (options?.reviewed !== undefined) {
        query = query.eq('reviewed', options.reviewed)
      }
      if (options?.dateFrom) {
        query = query.gte('scanned_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('scanned_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load plate scans')
        throw error
      }

      return data as PlateScan[]
    },
  })

  // Create scan mutation
  const createScan = useMutation({
    mutationFn: async (input: CreateScanInput) => {
      const { data, error } = await (supabase
        .from('plate_scans') as any)
        .insert({
          organization_id: user?.organization_id,
          zone_id: input.zone_id,
          scanned_by: user?.id,
          plate_number: input.plate_number,
          scan_mode: input.scan_mode,
          scanned_photo: input.scanned_photo,
          confidence_score: input.confidence_score,
          gps_latitude: input.gps_latitude,
          gps_longitude: input.gps_longitude,
          ai_vehicle_make: input.ai_vehicle_make,
          ai_vehicle_model: input.ai_vehicle_model,
          ai_vehicle_color: input.ai_vehicle_color,
          scanned_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create scan')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plate-scans'] })
      toast.success('Scan created successfully')
    },
  })

  // Review scan mutation
  const reviewScan = useMutation({
    mutationFn: async ({ id, action, notes }: ReviewScanInput) => {
      const { error } = await (supabase.from('plate_scans') as any)
        .update({
          reviewed: true,
          review_action: action,
          violation_summary: notes,
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to review scan')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plate-scans'] })
      toast.success('Scan reviewed')
    },
  })

  // Delete scan mutation
  const deleteScan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('plate_scans')
        .delete()
        .eq('id', id)

      if (error) {
        toast.error('Failed to delete scan')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plate-scans'] })
      toast.success('Scan deleted')
    },
  })

  return {
    scans: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createScan,
    reviewScan,
    deleteScan,
  }
}

// Hook for unreviewed scans
export function useUnreviewedScans() {
  return usePlateScans({ reviewed: false })
}

// Hook for my recent scans (last 24 hours)
export function useMyRecentScans() {
  const { user } = useAuthStore()
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  return usePlateScans({
    scannedBy: user?.id,
    dateFrom: twentyFourHoursAgo,
  })
}
