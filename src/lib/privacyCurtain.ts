/**
 * Privacy Curtain — PII auto-redaction utilities
 * Compliant with Privacy Act 2020 (NZ) s22-s27 access principles.
 *
 * Usage:
 *   import { redactField, buildRedactor, logPrivacyAccess } from '@/lib/privacyCurtain'
 *
 *   // Redact a single value
 *   const safe = redactField('John Smith', 'name')   // → '***** *****'
 *
 *   // Build a redactor for a full record
 *   const redactor = buildRedactor(settings, userRole)
 *   const safeRecord = redactor(vehicle)
 */

import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrivacyCurtainSettings {
  auto_redact_enabled: boolean
  redact_owner_name: boolean
  redact_owner_address: boolean
  redact_phone_number: boolean
  redact_plate_in_exports: boolean
  require_reason_for_unredact: boolean
  unredact_roles: string[]
}

export type RedactionField = 'name' | 'address' | 'phone' | 'plate' | 'email' | 'generic'

// ─────────────────────────────────────────────────────────────────────────────
// Low-level redactors
// ─────────────────────────────────────────────────────────────────────────────

const REDACT_PLACEHOLDER: Record<RedactionField, (value: string) => string> = {
  name: (v) => v.split(' ').map((w) => '*'.repeat(w.length)).join(' '),
  address: () => '[Address redacted — Privacy Act 2020]',
  phone: (v) => v.replace(/\d(?=\d{4})/g, '*'),
  plate: (v) => v.slice(0, 2) + '***' + v.slice(-1),
  email: (v) => {
    const [local, domain] = v.split('@')
    return local.slice(0, 2) + '***@' + (domain ?? '***')
  },
  generic: () => '[Redacted]',
}

/**
 * Redact a single PII value.
 * @param value  The original string value
 * @param field  Category of PII field (controls redaction style)
 * @returns Redacted string
 */
export function redactField(value: string | null | undefined, field: RedactionField): string {
  if (!value) return ''
  return REDACT_PLACEHOLDER[field](value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Record-level redaction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether a user role may see un-redacted PII given current settings.
 */
export function canUnredact(settings: PrivacyCurtainSettings, userRole: string): boolean {
  if (!settings.auto_redact_enabled) return true
  return settings.unredact_roles.includes(userRole)
}

/**
 * Build a redaction function for a canonical_vehicles-style record.
 * Applies redaction rules based on org settings and current user role.
 */
export function buildVehicleRedactor(
  settings: PrivacyCurtainSettings | null,
  userRole: string
): (record: Record<string, unknown>) => Record<string, unknown> {
  if (!settings || !settings.auto_redact_enabled || canUnredact(settings, userRole)) {
    return (record) => record
  }

  return (record: Record<string, unknown>): Record<string, unknown> => {
    const redacted = { ...record }

    if (settings.redact_owner_name) {
      if (typeof redacted['owner_first_name'] === 'string') {
        redacted['owner_first_name'] = redactField(redacted['owner_first_name'] as string, 'name')
      }
      if (typeof redacted['owner_last_name'] === 'string') {
        redacted['owner_last_name'] = redactField(redacted['owner_last_name'] as string, 'name')
      }
    }

    if (settings.redact_owner_address) {
      if (typeof redacted['owner_address'] === 'string') {
        redacted['owner_address'] = redactField(redacted['owner_address'] as string, 'address')
      }
    }

    if (settings.redact_phone_number) {
      if (typeof redacted['owner_phone'] === 'string') {
        redacted['owner_phone'] = redactField(redacted['owner_phone'] as string, 'phone')
      }
    }

    return redacted
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit logging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a PII field access event.
 * Call this when an authorised user views un-redacted data.
 *
 * Fire-and-forget (no await needed in most UI contexts).
 */
export function logPrivacyAccess(params: {
  organizationId: string
  actorId: string
  targetTable: string
  targetRecordId: string
  fieldAccessed: string
  accessReason?: string
}): void {
  ;(supabase as any)
    .from('privacy_access_log')
    .insert({
      organization_id: params.organizationId,
      actor: params.actorId,
      target_table: params.targetTable,
      target_record_id: params.targetRecordId,
      field_accessed: params.fieldAccessed,
      access_reason: params.accessReason ?? null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('Privacy access log failed:', error.message)
    })
}
