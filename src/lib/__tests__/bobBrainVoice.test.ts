import { describe, expect, it } from 'vitest'

import {
  buildBobUserMemoryNote,
  extractBobVoiceStateFromAssistant,
} from '@/lib/bob-brain'

describe('extractBobVoiceStateFromAssistant', () => {
  it('returns null for unrelated assistant text', () => {
    expect(extractBobVoiceStateFromAssistant('The patrol report has been sent to your email.')).toBeNull()
    expect(extractBobVoiceStateFromAssistant('')).toBeNull()
  })

  it('detects smoke assessment open phrase', () => {
    const result = extractBobVoiceStateFromAssistant("I've opened the assessment for you.")
    expect(result).not.toBeNull()
    expect(result?.target).toBe('smoke_assessment')
    expect(result?.source).toBe('assistant')
    expect(result?.phrase).toContain("opened the assessment for you")
  })

  it('detects smoke assessment from alternative phrasing', () => {
    const result = extractBobVoiceStateFromAssistant("I'll open the smoke assessment now.")
    expect(result).not.toBeNull()
    expect(result?.target).toBe('smoke_assessment')
  })

  it('detects ALPR scanner open phrase', () => {
    const result = extractBobVoiceStateFromAssistant("I've opened the scanner for you.")
    expect(result).not.toBeNull()
    expect(result?.target).toBe('alpr_scanner')
    expect(result?.source).toBe('assistant')
  })

  it('detects ALPR scanner from alternative phrasing', () => {
    const result = extractBobVoiceStateFromAssistant("Let me open the ALPR scanner.")
    expect(result).not.toBeNull()
    expect(result?.target).toBe('alpr_scanner')
  })

  it('populates at as a recent ISO timestamp', () => {
    const before = Date.now()
    const result = extractBobVoiceStateFromAssistant("I've opened the scanner for you.")
    const after = Date.now()

    expect(result).not.toBeNull()
    const ts = Date.parse(result!.at)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

describe('buildBobUserMemoryNote', () => {
  it('returns empty string for empty rows', () => {
    expect(buildBobUserMemoryNote([])).toBe('')
  })

  it('formats preferred_site rows', () => {
    const note = buildBobUserMemoryNote([
      { user_id: 'u1', context_key: 'preferred_site_1', context_value: 'Nelson Civic House', last_interaction: '' },
      { user_id: 'u1', context_key: 'preferred_site_2', context_value: 'Richmond Mall', last_interaction: '' },
    ])

    expect(note).toContain('Preferred sites:')
    expect(note).toContain('Nelson Civic House')
    expect(note).toContain('Richmond Mall')
  })

  it('formats common_phrase rows', () => {
    const note = buildBobUserMemoryNote([
      { user_id: 'u1', context_key: 'common_phrase_1', context_value: 'raise a breach alert', last_interaction: '' },
    ])

    expect(note).toContain('Common phrases:')
    expect(note).toContain('raise a breach alert')
  })

  it('formats past_shift_type rows', () => {
    const note = buildBobUserMemoryNote([
      { user_id: 'u1', context_key: 'past_shift_type_1', context_value: 'Night patrol', last_interaction: '' },
    ])

    expect(note).toContain('Past shift types:')
    expect(note).toContain('Night patrol')
  })

  it('combines all section types separated by pipe', () => {
    const note = buildBobUserMemoryNote([
      { user_id: 'u1', context_key: 'preferred_site_1', context_value: 'Site A', last_interaction: '' },
      { user_id: 'u1', context_key: 'common_phrase_1', context_value: 'log observation', last_interaction: '' },
      { user_id: 'u1', context_key: 'past_shift_type_1', context_value: 'Day shift', last_interaction: '' },
    ])

    expect(note).toContain(' | ')
    expect(note).toContain('Preferred sites:')
    expect(note).toContain('Common phrases:')
    expect(note).toContain('Past shift types:')
  })

  it('limits preferred_site output to 5 entries', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      user_id: 'u1',
      context_key: `preferred_site_${i + 1}`,
      context_value: `Site ${i + 1}`,
      last_interaction: '',
    }))

    const note = buildBobUserMemoryNote(rows)
    const siteCount = (note.match(/Site \d+/g) ?? []).length
    expect(siteCount).toBeLessThanOrEqual(5)
  })

  it('ignores unrecognised context_key prefixes', () => {
    const note = buildBobUserMemoryNote([
      { user_id: 'u1', context_key: 'unknown_key_xyz', context_value: 'some value', last_interaction: '' },
    ])

    expect(note).toBe('')
  })
})
