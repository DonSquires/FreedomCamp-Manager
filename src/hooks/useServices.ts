import { useQuery, useMutation } from '@tanstack/react-query'
import { checkNZSCVStatus, enrichFromMotorWeb, analyzeVehiclePhoto, selectBestVehiclePhoto } from '@/lib/inferenceService'
import { toast } from 'sonner'

/**
 * Hook for checking NZSCV (Self-Contained Vehicle) warrant status
 */
export function useNZSCVStatus(plateNumber: string | null) {
  return useQuery({
    queryKey: ['nzscv-status', plateNumber],
    queryFn: () => checkNZSCVStatus(plateNumber!),
    enabled: !!plateNumber,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours (warrants don't change frequently)
    retry: 1,
  })
}

/**
 * Hook for enriching vehicle details
 */
export function useMotorWebEnrichment() {
  return useMutation({
    mutationFn: (plateNumber: string) => enrichFromMotorWeb(plateNumber),
    onSuccess: () => {
      toast.success('Vehicle details enrichment complete')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to enrich vehicle data')
    },
  })
}

/**
 * Hook for analyzing vehicle photos using AI inference
 */
export function useVehiclePhotoAnalysis() {
  return useMutation({
    mutationFn: (photoUrl: string) => analyzeVehiclePhoto(photoUrl),
    onError: (error: any) => {
      toast.error(error.message || 'Failed to analyze vehicle photo')
    },
  })
}

/**
 * Hook for selecting the best vehicle photo from multiple candidates
 */
export function useBestPhotoSelection() {
  return useMutation({
    mutationFn: (photoUrls: string[]) => selectBestVehiclePhoto(photoUrls),
    onSuccess: () => {
      toast.success('Best photo selected automatically')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to select best photo')
    },
  })
}
