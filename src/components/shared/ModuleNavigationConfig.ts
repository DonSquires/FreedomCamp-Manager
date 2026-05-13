/**
 * ModuleNavigationConfig - Single source of truth for app navigation
 * 
 * Updates sidebar, breadcrumbs, and routing dynamically.
 * See MODULE_README.md and docs/ENTERPRISE_UI_CONSOLIDATION_PATTERNS.md §5
 */

export interface NavItem {
  id: string
  label: string
  url?: string
  icon?: string
  badge?: number | string
  submenu?: NavItem[]
}

export interface NavModule {
  id: string
  label: string
  icon: string
  roles: string[]
  items: NavItem[]
  description?: string
}

/**
 * SIDEBAR_NAVIGATION - Complete navigation tree for all modules
 * Each module shows/hides based on user role
 * Users can star items for quick access in Favorites section
 */
export const SIDEBAR_NAVIGATION: NavModule[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'grid',
    roles: ['officer', 'dispatcher', 'admin', 'admin_officer', 'master', 'grand_master'],
    items: [
      {
        id: 'home',
        label: 'Overview',
        url: '/dashboard',
        icon: 'home',
      },
      {
        id: 'analytics',
        label: 'Analytics',
        url: '/dashboard/analytics',
        icon: 'chart',
      },
      {
        id: 'alerts',
        label: 'Alerts & Notifications',
        url: '/dashboard/alerts',
        icon: 'bell',
      },
    ],
    description: 'Dashboard Hub - Role-based overview, KPIs, quick actions',
  },

  {
    id: 'patrol',
    label: 'Patrol Management',
    icon: 'map',
    roles: ['officer', 'dispatcher', 'admin', 'admin_officer', 'master', 'grand_master'],
    items: [
      {
        id: 'patrol-dashboard',
        label: 'Dashboard',
        url: '/patrol',
        icon: 'activity',
      },
      {
        id: 'active-patrols',
        label: 'Active Patrols',
        url: '/patrols',
        icon: 'users',
        badge: 'live',
      },
      {
        id: 'patrol-history',
        label: 'History',
        url: '/patrols/history',
        icon: 'history',
      },
      {
        id: 'roster',
        label: 'Roster & Schedule',
        url: '/patrol/roster',
        icon: 'calendar',
      },
      {
        id: 'routes',
        label: 'Routes',
        url: '/patrol/routes',
        icon: 'route',
      },
      {
        id: 'welfare',
        label: 'Officer Welfare',
        url: '/patrol/welfare',
        icon: 'heart',
      },
    ],
    description: 'Patrol Management - Schedule, monitor, analyze patrols',
  },

  {
    id: 'enforcement',
    label: 'Enforcement',
    icon: 'alert-circle',
    roles: ['officer', 'dispatcher', 'admin', 'admin_officer', 'master', 'grand_master'],
    items: [
      {
        id: 'breaches',
        label: 'Breaches & Incidents',
        url: '/breaches',
        icon: 'alert',
      },
      {
        id: 'compliance',
        label: 'Compliance',
        url: '/compliance',
        icon: 'check-circle',
      },
      {
        id: 'notices',
        label: 'Notices',
        url: '/enforcement/notices',
        icon: 'file-text',
      },
      {
        id: 'enforcement-actions',
        label: 'Actions',
        url: '/enforcement/actions',
        icon: 'zap',
      },
      {
        id: 'investigations',
        label: 'Investigations',
        url: '/enforcement/investigations',
        icon: 'search',
      },
      {
        id: 'evidence',
        label: 'Evidence',
        url: '/enforcement/evidence',
        icon: 'package',
      },
    ],
    description: 'Enforcement - Breaches, compliance, notices, actions',
  },

  {
    id: 'operations',
    label: 'Operations',
    icon: 'settings',
    roles: ['admin', 'admin_officer', 'master', 'grand_master'],
    items: [
      {
        id: 'zones',
        label: 'Zones',
        url: '/zones',
        icon: 'map-pin',
      },
      {
        id: 'sites',
        label: 'Client Sites',
        url: '/sites',
        icon: 'building',
      },
      {
        id: 'vehicles',
        label: 'Vehicles',
        url: '/vehicles',
        icon: 'truck',
      },
      {
        id: 'assets',
        label: 'Assets',
        url: '/assets',
        icon: 'briefcase',
      },
      {
        id: 'poi',
        label: 'Points of Interest',
        url: '/operations/poi',
        icon: 'map',
      },
      {
        id: 'persons',
        label: 'Persons Registry',
        url: '/operations/persons',
        icon: 'user',
      },
    ],
    description: 'Operations - Zones, sites, vehicles, assets, POI',
  },

  {
    id: 'administration',
    label: 'Administration',
    icon: 'sliders',
    roles: ['admin', 'admin_officer', 'master', 'grand_master'],
    items: [
      {
        id: 'users',
        label: 'Users & Teams',
        url: '/users',
        icon: 'people',
      },
      {
        id: 'permissions',
        label: 'Permissions',
        url: '/admin/permissions',
        icon: 'shield',
      },
      {
        id: 'organization',
        label: 'Organization',
        url: '/admin/organization',
        icon: 'building2',
      },
      {
        id: 'audit-log',
        label: 'Audit Log',
        url: '/admin/audit-log',
        icon: 'file-check',
      },
      {
        id: 'data-management',
        label: 'Data Management',
        url: '/admin/data',
        icon: 'database',
      },
      {
        id: 'feature-flags',
        label: 'Feature Flags',
        url: '/admin/features',
        icon: 'flag',
      },
      {
        id: 'settings',
        label: 'Settings',
        url: '/admin/settings',
        icon: 'gear',
      },
    ],
    description: 'Administration - Users, permissions, org settings, audit',
  },
]

/**
 * Helper to get modules visible to a user
 */
export function getVisibleModules(userRole?: string): NavModule[] {
  if (!userRole) return []
  return SIDEBAR_NAVIGATION.filter(mod => mod.roles.includes(userRole))
}

/**
 * Helper to find an item by URL
 */
export function findNavItemByUrl(url: string): NavItem | null {
  for (const mod of SIDEBAR_NAVIGATION) {
    for (const item of mod.items) {
      if (item.url === url) return item
      if (item.submenu) {
        for (const subitem of item.submenu) {
          if (subitem.url === url) return subitem
        }
      }
    }
  }
  return null
}

/**
 * Helper to generate breadcrumbs from URL
 */
export function generateBreadcrumbs(
  url: string
): Array<{ label: string; url: string; current: boolean }> {
  const breadcrumbs: Array<{ label: string; url: string; current: boolean }> = [
    { label: 'Home', url: '/', current: false },
  ]

  const segments = url.split('/').filter(Boolean)
  let currentPath = ''

  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`
    const isLast = i === segments.length - 1

    // Try to find label from navigation config
    const navItem = findNavItemByUrl(currentPath)
    if (navItem) {
      breadcrumbs.push({
        label: navItem.label,
        url: currentPath,
        current: isLast,
      })
    }
  }

  return breadcrumbs
}

/**
 * Helper to check if user can access a route
 */
export function canAccessRoute(url: string, userRole?: string): boolean {
  if (!userRole) return false

  for (const mod of SIDEBAR_NAVIGATION) {
    if (!mod.roles.includes(userRole)) continue

    for (const item of mod.items) {
      if (item.url === url) return true
      if (item.submenu) {
        for (const subitem of item.submenu) {
          if (subitem.url === url) return true
        }
      }
    }
  }

  return false
}
