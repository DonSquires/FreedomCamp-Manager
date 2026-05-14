/**
 * Role-Based Visibility Guard
 * 
 * Wraps components/sections to show/hide based on user role + permissions.
 * Also enforces org-level visibility via org_access_allowed.
 * 
 * Usage:
 *   <RoleBasedVisibility requiredRoles={['admin', 'officer']}>
 *     <AdminOnlyFeature />
 *   </RoleBasedVisibility>
 * 
 *   <RoleBasedVisibility requiredOrgs={['org-id']} fallback={<AccessDenied />}>
 *     <OrgSpecificView />
 *   </RoleBasedVisibility>
 */

import { ReactNode } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useOrganization } from '@/hooks/useOrganization'

export interface RoleBasedVisibilityProps {
  children: ReactNode
  fallback?: ReactNode
  requiredRoles?: string[]
  requiredOrgs?: string[]
  requireAll?: boolean // If true, user must have ALL roles/orgs. If false, ANY role/org is sufficient.
}

/**
 * Default fallback component for access denied
 */
function DefaultFallback() {
  return (
    <div className="p-4 border border-yellow-200 rounded-md bg-yellow-50">
      <p className="text-sm text-yellow-800">You do not have permission to view this content.</p>
    </div>
  )
}

export default function RoleBasedVisibility({
  children,
  fallback,
  requiredRoles = [],
  requiredOrgs = [],
  requireAll = false,
}: RoleBasedVisibilityProps) {
  const { role } = useAuthStore()
  const { organization, allowedOrganizations } = useOrganization()

  // Check role visibility
  const hasRoleAccess =
    requiredRoles.length === 0 ||
    (requireAll
      ? requiredRoles.every(r => role === r)
      : requiredRoles.some(r => role === r))

  // Check org visibility
  const hasOrgAccess =
    requiredOrgs.length === 0 ||
    (requireAll
      ? requiredOrgs.every(orgId => allowedOrganizations?.some(o => o.id === orgId))
      : requiredOrgs.some(orgId => allowedOrganizations?.some(o => o.id === orgId)))

  if (!hasRoleAccess || !hasOrgAccess) {
    return fallback || <DefaultFallback />
  }

  return <>{children}</>
}
