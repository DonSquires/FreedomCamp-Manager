import type { AppRole, RouteManifestEntry } from './routeManifest'

export type RouteVisibilityRuntimeMode = 'production' | 'staging' | 'development'

const AUDIT_PATH_PREFIX = '/audit/'

interface AuditAliasCandidate {
  aliasPath: string
  targetPath: string
}

function normalizeAuditAliasPath(path: string): string {
  return `/${path.trim().replace(/^\/+|\/+$/g, '')}`
}

function getAuditDomain(entry: RouteManifestEntry): string {
  return entry.auditDomain || 'records'
}

function buildAuditAliasCandidates(entries: RouteManifestEntry[]): AuditAliasCandidate[] {
  const candidates: AuditAliasCandidate[] = []

  for (const entry of entries) {
    if (!entry.path.startsWith('/') || !entry.path.endsWith('-log')) continue

    const slugWithSuffix = entry.path.slice(1)
    const slug = slugWithSuffix.replace(/-log$/, '')
    const domain = getAuditDomain(entry)

    candidates.push({ aliasPath: `/audit/${slugWithSuffix}`, targetPath: entry.path })
    candidates.push({ aliasPath: `/audit/${slug}`, targetPath: entry.path })
    candidates.push({ aliasPath: `/audit/${domain}/${slugWithSuffix}`, targetPath: entry.path })
    candidates.push({ aliasPath: `/audit/${domain}/${slug}`, targetPath: entry.path })
  }

  return candidates
}

/**
 * Resolves a /audit alias path to a canonical legacy log route using manifest metadata.
 * Returns null when no known alias mapping exists.
 */
export function resolveAuditAliasPath(
  aliasPath: string,
  entries: RouteManifestEntry[],
): string | null {
  const normalizedAlias = normalizeAuditAliasPath(aliasPath)
  if (!normalizedAlias.startsWith(AUDIT_PATH_PREFIX)) return null

  for (const candidate of buildAuditAliasCandidates(entries)) {
    if (candidate.aliasPath === normalizedAlias) return candidate.targetPath
  }

  return null
}

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
  visibilityMode?: RouteVisibilityRuntimeMode
  shell?: RouteManifestEntry['shell']
}

function isVisible(entry: RouteManifestEntry, visibilityMode: RouteVisibilityRuntimeMode): boolean {
  if (entry.visibilityMode === 'hidden') return false
  if (entry.visibilityMode === 'internal' && visibilityMode === 'production') return false
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
  const visibilityMode = options.visibilityMode ?? ((options.includeInternal ?? false) ? 'staging' : 'production')
  return entries
    .filter((entry) => isVisible(entry, visibilityMode))
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
 *
 * @param featureFlagsActive - optional set of active feature flag keys. When provided,
 *   routes gated by a featureFlag are hidden unless the flag is present in this set.
 *   When omitted, feature-flagged routes default to visible (fallback for callers that
 *   have not yet wired up the flag store).
 * @param visibilityMode - runtime visibility context. Internal routes are hidden in
 *   production mode and allowed in staging/development (subject to role/flag checks).
 */
export function isRouteVisibleForRole(
  path: string,
  role: AppRole | null | undefined,
  entries: RouteManifestEntry[],
  featureFlagsActive?: Set<string>,
  visibilityMode: RouteVisibilityRuntimeMode = 'production',
): boolean {
  const entry = entries.find((e) => e.path === path)
  if (!entry) return true // not in manifest yet — allow (backward compat)
  if (entry.visibilityMode === 'hidden') return false
  if (entry.visibilityMode === 'internal' && visibilityMode === 'production') return false
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
 * Returns whether a path is hidden for the provided runtime mode.
 * Unknown paths are treated as not-hidden for backward compatibility.
 */
export function isRouteHidden(
  path: string,
  entries: RouteManifestEntry[],
  visibilityMode: RouteVisibilityRuntimeMode = 'production',
): boolean {
  const entry = entries.find((e) => e.path === path)
  if (!entry) return false
  if (entry.visibilityMode === 'hidden') return true
  return entry.visibilityMode === 'internal' && visibilityMode === 'production'
}

/**
 * Maps runtime environment settings to manifest visibility mode.
 */
export function resolveRuntimeVisibilityMode(
  envMode: string | undefined,
  isProd: boolean,
): RouteVisibilityRuntimeMode {
  if (isProd) return 'production'
  if (envMode === 'staging') return 'staging'
  return 'development'
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
