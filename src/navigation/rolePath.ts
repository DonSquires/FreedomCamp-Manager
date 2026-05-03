export type SessionRole =
  | 'master'
  | 'admin'
  | 'officer'
  | 'admin_officer'
  | 'nzscv_monitor'
  | 'grand_master'
  | 'client_viewer'
  | 'client_officer'
  | 'client_admin'

const NZSCV_MONITOR_ALLOWED_PATHS = new Set([
  '/vehicle-registry',
  '/admin/nzscv',
  '/search',
  '/profile',
  '/settings',
])

const CLIENT_PORTAL_ALLOWED_PATHS = new Set([
  '/client-portal',
  '/profile',
  '/settings',
])

export function isClientPersonaRole(role?: string | null): boolean {
  return role === 'client_viewer' || role === 'client_officer' || role === 'client_admin'
}

export function getDefaultRouteForRole(role?: string | null): string {
  switch (role) {
    case 'officer':
      return '/officer-home'
    case 'admin_officer':
      return '/portal-selection'
    case 'nzscv_monitor':
      return '/admin/nzscv'
    case 'grand_master':
      return '/platform'
    case 'client_viewer':
    case 'client_officer':
    case 'client_admin':
      return '/client-portal'
    default:
      return '/'
  }
}

export function getRoleConstrainedRedirect(
  role: string | null | undefined,
  path: string,
  hasPortalChoice: boolean,
): string | null {
  if (!role) return '/login'

  if (role === 'admin_officer' && path !== '/portal-selection' && !hasPortalChoice) {
    return '/portal-selection'
  }

  if (role === 'nzscv_monitor' && !NZSCV_MONITOR_ALLOWED_PATHS.has(path)) {
    return '/admin/nzscv'
  }

  if (role === 'grand_master' && path === '/') {
    return '/platform'
  }

  if (isClientPersonaRole(role) && !CLIENT_PORTAL_ALLOWED_PATHS.has(path)) {
    return '/client-portal'
  }

  return null
}
