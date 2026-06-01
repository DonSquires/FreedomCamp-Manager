import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { resolveUserOrganizationId } from '@/lib/adminPortalScope'

export function useOperationalOrganization() {
  const user = useAuthStore((state) => state.user)
  const { organizationId, organizationName } = useGlobalFiltersStore()
  const isMasterLevel = user?.role === 'master' || user?.role === 'grand_master'
  const isGrandMaster = user?.role === 'grand_master'

  const authorizedOrganizationIds = Array.from(new Set([
    ...(user?.organization_id ? [user.organization_id] : []),
    ...(user?.employer_organization_id ? [user.employer_organization_id] : []),
    ...(user?.authorized_work_locations ?? []),
    ...(user?.extra_organization_ids ?? []),
  ]))

  const canUseSelectedOrganizationId =
    !!organizationId && (isMasterLevel || authorizedOrganizationIds.includes(organizationId))

  // Some operational personas are authorized through work locations/extra orgs
  // while profile org fields can be null during bootstrap or legacy records.
  const fallbackAuthorizedOrganizationId = authorizedOrganizationIds[0] ?? null

  const operationalOrganizationId = canUseSelectedOrganizationId
    ? organizationId
    : isGrandMaster
      ? null
      : resolveUserOrganizationId(user) ?? fallbackAuthorizedOrganizationId

  return {
    operationalOrganizationId,
    operationalOrganizationName: organizationName,
    authorizedOrganizationIds,
    hasOperationalOrganization: isMasterLevel || !!operationalOrganizationId,
  }
}