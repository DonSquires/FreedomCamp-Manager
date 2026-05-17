/**
 * CRO Metrics — Conversion Rate Optimisation Event Tracking
 *
 * Instruments task completion events and time-to-first-action metrics for the
 * three role conversion targets defined in docs/CRO_TODOLIST.md Part 6.
 *
 * All events are written to the existing `audit_log` table so they appear in
 * the Audit Log dashboard alongside other operational events. Events use the
 * `cro_` action prefix to allow easy filtering.
 *
 * **Conversion targets:**
 * - Officer:  patrol complete  (cro_patrol_complete)
 * - Admin:    breach resolved  (cro_breach_resolved)
 * - Master:   approval complete (cro_approval_complete)
 *
 * **Time-to-first-action events:**
 * - cro_time_to_first_action — emitted when a user first clicks a primary CTA
 *   on their role landing page; `new_values.duration_ms` holds the latency.
 */

import { supabase } from '@/lib/supabase'

// ─── Event types ─────────────────────────────────────────────────────────────

export type CroEventAction =
  | 'cro_patrol_complete'
  | 'cro_breach_resolved'
  | 'cro_approval_complete'
  | 'cro_time_to_first_action'

export type CroEntityType = 'patrol' | 'breach' | 'approval' | 'landing_page'

export type CroRoleSurface = 'officer' | 'admin' | 'master'

export interface CroEventPayload {
  action: CroEventAction
  entity_type: CroEntityType
  entity_id?: string | null
  organization_id?: string | null
  performed_by?: string | null
  /** Structured metrics stored in new_values (audit_log jsonb column). */
  metrics: Record<string, unknown>
}

// ─── Core write function ──────────────────────────────────────────────────────

/**
 * Write a CRO tracking event to `audit_log`.
 *
 * Fire-and-forget: errors are logged to console only so a tracking failure
 * never breaks the primary user action.
 */
export async function writeCroEvent(payload: CroEventPayload): Promise<void> {
  try {
    const { error } = await supabase.from('audit_log').insert({
      action: payload.action,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id ?? null,
      organization_id: payload.organization_id ?? null,
      performed_by: payload.performed_by ?? null,
      old_values: null,
      new_values: {
        cro: true,
        ...payload.metrics,
        recorded_at: new Date().toISOString(),
      },
    })

    if (error) {
      console.warn('[cro-metrics] audit_log insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[cro-metrics] unexpected error:', err)
  }
}

// ─── Task completion helpers ──────────────────────────────────────────────────

/**
 * Track officer patrol completion.
 * Called when `useCompletePatrol` mutation succeeds.
 */
export async function trackPatrolComplete(params: {
  patrolId: string
  organizationId: string | null | undefined
  performedBy: string | null | undefined
  vehiclesChecked: number
  breachesFound: number
  /** Elapsed ms from patrol start to completion, if known. */
  durationMs?: number
}): Promise<void> {
  await writeCroEvent({
    action: 'cro_patrol_complete',
    entity_type: 'patrol',
    entity_id: params.patrolId,
    organization_id: params.organizationId,
    performed_by: params.performedBy,
    metrics: {
      vehicles_checked: params.vehiclesChecked,
      breaches_found: params.breachesFound,
      duration_ms: params.durationMs ?? null,
    },
  })
}

/**
 * Track admin breach resolution.
 * Called when `resolveMutation` succeeds in BreachAlerts.tsx.
 */
export async function trackBreachResolved(params: {
  breachId: string
  organizationId: string | null | undefined
  performedBy: string | null | undefined
  /** Elapsed ms from breach first-view to resolution, if known. */
  triageDurationMs?: number
  notes?: string
}): Promise<void> {
  await writeCroEvent({
    action: 'cro_breach_resolved',
    entity_type: 'breach',
    entity_id: params.breachId,
    organization_id: params.organizationId,
    performed_by: params.performedBy,
    metrics: {
      triage_duration_ms: params.triageDurationMs ?? null,
      has_notes: Boolean(params.notes),
    },
  })
}

/**
 * Track master approval completion.
 * Called when a governance approval/exception action succeeds.
 */
export async function trackApprovalComplete(params: {
  approvalId?: string | null
  organizationId: string | null | undefined
  performedBy: string | null | undefined
  approvalType: string
  /** Elapsed ms from approval first-view to action, if known. */
  reviewDurationMs?: number
}): Promise<void> {
  await writeCroEvent({
    action: 'cro_approval_complete',
    entity_type: 'approval',
    entity_id: params.approvalId ?? null,
    organization_id: params.organizationId,
    performed_by: params.performedBy,
    metrics: {
      approval_type: params.approvalType,
      review_duration_ms: params.reviewDurationMs ?? null,
    },
  })
}

/**
 * Track time-to-first-action on a role landing page.
 * Called when the user first clicks a primary CTA after page load.
 *
 * @param pageLoadTime - `Date.now()` value captured when the component mounted.
 * @param surface      - Which shell the user is on.
 * @param action       - Label for the CTA that was clicked (e.g. "start_patrol").
 */
export async function trackTimeToFirstAction(params: {
  pageLoadTime: number
  surface: CroRoleSurface
  action: string
  organizationId: string | null | undefined
  performedBy: string | null | undefined
}): Promise<void> {
  const durationMs = Date.now() - params.pageLoadTime

  await writeCroEvent({
    action: 'cro_time_to_first_action',
    entity_type: 'landing_page',
    entity_id: null,
    organization_id: params.organizationId,
    performed_by: params.performedBy,
    metrics: {
      surface: params.surface,
      first_action: params.action,
      duration_ms: durationMs,
    },
  })
}
