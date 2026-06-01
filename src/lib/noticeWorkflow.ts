export type NoticeClass = 'warning' | 'infringement' | 'notice_to_vacate' | 'trespass' | 'noise'

export type CanonicalNoticeStatus =
  | 'draft'
  | 'issued'
  | 'served'
  | 'complied'
  | 'paid'
  | 'reminder_sent'
  | 'escalated'
  | 'court_referred'
  | 'seized'
  | 'active'
  | 'expired'
  | 'withdrawn'
  | 'cancelled'
  | 'voided'

export type NoticeRole = string | null | undefined

export type NoticeDecisionAction = 'edit' | 'approve' | 'issue' | 'escalate' | 'cancel' | 'enforce' | 'revoke'

export type ServiceMethod =
  | 'hand'
  | 'post'
  | 'email'
  | 'printed_onsite'
  | 'handed_in_person'
  | 'officer_delivery'
  | 'in_person'
  | 'unknown'

export interface NoticeServiceProof {
  method: ServiceMethod
  servedAt: string
  servedBy: string
  recipientName?: string | null
  recipientAddress?: string | null
  recipientEmail?: string | null
  artifactUrls?: string[]
  evidenceHash?: string | null
}

export interface CanonicalNoticeIssuancePayload {
  noticeClass: NoticeClass
  legalBasis: string
  policyReference?: string | null
  templateVersion?: string | null
  evidenceRefs: string[]
  issuerId: string
  issuerRole: string
  serviceProof: NoticeServiceProof
}

export interface NoticeTransitionContext {
  /**
   * Enables enterprise client-governed checkpoints before high-impact transitions.
   */
  requiresClientApproval?: boolean
  /**
   * Set true once a client admin/officer has approved the intended transition.
   */
  clientApproved?: boolean
  /**
   * Field officers can still issue immediate notices during on-site visits.
   */
  isOnSiteOfficerIssuance?: boolean
}

export interface NoticeSnapshot {
  id: string
  noticeClass: NoticeClass
  status: CanonicalNoticeStatus
  title: string
  legalBasis: string
  amountCents?: number | null
  templateVersion?: string | null
  notes?: string | null
}

export interface NoticeAmendmentVersion {
  version: number
  amendedAt: string
  amendedBy: string
  reasonCode: string
  notice: NoticeSnapshot
}

export interface NoticeFieldChange {
  field: keyof NoticeSnapshot
  from: string | number | null | undefined
  to: string | number | null | undefined
}

export interface NoticeAmendmentResult {
  nextVersion: NoticeAmendmentVersion
  fieldDiff: NoticeFieldChange[]
}

const TERMINAL_STATUSES = new Set<CanonicalNoticeStatus>([
  'paid',
  'complied',
  'expired',
  'withdrawn',
  'cancelled',
  'voided',
  'seized',
])

const CLIENT_CHECKPOINT_STATUSES = new Set<CanonicalNoticeStatus>([
  'issued',
  'withdrawn',
  'cancelled',
  'voided',
  'escalated',
  'court_referred',
  'seized',
])

const DECISION_RIGHTS_MATRIX: Record<NoticeDecisionAction, readonly string[]> = {
  edit: ['officer', 'admin_officer', 'admin', 'master'],
  approve: ['client_admin', 'client_officer', 'admin', 'master'],
  issue: ['officer', 'admin_officer', 'admin', 'master'],
  escalate: ['admin_officer', 'admin', 'master'],
  cancel: ['client_admin', 'client_officer', 'admin', 'master'],
  enforce: ['admin_officer', 'admin', 'master'],
  revoke: ['client_admin', 'admin', 'master'],
}

const STATUS_ALIASES: Record<string, CanonicalNoticeStatus> = {
  draft: 'draft',
  issued: 'issued',
  served: 'served',
  complied: 'complied',
  paid: 'paid',
  reminder_sent: 'reminder_sent',
  escalated: 'escalated',
  court_referred: 'court_referred',
  referred_to_court: 'court_referred',
  seized: 'seized',
  active: 'active',
  expired: 'expired',
  withdrawn: 'withdrawn',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  voided: 'voided',
}

const NOTICE_LIFECYCLE: Record<NoticeClass, Record<CanonicalNoticeStatus, CanonicalNoticeStatus[]>> = {
  warning: {
    draft: ['issued', 'withdrawn', 'voided'],
    issued: ['served', 'withdrawn', 'voided', 'expired'],
    served: ['complied', 'escalated', 'withdrawn', 'voided', 'expired'],
    complied: [],
    escalated: [],
    withdrawn: [],
    voided: [],
    expired: [],
    paid: [],
    reminder_sent: [],
    court_referred: [],
    seized: [],
    active: [],
    cancelled: [],
  },
  infringement: {
    draft: ['issued', 'withdrawn', 'voided'],
    issued: ['reminder_sent', 'paid', 'court_referred', 'withdrawn', 'voided'],
    reminder_sent: ['paid', 'court_referred', 'withdrawn', 'voided'],
    paid: [],
    court_referred: [],
    withdrawn: [],
    voided: [],
    complied: [],
    served: [],
    escalated: [],
    seized: [],
    active: [],
    expired: [],
    cancelled: [],
  },
  notice_to_vacate: {
    issued: ['complied', 'expired', 'escalated', 'voided'],
    complied: [],
    expired: ['escalated', 'voided'],
    escalated: ['voided'],
    voided: [],
    draft: [],
    served: [],
    paid: [],
    reminder_sent: [],
    court_referred: [],
    seized: [],
    active: [],
    withdrawn: [],
    cancelled: [],
  },
  trespass: {
    active: ['served', 'expired', 'withdrawn', 'voided'],
    served: ['expired', 'withdrawn', 'voided'],
    expired: [],
    withdrawn: [],
    voided: [],
    draft: [],
    issued: [],
    complied: [],
    paid: [],
    reminder_sent: [],
    escalated: [],
    court_referred: [],
    seized: [],
    cancelled: [],
  },
  noise: {
    issued: ['complied', 'escalated', 'seized', 'withdrawn', 'voided'],
    complied: [],
    escalated: ['seized', 'withdrawn', 'voided'],
    seized: [],
    withdrawn: [],
    voided: [],
    draft: [],
    served: [],
    paid: [],
    reminder_sent: [],
    court_referred: [],
    active: [],
    expired: [],
    cancelled: [],
  },
}

export function normalizeNoticeStatus(status: string | null | undefined): CanonicalNoticeStatus | null {
  if (!status || typeof status !== 'string') return null
  return STATUS_ALIASES[status.trim().toLowerCase()] ?? null
}

function normalizeRole(role: NoticeRole): string {
  return (role || '').trim().toLowerCase()
}

function canEscalate(role: NoticeRole): boolean {
  return ['admin_officer', 'admin', 'master'].includes(normalizeRole(role))
}

function canVoid(role: NoticeRole): boolean {
  return ['admin', 'master'].includes(normalizeRole(role))
}

export function canTransitionNoticeStatus(
  noticeClass: NoticeClass,
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
  actorRole: NoticeRole,
  context: NoticeTransitionContext = {},
): { ok: boolean; reason?: string } {
  const from = normalizeNoticeStatus(fromStatus)
  const to = normalizeNoticeStatus(toStatus)

  if (!from || !to) return { ok: false, reason: 'Unknown status transition' }
  if (from === to) return { ok: true }
  if (TERMINAL_STATUSES.has(from)) return { ok: false, reason: `Cannot transition from terminal status ${from}` }

  const allowed = NOTICE_LIFECYCLE[noticeClass][from] ?? []
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Transition ${from} → ${to} is not allowed` }
  }

  if (context.requiresClientApproval && CLIENT_CHECKPOINT_STATUSES.has(to) && !context.clientApproved) {
    const role = normalizeRole(actorRole)
    const canOnSiteIssue =
      to === 'issued' &&
      context.isOnSiteOfficerIssuance === true &&
      ['officer', 'admin_officer', 'admin', 'master'].includes(role)

    if (!canOnSiteIssue) {
      return { ok: false, reason: 'Client approval is required for this transition' }
    }
  }

  if (to === 'escalated' || to === 'court_referred') {
    return canEscalate(actorRole)
      ? { ok: true }
      : { ok: false, reason: 'Escalation requires admin officer or higher' }
  }

  if (to === 'voided') {
    return canVoid(actorRole)
      ? { ok: true }
      : { ok: false, reason: 'Voiding requires admin or master role' }
  }

  return { ok: true }
}

export function canRolePerformNoticeAction(
  action: NoticeDecisionAction,
  actorRole: NoticeRole,
): { ok: boolean; reason?: string } {
  const role = normalizeRole(actorRole)
  const allowedRoles = DECISION_RIGHTS_MATRIX[action]
  if (allowedRoles.includes(role)) {
    return { ok: true }
  }
  return { ok: false, reason: `Role ${role || 'unknown'} cannot ${action} notices` }
}

export function createNoticeAmendmentVersion(
  previousVersion: NoticeAmendmentVersion | null,
  updatedNotice: NoticeSnapshot,
  actorId: string,
  reasonCode: string,
  amendedAt: string = new Date().toISOString(),
): NoticeAmendmentResult {
  const priorSnapshot = previousVersion?.notice ?? null
  const fieldDiff: NoticeFieldChange[] = []

  const trackedFields: Array<keyof NoticeSnapshot> = [
    'status',
    'title',
    'legalBasis',
    'amountCents',
    'templateVersion',
    'notes',
  ]

  for (const field of trackedFields) {
    const before = priorSnapshot?.[field]
    const after = updatedNotice[field]
    if (before !== after) {
      fieldDiff.push({ field, from: before, to: after })
    }
  }

  return {
    nextVersion: {
      version: (previousVersion?.version ?? 0) + 1,
      amendedAt,
      amendedBy: actorId,
      reasonCode,
      notice: { ...updatedNotice },
    },
    fieldDiff,
  }
}

export function validateNoticeIssuancePayload(payload: CanonicalNoticeIssuancePayload): { ok: boolean; errors: string[] } {
  const errors: string[] = []

  if (!payload.legalBasis?.trim()) errors.push('Legal basis is required')
  if (!payload.issuerId?.trim()) errors.push('Issuer identity is required')
  if (!payload.issuerRole?.trim()) errors.push('Issuer role is required')
  if (!payload.serviceProof?.method) errors.push('Service method is required')
  if (!payload.serviceProof?.servedAt) errors.push('Service timestamp is required')
  if (!payload.serviceProof?.servedBy?.trim()) errors.push('Service actor is required')
  if (!payload.evidenceRefs || payload.evidenceRefs.length === 0) errors.push('At least one evidence reference is required')

  return { ok: errors.length === 0, errors }
}
