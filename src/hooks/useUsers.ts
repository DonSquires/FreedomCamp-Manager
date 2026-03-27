import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { toast } from 'sonner'
import type { UserRole } from '@/types'

interface UserProfile {
  id: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  organization_id: string | null
  is_active: boolean
  phone: string | null
  created_at: string
}

interface UseUsersOptions {
  searchQuery?: string
  role?: UserProfile['role'] | 'all'
  isActive?: boolean | null
}

// Reuse helper for create-user (invitation workflow) which requires custom retry and auth handling
// The create-user endpoint is special: it sends invitations and requires session refresh on auth errors
async function invokeFunctionWithAuthRetry(name: string, body: any, fallbackMessage: string) {
  let result = await supabase.functions.invoke(name, { body })
  if (!result.error) return result

  const isFetchError = /failed to send.*edge function|failed to fetch|networkerror/i.test(
    String((result.error as any)?.message || '')
  )
  // If we get a fetch error or auth error, refresh and retry once
  if (!isFetchError) return result

  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.access_token) {throw new Error('Session expired. Please sign in again.')
  }

  result = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  })
  return result
}

export function useUsers(options: UseUsersOptions = {}) {
  const { searchQuery = '', role = 'all', isActive = null } = options

  return useQuery({
    queryKey: ['users', searchQuery, role, isActive],
    queryFn: async () => {
      let query = supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (searchQuery) {
        query = query.or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
      }

      if (role !== 'all') {
        query = query.eq('role', role)
      }

      if (isActive !== null) {
        query = query.eq('is_active', isActive)
      }

      const { data, error } = await query

      if (error) throw error
      return data as UserProfile[]
    },
  })
}

export function useUser(userId: string) {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      return data as UserProfile
    },
    enabled: !!userId,
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userData: {
      email: string
      first_name: string
      last_name: string
      role: UserProfile['role']
      phone?: string
    }) => {
      const { data, error } = await invokeFunctionWithAuthRetry(
        'create-user',
        userData,
        'Failed to send user invitation',
      )

      if (error) {
        const msg = typeof error === 'object' && error && 'message' in error ? (error as any).message : String(error)
        throw new Error(msg || 'Failed to send user invitation')
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User invitation sent')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create user')
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, updates }: { 
      userId: string
      updates: Partial<UserProfile> 
    }) => {
      const { error } = await supabase.from('user_profiles')
        .update(updates)
        .eq('id', userId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['user', variables.userId] })
      toast.success('User updated successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update user')
    },
  })
}

export function useToggleUserStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const { error } = await supabase.from('user_profiles')
        .update({ is_active: !isActive })
        .eq('id', userId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User status updated')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update user status')
    },
  })
}

export function useUserStats(organizationId?: string | null) {
  return useQuery({
    queryKey: ['user-stats', organizationId],
    queryFn: async () => {
      let query = supabase.from('user_profiles')
        .select('role, is_active', { count: 'exact' })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error, count } = await query

      if (error) throw error

      const stats = {
        total: count || 0,
        active: data?.filter(u => u.is_active).length || 0,
        inactive: data?.filter(u => !u.is_active).length || 0,
        officers: data?.filter(u => u.role === 'officer').length || 0,
        admins: data?.filter(u => u.role === 'admin' || u.role === 'admin_officer').length || 0,
        masters: data?.filter(u => u.role === 'master' || u.role === 'grand_master').length || 0,
      }

      return stats
    },
  })
}
