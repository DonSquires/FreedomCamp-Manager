import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'

export function useOperationalOrganization() {
  const user = useAuthStore((state) => state.user)
  const { organizationId, organizationName } = useGlobalFiltersStore()
  const isGrandMaster = user?.role === 'grand_master'

  const authorizedOrganizationIds = Array.from(new Set([
    ...(user?.organization_id ? [user.organization_id] : []),
    ...(user?.employer_organization_id ? [user.employer_organization_id] : []),
    ...(user?.authorized_work_locations ?? []),
    ...(user?.extra_organization_ids ?? []),
  ]))

  const canUseSelectedOrganizationId =
    !!organizationId && (isGrandMaster || authorizedOrganizationIds.includes(organizationId))

  const operationalOrganizationId = canUseSelectedOrganizationId
    ? organizationId
    : user?.employer_organization_id ?? user?.organization_id ?? null

  return {
    operationalOrganizationId,
    operationalOrganizationName: organizationName,
    authorizedOrganizationIds,
    hasOperationalOrganization: isGrandMaster || !!operationalOrganizationId,
  }
}