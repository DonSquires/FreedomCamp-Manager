/**
 * Custom Hook: useHealthSafety
 * Health & Safety report management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface HealthSafetyReport {
  id: string
  organization_id: string
  zone_id: string
  reported_by: string
  patrol_id: string | null
  details: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'pending' | 'in_progress' | 'resolved'
  location_lat: number | null
  location_lng: number | null
  attachments: any[]
  resolution_notes: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  zone: {
    name: string
  }
  reporter: {
    first_name: string
    last_name: string
  }
}

interface CreateHSReportInput {
  zone_id: string
  patrol_id?: string
  details: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  location_lat?: number
  location_lng?: number
  attachments?: any[]
}

interface UpdateHSReportInput {
  status?: 'pending' | 'in_progress' | 'resolved'
  resolution_notes?: string
}

export function useHealthSafety(options?: {
  organizationId?: string
  zoneId?: string
  severity?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch H&S reports
  const query = useQuery({
    queryKey: ['health-safety-reports', options],
    queryFn: async () => {
      let query = supabase
        .from('health_safety_reports')
        .select(`
          *,
          zone:zones(name),
          reporter:user_profiles!health_safety_reports_reported_by_fkey(first_name, last_name)
        `)
        .order('created_at', { ascending: false })

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
      if (options?.severity) {
        query = query.eq('severity', options.severity)
      }
      if (options?.status) {
        query = query.eq('status', options.status)
      }
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load H&S reports')
        throw error
      }

      return data as unknown as HealthSafetyReport[]
    },
  })

  // Create report mutation
  const createReport = useMutation({
    mutationFn: async (input: CreateHSReportInput) => {
      const { data, error } = await (supabase
        .from('health_safety_reports') as any)
        .insert({
          organization_id: user?.organization_id,
          reported_by: user?.id,
          zone_id: input.zone_id,
          patrol_id: input.patrol_id,
          details: input.details,
          severity: input.severity,
          location_lat: input.location_lat,
          location_lng: input.location_lng,
          attachments: input.attachments || [],
          status: 'pending',
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create H&S report')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-safety-reports'] })
      toast.success('H&S report created')
    },
  })

  // Update report mutation
  const updateReport = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateHSReportInput & { id: string }) => {
      const payload: any = { ...updates }

      if (updates.status === 'resolved') {
        payload.resolved_by = user?.id
        payload.resolved_at = new Date().toISOString()
      }

      const { error } = await supabase.from('health_safety_reports')
        .update(payload)
        .eq('id', id)

      if (error) {
        toast.error('Failed to update H&S report')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-safety-reports'] })
      toast.success('H&S report updated')
    },
  })

  // Delete report mutation
  const deleteReport = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('health_safety_reports')
        .delete()
        .eq('id', id)

      if (error) {
        toast.error('Failed to delete H&S report')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-safety-reports'] })
      toast.success('H&S report deleted')
    },
  })

  return {
    reports: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createReport,
    updateReport,
    deleteReport,
  }
}

// Hook for pending H&S reports
export function usePendingHSReports() {
  return useHealthSafety({ status: 'pending' })
}

// Hook for critical H&S reports
export function useCriticalHSReports() {
  return useHealthSafety({ severity: 'critical' })
}

// Hook for single H&S report
export function useHSReport(id: string | null) {
  return useQuery({
    queryKey: ['health-safety-report', id],
    queryFn: async () => {
      if (!id) return null

      const { data, error } = await (supabase
        .from('health_safety_reports') as any)
        .select(`
          *,
          zone:zones(name),
          reporter:user_profiles!health_safety_reports_reported_by_fkey(first_name, last_name)
        `)
        // Note: resolver join removed — resolved_by column/FK does not exist in live schema
        .eq('id', id)
        .single()

      if (error) {
        toast.error('Failed to load H&S report')
        throw error
      }

      return data
    },
    enabled: !!id,
  })
}
