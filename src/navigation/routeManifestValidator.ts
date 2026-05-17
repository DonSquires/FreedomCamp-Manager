import { routeManifest, type AppShell, type AuditDomain, type PreloadPolicy, type RouteManifestEntry, type VisibilityMode } from './routeManifest'

export interface RouteManifestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const VALID_SHELLS: AppShell[] = ['officer', 'admin', 'master', 'shared']
const VALID_VISIBILITY: VisibilityMode[] = ['production', 'internal', 'hidden']
const VALID_PRELOAD: PreloadPolicy[] = ['none', 'intent', 'viewport', 'eager']
const VALID_AUDIT_DOMAINS: AuditDomain[] = ['operations', 'compliance', 'enforcement', 'dispatch', 'people', 'management', 'records', 'system', 'bob', 'specialist']
const VALID_CATCH_ALL_PATHS = new Set(['*'])

function isUnique(items: string[]): boolean {
  return new Set(items).size === items.length
}

export function validateRouteManifest(entries: RouteManifestEntry[]): RouteManifestValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const routeIds = entries.map((e) => e.routeId)
  const paths = entries.map((e) => e.path)

  if (!isUnique(routeIds)) errors.push('Duplicate routeId values detected in route manifest.')
  if (!isUnique(paths)) errors.push('Duplicate path values detected in route manifest.')

  for (const entry of entries) {
    const prefix = `routeId=${entry.routeId}`

    if (!entry.routeId.trim()) errors.push(`${prefix}: routeId must not be empty.`)
    if (!entry.path.startsWith('/') && !VALID_CATCH_ALL_PATHS.has(entry.path)) {
      errors.push(`${prefix}: path must start with '/' (or be '*' for a catch-all route).`)
    }
    if (!VALID_SHELLS.includes(entry.shell)) errors.push(`${prefix}: invalid shell '${entry.shell}'.`)
    if (!VALID_VISIBILITY.includes(entry.visibilityMode)) {
      errors.push(`${prefix}: invalid visibilityMode '${entry.visibilityMode}'.`)
    }
    if (!VALID_PRELOAD.includes(entry.preloadPolicy)) {
      errors.push(`${prefix}: invalid preloadPolicy '${entry.preloadPolicy}'.`)
    }
    if (entry.auditDomain && !VALID_AUDIT_DOMAINS.includes(entry.auditDomain)) {
      errors.push(`${prefix}: invalid auditDomain '${entry.auditDomain}'.`)
    }
    if (!entry.rolesAllowed.length) errors.push(`${prefix}: rolesAllowed must include at least one role.`)

    if (entry.visibilityMode === 'production' && !entry.navLabel) {
      warnings.push(`${prefix}: production route has no navLabel (allowed for non-nav routes only).`)
    }

    if (entry.visibilityMode === 'internal' && !entry.featureFlag) {
      warnings.push(`${prefix}: internal route should usually specify a featureFlag.`)
    }

    if (entry.mobilePriority !== null && entry.mobilePriority !== undefined && entry.mobilePriority < 1) {
      errors.push(`${prefix}: mobilePriority must be >= 1 when specified.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

export function assertRouteManifestValid(entries: RouteManifestEntry[] = routeManifest): void {
  const result = validateRouteManifest(entries)
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn('[route-manifest warning]', warning)
    }
  }

  if (!result.valid) {
    const details = result.errors.join('\n')
    throw new Error(`Route manifest validation failed:\n${details}`)
  }
}
