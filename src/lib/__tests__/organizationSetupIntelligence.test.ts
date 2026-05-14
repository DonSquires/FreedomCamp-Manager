import { describe, expect, it } from 'vitest'

import {
  buildOrganizationSetupFollowUpQuestions,
  extractOrganizationSetupDraft,
  looksLikeOrganizationSetupRequest,
} from '@/lib/organizationSetupIntelligence'

describe('organizationSetupIntelligence', () => {
  it('detects a parking-related organization setup brief', () => {
    const prompt = 'First Security Blenheim is contracted by Marlborough Roads and needs a new organization setup for the client and zones.'
    expect(looksLikeOrganizationSetupRequest(prompt)).toBe(true)
  })

  it('extracts a usable organization draft from structured AI output', () => {
    const draft = extractOrganizationSetupDraft({
      organizationName: 'Marlborough Roads',
      organizationType: 'client',
      organizationLevel: 3,
      parentOrganizationName: 'First Security - Blenheim',
      address: 'Blenheim, Marlborough, New Zealand',
      contactEmail: 'parking@marlborough.govt.nz',
      contactPhone: '03 123 4567',
      isActive: true,
      notes: 'Governing organization for parking setup',
      childSiteNames: ['Kinross Street car park'],
      childZoneNames: ['Blenheim CBD Time Restricted Parking'],
      childGeofenceNames: ['Blenheim CBD geofence'],
      missingFields: [],
      followUpQuestions: [],
    }, 'source text')

    expect(draft?.organizationName).toBe('Marlborough Roads')
    expect(draft?.childZoneNames).toContain('Blenheim CBD Time Restricted Parking')
    expect(draft?.sourceText).toBe('source text')
  })

  it('falls back to standard follow-up questions when none are supplied', () => {
    const questions = buildOrganizationSetupFollowUpQuestions({
      organizationName: 'Marlborough Roads',
      organizationType: 'client',
      organizationLevel: 3,
      parentOrganizationName: '',
      address: '',
      contactEmail: '',
      contactPhone: '',
      isActive: true,
      notes: '',
      childSiteNames: [],
      childZoneNames: [],
      childGeofenceNames: [],
      missingFields: ['address'],
      followUpQuestions: [],
      sourceText: 'source text',
    })

    expect(questions).toContain('What is the exact legal organization name?')
    expect(questions).toContain('What address and contact details should Bob store?')
  })
})