/**
 * Custom Hook: useVehicleProfilePhoto
 * AI-selected profile photo management for vehicles
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface ProfilePhoto {
  plate_number: string
  profile_photo: string | null
  profile_photo_selected_at: string | null
  profile_photo_metadata: any
  total_photos: number
  best_quality_score: number | null
}

export function useVehicleProfilePhoto(plateNumber?: string) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch current profile photo
  const query = useQuery({
    queryKey: ['vehicle-profile-photo', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return null

      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select(`
          plate_number,
          profile_photo,
          profile_photo_selected_at,
          profile_photo_metadata
        `)
        .eq('plate_number', plateNumber)
        .single()

      if (error) {
        if (error.code !== 'PGRST116') { // Not found is OK
          toast.error('Failed to load profile photo')
          throw error
        }
        return null
      }

      // Get total photo count
      const { count } = await supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .eq('plate_number', plateNumber)
        .not('photo_url', 'is', null)
        .is('deleted_at', null)

      const d = data as any
      return {
        plate_number: d?.plate_number,
        profile_photo: d?.profile_photo,
        profile_photo_selected_at: d?.profile_photo_selected_at,
        profile_photo_metadata: d?.profile_photo_metadata,
        total_photos: count || 0,
        best_quality_score: d?.profile_photo_metadata?.quality_score || null,
      } as ProfilePhoto
    },
    enabled: !!plateNumber,
  })

  // Auto-select best photo mutation
  const selectBestPhoto = useMutation({
    mutationFn: async (plate: string) => {
      const { data, error } = await supabase.functions.invoke('select-best-vehicle-photo', {
        body: { plate_number: plate },
      })

      if (error) {
        toast.error('Failed to select best photo')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-profile-photo'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Profile photo updated')
    },
  })

  // Manual set photo mutation
  const setProfilePhoto = useMutation({
    mutationFn: async ({ plate, photoUrl }: { plate: string; photoUrl: string }) => {
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .update({
          profile_photo: photoUrl,
          profile_photo_selected_at: new Date().toISOString(),
          profile_photo_metadata: {
            source: 'manual',
            selected_by: user?.id,
          },
        })
        .eq('plate_number', plate)

      if (error) {
        toast.error('Failed to set profile photo')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-profile-photo'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Profile photo set')
    },
  })

  // Get all photos for vehicle
  const getAllPhotos = useQuery({
    queryKey: ['vehicle-all-photos', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return []

      const { data, error } = await (supabase.from('observations') as any)
        .select('photo_url, recorded_at, embedding_quality, gps_accuracy')
        .eq('plate_number', plateNumber)
        .not('photo_url', 'is', null)
        .is('deleted_at', null)
        .order('recorded_at', { ascending: false })

      if (error) throw error

      return data.map(obs => ({
        url: obs.photo_url,
        recorded_at: obs.recorded_at,
        quality: obs.embedding_quality,
        gps_accuracy: obs.gps_accuracy,
      }))
    },
    enabled: !!plateNumber,
  })

  return {
    profilePhoto: query.data,
    allPhotos: getAllPhotos.data,
    isLoading: query.isLoading,
    error: query.error,
    selectBestPhoto,
    setProfilePhoto,
  }
}

// Hook for batch profile photo selection
export function useBatchProfilePhotoSelection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (plateNumbers: string[]) => {
      const results = []
      for (const plate of plateNumbers) {
        try {
          const { data } = await supabase.functions.invoke('select-best-vehicle-photo', {
            body: { plate_number: plate },
          })
          results.push({ plate, success: true, data })
        } catch (error) {
          results.push({ plate, success: false, error })
        }
      }
      return results
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length
      queryClient.invalidateQueries({ queryKey: ['vehicle-profile-photo'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success(`Updated ${successCount}/${results.length} profile photos`)
    },
  })
}
