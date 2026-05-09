import type { AppRole, RouteManifestEntry } from './routeManifest'

export interface LegacyNavItem {
  path: string
  label: string
  roles: string[]
}

export interface LegacyNavGroup {
  label: string
  items: LegacyNavItem[]
}

export interface RouteProjectionOptions {
  role?: AppRole
  includeInternal?: boolean
  shell?: RouteManifestEntry['shell']
}

function isVisible(entry: RouteManifestEntry, includeInternal: boolean): boolean {
  if (entry.visibilityMode === 'hidden') return false
  if (!includeInternal && entry.visibilityMode === 'internal') return false
  return true
}

function canAccess(entry: RouteManifestEntry, role?: AppRole): boolean {
  if (!role) return true
  return entry.rolesAllowed.includes(role)
}

/**
 * Projection for legacy top-level nav consumers.
 */
export function projectLegacyNavItems(
  entries: RouteManifestEntry[],
  options: RouteProjectionOptions = {},
): LegacyNavItem[] {
  const includeInternal = options.includeInternal ?? false
  return entries
    .filter((entry) => isVisible(entry, includeInternal))
    .filter((entry) => canAccess(entry, options.role))
    .filter((entry) => !options.shell || entry.shell === options.shell || entry.shell === 'shared')
    .filter((entry) => !!entry.navLabel)
    .map((entry) => ({
      path: entry.path,
      label: entry.navLabel as string,
      roles: [...entry.rolesAllowed],
    }))
}

/**
 * Grouped projection for modern sidebar consumers.
 */
export function projectLegacyNavGroups(
  entries: RouteManifestEntry[],
  options: RouteProjectionOptions = {},
): LegacyNavGroup[] {
  const grouped = new Map<string, LegacyNavItem[]>()

  for (const item of projectLegacyNavItems(entries, options)) {
    const source = entries.find((entry) => entry.path === item.path)
    const group = source?.navGroup || 'Ungrouped'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)?.push(item)
  }

  return Array.from(grouped.entries()).map(([label, items]) => ({
    label,
    items,
  }))
}

/**
 * Determines if a route should be visible in the navigation for a given role.
 * If the path is in the manifest, the manifest is authoritative.
 * If the path is NOT in the manifest yet, returns `true` (backward-compat fallback).
 */
/**
 * Determines if a route should be visible in the navigation for a given role.
 * If the path is in the manifest, the manifest is authoritative.
 * If the path is NOT in the manifest yet, returns `true` (backward-compat fallback).
 *
 * @param featureFlagsActive - optional set of active feature flag keys. When provided,
 *   routes gated by a featureFlag are hidden unless the flag is present in this set.
 *   When omitted, feature-flagged routes default to visible (fallback for callers that
 *   have not yet wired up the flag store).
 */
export function isRouteVisibleForRole(
  path: string,
  role: AppRole | null | undefined,
  entries: RouteManifestEntry[],
  featureFlagsActive?: Set<string>,
): boolean {
  const entry = entries.find((e) => e.path === path)
  if (!entry) return true // not in manifest yet — allow (backward compat)
  if (entry.visibilityMode === 'hidden') return false
  if (role === 'grand_master') {
    if (entry.featureFlag && featureFlagsActive && !featureFlagsActive.has(entry.featureFlag)) return false
    return true
  }
  // Internal routes are only surfaced to master when not in the grand_master bypass path.
  if (entry.visibilityMode === 'internal' && role !== 'master') return false
  if (!role) return false
  if (!entry.rolesAllowed.includes(role)) return false
  // Feature-flag gate: hide if a flag is required and the caller supplied the active set without it
  if (entry.featureFlag && featureFlagsActive && !featureFlagsActive.has(entry.featureFlag)) return false
  return true
}

/**
 * Lightweight runtime check to ensure legacy hardcoded nav has path parity
 * with migrated manifest routes for the current phase.
 */
export function getMissingManifestPaths(
  legacyPaths: string[],
  entries: RouteManifestEntry[],
): string[] {
  const manifestPaths = new Set(entries.map((entry) => entry.path))
  return legacyPaths.filter((path) => !manifestPaths.has(path))
}
