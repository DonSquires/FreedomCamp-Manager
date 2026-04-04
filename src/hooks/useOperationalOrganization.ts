import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'

export function useOperationalOrganization() {
  const user = useAuthStore((state) => state.user)
  const { organizationId, organizationName } = useGlobalFiltersStore()

  const authorizedOrganizationIds = Array.from(new Set([
    ...(user?.organization_id ? [user.organization_id] : []),
    ...(user?.authorized_work_locations ?? []),
    ...(user?.extra_organization_ids ?? []),
  ]))

  const operationalOrganizationId =
    organizationId && authorizedOrganizationIds.includes(organizationId)
      ? organizationId
      : user?.organization_id ?? null

  return {
    operationalOrganizationId,
    operationalOrganizationName: organizationName,
    authorizedOrganizationIds,
    hasOperationalOrganization: !!operationalOrganizationId,
  }
}