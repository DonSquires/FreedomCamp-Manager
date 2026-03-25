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
  grand_master: 6,
  master: 5,
  admin: 4,
  admin_officer: 3,
  officer: 2,
  nzscv_monitor: 1,
  client_viewer: 1,
  viewer: 1,
}

const PERMISSION_MATRIX = {
  grand_master: ['*'],
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
  nzscv_monitor: [
    'view_own_data',
    'view_reports',
  ],
  client_viewer: [
    'view_own_data',
    'view_reports',
  ],
  viewer: [
    'view_own_data',
    'view_reports',
  ],
}

/**
 * Portal / area codes that a user can be explicitly allocated to.
 * grand_master and master implicitly have access to all areas.
 * For all other roles, portal_access must include the code (or be empty,
 * in which case role-based routing applies).
 */
export const PORTAL_AREA_CODES = [
  'field_officer',
  'site_guard',
  'parking',
  'noise',
  'ems',
  'admin',
  'compliance',
  'enforcement',
  'dispatch',
  'investigations',
  'reports',
  'roster',
  'users',
  'zones',
  'data_management',
  'client_portal',
  'platform',
] as const

export type PortalAreaCode = typeof PORTAL_AREA_CODES[number]

export const PORTAL_AREA_LABELS: Record<PortalAreaCode, string> = {
  field_officer:    'Field Officer Portal',
  site_guard:       'Site Guard Portal',
  parking:          'Parking Enforcement',
  noise:            'Noise Control',
  ems:              'EMS Portal',
  admin:            'Admin Dashboard',
  compliance:       'Compliance',
  enforcement:      'Enforcement',
  dispatch:         'Dispatch Console',
  investigations:   'Investigations',
  reports:          'Reports',
  roster:           'Roster Planner',
  users:            'User Management',
  zones:            'Zone Management',
  data_management:  'Data Management',
  client_portal:    'Client Portal',
  platform:         'Platform Overview',
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

  /**
   * hasPortalAccess(area)
   *
   * Returns true when the current user is allowed to enter a specific portal
   * area.  Rules (in order):
   *   1. grand_master / master always have access to everything.
   *   2. If the user's portal_access array is empty the check is skipped
   *      (access is governed purely by role-based guards in App.tsx).
   *   3. Otherwise the user must have the area code in portal_access.
   */
  const hasPortalAccess = (area: string): boolean => {
    if (!user) return false
    // Platform-owner roles bypass all area restrictions
    if (user.role === 'grand_master' || user.role === 'master') return true
    // No restrictions set — fall back to role-only checks
    if (!user.portal_access || user.portal_access.length === 0) return true
    return user.portal_access.includes(area)
  }

  /**
   * canAccessOrganization(orgId)
   *
   * Returns true when the user is authorised to access data belonging to the
   * given organisation.  Checks primary org, authorized_work_locations and
   * extra_organization_ids.
   */
  const canAccessOrganization = (organizationId: string): boolean => {
    if (!user) return false

    // Grand master and master can access all organizations
    if (user.role === 'grand_master' || user.role === 'master') return true

    // Check primary org
    if (user.organization_id === organizationId) return true

    // Check authorized_work_locations
    if (user.authorized_work_locations?.includes(organizationId)) return true

    // Check extra_organization_ids
    if (user.extra_organization_ids?.includes(organizationId)) return true

    return false
  }

  // Check if user can edit resource owned by another user
  const canEditOthersResource = (resourceOwnerId: string): boolean => {
    if (!user) return false

    // Grand masters, masters and admins can edit anyone's resources
    if (user.role === 'grand_master' || user.role === 'master' || user.role === 'admin') return true

    // admin_officer can edit resources except their own
    if (user.role === 'admin_officer' && resourceOwnerId !== user.id) {
      return true
    }

    // Others can only edit their own
    return resourceOwnerId === user.id
  }

  /** All org IDs the user is authorised to access (union of primary + work locations + extra) */
  const authorizedOrgIds: string[] = [
    ...(user?.organization_id ? [user.organization_id] : []),
    ...(user?.authorized_work_locations ?? []),
    ...(user?.extra_organization_ids ?? []),
  ]

  return {
    hasPermission,
    hasRole,
    hasRoleLevel,
    hasPortalAccess,
    canAccessOrganization,
    canEditOthersResource,
    authorizedOrgIds,
    isGrandMaster: user?.role === 'grand_master',
    isMaster: user?.role === 'master' || user?.role === 'grand_master',
    isAdmin: user?.role === 'admin' || user?.role === 'admin_officer',
    isOfficer: user?.role === 'officer' || user?.role === 'admin_officer',
    isClientViewer: user?.role === 'client_viewer',
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

// Hook for portal-area UI rendering
export function usePortalAccessCheck(area: string): boolean {
  const { hasPortalAccess } = usePermissions()
  return hasPortalAccess(area)
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
