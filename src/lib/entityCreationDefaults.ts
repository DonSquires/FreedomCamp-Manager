const FIELD_ROLE_FALLBACK_LAST_NAME = new Set(['officer', 'nzscv_monitor'])

function toTitleCase(token: string): string {
  if (!token) return ''
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

export function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeEmailAddress(value: unknown): string {
  return trimToNull(typeof value === 'string' ? value.toLowerCase() : value) ?? ''
}

export function normalizeStringArray(value: unknown, transform?: (entry: string) => string): string[] {
  if (!Array.isArray(value)) return []

  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .map((entry) => (entry && transform ? transform(entry) : entry))
    .filter((entry): entry is string => entry.length > 0)

  return Array.from(new Set(normalized))
}

export function deriveNamePartsFromEmail(email: string): { firstName: string | null; lastName: string | null } {
  const localPart = String(email || '').split('@')[0] || ''
  const tokens = localPart
    .replace(/[._+-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => toTitleCase(token.trim()))
    .filter(Boolean)

  if (tokens.length === 0) {
    return { firstName: null, lastName: null }
  }

  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(' ') || null,
  }
}

export function resolveUserNames(params: {
  email: string
  first_name?: unknown
  last_name?: unknown
  role?: unknown
}): { first_name: string | null; last_name: string | null } {
  const explicitFirstName = trimToNull(params.first_name)
  const explicitLastName = trimToNull(params.last_name)
  const derived = deriveNamePartsFromEmail(params.email)
  const firstName = explicitFirstName ?? derived.firstName

  let lastName = explicitLastName ?? derived.lastName
  if (!lastName) {
    const normalizedRole = trimToNull(typeof params.role === 'string' ? params.role.toLowerCase() : params.role)
    if (firstName && normalizedRole && FIELD_ROLE_FALLBACK_LAST_NAME.has(normalizedRole)) {
      lastName = 'Officer'
    }
  }

  return {
    first_name: firstName,
    last_name: lastName,
  }
}

export function resolveEmployerOrganizationId(
  organizationId: string | null,
  employerOrganizationId: string | null,
): string | null {
  return trimToNull(employerOrganizationId) ?? trimToNull(organizationId)
}

export function resolveAuthorizedWorkLocations(
  organizationId: string | null,
  extraOrganizationIds: string[],
  authorizedWorkLocations: string[],
): string[] {
  return Array.from(
    new Set(
      [organizationId, ...extraOrganizationIds, ...authorizedWorkLocations]
        .map((entry) => trimToNull(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  )
}

export function resolveOrganizationParentId(orgType: string, selectedParentOrganizationId: string | null): string | null {
  return orgType.trim().toLowerCase() === 'owner' ? null : trimToNull(selectedParentOrganizationId)
}
