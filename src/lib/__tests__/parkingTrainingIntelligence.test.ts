import { describe, expect, it } from 'vitest'

import {
  buildParkingTrainingFocus,
  formatParkingTrainingFocusSummary,
  looksLikeParkingTrainingDocument,
} from '@/lib/parkingTrainingIntelligence'

describe('parkingTrainingIntelligence', () => {
  const raw = [
    'Parking Training Manual',
    'The Marlborough District Council are legally warranted to provide enforcement services for the rules that apply throughout Marlborough.',
    'Zone parking restrictions only require signage at the entry and exit points, to stipulate the zone.',
    'Kinross Street car park, Blenheim: Located at the back of the Police Station, adjacent to The Warehouse',
    'Seymour Street car park, Blenheim: Located at the back of Mitsubishi Motors',
    'Wynen Street car park, Blenheim: Located behind Rebel Sports',
    'Alfred Street car park building, Blenheim: Second level parking (undercover).',
    'Blenheim Enforcement area',
    'Blenheim Central Business Area - Kerbside Meters',
    'Time Restricted Parking in CBD',
    'Picton Map',
    '128E Powers of parking wardens',
  ].join('\n')

  it('detects Marlborough parking training documents', () => {
    expect(looksLikeParkingTrainingDocument(raw, 'NZTA Warden training guidelines version 1 codes.docx')).toBe(true)
  })

  it('extracts Blenheim parking focus areas and legal references', () => {
    const focus = buildParkingTrainingFocus(raw)

    expect(focus.includesMapReferences).toBe(true)
    expect(focus.reservedParkingLocations).toContain('Kinross Street car park, Blenheim: Located at the back of the Police Station, adjacent to The Warehouse')
    expect(focus.enforcementAreas).toContain('Blenheim Enforcement area')
    expect(focus.legalReferences.some((item) => item.includes('128E Powers of parking wardens'))).toBe(true)
  })

  it('formats a summary that reflects missing live parking zones', () => {
    const focus = buildParkingTrainingFocus(raw)
    const summary = formatParkingTrainingFocusSummary(focus, {
      organizationName: 'First Security - Blenheim',
      liveParkingZoneCount: 0,
      liveParkingZoneNames: [],
      liveClientSiteCount: 0,
      liveClientSiteNames: [],
    })

    expect(summary).toContain('No active parking_zones are configured yet')
    expect(summary).toContain('When the user provides setup instructions, Bob should draft client sites, linked zones, and geofence blockers')
  })
})