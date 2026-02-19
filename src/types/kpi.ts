/**
 * KPI Type Definitions
 * 
 * Type-safe constants for KPI keys to prevent typos between dashboard and report
 */

export type KpiKey = 'overstayers' | 'homeless_exempt' | 'breaches' | 'compliant' | null;

export const KPI = {
  OVERSTAYERS: 'overstayers' as KpiKey,
  HOMELESS_EXEMPT: 'homeless_exempt' as KpiKey,
  BREACHES: 'breaches' as KpiKey,
  COMPLIANT: 'compliant' as KpiKey,
} as const;

export const KPI_LABELS: Record<string, string> = {
  overstayers: 'Overstayers',
  homeless_exempt: 'Homeless (Exempt)',
  breaches: 'All Breaches',
  compliant: 'Compliant',
};

export const KPI_DESCRIPTIONS: Record<string, string> = {
  overstayers: 'Breaches requiring enforcement action (excludes homeless-exempt)',
  homeless_exempt: 'Breaches with confirmed homeless exemption (welfare pathway)',
  breaches: 'All breach observations (including homeless-exempt)',
  compliant: 'Observations with no breaches detected',
};
