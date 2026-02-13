/**
 * Timezone Utilities - New Zealand Standard Time (NZST/NZDT)
 * All dates in the system should use NZ timezone (Pacific/Auckland)
 */

export const NZ_TIMEZONE = 'Pacific/Auckland';

/**
 * Convert any date to NZ timezone
 */
export function toNZDate(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(d.toLocaleString('en-NZ', { timeZone: NZ_TIMEZONE }));
}

/**
 * Format date/time in NZ timezone
 */
export function formatNZDateTime(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: NZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  };
  return d.toLocaleString('en-NZ', defaultOptions);
}

/**
 * Get current date string in NZ timezone (YYYY-MM-DD)
 */
export function getNZDateString(date: Date = new Date()): string {
  const nzDate = toNZDate(date);
  const year = nzDate.getFullYear();
  const month = String(nzDate.getMonth() + 1).padStart(2, '0');
  const day = String(nzDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in NZ timezone (HH:MM)
 */
export function getNZTimeString(date: Date = new Date()): string {
  return formatNZDateTime(date, { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  }).split(', ')[1];
}

/**
 * Get start of day in NZ timezone (00:00:00)
 */
export function getNZStartOfDay(date: Date = new Date()): Date {
  const dateStr = getNZDateString(date);
  return new Date(`${dateStr}T00:00:00+13:00`); // NZDT offset
}

/**
 * Get end of day in NZ timezone (23:59:59)
 */
export function getNZEndOfDay(date: Date = new Date()): Date {
  const dateStr = getNZDateString(date);
  return new Date(`${dateStr}T23:59:59+13:00`); // NZDT offset
}

/**
 * Parse date string and ensure it's in NZ timezone
 */
export function parseNZDate(dateString: string): Date {
  // If no time specified, default to 00:00:00 in NZ timezone
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(`${dateString}T00:00:00+13:00`);
  }
  return toNZDate(new Date(dateString));
}

/**
 * Get NZ "now" as ISO string for database inserts
 */
export function getNZNowISO(): string {
  return toNZDate(new Date()).toISOString();
}

/**
 * Format for display (friendly format)
 */
export function formatNZDateFriendly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-NZ', {
    timeZone: NZ_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format for display (date only)
 */
export function formatNZDateOnly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-NZ', {
    timeZone: NZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Format for display (time only)
 */
export function formatNZTimeOnly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-NZ', {
    timeZone: NZ_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Check if date is today in NZ timezone
 */
export function isNZToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = getNZDateString();
  const checkDate = getNZDateString(d);
  return today === checkDate;
}

/**
 * Get date range for query (start and end of day in NZ timezone)
 */
export function getNZDateRange(dateStr: string): { start: string; end: string } {
  const start = parseNZDate(dateStr);
  const end = getNZEndOfDay(start);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}
