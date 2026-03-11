/**
 * NZ Timezone Utilities
 * All datetimes in the system use Pacific/Auckland timezone
 */

const NZ_TIMEZONE = 'Pacific/Auckland'

/**
 * Get current NZ date/time
 */
export function nzNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: NZ_TIMEZONE }))
}

/**
 * Format date/time in NZ timezone
 */
export function formatNZDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-NZ', { 
    timeZone: NZ_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/**
 * Format date only in NZ timezone
 */
export function formatNZDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-NZ', { 
    timeZone: NZ_TIMEZONE,
    dateStyle: 'medium'
  })
}

/**
 * Format time only in NZ timezone
 */
export function formatNZTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-NZ', { 
    timeZone: NZ_TIMEZONE,
    timeStyle: 'short'
  })
}

/**
 * Get start of day in NZ timezone
 */
export function nzStartOfDay(date?: Date): Date {
  const d = date || nzNow()
  const nzDateStr = d.toLocaleDateString('en-CA', { timeZone: NZ_TIMEZONE })
  return new Date(`${nzDateStr}T00:00:00+12:00`)
}

/**
 * Get end of day in NZ timezone
 */
export function nzEndOfDay(date?: Date): Date {
  const d = date || nzNow()
  const nzDateStr = d.toLocaleDateString('en-CA', { timeZone: NZ_TIMEZONE })
  return new Date(`${nzDateStr}T23:59:59+12:00`)
}

/**
 * Convert to ISO string with NZ timezone
 */
export function toNZISOString(date: Date): string {
  return date.toLocaleString('sv-SE', { timeZone: NZ_TIMEZONE }).replace(' ', 'T')
}

/**
 * Parse date string as NZ timezone
 */
export function parseNZDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+12:00')
}

/**
 * Convert a NZ local date string (YYYY-MM-DD) to a UTC ISO string representing
 * the start of that day in NZ timezone.
 *
 * NZ observes NZST (UTC+12) in winter and NZDT (UTC+13) in summer.  By always
 * using +13:00 (the maximum NZ offset) we ensure we capture the earliest
 * possible NZ midnight in UTC regardless of the current DST state:
 *   - During NZDT (+13:00): exactly correct.
 *   - During NZST (+12:00): starts 1 hour earlier than NZ midnight, which may
 *     include a small amount of the previous NZ day — but guarantees that no
 *     NZ data from the selected day is accidentally excluded.
 */
export function nzDateToUTCStart(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+13:00`).toISOString()
}

/**
 * Convert a NZ local date string (YYYY-MM-DD) to a UTC ISO string representing
 * the end of that day in NZ timezone.
 *
 * By always using +12:00 (NZST / the minimum NZ offset) we ensure we capture
 * the latest possible NZ day-end in UTC regardless of the current DST state:
 *   - During NZST (+12:00): exactly correct.
 *   - During NZDT (+13:00): extends 1 hour past NZ midnight, which may include
 *     a small amount of the following NZ day — but guarantees that no NZ data
 *     from the selected day is accidentally excluded.
 */
export function nzDateToUTCEnd(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59+12:00`).toISOString()
}

/**
 * Get relative time string (e.g., "2 hours ago")
 */
export function relativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = nzNow()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  return formatNZDate(d)
}

/**
 * Check if date is today in NZ timezone
 */
export function isToday(date: string | Date): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  const today = nzNow()
  return d.toLocaleDateString('en-CA', { timeZone: NZ_TIMEZONE }) === 
         today.toLocaleDateString('en-CA', { timeZone: NZ_TIMEZONE })
}

/**
 * Check if date is in the past (NZ timezone)
 */
export function isPast(date: string | Date): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  return d < nzNow()
}

/**
 * Add days to date in NZ timezone
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Get date range for filters
 */
export function getDateRange(preset: 'today' | 'yesterday' | 'week' | 'month'): { from: string; to: string } {
  const now = nzNow()
  const today = nzStartOfDay(now)
  
  switch (preset) {
    case 'today':
      return {
        from: toNZISOString(today),
        to: toNZISOString(nzEndOfDay(now))
      }
    case 'yesterday': {
      const yesterday = addDays(today, -1)
      return {
        from: toNZISOString(yesterday),
        to: toNZISOString(nzEndOfDay(yesterday))
      }
    }
    case 'week': {
      const weekAgo = addDays(today, -7)
      return {
        from: toNZISOString(weekAgo),
        to: toNZISOString(nzEndOfDay(now))
      }
    }
    case 'month': {
      const monthAgo = new Date(today)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return {
        from: toNZISOString(monthAgo),
        to: toNZISOString(nzEndOfDay(now))
      }
    }
  }
}
