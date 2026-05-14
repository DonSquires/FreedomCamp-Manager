export interface OrganizationSetupDraft {
  organizationName: string
  organizationType: 'security_company' | 'service_provider' | 'client' | 'operator' | 'owner'
  organizationLevel: 1 | 2 | 3
  parentOrganizationName: string
  address: string
  contactEmail: string
  contactPhone: string
  isActive: boolean
  notes: string
  childSiteNames: string[]
  childZoneNames: string[]
  childGeofenceNames: string[]
  missingFields: string[]
  followUpQuestions: string[]
  sourceText: string
}

const SETUP_VERBS = /(create|add|set up|setup|register|onboard|build|make)/i
const ORG_NOUNS = /(organization|organisation|org|company|branch|client)/i

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

export function looksLikeOrganizationSetupRequest(message: string, fileName?: string | null): boolean {
  const sample = `${fileName || ''}\n${message}`
  return SETUP_VERBS.test(sample) && ORG_NOUNS.test(sample)
}

export function extractOrganizationSetupDraft(parsed: Record<string, any>, sourceText: string): OrganizationSetupDraft | null {
  if (!parsed?.organizationName) return null

  return {
    organizationName: String(parsed.organizationName || '').trim(),
    organizationType: ['security_company', 'service_provider', 'client', 'operator', 'owner'].includes(String(parsed.organizationType || ''))
      ? String(parsed.organizationType) as OrganizationSetupDraft['organizationType']
      : 'client',
    organizationLevel: [1, 2, 3].includes(Number(parsed.organizationLevel))
      ? Number(parsed.organizationLevel) as 1 | 2 | 3
      : 3,
    parentOrganizationName: String(parsed.parentOrganizationName || '').trim(),
    address: String(parsed.address || '').trim(),
    contactEmail: String(parsed.contactEmail || '').trim(),
    contactPhone: String(parsed.contactPhone || '').trim(),
    isActive: parsed.isActive !== false,
    notes: String(parsed.notes || '').trim(),
    childSiteNames: asStringArray(parsed.childSiteNames),
    childZoneNames: asStringArray(parsed.childZoneNames),
    childGeofenceNames: asStringArray(parsed.childGeofenceNames),
    missingFields: asStringArray(parsed.missingFields),
    followUpQuestions: asStringArray(parsed.followUpQuestions),
    sourceText,
  }
}

export function buildOrganizationSetupFollowUpQuestions(draft: OrganizationSetupDraft): string[] {
  if (draft.followUpQuestions.length > 0) return draft.followUpQuestions

  return [
    'What is the exact legal organization name?',
    'Is this a security company, service provider, or client?',
    'What is the parent organization, if any?',
    'What address and contact details should Bob store?',
  ]
}