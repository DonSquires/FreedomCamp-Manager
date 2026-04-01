/**
 * Query Key Factory for React Query
 * 
 * Provides consistent, type-safe query keys for all data fetching operations.
 * This enables:
 * - Proper cache invalidation
 * - Query deduplication
 * - DevTools organization
 * 
 * Usage:
 * ```typescript
 * // In a hook
 * import { queryKeys } from '@/lib/queryKeys'
 * 
 * useQuery({
 *   queryKey: queryKeys.vehicles.list(organizationId),
 *   queryFn: () => fetchVehicles(organizationId)
 * })
 * 
 * // Invalidating queries
 * queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() })
 * ```
 */

// ============================================================================
// Type definitions
// ============================================================================

export interface BreachFilters {
  organizationId?: string
  zoneId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}

export interface ObservationFilters {
  organizationId?: string
  zoneId?: string
  vehicleId?: string
  dateFrom?: string
  dateTo?: string
}

// ============================================================================
// Query Keys
// ============================================================================

export const queryKeys = {
  // ──────────────────────────────────────────────────────────────────────────
  // Vehicles
  // ──────────────────────────────────────────────────────────────────────────
  vehicles: {
    all: () => ['vehicles'] as const,
    lists: () => ['vehicles', 'list'] as const,
    list: (organizationId: string) => ['vehicles', 'list', organizationId] as const,
    details: () => ['vehicles', 'detail'] as const,
    detail: (id: string) => ['vehicles', 'detail', id] as const,
    observations: (vehicleId: string) => ['vehicles', vehicleId, 'observations'] as const,
    compliance: (vehicleId: string) => ['vehicles', vehicleId, 'compliance'] as const,
    scvStatus: (plate: string) => ['vehicles', 'scv', plate] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Breaches
  // ──────────────────────────────────────────────────────────────────────────
  breaches: {
    all: () => ['breaches'] as const,
    lists: () => ['breaches', 'list'] as const,
    list: (filters: BreachFilters) => ['breaches', 'list', filters] as const,
    details: () => ['breaches', 'detail'] as const,
    detail: (id: string) => ['breaches', 'detail', id] as const,
    forVehicle: (vehicleId: string) => ['breaches', 'vehicle', vehicleId] as const,
    forZone: (zoneId: string) => ['breaches', 'zone', zoneId] as const,
    stats: (organizationId: string) => ['breaches', 'stats', organizationId] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Zones
  // ──────────────────────────────────────────────────────────────────────────
  zones: {
    all: () => ['zones'] as const,
    lists: () => ['zones', 'list'] as const,
    list: (organizationId: string) => ['zones', 'list', organizationId] as const,
    details: () => ['zones', 'detail'] as const,
    detail: (id: string) => ['zones', 'detail', id] as const,
    compliance: (zoneId: string) => ['zones', zoneId, 'compliance'] as const,
    occupancy: (zoneId: string) => ['zones', zoneId, 'occupancy'] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Observations
  // ──────────────────────────────────────────────────────────────────────────
  observations: {
    all: () => ['observations'] as const,
    lists: () => ['observations', 'list'] as const,
    list: (filters: ObservationFilters) => ['observations', 'list', filters] as const,
    details: () => ['observations', 'detail'] as const,
    detail: (id: string) => ['observations', 'detail', id] as const,
    recent: (organizationId: string, limit?: number) => 
      ['observations', 'recent', organizationId, limit ?? 50] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Organizations
  // ──────────────────────────────────────────────────────────────────────────
  organizations: {
    all: () => ['organizations'] as const,
    lists: () => ['organizations', 'list'] as const,
    list: () => ['organizations', 'list'] as const,
    details: () => ['organizations', 'detail'] as const,
    detail: (id: string) => ['organizations', 'detail', id] as const,
    settings: (id: string) => ['organizations', id, 'settings'] as const,
    members: (id: string) => ['organizations', id, 'members'] as const,
    boundary: (id: string) => ['organizations', id, 'boundary'] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Users / Officers
  // ──────────────────────────────────────────────────────────────────────────
  users: {
    all: () => ['users'] as const,
    lists: () => ['users', 'list'] as const,
    list: (organizationId: string) => ['users', 'list', organizationId] as const,
    details: () => ['users', 'detail'] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
    profile: (id: string) => ['users', id, 'profile'] as const,
    permissions: (id: string) => ['users', id, 'permissions'] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Access Control
  // ──────────────────────────────────────────────────────────────────────────
  accessControl: {
    all: () => ['accessControl'] as const,
    permissions: (personId: string, zoneId: string) => 
      ['accessControl', 'permissions', personId, zoneId] as const,
    personPermissions: (personId: string) => 
      ['accessControl', 'permissions', 'person', personId] as const,
    zonePermissions: (zoneId: string) => 
      ['accessControl', 'permissions', 'zone', zoneId] as const,
    auditLog: (zoneId: string) => ['accessControl', 'audit', zoneId] as const,
    watchlist: (organizationId: string) => 
      ['accessControl', 'watchlist', organizationId] as const,
    occupancy: (zoneId: string) => ['accessControl', 'occupancy', zoneId] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Person Records
  // ──────────────────────────────────────────────────────────────────────────
  persons: {
    all: () => ['persons'] as const,
    lists: () => ['persons', 'list'] as const,
    list: (organizationId: string) => ['persons', 'list', organizationId] as const,
    details: () => ['persons', 'detail'] as const,
    detail: (id: string) => ['persons', 'detail', id] as const,
    biometricConsent: (personId: string) => 
      ['persons', personId, 'biometricConsent'] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Patrol Routes
  // ──────────────────────────────────────────────────────────────────────────
  patrols: {
    all: () => ['patrols'] as const,
    routes: (organizationId: string) => ['patrols', 'routes', organizationId] as const,
    routeDetail: (routeId: string) => ['patrols', 'routes', 'detail', routeId] as const,
    checkpoints: (routeId: string) => ['patrols', 'routes', routeId, 'checkpoints'] as const,
    scans: (routeId: string, date?: string) => 
      ['patrols', 'routes', routeId, 'scans', date] as const,
    roster: (organizationId: string, date: string) => 
      ['patrols', 'roster', organizationId, date] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Duress / Safety
  // ──────────────────────────────────────────────────────────────────────────
  duress: {
    all: () => ['duress'] as const,
    alerts: (organizationId: string) => ['duress', 'alerts', organizationId] as const,
    alertDetail: (alertId: string) => ['duress', 'alerts', 'detail', alertId] as const,
    activeAlerts: (organizationId: string) => 
      ['duress', 'alerts', organizationId, 'active'] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Reports / Analytics
  // ──────────────────────────────────────────────────────────────────────────
  reports: {
    all: () => ['reports'] as const,
    complianceSummary: (organizationId: string, dateRange: { from: string; to: string }) => 
      ['reports', 'compliance', organizationId, dateRange] as const,
    zoneActivity: (zoneId: string, dateRange: { from: string; to: string }) => 
      ['reports', 'zoneActivity', zoneId, dateRange] as const,
    officerActivity: (officerId: string, dateRange: { from: string; to: string }) => 
      ['reports', 'officerActivity', officerId, dateRange] as const,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Service Health
  // ──────────────────────────────────────────────────────────────────────────
  health: {
    all: () => ['health'] as const,
    inference: () => ['health', 'inference'] as const,
    proxy: () => ['health', 'proxy'] as const,
    ptt: () => ['health', 'ptt'] as const,
  },
} as const

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Get all query keys that should be invalidated when an entity is updated
 */
export function getInvalidationKeys(entity: 'vehicle' | 'breach' | 'zone' | 'observation', id: string) {
  switch (entity) {
    case 'vehicle':
      return [
        queryKeys.vehicles.all(),
        queryKeys.vehicles.detail(id),
        queryKeys.vehicles.observations(id),
        queryKeys.vehicles.compliance(id),
      ]
    case 'breach':
      return [
        queryKeys.breaches.all(),
        queryKeys.breaches.detail(id),
      ]
    case 'zone':
      return [
        queryKeys.zones.all(),
        queryKeys.zones.detail(id),
        queryKeys.zones.compliance(id),
        queryKeys.zones.occupancy(id),
      ]
    case 'observation':
      return [
        queryKeys.observations.all(),
        queryKeys.observations.detail(id),
      ]
    default:
      return []
  }
}

export default queryKeys
