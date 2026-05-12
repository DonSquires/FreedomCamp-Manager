export type SafetyDossierInput = {
  observations24h: number
  incidents24h: number
  welfareAlerts24h: number
  aggressionSignals24h: number
}

export function computeSafetyDossierRisk(input: SafetyDossierInput): 'low' | 'medium' | 'high' | 'critical' {
  const score =
    Math.max(0, Number(input.observations24h || 0)) * 0.3 +
    Math.max(0, Number(input.incidents24h || 0)) * 1.2 +
    Math.max(0, Number(input.welfareAlerts24h || 0)) * 1.5 +
    Math.max(0, Number(input.aggressionSignals24h || 0)) * 2

  if (score >= 12) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 3) return 'medium'
  return 'low'
}

export function isDigitalSignatureValid(signature: string, officerName: string): boolean {
  const sig = String(signature || '').trim()
  if (sig.length < 3) return false

  const name = String(officerName || '').trim()
  if (!name) return sig.length >= 3

  return sig.toLowerCase() === name.toLowerCase()
}
