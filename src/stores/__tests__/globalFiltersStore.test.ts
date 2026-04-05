import { describe, it, expect, beforeEach } from 'vitest'
import { useGlobalFiltersStore } from '../globalFiltersStore'

describe('globalFiltersStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useGlobalFiltersStore.setState({
      dateFrom: null,
      dateTo: null,
      datePreset: null,
      organizationId: null,
      organizationName: null,
      zoneId: null,
      zoneName: null,
    })
  })

  describe('initial state', () => {
    it('has null values for all filters', () => {
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBeNull()
      expect(state.dateTo).toBeNull()
      expect(state.datePreset).toBeNull()
      expect(state.organizationId).toBeNull()
      expect(state.organizationName).toBeNull()
      expect(state.zoneId).toBeNull()
      expect(state.zoneName).toBeNull()
    })
  })

  describe('setDateRange', () => {
    it('sets date range with custom preset by default', () => {
      useGlobalFiltersStore.getState().setDateRange('2025-06-01', '2025-06-15')
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe('2025-06-01')
      expect(state.dateTo).toBe('2025-06-15')
      expect(state.datePreset).toBe('custom')
    })

    it('sets date range with specified preset', () => {
      useGlobalFiltersStore.getState().setDateRange('2025-06-15', '2025-06-15', 'today')
      const state = useGlobalFiltersStore.getState()
      expect(state.datePreset).toBe('today')
    })

    it('normalizes ISO date format', () => {
      useGlobalFiltersStore.getState().setDateRange('2025-06-01', '2025-06-15')
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe('2025-06-01')
      expect(state.dateTo).toBe('2025-06-15')
    })

    it('normalizes legacy DD/MM/YYYY format', () => {
      useGlobalFiltersStore.getState().setDateRange('01/06/2025', '15/06/2025')
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe('2025-06-01')
      expect(state.dateTo).toBe('2025-06-15')
    })

    it('sets null for null input', () => {
      useGlobalFiltersStore.getState().setDateRange(null, null)
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBeNull()
      expect(state.dateTo).toBeNull()
    })

    it('handles empty string input', () => {
      useGlobalFiltersStore.getState().setDateRange('', '')
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBeNull()
      expect(state.dateTo).toBeNull()
    })
  })

  describe('setOrganization', () => {
    it('sets organization', () => {
      useGlobalFiltersStore.getState().setOrganization('org-1', 'Test Org')
      const state = useGlobalFiltersStore.getState()
      expect(state.organizationId).toBe('org-1')
      expect(state.organizationName).toBe('Test Org')
    })

    it('clears organization', () => {
      useGlobalFiltersStore.getState().setOrganization('org-1', 'Test')
      useGlobalFiltersStore.getState().setOrganization(null, null)
      const state = useGlobalFiltersStore.getState()
      expect(state.organizationId).toBeNull()
      expect(state.organizationName).toBeNull()
    })
  })

  describe('setZone', () => {
    it('sets zone', () => {
      useGlobalFiltersStore.getState().setZone('zone-1', 'Test Zone')
      const state = useGlobalFiltersStore.getState()
      expect(state.zoneId).toBe('zone-1')
      expect(state.zoneName).toBe('Test Zone')
    })

    it('clears zone', () => {
      useGlobalFiltersStore.getState().setZone('z', 'Z')
      useGlobalFiltersStore.getState().setZone(null, null)
      const state = useGlobalFiltersStore.getState()
      expect(state.zoneId).toBeNull()
      expect(state.zoneName).toBeNull()
    })
  })

  describe('clearFilters', () => {
    it('resets all filter values to null', () => {
      const store = useGlobalFiltersStore.getState()
      store.setDateRange('2025-06-01', '2025-06-15', 'custom')
      store.setOrganization('org-1', 'Test Org')
      store.setZone('zone-1', 'Test Zone')

      useGlobalFiltersStore.getState().clearFilters()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBeNull()
      expect(state.dateTo).toBeNull()
      expect(state.datePreset).toBeNull()
      expect(state.organizationId).toBeNull()
      expect(state.organizationName).toBeNull()
      expect(state.zoneId).toBeNull()
      expect(state.zoneName).toBeNull()
    })
  })

  describe('setToday', () => {
    it('sets both dates to today with "today" preset', () => {
      useGlobalFiltersStore.getState().setToday()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe(state.dateTo)
      expect(state.datePreset).toBe('today')
      expect(state.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('setYesterday', () => {
    it('sets both dates to yesterday with "yesterday" preset', () => {
      useGlobalFiltersStore.getState().setYesterday()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe(state.dateTo)
      expect(state.datePreset).toBe('yesterday')
      expect(state.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('setPrevDay', () => {
    it('produces a valid YYYY-MM-DD date string', () => {
      useGlobalFiltersStore.getState().setToday()
      useGlobalFiltersStore.getState().setPrevDay()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(state.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(state.datePreset).toBe('custom')
    })

    it('sets dateFrom and dateTo to the same value', () => {
      useGlobalFiltersStore.getState().setToday()
      useGlobalFiltersStore.getState().setPrevDay()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe(state.dateTo)
    })

    it('does nothing if dateFrom is null', () => {
      useGlobalFiltersStore.getState().setPrevDay()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBeNull()
    })
  })

  describe('setNextDay', () => {
    it('produces a valid YYYY-MM-DD date string', () => {
      useGlobalFiltersStore.getState().setToday()
      useGlobalFiltersStore.getState().setNextDay()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(state.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(state.datePreset).toBe('custom')
    })

    it('sets dateFrom and dateTo to the same value', () => {
      useGlobalFiltersStore.getState().setToday()
      useGlobalFiltersStore.getState().setNextDay()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBe(state.dateTo)
    })

    it('does nothing if dateFrom is null', () => {
      useGlobalFiltersStore.getState().setNextDay()
      const state = useGlobalFiltersStore.getState()
      expect(state.dateFrom).toBeNull()
    })
  })
})
