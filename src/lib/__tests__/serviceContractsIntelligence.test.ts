import { describe, expect, it } from 'vitest'
import {
  buildServiceContractMatchContext,
  formatServiceContractPromptSupplement,
  isContentScanCandidatePath,
  isReadableServiceContractPath,
  scoreServiceContractRecord,
} from '@/lib/serviceContractsIntelligence'

describe('serviceContractsIntelligence', () => {
  it('matches blenheim parking contract files from mixed paths', () => {
    const context = buildServiceContractMatchContext([
      { path: 'ops/blenheim/parking/setup-notes.txt', updatedAt: '2026-01-01T00:00:00Z' },
      { path: 'ops/blenheim/parking/final-signed-contract.pdf', updatedAt: '2026-05-10T00:00:00Z' },
      { path: 'ops/nelson/general-contract.pdf', updatedAt: '2024-01-01T00:00:00Z' },
      { path: 'marlborough/zones/geofence-definition.json', updatedAt: '2026-03-01T00:00:00Z' },
    ], [
      {
        path: 'ops/blenheim/parking/setup-notes.txt',
        content: 'Blenheim Enforcement area and Time Restricted Parking in CBD are active.',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        path: 'marlborough/zones/geofence-definition.json',
        content: 'Kinross Street car park, Blenheim, and loading zone controls must be preserved.',
        updatedAt: '2026-03-01T00:00:00Z',
      },
    ])

    expect(context.scannedFileCount).toBe(4)
    expect(context.matchedFileCount).toBe(3)
    expect(context.contentScannedFileCount).toBe(2)
    expect(context.contentMatchedFileCount).toBe(2)
    expect(context.blenheimMatchCount).toBe(2)
    expect(context.parkingMatchCount).toBe(2)
    expect(context.topRankedPaths[0]).toContain('final-signed-contract.pdf')
    expect(context.matchedKeywords).toEqual(expect.arrayContaining(['blenheim', 'parking', 'geofence', 'zone', 'marlborough']))
    expect(context.contentEvidence.join(' ')).toContain('Blenheim Enforcement area')
    expect(context.instructionLines.length).toBeGreaterThan(0)
    expect(context.trainingChecklist.join(' ')).toContain('Officer action:')
  })

  it('formats a useful prompt supplement', () => {
    const context = buildServiceContractMatchContext([
      'blenheim/parking/site-rules.md',
      'marlborough/parking/zone-map.txt',
    ])

    const prompt = formatServiceContractPromptSupplement(context)
    expect(prompt).toContain('service-contracts')
    expect(prompt).toContain('Matched Blenheim/Marlborough parking-related files: 2')
    expect(prompt).toContain('Readable files scanned for content: 0')
    expect(prompt).toContain('blenheim/parking/site-rules.md')
  })

  it('identifies readable contract files by extension', () => {
    expect(isReadableServiceContractPath('blenheim/parking/rules.txt')).toBe(true)
    expect(isReadableServiceContractPath('blenheim/parking/rules.md')).toBe(true)
    expect(isReadableServiceContractPath('blenheim/parking/rules.json')).toBe(true)
    expect(isReadableServiceContractPath('blenheim/parking/rules.pdf')).toBe(false)
    expect(isReadableServiceContractPath('blenheim/parking/rules.docx')).toBe(false)
  })

  it('allows content scanning for pdf/docx contracts', () => {
    expect(isContentScanCandidatePath('blenheim/parking/contract.pdf')).toBe(true)
    expect(isContentScanCandidatePath('blenheim/parking/setup.docx')).toBe(true)
    expect(isContentScanCandidatePath('blenheim/parking/readme.txt')).toBe(true)
    expect(isContentScanCandidatePath('blenheim/parking/image.png')).toBe(false)
  })

  it('scores authoritative recent contracts above weaker sources', () => {
    const finalScore = scoreServiceContractRecord({
      path: 'blenheim/parking/final-signed-contract.pdf',
      updatedAt: '2026-05-10T00:00:00Z',
    })
    const archiveScore = scoreServiceContractRecord({
      path: 'archive/blenheim/parking/old-draft-notes.txt',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    expect(finalScore).toBeGreaterThan(archiveScore)
  })

  it('flags likely conflicts when matched contract sources disagree', () => {
    const context = buildServiceContractMatchContext([
      { path: 'blenheim/parking/final-signed-contract.pdf', updatedAt: '2026-05-10T00:00:00Z' },
      { path: 'blenheim/parking/archive/old-instructions.txt', updatedAt: '2025-01-01T00:00:00Z' },
    ], [
      {
        path: 'blenheim/parking/final-signed-contract.pdf',
        content: [
          'Service scope includes patrol coverage for loading zones and mobility bays.',
          'Officers must inspect the loading zone every 30 minutes and record each visit.',
          'Monthly service fee is NZD 3,000 for full CBD patrol coverage.',
          'This increases current service coverage for after-hours parking checks.',
        ].join('\n'),
        updatedAt: '2026-05-10T00:00:00Z',
      },
      {
        path: 'blenheim/parking/archive/old-instructions.txt',
        content: [
          'Service scope was limited to loading zone patrol only.',
          'Officers must inspect the loading zone hourly and notify admin only if there is a breach.',
          'Monthly service fee is NZD 2,200 for basic patrol support.',
          'Current service remains unchanged under this older schedule.',
        ].join('\n'),
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    expect(context.conflictWarnings.length).toBeGreaterThan(0)
    expect(context.conflictWarnings.join(' ')).toContain('loading zone rules')
    expect(context.comparisonSummary.length).toBe(4)
    expect(context.comparisonSummary.map((item) => item.category)).toEqual(expect.arrayContaining(['service', 'times', 'cost', 'impact']))
    expect(context.comparisonSummary.find((item) => item.category === 'cost')?.primaryEvidence).toContain('NZD 3,000')

    const prompt = formatServiceContractPromptSupplement(context)
    expect(prompt).toContain('Contract conflicts to resolve')
    expect(prompt).toContain('prefer the higher-ranked signed/current contract')
    expect(prompt).toContain('Contract comparison:')
    expect(prompt).toContain('natural conversational language')
  })
})
