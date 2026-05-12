import { describe, expect, it } from 'vitest'
import { containsWakeWord, getCoworkerChannelVolume, normalizeSpeechText } from '@/lib/radio/phase2AudioLogic'

describe('phase2AudioLogic', () => {
  it('normalizes punctuation and casing', () => {
    expect(normalizeSpeechText('  Hey, BOB!!  ')).toBe('hey bob')
  })

  it('detects wake word in transcript', () => {
    expect(containsWakeWord('Can you help me, hey bob')).toBe(true)
    expect(containsWakeWord('HEY BOB translate this now')).toBe(true)
    expect(containsWakeWord('hello team')).toBe(false)
  })

  it('returns ducked coworker volume when Bob intercom is speaking', () => {
    expect(getCoworkerChannelVolume(true, true)).toBe(0.2)
    expect(getCoworkerChannelVolume(false, true)).toBe(1)
    expect(getCoworkerChannelVolume(true, false)).toBe(1)
  })
})
