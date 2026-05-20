export function shouldEnableRosterPlannerQueries(
  activeTab: 'planner' | 'users',
  hasOrganizationId: boolean
) {
  return hasOrganizationId && activeTab === 'planner'
}

export function shouldEnableRosterPlannerClientScopedQueries(
  activeTab: 'planner' | 'users',
  hasOrganizationId: boolean,
  clientOrgIdsLoading: boolean
) {
  return shouldEnableRosterPlannerQueries(activeTab, hasOrganizationId) && !clientOrgIdsLoading
}
