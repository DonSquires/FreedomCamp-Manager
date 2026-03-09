import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GlobalFiltersState {
  // Date filters
  dateFrom: string | null
  dateTo: string | null
  datePreset: 'today' | 'yesterday' | 'week' | 'month' | 'custom' | null

  // Organization filter
  organizationId: string | null
  organizationName: string | null

  // Zone filter
  zoneId: string | null
  zoneName: string | null

  // Actions
  setDateRange: (from: string | null, to: string | null, preset?: GlobalFiltersState['datePreset']) => void
  setOrganization: (id: string | null, name: string | null) => void
  setZone: (id: string | null, name: string | null) => void
  clearFilters: () => void

  // Quick date setters
  setToday: () => void
  setYesterday: () => void
  setPrevDay: () => void
  setNextDay: () => void
}

const toNZDateString = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(date)
}

export const useGlobalFiltersStore = create<GlobalFiltersState>()(
  persist(
    (set) => ({
      dateFrom: null,
      dateTo: null,
      datePreset: null,
      organizationId: null,
      organizationName: null,
      zoneId: null,
      zoneName: null,

      setDateRange: (from, to, preset = 'custom') => 
        set({ dateFrom: from, dateTo: to, datePreset: preset }),

      setOrganization: (id, name) => 
        set({ organizationId: id, organizationName: name }),

      setZone: (id, name) => 
        set({ zoneId: id, zoneName: name }),

      clearFilters: () => 
        set({ 
          dateFrom: null, 
          dateTo: null, 
          datePreset: null,
          organizationId: null, 
          organizationName: null,
          zoneId: null,
          zoneName: null 
        }),

      setToday: () => {
        const today = toNZDateString(new Date())
        set({ dateFrom: today, dateTo: today, datePreset: 'today' })
      },

      setYesterday: () => {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const dateStr = toNZDateString(yesterday)
        set({ dateFrom: dateStr, dateTo: dateStr, datePreset: 'yesterday' })
      },

      setPrevDay: () => {
        set((state) => {
          if (!state.dateFrom) return state
          const prevDay = new Date(`${state.dateFrom}T12:00:00`)
          prevDay.setDate(prevDay.getDate() - 1)
          const dateStr = toNZDateString(prevDay)
          return { dateFrom: dateStr, dateTo: dateStr, datePreset: 'custom' }
        })
      },

      setNextDay: () => {
        set((state) => {
          if (!state.dateFrom) return state
          const nextDay = new Date(`${state.dateFrom}T12:00:00`)
          nextDay.setDate(nextDay.getDate() + 1)
          const dateStr = toNZDateString(nextDay)
          return { dateFrom: dateStr, dateTo: dateStr, datePreset: 'custom' }
        })
      },
    }),
    {
      name: 'global-filters-storage',
    }
  )
)
