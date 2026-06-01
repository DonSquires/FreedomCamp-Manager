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

const TERMINAL_STATUSES = new Set<CanonicalNoticeStatus>([
  'paid',
  'complied',
  'expired',
  'withdrawn',
  'cancelled',
  'voided',
  'seized',
])

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
