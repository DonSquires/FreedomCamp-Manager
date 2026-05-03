import { createContext, useContext } from 'react'

export interface OrganizationPermissions {
  canInviteUsers: boolean
  canRemoveUsers: boolean
  canManageRoles: boolean
}

export interface OrganizationContextValue {
  activeOrgId: string | null
  activeOrgName: string | null
  permissions: OrganizationPermissions
}

const defaultPermissions: OrganizationPermissions = {
  canInviteUsers: false,
  canRemoveUsers: false,
  canManageRoles: false,
}

export const OrganizationContext = createContext<OrganizationContextValue>({
  activeOrgId: null,
  activeOrgName: null,
  permissions: defaultPermissions,
})

export function useOrganizationContext(): OrganizationContextValue {
  return useContext(OrganizationContext)
}
