/**
 * Custom Hook: usePermissions
 * Role-based permissions and authorization checks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface Permission {
  action: string
  resource: string
  allowed: boolean
}

const ROLE_HIERARCHY = {
  master: 5,
  admin: 4,
  admin_officer: 3,
  officer: 2,
  viewer: 1,
}

const PERMISSION_MATRIX = {
  master: ['*'],
  admin: [
    'manage_users',
    'manage_zones',
    'manage_organizations',
    'view_all_data',
    'edit_all_data',
    'delete_data',
    'approve_incidents',
    'manage_enforcement',
    'manage_investigations',
    'view_reports',
    'export_data',
  ],
  admin_officer: [
    'view_all_data',
    'create_observations',
    'create_incidents',
    'create_enforcement_actions',
    'view_reports',
  ],
  officer: [
    'view_own_data',
    'create_observations',
    'create_incidents',
    'edit_own_observations',
    'edit_own_incidents',
  ],
  viewer: [
    'view_own_data',
    'view_reports',
  ],
}

export function usePermissions() {
  const { user } = useAuthStore()

  // Check if user has specific permission
  const hasPermission = (permission: string): boolean => {
    if (!user || !user.role) return false

    const role = user.role as keyof typeof PERMISSION_MATRIX
    const rolePermissions = PERMISSION_MATRIX[role] || []

    // Master role has all permissions
    if (rolePermissions.includes('*')) return true

    // Check direct permission
    if (rolePermissions.includes(permission)) return true

    // Check custom permissions from user_profiles.permissions
    const userPerms = (user as any).permissions
    if (userPerms && Array.isArray(userPerms)) {
      return userPerms.includes(permission)
    }

    return false
  }

  // Check if user has any of the specified roles
  const hasRole = (...roles: string[]): boolean => {
    if (!user || !user.role) return false
    return roles.includes(user.role)
  }

  // Check if user has at least the specified role level
  const hasRoleLevel = (minRole: string): boolean => {
    if (!user || !user.role) return false

    const userLevel = ROLE_HIERARCHY[user.role as keyof typeof ROLE_HIERARCHY] || 0
    const minLevel = ROLE_HIERARCHY[minRole as keyof typeof ROLE_HIERARCHY] || 0

    return userLevel >= minLevel
  }

  // Check if user can access organization data
  const canAccessOrganization = (organizationId: string): boolean => {
    if (!user) return false

    // Master can access all organizations
    if (user.role === 'master') return true

    // Check if organization matches user's organization
    if (user.organization_id === organizationId) return true

    // Check if organization is in user's authorized work locations
    return false
  }

  // Check if user can edit resource owned by another user
  const canEditOthersResource = (resourceOwnerId: string): boolean => {
    if (!user) return false

    // Masters and admins can edit anyone's resources
    if (user.role === 'master' || user.role === 'admin') return true

    // admin_officer can edit resources except their own
    if (user.role === 'admin_officer' && resourceOwnerId !== user.id) {
      return true
    }

    // Others can only edit their own
    return resourceOwnerId === user.id
  }

  return {
    hasPermission,
    hasRole,
    hasRoleLevel,
    canAccessOrganization,
    canEditOthersResource,
    isMaster: user?.role === 'master',
    isAdmin: user?.role === 'admin' || user?.role === 'admin_officer',
    isOfficer: user?.role === 'officer' || user?.role === 'admin_officer',
    currentRole: user?.role,
  }
}

// Hook for permission-based UI rendering
export function usePermissionCheck(permission: string): boolean {
  const { hasPermission } = usePermissions()
  return hasPermission(permission)
}

// Hook for role-based UI rendering
export function useRoleCheck(...roles: string[]): boolean {
  const { hasRole } = usePermissions()
  return hasRole(...roles)
}

// Hook for managing user permissions (admin only)
export function useManagePermissions(userId: string | null) {
  const queryClient = useQueryClient()
  const { hasPermission } = usePermissions()

  const permissionsQuery = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: async () => {
      if (!userId || !hasPermission('manage_users')) return null

      const { data, error } = await (supabase.from('user_profiles') as any)
        .select('permissions, role')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Failed to load user permissions:', error)
        return null
      }

      if (!data) return null

      return {
        role: data.role,
        customPermissions: data.permissions || [],
      }
    },
    enabled: !!userId && hasPermission('manage_users'),
  })

  const updatePermissions = useMutation({
    mutationFn: async (permissions: string[]) => {
      if (!userId || !hasPermission('manage_users')) {
        throw new Error('Unauthorized')
      }

      const { error } = await (supabase.from('user_profiles') as any)
        .update({ permissions })
        .eq('id', userId)

      if (error) {
        toast.error('Failed to update permissions')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-permissions'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Permissions updated')
    },
  })

  return {
    permissions: permissionsQuery.data,
    isLoading: permissionsQuery.isLoading,
    updatePermissions,
  }
}
