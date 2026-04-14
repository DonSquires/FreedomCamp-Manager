/**
 * Custom Hook: useIncidents
 * Incident CRUD with legal holds and court-ready management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface Incident {
  id: string
  organization_id: string
  zone_id: string | null
  plate_number: string | null
  incident_type: string | null
  severity: string | null
  status: string
  description: string | null
  evidence_count: number
  primary_evidence_url: string | null
  location_lat: number | null
  location_lng: number | null
  location_address: string | null
  notes: string | null
  metadata: any
  created_at: string
  user_id: string | null
}

interface CreateIncidentInput {
  zone_id: string
  plate_number?: string
  incident_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  location_lat?: number
  location_lng?: number
}

interface UpdateIncidentInput {
  status?: string
  retention_hold?: boolean
}

export function useIncidents(options?: {
  organizationId?: string
  zoneId?: string
  severity?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch incidents
  const query = useQuery({
    queryKey: ['incidents', options],
    queryFn: async () => {
      let query = supabase
        .from('incidents')
        .select(`
          id,
          organization_id,
          zone_id,
          plate_number,
          incident_type,
          severity,
          status,
          description,
          evidence_count,
          primary_evidence_url,
          location_lat,
          location_lng,
          location_address,
          notes,
          metadata,
          created_at,
          user_id,
          zone:zones(name),
          user_profile:user_profiles!incidents_user_id_fkey(first_name, last_name)
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
        toast.error('Failed to load incidents')
        throw error
      }

      return data as Incident[]
    },
  })

  // Create incident mutation
  const createIncident = useMutation({
    mutationFn: async (input: CreateIncidentInput) => {
      const { data, error } = await (supabase
        .from('incidents') as any)
        .insert({
          organization_id: user?.organization_id,
          user_id: user?.id,
          zone_id: input.zone_id,
          plate_number: input.plate_number,
          incident_type: input.incident_type,
          severity: input.severity,
          description: input.description,
          location_lat: input.location_lat,
          location_lng: input.location_lng,
          status: 'new',
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create incident')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident created successfully')
    },
  })

  // Update incident mutation
  const updateIncident = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateIncidentInput & { id: string }) => {
      const { error } = await supabase.from('incidents')
        .update(updates)
        .eq('id', id)

      if (error) {
        toast.error('Failed to update incident')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident updated successfully')
    },
  })

  // Set legal hold mutation
  const setLegalHold = useMutation({
    mutationFn: async ({ id, enable }: { id: string; enable: boolean }) => {
      const retentionDate = enable
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        : null

      const { error } = await supabase.from('incidents')
        .update({
          retention_hold: enable,
          retention_until: retentionDate,
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to update legal hold')
        throw error
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success(variables.enable ? 'Legal hold enabled' : 'Legal hold removed')
    },
  })

  return {
    incidents: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createIncident,
    updateIncident,
    setLegalHold,
  }
}

// Hook for single incident
export function useIncident(id: string | null) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: async () => {
      if (!id) return null

      const { data, error } = await (supabase
        .from('incidents') as any)
        .select(`
          *,
          zone:zones(name),
          user_profile:user_profiles!incidents_user_id_fkey(first_name, last_name)
        `)
        .eq('id', id)
        .single()

      if (error) {
        toast.error('Failed to load incident')
        throw error
      }

      return data
    },
    enabled: !!id,
  })
}
