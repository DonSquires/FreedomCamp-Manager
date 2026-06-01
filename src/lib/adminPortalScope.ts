type AdminPortalScopeUser = {
  role?: string | null
  organization_id?: string | null
  employer_organization_id?: string | null
  authorized_work_locations?: string[] | null
  extra_organization_ids?: string[] | null
}

const isNonEmptyString = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

const firstNonEmpty = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (isNonEmptyString(value)) return value
  }
  return null
}

export function resolveAdminPortalOrganizationId(
  user: AdminPortalScopeUser | null | undefined,
  selectedOrganizationId: string | null | undefined,
): string | null {
  const isMasterScope = user?.role === 'master' || user?.role === 'grand_master'
  if (isMasterScope) return firstNonEmpty(selectedOrganizationId)

  return resolveUserOrganizationId(user)
}

export function resolveUserOrganizationId(user: AdminPortalScopeUser | null | undefined): string | null {
  return firstNonEmpty(
    user?.organization_id,
    user?.employer_organization_id,
    user?.authorized_work_locations?.[0],
    user?.extra_organization_ids?.[0],
  )
}
