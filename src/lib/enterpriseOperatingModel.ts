import { resolveCanonicalSpecialty } from '@/lib/specialtyRegistry'

export type EnterpriseRole =
  | 'client_admin'
  | 'client_officer'
  | 'client_viewer'
  | 'officer'
  | 'admin_officer'
  | 'admin'
  | 'master'
  | string

export type NoticeDecisionAction = 'edit' | 'approve' | 'issue' | 'escalate' | 'cancel' | 'enforce' | 'revoke'

const DECISION_RIGHTS_MATRIX: Record<NoticeDecisionAction, readonly string[]> = {
  edit: ['officer', 'admin_officer', 'admin', 'master'],
  approve: ['client_admin', 'client_officer', 'admin', 'master'],
  issue: ['officer', 'admin_officer', 'admin', 'master'],
  escalate: ['client_admin', 'client_officer', 'admin_officer', 'admin', 'master'],
  cancel: ['client_admin', 'client_officer', 'admin', 'master'],
  enforce: ['client_admin', 'client_officer', 'admin_officer', 'admin', 'master'],
  revoke: ['client_admin', 'client_officer', 'admin', 'master'],
}

export function canEnterpriseRolePerform(action: NoticeDecisionAction, role: EnterpriseRole): boolean {
  const normalizedRole = role.trim().toLowerCase()
  return DECISION_RIGHTS_MATRIX[action]?.includes(normalizedRole) ?? false
}

export interface SpecialtyBillingEntitlement {
  specialtyKey: string
  serviceAgreementId: string
  enabled: boolean
  billable: boolean
  unitPriceCents: number
  currency?: string
}

export interface SpecialtyServiceExecution {
  specialtyKey: string
  quantity: number
  referenceId: string
  description: string
}

export interface InvoiceLineDraft {
  serviceAgreementId: string
  specialtyKey: string
  description: string
  quantity: number
  unitPriceCents: number
  totalCents: number
  currency: string
  referenceId: string
}

export function buildSpecialtyInvoiceLineDrafts(
  entitlements: SpecialtyBillingEntitlement[],
  serviceExecutions: SpecialtyServiceExecution[],
): InvoiceLineDraft[] {
  const entitlementBySpecialty = new Map(
    entitlements
      .filter((entitlement) => entitlement.enabled && entitlement.billable && entitlement.unitPriceCents > 0)
      .map((entitlement) => [resolveCanonicalSpecialty(entitlement.specialtyKey) ?? entitlement.specialtyKey, entitlement] as const),
  )

  return serviceExecutions.flatMap((execution) => {
    const canonicalSpecialty = resolveCanonicalSpecialty(execution.specialtyKey) ?? execution.specialtyKey
    const entitlement = entitlementBySpecialty.get(canonicalSpecialty)
    if (!entitlement) return []

    return [
      {
        serviceAgreementId: entitlement.serviceAgreementId,
        specialtyKey: canonicalSpecialty,
        description: execution.description,
        quantity: execution.quantity,
        unitPriceCents: entitlement.unitPriceCents,
        totalCents: entitlement.unitPriceCents * execution.quantity,
        currency: entitlement.currency ?? 'NZD',
        referenceId: execution.referenceId,
      },
    ]
  })
}

export type PublicIntakeCategory = 'waiver' | 'complaint'

export interface PublicIntakeSubmission {
  category: PublicIntakeCategory
  intakeType: string
  description: string
  evidenceRefs: string[]
  claimantName: string
  claimantContact: string
  jurisdictionId: string
}

export function validatePublicIntakeSubmission(submission: PublicIntakeSubmission): string[] {
  const errors: string[] = []
  if (!submission.claimantName.trim()) errors.push('Claimant name is required')
  if (!submission.claimantContact.trim()) errors.push('Claimant contact is required')
  if (!submission.description.trim()) errors.push('Description is required')
  if (!submission.jurisdictionId.trim()) errors.push('Jurisdiction is required')

  if (submission.category === 'waiver' && submission.evidenceRefs.length < 1) {
    errors.push('Waiver requests require supporting evidence')
  }
  if (submission.category === 'complaint' && submission.evidenceRefs.length < 1) {
    errors.push('Complaints require at least one evidence item')
  }

  return errors
}

export interface JurisdictionRuleConfig {
  holdMinutesBetweenNoiseCalls: number
  minimumNoiseCallsBeforeDispatch: number
  autoCreateTicketIntakeTypes: string[]
}

export interface ComplaintTicketQualificationInput {
  intakeType: string
  reportedAt: string
  priorCallTimestamps: string[]
}

export interface ComplaintTicketQualification {
  dispatchable: boolean
  reasonCode: string
  nextEligibleAt?: string
}

export function evaluateComplaintTicketQualification(
  input: ComplaintTicketQualificationInput,
  config: JurisdictionRuleConfig,
): ComplaintTicketQualification {
  if (!config.autoCreateTicketIntakeTypes.includes(input.intakeType)) {
    return { dispatchable: false, reasonCode: 'ticket_not_enabled_for_intake_type' }
  }

  if (input.intakeType !== 'noise') {
    return { dispatchable: true, reasonCode: 'dispatchable_now' }
  }

  const allCalls = [...input.priorCallTimestamps, input.reportedAt].sort()
  if (allCalls.length < config.minimumNoiseCallsBeforeDispatch) {
    return { dispatchable: false, reasonCode: 'requires_followup_call' }
  }

  const latestPriorCall = input.priorCallTimestamps.slice().sort().at(-1)
  if (!latestPriorCall) {
    return { dispatchable: false, reasonCode: 'requires_followup_call' }
  }

  const elapsedMs = Date.parse(input.reportedAt) - Date.parse(latestPriorCall)
  const requiredMs = config.holdMinutesBetweenNoiseCalls * 60 * 1000
  if (elapsedMs < requiredMs) {
    return {
      dispatchable: false,
      reasonCode: 'followup_call_too_soon',
      nextEligibleAt: new Date(Date.parse(latestPriorCall) + requiredMs).toISOString(),
    }
  }

  return { dispatchable: true, reasonCode: 'dispatchable_after_recall_gate' }
}

export interface DispatchPolicyContext {
  loiId?: string | null
  poiId?: string | null
  voiId?: string | null
  zoneId?: string | null
}

export interface DispatchRuleBinding {
  queue: string
  requiredSpecialty: string
  blockedWithoutLocationContext: boolean
}

export interface DispatchDirective {
  queue: string
  specialty: string
  compliant: boolean
  reasons: string[]
}

export function applyDispatchPolicy(
  ticketSpecialty: string,
  context: DispatchPolicyContext,
  rule: DispatchRuleBinding,
): DispatchDirective {
  const reasons: string[] = []
  const ticketCanonical = resolveCanonicalSpecialty(ticketSpecialty) ?? ticketSpecialty
  const ruleCanonical = resolveCanonicalSpecialty(rule.requiredSpecialty) ?? rule.requiredSpecialty

  if (ticketCanonical !== ruleCanonical) {
    reasons.push('specialty_mismatch')
  }

  const hasLinkedContext = Boolean(context.loiId || context.poiId || context.voiId || context.zoneId)
  if (rule.blockedWithoutLocationContext && !hasLinkedContext) {
    reasons.push('missing_loi_poi_voi_or_zone')
  }

  return {
    queue: rule.queue,
    specialty: ruleCanonical,
    compliant: reasons.length === 0,
    reasons,
  }
}

export interface WorkflowAuditEvent {
  action: string
  actorRole: string
  reasonCode: string
  happenedAt: string
}

export interface SlaEvidencePack {
  resolutionMinutes: number
  breached: boolean
  approvalTraceability: WorkflowAuditEvent[]
}

export function buildSlaEvidencePack(
  openedAt: string,
  resolvedAt: string,
  targetResolutionMinutes: number,
  auditTrail: WorkflowAuditEvent[],
): SlaEvidencePack {
  const resolutionMinutes = Math.max(0, Math.round((Date.parse(resolvedAt) - Date.parse(openedAt)) / 60000))
  const approvalTraceability = auditTrail.filter((event) => event.action.includes('approve') || event.action.includes('client_signoff'))

  return {
    resolutionMinutes,
    breached: resolutionMinutes > targetResolutionMinutes,
    approvalTraceability,
  }
}
