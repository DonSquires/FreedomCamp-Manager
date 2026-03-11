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
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  // Build YYYY-MM-DD from parts so we never depend on locale ordering.
  const parts = formatter.formatToParts(date)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  if (!year || !month || !day) {
    return new Date(date).toISOString().slice(0, 10)
  }

  return `${year}-${month}-${day}`
}

const normalizeDateString = (value: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  // Already ISO date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // Legacy persisted format in some environments: DD/MM/YYYY.
  const slash = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slash) {
    const [, dd, mm, yyyy] = slash
    return `${yyyy}-${mm}-${dd}`
  }

  return null
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
        set({
          dateFrom: normalizeDateString(from),
          dateTo: normalizeDateString(to),
          datePreset: preset,
        }),

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
          const normalizedFrom = normalizeDateString(state.dateFrom)
          if (!normalizedFrom) return state
          const prevDay = new Date(`${normalizedFrom}T12:00:00`)
          prevDay.setDate(prevDay.getDate() - 1)
          const dateStr = toNZDateString(prevDay)
          return { dateFrom: dateStr, dateTo: dateStr, datePreset: 'custom' }
        })
      },

      setNextDay: () => {
        set((state) => {
          const normalizedFrom = normalizeDateString(state.dateFrom)
          if (!normalizedFrom) return state
          const nextDay = new Date(`${normalizedFrom}T12:00:00`)
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
