import { describe, it, expect } from 'vitest'
import { queryKeys, getInvalidationKeys } from '../queryKeys'

// ── queryKeys factory ───────────────────────────────────────────────────────

describe('queryKeys', () => {
  describe('vehicles', () => {
    it('all() returns base key', () => {
      expect(queryKeys.vehicles.all()).toEqual(['vehicles'])
    })

    it('lists() returns list key', () => {
      expect(queryKeys.vehicles.lists()).toEqual(['vehicles', 'list'])
    })

    it('list(orgId) includes organization', () => {
      expect(queryKeys.vehicles.list('org-1')).toEqual(['vehicles', 'list', 'org-1'])
    })

    it('detail(id) includes vehicle id', () => {
      expect(queryKeys.vehicles.detail('v-1')).toEqual(['vehicles', 'detail', 'v-1'])
    })

    it('observations(vehicleId) includes vehicle id', () => {
      expect(queryKeys.vehicles.observations('v-1')).toEqual(['vehicles', 'v-1', 'observations'])
    })

    it('compliance(vehicleId) includes vehicle id', () => {
      expect(queryKeys.vehicles.compliance('v-1')).toEqual(['vehicles', 'v-1', 'compliance'])
    })

    it('scvStatus(plate) includes plate', () => {
      expect(queryKeys.vehicles.scvStatus('ABC123')).toEqual(['vehicles', 'scv', 'ABC123'])
    })
  })

  describe('breaches', () => {
    it('all() returns base key', () => {
      expect(queryKeys.breaches.all()).toEqual(['breaches'])
    })

    it('list(filters) includes filters object', () => {
      const filters = { organizationId: 'org-1', status: 'active' }
      expect(queryKeys.breaches.list(filters)).toEqual(['breaches', 'list', filters])
    })

    it('forVehicle(vehicleId)', () => {
      expect(queryKeys.breaches.forVehicle('v-1')).toEqual(['breaches', 'vehicle', 'v-1'])
    })

    it('forZone(zoneId)', () => {
      expect(queryKeys.breaches.forZone('z-1')).toEqual(['breaches', 'zone', 'z-1'])
    })

    it('stats(orgId)', () => {
      expect(queryKeys.breaches.stats('org-1')).toEqual(['breaches', 'stats', 'org-1'])
    })
  })

  describe('zones', () => {
    it('compliance(zoneId)', () => {
      expect(queryKeys.zones.compliance('z-1')).toEqual(['zones', 'z-1', 'compliance'])
    })

    it('occupancy(zoneId)', () => {
      expect(queryKeys.zones.occupancy('z-1')).toEqual(['zones', 'z-1', 'occupancy'])
    })
  })

  describe('observations', () => {
    it('recent(orgId) defaults limit to 50', () => {
      expect(queryKeys.observations.recent('org-1')).toEqual(['observations', 'recent', 'org-1', 50])
    })

    it('recent(orgId, limit) uses custom limit', () => {
      expect(queryKeys.observations.recent('org-1', 10)).toEqual(['observations', 'recent', 'org-1', 10])
    })
  })

  describe('organizations', () => {
    it('settings(id)', () => {
      expect(queryKeys.organizations.settings('org-1')).toEqual(['organizations', 'org-1', 'settings'])
    })

    it('members(id)', () => {
      expect(queryKeys.organizations.members('org-1')).toEqual(['organizations', 'org-1', 'members'])
    })

    it('boundary(id)', () => {
      expect(queryKeys.organizations.boundary('org-1')).toEqual(['organizations', 'org-1', 'boundary'])
    })
  })

  describe('health', () => {
    it('all()', () => {
      expect(queryKeys.health.all()).toEqual(['health'])
    })

    it('inference()', () => {
      expect(queryKeys.health.inference()).toEqual(['health', 'inference'])
    })

    it('proxy()', () => {
      expect(queryKeys.health.proxy()).toEqual(['health', 'proxy'])
    })

    it('ptt()', () => {
      expect(queryKeys.health.ptt()).toEqual(['health', 'ptt'])
    })
  })
})

// ── getInvalidationKeys ─────────────────────────────────────────────────────

describe('getInvalidationKeys', () => {
  it('returns vehicle-related keys for vehicle entity', () => {
    const keys = getInvalidationKeys('vehicle', 'v-1')
    expect(keys).toHaveLength(4)
    expect(keys).toContainEqual(['vehicles'])
    expect(keys).toContainEqual(['vehicles', 'detail', 'v-1'])
    expect(keys).toContainEqual(['vehicles', 'v-1', 'observations'])
    expect(keys).toContainEqual(['vehicles', 'v-1', 'compliance'])
  })

  it('returns breach-related keys for breach entity', () => {
    const keys = getInvalidationKeys('breach', 'b-1')
    expect(keys).toHaveLength(2)
    expect(keys).toContainEqual(['breaches'])
    expect(keys).toContainEqual(['breaches', 'detail', 'b-1'])
  })

  it('returns zone-related keys for zone entity', () => {
    const keys = getInvalidationKeys('zone', 'z-1')
    expect(keys).toHaveLength(4)
    expect(keys).toContainEqual(['zones'])
    expect(keys).toContainEqual(['zones', 'detail', 'z-1'])
    expect(keys).toContainEqual(['zones', 'z-1', 'compliance'])
    expect(keys).toContainEqual(['zones', 'z-1', 'occupancy'])
  })

  it('returns observation-related keys for observation entity', () => {
    const keys = getInvalidationKeys('observation', 'o-1')
    expect(keys).toHaveLength(2)
    expect(keys).toContainEqual(['observations'])
    expect(keys).toContainEqual(['observations', 'detail', 'o-1'])
  })
})
