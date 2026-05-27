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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function readSupabaseAccessTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null

  const storages: Storage[] = [window.localStorage, window.sessionStorage]
  for (const storage of storages) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

      const raw = storage.getItem(key)
      if (!raw) continue

      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
          return parsed.access_token
        }
      } catch {
        // Ignore malformed auth storage values.
      }
    }
  }

  return null
}

async function fetchOrganizationsDirect(timeoutMs = 15000): Promise<OrganizationWithParent[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing')
  }

  let accessToken = readSupabaseAccessTokenFromStorage()
  if (!accessToken) {
    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      Math.min(2000, timeoutMs),
      'Session lookup'
    )

    accessToken = session?.access_token ?? null
  }

  if (!accessToken) {
    throw new Error('Session expired. Please sign in again')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const query = new URLSearchParams({
      select: '*,parent_organization:organizations!parent_organization_id(name)',
      is_active: 'eq.true',
      order: 'name.asc',
    })

    const response = await fetch(`${supabaseUrl}/rest/v1/organizations?${query.toString()}`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      let message = 'Failed to load organisations'
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          message = parsed?.message || parsed?.error_description || parsed?.hint || raw
        } catch {
          message = raw
        }
      }
      throw new Error(message)
    }

    return raw ? JSON.parse(raw) as OrganizationWithParent[] : []
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Organisation list timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () => fetchOrganizationsDirect(),
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
