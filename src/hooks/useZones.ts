import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Zone } from '@/types'

interface UseZonesOptions {
  organizationId?: string | null
  showInactive?: boolean
  searchQuery?: string
}

export function useZones(options: UseZonesOptions = {}) {
  const { organizationId, showInactive = false, searchQuery = '' } = options

  return useQuery({
    queryKey: ['zones', organizationId, showInactive, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('zones')
        .select(`
          *,
          observations:observations(count),
          breach_alerts:breach_alerts(count)
        `)
        .order('name', { ascending: true })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (!showInactive) {
        query = query.eq('is_active', true)
      }

      if (searchQuery) {
        query = query.ilike('name', `%${searchQuery}%`)
      }

      const { data, error } = await query

      if (error) throw error

      // Deduplicate zones by (organization_id, name) — keep first occurrence
      const seen = new Set<string>()
      const unique = ((data || []) as unknown as Zone[]).filter((zone) => {
        const key = `${zone.organization_id}::${zone.name.trim().toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return unique as Zone[]
    },
  })
}

export function useZone(zoneId: string) {
  return useQuery({
    queryKey: ['zone', zoneId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('*')
        .eq('id', zoneId)
        .single()

      if (error) throw error
      return data as unknown as Zone
    },
    enabled: !!zoneId,
  })
}

export function useCreateZone() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (zone: Omit<Zone, 'id' | 'created_at'>) => {
      const { error } = await (supabase
        .from('zones') as any)
        .insert(zone)

      if (error) {
        if (error.message?.includes('idx_zones_unique_org_name_active')) {
          throw new Error(`A zone with this name already exists in this organisation`)
        }
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      toast.success('Zone created successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create zone')
    },
  })
}

export function useUpdateZone() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ zoneId, updates }: { zoneId: string; updates: Partial<Zone> }) => {
      const { _count: _count_, ...dbUpdates } = updates
      const { error } = await supabase.from('zones')
        .update(dbUpdates)
        .eq('id', zoneId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      queryClient.invalidateQueries({ queryKey: ['zone', variables.zoneId] })
      toast.success('Zone updated successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update zone')
    },
  })
}

export function useToggleZoneActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ zoneId, isActive }: { zoneId: string; isActive: boolean }) => {
      const { error } = await supabase.from('zones')
        .update({ is_active: !isActive })
        .eq('id', zoneId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      toast.success('Zone status updated')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update zone status')
    },
  })
}

export function useZoneStats(organizationId?: string | null) {
  return useQuery({
    queryKey: ['zone-stats', organizationId],
    queryFn: async () => {
      let query = supabase.from('zones')
        .select('is_active, day_visit_only, self_contained_required', { count: 'exact' })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error, count } = await query

      if (error) throw error

      const stats = {
        total: count || 0,
        active: data?.filter(z => z.is_active).length || 0,
        inactive: data?.filter(z => !z.is_active).length || 0,
        dayVisitOnly: data?.filter(z => z.day_visit_only).length || 0,
        requiresSC: data?.filter(z => z.self_contained_required).length || 0,
      }

      return stats
    },
  })
}
