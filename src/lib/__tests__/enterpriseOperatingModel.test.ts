import { describe, expect, it } from 'vitest'
import {
  applyDispatchPolicy,
  buildSlaEvidencePack,
  buildSpecialtyInvoiceLineDrafts,
  canEnterpriseRolePerform,
  evaluateComplaintTicketQualification,
  validatePublicIntakeSubmission,
} from '@/lib/enterpriseOperatingModel'

describe('enterprise operating model', () => {
  it('enforces client/provider decision rights by action', () => {
    expect(canEnterpriseRolePerform('approve', 'client_admin')).toBe(true)
    expect(canEnterpriseRolePerform('approve', 'officer')).toBe(false)
    expect(canEnterpriseRolePerform('issue', 'officer')).toBe(true)
  })

  it('builds billable specialty invoice line drafts from service executions', () => {
    const lines = buildSpecialtyInvoiceLineDrafts(
      [
        {
          specialtyKey: 'noise',
          serviceAgreementId: 'sa-1',
          enabled: true,
          billable: true,
          unitPriceCents: 7500,
        },
      ],
      [
        {
          specialtyKey: 'noise_control',
          quantity: 2,
          referenceId: 'job-1',
          description: 'After-hours noise attendance',
        },
      ],
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].totalCents).toBe(15000)
  })

  it('validates unified public intake evidence requirements', () => {
    const errors = validatePublicIntakeSubmission({
      category: 'waiver',
      intakeType: 'hardship',
      description: 'Need review',
      evidenceRefs: [],
      claimantName: 'Casey',
      claimantContact: 'casey@example.com',
      jurisdictionId: 'j-1',
    })
    expect(errors).toContain('Waiver requests require supporting evidence')
  })

  it('enforces 15-minute recall gate before noise dispatch', () => {
    const result = evaluateComplaintTicketQualification(
      {
        intakeType: 'noise',
        reportedAt: '2026-01-01T10:10:00.000Z',
        priorCallTimestamps: ['2026-01-01T10:00:00.000Z'],
      },
      {
        holdMinutesBetweenNoiseCalls: 15,
        minimumNoiseCallsBeforeDispatch: 2,
        autoCreateTicketIntakeTypes: ['noise', 'smoke'],
      },
    )

    expect(result.dispatchable).toBe(false)
    expect(result.reasonCode).toBe('followup_call_too_soon')
    expect(result.nextEligibleAt).toBe('2026-01-01T10:15:00.000Z')
  })

  it('requires LOI/POI/VOI/zone context when dispatch policy demands it', () => {
    const directive = applyDispatchPolicy(
      'noise',
      {},
      {
        queue: 'noise-dispatch',
        requiredSpecialty: 'noise',
        blockedWithoutLocationContext: true,
      },
    )

    expect(directive.compliant).toBe(false)
    expect(directive.reasons).toContain('missing_loi_poi_voi_or_zone')
  })

  it('produces SLA evidence pack with approval traceability', () => {
    const evidence = buildSlaEvidencePack(
      '2026-01-01T09:00:00.000Z',
      '2026-01-01T10:30:00.000Z',
      60,
      [
        { action: 'client_signoff_approve', actorRole: 'client_admin', reasonCode: 'ok', happenedAt: '2026-01-01T09:05:00.000Z' },
        { action: 'dispatch_assigned', actorRole: 'admin_officer', reasonCode: 'queue', happenedAt: '2026-01-01T09:06:00.000Z' },
      ],
    )

    expect(evidence.breached).toBe(true)
    expect(evidence.approvalTraceability).toHaveLength(1)
  })
})
