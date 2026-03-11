/**
 * Organization filtering utilities
 *
 * Provides a single, consistent way to resolve the effective organization ID
 * for all queries. This prevents the fragmented org-filter logic scattered
 * across components.
 *
 * Rules:
 *  - master users: use the globally-selected org (from global filters store or
 *    a component-level selection). Returns null if none selected (shows all).
 *  - all other users: always scoped to their own organisation_id.
 */

interface UserLike {
  role?: string | null
  organization_id?: string | null
}

/**
 * Returns the organization ID that should be used to filter queries.
 *
 * @param user - The authenticated user (or null if not logged in).
 * @param selectedOrgId - The org ID selected via global filters / org selector.
 *   Only honoured for master users. Pass `undefined` or `null` if no selection.
 * @returns The effective org ID, or `null` to indicate "no filter / show all".
 */
export function getEffectiveOrgId(
  user: UserLike | null | undefined,
  selectedOrgId?: string | null,
): string | null {
  if (!user) return null
  if (user.role === 'master') return selectedOrgId ?? null
  return user.organization_id ?? null
}
