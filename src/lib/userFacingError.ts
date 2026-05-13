type ErrorLike = {
  code?: string | number | null
  message?: string | null
  details?: string | null
  hint?: string | null
  status?: number | null
  name?: string | null
}

const PERMISSION_PATTERNS = [
  'permission denied',
  'not allowed',
  'not authorized',
  'insufficient privileges',
  'row-level security',
  'violates row-level security',
  'violates rls',
  'forbidden',
]

const NETWORK_PATTERNS = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'connection failed',
]

const TIMEOUT_PATTERNS = [
  'timeout',
  'timed out',
  'aborterror',
  'request aborted',
]

const DUPLICATE_PATTERNS = [
  'duplicate key',
  'already exists',
  'unique constraint',
]

const MISSING_PATTERNS = [
  'not found',
  'no rows',
  'does not exist',
]

function matchesAnyPattern(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern))
}

export function toUserFacingError(error: unknown, fallback: string) {
  const candidate = (error && typeof error === 'object' ? error : {}) as ErrorLike
  const message = String(candidate.message || '').trim()
  const details = String(candidate.details || '').trim()
  const hint = String(candidate.hint || '').trim()
  const combined = `${message} ${details} ${hint}`.trim().toLowerCase()
  const code = String(candidate.code || '').trim().toUpperCase()
  const status = Number(candidate.status || 0)

  if (error) {
    console.error('[user-facing-error]', { fallback, error })
  }

  if (!combined) return fallback

  if (
    status === 401 ||
    status === 403 ||
    code === '42501' ||
    matchesAnyPattern(combined, PERMISSION_PATTERNS)
  ) {
    return 'You do not have permission to perform this action.'
  }

  if (matchesAnyPattern(combined, NETWORK_PATTERNS)) {
    return 'Network connection failed. Please try again.'
  }

  if (matchesAnyPattern(combined, TIMEOUT_PATTERNS)) {
    return 'The request took too long. Please try again.'
  }

  if (code === '23505' || matchesAnyPattern(combined, DUPLICATE_PATTERNS)) {
    return 'This record already exists.'
  }

  if (status === 404 || matchesAnyPattern(combined, MISSING_PATTERNS)) {
    return 'The requested record could not be found.'
  }

  return fallback
}