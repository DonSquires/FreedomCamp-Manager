/**
 * Custom Hook: useVehicleAnalysis
 * AI vehicle analysis and photo recognition
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface VehicleAnalysis {
  plate_number: string
  photo_url: string
  ai_make: string | null
  ai_model: string | null
  ai_color: string | null
  ai_year: number | null
  ai_body_style: string | null
  confidence_score: number | null
  embedding_quality: number | null
  analyzed_at: string
}

interface AnalyzePhotoInput {
  photo_url: string
  plate_number?: string
}

export function useVehicleAnalysis(plateNumber?: string) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch AI analysis results for vehicle
  const analysisQuery = useQuery({
    queryKey: ['vehicle-analysis', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return []

      const { data, error } = await (supabase as any)
        .from('observations')
        .select(`
          plate_number,
          photo_url,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          vehicle_year,
          embedding_quality,
          recorded_at
        `)
        .eq('plate_number', plateNumber)
        
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })

      if (error) {
        toast.error('Failed to load analysis data')
        throw error
      }

      return data.map(obs => ({
        plate_number: obs.plate_number,
        photo_url: obs.photo_url,
        ai_make: obs.vehicle_make,
        ai_model: obs.vehicle_model,
        ai_color: obs.vehicle_color,
        ai_year: obs.vehicle_year,
        ai_body_style: null,
        confidence_score: null,
        embedding_quality: obs.embedding_quality,
        analyzed_at: obs.recorded_at,
      })) as VehicleAnalysis[]
    },
    enabled: !!plateNumber,
  })

  // Analyze photo mutation
  const analyzePhoto = useMutation({
    mutationFn: async ({ photo_url, plate_number }: AnalyzePhotoInput) => {
      const { data, error } = await supabase.functions.invoke('analyze-vehicle-photo', {
        body: { photo_url, plate_number },
      })

      if (error) {
        toast.error('Failed to analyse photo')
        throw error
      }

      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-analysis'] })
      queryClient.invalidateQueries({ queryKey: ['observations'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Photo analysis complete')
    },
  })

  // Batch analyze mutation
  const batchAnalyze = useMutation({
    mutationFn: async (photoUrls: string[]) => {
      const results = []
      for (const url of photoUrls) {
        try {
          const { data } = await supabase.functions.invoke('analyze-vehicle-photo', {
            body: { photo_url: url },
          })
          results.push({ url, success: true, data })
        } catch (error) {
          results.push({ url, success: false, error })
        }
      }
      return results
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length
      queryClient.invalidateQueries({ queryKey: ['vehicle-analysis'] })
      toast.success(`Analysed ${successCount}/${results.length} photos`)
    },
  })

  return {
    analyses: analysisQuery.data,
    isLoading: analysisQuery.isLoading,
    error: analysisQuery.error,
    analyzePhoto,
    batchAnalyze,
  }
}

// Hook for analyzing single observation
export function useAnalyzeObservation(observationId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!observationId) throw new Error('No observation ID')

      // Get observation
      const { data: obs, error: obsError } = await (supabase as any)
        .from('observations')
        .select('photo_url, plate_number')
        .eq('id', observationId)
        .single()

      if (obsError) throw obsError

      // Analyze photo
      const { data, error } = await supabase.functions.invoke('analyze-vehicle-photo', {
        body: { 
          photo_url: obs.photo_url,
          plate_number: obs.plate_number,
        },
      })

      if (error) throw error

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-analysis'] })
      queryClient.invalidateQueries({ queryKey: ['observations'] })
      toast.success('Analysis complete')
    },
    onError: () => {
      toast.error('Failed to analyse observation')
    },
  })
}
