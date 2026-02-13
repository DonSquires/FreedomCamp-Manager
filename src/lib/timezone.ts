/**
 * Timezone Utilities - New Zealand Standard Time (NZST/NZDT)
 * All dates in the system should use NZ timezone (Pacific/Auckland)
 */

export const NZ_TIMEZONE = 'Pacific/Auckland';

/**
 * Convert any date to NZ timezone
 * Uses proper UTC offset calculation instead of locale string parsing
 */
export function toNZDate(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  // Get the date components in NZ timezone
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(d);
  const getValue = (type: string) => parts.find(p => p.type === type)?.value || '';
  
  const year = getValue('year');
  const month = getValue('month');
  const day = getValue('day');
  const hour = getValue('hour');
  const minute = getValue('minute');
  const second = getValue('second');
  
  // Create a new Date object using the NZ timezone components
  // This creates a "local" date that represents the NZ time
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
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
 * Uses Intl.DateTimeFormat for reliable timezone conversion
 */
export function getNZDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  
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
 * Handles both YYYY-MM-DD and DD/MM/YYYY formats
 */
export function parseNZDate(dateString: string): Date {
  // Handle YYYY-MM-DD format (ISO)
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(`${dateString}T00:00:00+13:00`);
  }
  
  // Handle DD/MM/YYYY format (NZ locale)
  const ddmmyyyyMatch = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyyMatch) {
    const [_, day, month, year] = ddmmyyyyMatch;
    return new Date(`${year}-${month}-${day}T00:00:00+13:00`);
  }
  
  // Fallback to standard parsing
  return toNZDate(new Date(dateString));
}

/**
 * Convert DD/MM/YYYY to YYYY-MM-DD
 * Returns empty string if input is invalid/empty to prevent "Invalid Date" display
 */
export function normalizeDateString(dateString: string): string {
  // Handle empty/null/undefined
  if (!dateString || dateString.trim() === '') {
    console.warn('Empty date string provided, using today');
    return getNZDateString();
  }
  
  // If already YYYY-MM-DD, return as-is
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateString;
  }
  
  // Convert DD/MM/YYYY to YYYY-MM-DD
  const ddmmyyyyMatch = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyyMatch) {
    const [_, day, month, year] = ddmmyyyyMatch;
    return `${year}-${month}-${day}`;
  }
  
  // Try to parse and convert to YYYY-MM-DD
  const date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    return getNZDateString(date);
  }
  
  // If all else fails, return current date
  console.error('Invalid date string, using today:', dateString);
  return getNZDateString();
}

/**
 * Get NZ "now" as ISO string for database inserts
 * ✅ CRITICAL: This forces NZ timezone regardless of browser timezone
 * Prevents data corruption when users have browsers set to different timezones
 */
export function getNZNowISO(): string {
  // Get current time and force it to be interpreted as NZ time
  const now = new Date();
  const nzDateStr = now.toLocaleString('en-NZ', { timeZone: NZ_TIMEZONE });
  const nzDate = new Date(nzDateStr);
  return nzDate.toISOString();
}

/**
 * Convert a date input (assuming NZ timezone) to UTC ISO string
 * Use this when user enters a date/time and you need to store in database
 */
export function toUTCFromNZ(nzDateStr: string): string {
  // Parse as if it's NZ time, then convert to UTC
  const nzDate = new Date(nzDateStr + (nzDateStr.includes('T') ? '' : 'T00:00:00'));
  
  // Get the offset between browser timezone and NZ timezone
  const nzTime = new Date(nzDate.toLocaleString('en-US', { timeZone: NZ_TIMEZONE }));
  const localTime = new Date(nzDate.toLocaleString('en-US'));
  const offset = nzTime.getTime() - localTime.getTime();
  
  // Apply offset to get correct UTC time
  const utcTime = new Date(nzDate.getTime() - offset);
  return utcTime.toISOString();
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
 * Converts YYYY-MM-DD to full day range in UTC for database queries
 */
export function getNZDateRange(dateStr: string): { start: string; end: string } {
  // Validate input format
  if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    console.error('Invalid date format for getNZDateRange:', dateStr);
    // Return today's range as fallback
    const todayStr = getNZDateString();
    return getNZDateRange(todayStr);
  }
  
  const start = parseNZDate(dateStr);
  const end = getNZEndOfDay(start);
  
  // Validate dates before converting to ISO
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    console.error('Invalid Date objects created:', { start, end, dateStr });
    const todayStr = getNZDateString();
    return getNZDateRange(todayStr);
  }
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}
