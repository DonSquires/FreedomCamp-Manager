import { describe, expect, it } from 'vitest'
import {
  canRolePerformNoticeAction,
  canTransitionNoticeStatus,
  createNoticeAmendmentVersion,
  validateNoticeIssuancePayload,
} from '@/lib/noticeWorkflow'

describe('notice workflow lifecycle guards', () => {
  it('allows valid infringement transitions for authorized roles', () => {
    expect(canTransitionNoticeStatus('infringement', 'issued', 'reminder_sent', 'officer').ok).toBe(true)
    expect(canTransitionNoticeStatus('infringement', 'reminder_sent', 'court_referred', 'admin_officer').ok).toBe(true)
  })

  it('blocks escalation and voiding for insufficient roles', () => {
    expect(canTransitionNoticeStatus('notice_to_vacate', 'issued', 'escalated', 'officer').ok).toBe(false)
    expect(canTransitionNoticeStatus('notice_to_vacate', 'issued', 'voided', 'admin_officer').ok).toBe(false)
  })

  it('requires client approval for gated transitions but still allows on-site officer issuance', () => {
    expect(
      canTransitionNoticeStatus('infringement', 'issued', 'court_referred', 'admin_officer', {
        requiresClientApproval: true,
        clientApproved: false,
      }).ok,
    ).toBe(false)

    expect(
      canTransitionNoticeStatus('infringement', 'draft', 'issued', 'officer', {
        requiresClientApproval: true,
        clientApproved: false,
        isOnSiteOfficerIssuance: true,
      }).ok,
    ).toBe(true)
  })

  it('enforces decision-rights matrix for approval actions', () => {
    expect(canRolePerformNoticeAction('approve', 'client_admin').ok).toBe(true)
    expect(canRolePerformNoticeAction('approve', 'officer').ok).toBe(false)
  })

  it('creates immutable amendment versions with field-level diffs', () => {
    const first = createNoticeAmendmentVersion(
      null,
      {
        id: 'n-1',
        noticeClass: 'infringement',
        status: 'issued',
        title: 'Initial notice',
        legalBasis: 'Act 1',
        amountCents: 40000,
      },
      'u-1',
      'initial_issue',
      '2026-01-01T00:00:00.000Z',
    )

    const second = createNoticeAmendmentVersion(
      first.nextVersion,
      {
        id: 'n-1',
        noticeClass: 'infringement',
        status: 'voided',
        title: 'Initial notice',
        legalBasis: 'Act 1',
        amountCents: 0,
      },
      'u-2',
      'voided_by_client',
      '2026-01-02T00:00:00.000Z',
    )

    expect(second.nextVersion.version).toBe(2)
    expect(second.fieldDiff.some((change) => change.field === 'status' && change.to === 'voided')).toBe(true)
  })

  it('validates mandatory issuance payload fields', () => {
    const invalid = validateNoticeIssuancePayload({
      noticeClass: 'noise',
      legalBasis: '',
      issuerId: '',
      issuerRole: '',
      evidenceRefs: [],
      serviceProof: {
        method: 'hand',
        servedAt: '',
        servedBy: '',
      },
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.errors.length).toBeGreaterThan(0)
  })
})
