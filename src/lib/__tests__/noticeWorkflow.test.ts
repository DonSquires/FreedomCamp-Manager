import { describe, expect, it } from 'vitest'
import { canTransitionNoticeStatus, validateNoticeIssuancePayload } from '@/lib/noticeWorkflow'

describe('notice workflow lifecycle guards', () => {
  it('allows valid infringement transitions for authorized roles', () => {
    expect(canTransitionNoticeStatus('infringement', 'issued', 'reminder_sent', 'officer').ok).toBe(true)
    expect(canTransitionNoticeStatus('infringement', 'reminder_sent', 'court_referred', 'admin_officer').ok).toBe(true)
  })

  it('blocks escalation and voiding for insufficient roles', () => {
    expect(canTransitionNoticeStatus('notice_to_vacate', 'issued', 'escalated', 'officer').ok).toBe(false)
    expect(canTransitionNoticeStatus('notice_to_vacate', 'issued', 'voided', 'admin_officer').ok).toBe(false)
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
