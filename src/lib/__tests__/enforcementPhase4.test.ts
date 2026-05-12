import { describe, expect, it } from 'vitest'
import { computeSafetyDossierRisk, isDigitalSignatureValid } from '@/lib/enforcementPhase4'

describe('enforcementPhase4 helpers', () => {
  it('computes escalating risk levels from 24h indicators', () => {
    expect(computeSafetyDossierRisk({ observations24h: 0, incidents24h: 0, welfareAlerts24h: 0, aggressionSignals24h: 0 })).toBe('low')
    expect(computeSafetyDossierRisk({ observations24h: 6, incidents24h: 1, welfareAlerts24h: 0, aggressionSignals24h: 0 })).toBe('medium')
    expect(computeSafetyDossierRisk({ observations24h: 5, incidents24h: 2, welfareAlerts24h: 1, aggressionSignals24h: 1 })).toBe('high')
    expect(computeSafetyDossierRisk({ observations24h: 8, incidents24h: 3, welfareAlerts24h: 2, aggressionSignals24h: 2 })).toBe('critical')
  })

  it('validates digital signature against officer name', () => {
    expect(isDigitalSignatureValid('Jane Doe', 'Jane Doe')).toBe(true)
    expect(isDigitalSignatureValid('jane doe', 'Jane Doe')).toBe(true)
    expect(isDigitalSignatureValid('JD', 'Jane Doe')).toBe(false)
    expect(isDigitalSignatureValid('Other Name', 'Jane Doe')).toBe(false)
  })
})
