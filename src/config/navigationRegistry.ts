/**
 * FieldOps Navigation Registry v1
 *
 * Grounded in: system_state.json::ia_redesign_config
 * Source files: src/App.tsx and current navigation surfaces
 *
 * This scaffold is intentionally non-breaking and can be incrementally adopted.
 */

export type NavigationSection =
  | 'Mission Control'
  | 'Field Operations'
  | 'Compliance and Enforcement'
  | 'Intelligence and Records'
  | 'Workforce and Scheduling'
  | 'Clients and Commercial'
  | 'Reports and Analytics'
  | 'Platform and Settings'

export type NavSurface =
  | 'sidebar'
  | 'admin-menu'
  | 'hub-card'
  | 'dashboard-tile'
  | 'hidden'

export interface NavigationRegistryEntry {
  path: string
  label: string
  section: NavigationSection
  navSurface: NavSurface
  allowedRoles: string[]
  area?: string
  orgScoped?: boolean
  aliasOf?: string
  redirectTo?: string
}

// Initial seed from existing, high-traffic routes.
// Remaining routes should be added in Phase 1 migration.
export const NAVIGATION_REGISTRY_V1: NavigationRegistryEntry[] = [
  {
    path: '/admin',
    label: 'Admin Hub',
    section: 'Mission Control',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master', 'grand_master'],
  },
  {
    path: '/field-officer',
    label: 'Field Officer',
    section: 'Field Operations',
    navSurface: 'sidebar',
    allowedRoles: ['officer', 'admin_officer'],
  },
  {
    path: '/compliance',
    label: 'Compliance',
    section: 'Compliance and Enforcement',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master'],
  },
  {
    path: '/incidents',
    label: 'Incidents',
    section: 'Intelligence and Records',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master', 'officer'],
  },
  {
    path: '/roster',
    label: 'Roster Planner',
    section: 'Workforce and Scheduling',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master'],
  },
  {
    path: '/crm',
    label: 'CRM',
    section: 'Clients and Commercial',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master'],
  },
  {
    path: '/reports',
    label: 'Reports',
    section: 'Reports and Analytics',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master'],
  },
  {
    path: '/settings',
    label: 'Settings',
    section: 'Platform and Settings',
    navSurface: 'sidebar',
    allowedRoles: ['admin', 'admin_officer', 'master', 'officer', 'nzscv_monitor'],
  },
]
