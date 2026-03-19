import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface UserProfile {
  id: string
  email: string
  first_name: string
  last_name: string
  role: 'master' | 'admin' | 'officer' | 'admin_officer' | 'nzscv_monitor'
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

async function getFunctionErrorMessage(error: any, fallbackMessage: string) {
  const baseMessage = error?.message || fallbackMessage
  const context = error?.context
  if (!context || typeof context.clone !== 'function') return baseMessage
  const statusPrefix = typeof context?.status === 'number' ? `HTTP ${context.status}: ` : ''
  try {
    const payload = await context.clone().json()
    return statusPrefix + (payload?.error || payload?.message || baseMessage)
  } catch {
    try {
      const bodyText = await context.clone().text()
      return statusPrefix + (bodyText || baseMessage)
    } catch {
      return statusPrefix + baseMessage
    }
  }
}

async function invokeFunctionWithAuthRetry(name: string, body: any, fallbackMessage: string) {
  let result = await supabase.functions.invoke(name, { body })
  if (!result.error) return result

  const message = await getFunctionErrorMessage(result.error, fallbackMessage)
  if (!/invalid jwt|http\s*401|401\b/i.test(message)) {
    return result
  }

  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.access_token) {
    throw new Error('Session expired. Please sign in again.')
  }

  result = await supabase.functions.invoke(name, { body })
  return result
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
  ])
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
      const { data, error } = await withTimeout(
        invokeFunctionWithAuthRetry(
          'create-user',
          userData,
          'Failed to send user invitation',
        ),
        60000,
        'Invitation request timed out after 60 seconds. Check SMTP settings/network and try again.',
      )

      if (error) {
        const message = await getFunctionErrorMessage(error, 'Failed to send user invitation')
        throw new Error(message)
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
      const { error } = await (supabase.from('user_profiles') as any)
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
      const { error } = await (supabase.from('user_profiles') as any)
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
      let query = (supabase.from('user_profiles') as any)
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
        masters: data?.filter(u => u.role === 'master').length || 0,
      }

      return stats
    },
  })
}
