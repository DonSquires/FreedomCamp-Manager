/**
 * Shared compliance helpers for edge functions.
 *
 * Centralises constants and utilities that are used across multiple
 * recalculation functions to avoid duplication.
 */

/**
 * Breach types that map 1-to-1 to the `breach_type` column CHECK constraint
 * on breach_alerts. Any computed breach_type must be one of these values
 * before being stored in breach_alerts.
 */
export const VALID_BREACH_TYPES = [
  'consecutive_nights',
  'monthly_limit',
  'self_contained',
  'after_hours',
  'day_visit_violation',
  'allowed_days_violation',
] as const;

export type BreachType = typeof VALID_BREACH_TYPES[number];

/** Returns the value unchanged when it is a valid breach type, otherwise 'consecutive_nights'. */
export function toValidBreachType(value: string | null): BreachType {
  if (value && (VALID_BREACH_TYPES as readonly string[]).includes(value)) {
    return value as BreachType;
  }
  return 'consecutive_nights';
}

/**
 * Returns the NZ (Pacific/Auckland) hour for a given UTC timestamp string.
 *
 * Correctly handles both NZST (UTC+12) and NZDT (UTC+13) via the Intl API
 * rather than a naive `(utcHour + 12) % 24` offset.
 */
export function nzHour(recordedAt: string): number {
  const str = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(recordedAt));
  return parseInt(str, 10);
}
