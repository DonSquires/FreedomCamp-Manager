import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface Organization {
  id: string
  name: string
  organization_type: 'owner' | 'service_provider' | 'client'
  organization_level: number
  parent_organization_id: string | null
  contact_email: string | null
  contact_phone: string | null
  enforcement_workflow: string
  overnight_verification_mode: 'two_photo_verification' | 'one_photo_per_day_inference'
  is_active: boolean
  created_at: string
  updated_at: string
}

interface OrganizationWithParent extends Organization {
  parent_organization: {
    name: string
  } | null
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select(`
          *,
          parent_organization:organizations!parent_organization_id(name)
        `)
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) throw error
      return data as unknown as OrganizationWithParent[]
    },
  })
}

export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: ['organization', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select(`
          *,
          parent_organization:organizations!parent_organization_id(name)
        `)
        .eq('id', orgId)
        .single()

      if (error) throw error
      return data as unknown as OrganizationWithParent
    },
    enabled: !!orgId,
  })
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orgData: {
      name: string
      organization_type: Organization['organization_type']
      parent_organization_id?: string | null
    }) => {
      const { data, error } = await (supabase
        .from('organizations') as any)
        .insert([orgData])
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      toast.success('Organisation created successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create organisation')
    },
  })
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, updates }: {
      orgId: string
      updates: Partial<Organization>
    }) => {
      const { error } = await supabase.from('organizations')
        .update(updates)
        .eq('id', orgId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', variables.orgId] })
      toast.success('Organisation updated successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update organisation')
    },
  })
}

export function useToggleOrganizationStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, isActive }: { orgId: string; isActive: boolean }) => {
      const { error } = await supabase.from('organizations')
        .update({ is_active: !isActive })
        .eq('id', orgId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      toast.success('Organisation status updated')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update organisation')
    },
  })
}

export function useOrganizationStats(orgId?: string | null) {
  return useQuery({
    queryKey: ['organization-stats', orgId],
    queryFn: async () => {
      const promises = [
        // Count users
        supabase
          .from('user_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId || ''),
        
        // Count zones
        supabase
          .from('zones')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId || ''),
        
        // Count observations
        supabase
          .from('observations')
          .select('observation_id', { count: 'exact', head: true })
          .eq('organization_id', orgId || ''),
        
        // Count breaches
        supabase
          .from('breach_alerts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId || '')
          .eq('status', 'pending'),
      ]

      const [users, zones, observations, breaches] = await Promise.all(promises)

      return {
        userCount: users.count || 0,
        zoneCount: zones.count || 0,
        observationCount: observations.count || 0,
        activeBreachCount: breaches.count || 0,
      }
    },
    enabled: !!orgId,
  })
}
