import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildBobLearningContext,
  clearBobLearningMemory,
  learnFromBobExchange,
} from '@/lib/bobLearningMemory'

beforeEach(() => {
  window.localStorage.clear()
})

describe('bobLearningMemory learnFromBobExchange', () => {
  it('returns null for empty userMessage or assistantReply', () => {
    expect(learnFromBobExchange({ userId: 'u1', userMessage: '', assistantReply: 'reply' })).toBeNull()
    expect(learnFromBobExchange({ userId: 'u1', userMessage: 'msg', assistantReply: '' })).toBeNull()
  })

  it('creates a new entry with expected structure', () => {
    const entry = learnFromBobExchange({
      userId: 'user-a',
      route: '/compliance',
      source: 'bob-studio',
      userMessage: 'How do I raise a breach alert?',
      assistantReply: 'Go to breach management and create a new record.',
    })

    expect(entry).not.toBeNull()
    expect(entry?.userId).toBe('user-a')
    expect(entry?.route).toBe('/compliance')
    expect(entry?.tags).toContain('compliance')
    expect(entry?.useCount).toBe(1)
    expect(entry?.topic.length).toBeGreaterThan(0)
  })

  it('increments useCount for duplicate topic+user entry', () => {
    const msg = 'Patrol shift compliance check for officer'
    const reply = 'Patrol shift compliance is managed via the roster planner.'

    learnFromBobExchange({ userId: 'user-b', userMessage: msg, assistantReply: reply })
    const second = learnFromBobExchange({ userId: 'user-b', userMessage: msg, assistantReply: reply })

    expect(second?.useCount).toBe(2)
  })

  it('keeps entries for different users separate', () => {
    learnFromBobExchange({ userId: 'user-c', userMessage: 'How do I run patrol diagnostics?', assistantReply: 'Use the doctor health check.' })
    learnFromBobExchange({ userId: 'user-d', userMessage: 'How do I file a CRM report?', assistantReply: 'Use the CRM module.' })

    const contextC = buildBobLearningContext('user-c')
    const contextD = buildBobLearningContext('user-d')

    expect(contextC).toContain('patrol')
    expect(contextD).toContain('CRM')
    expect(contextC).not.toContain('CRM')
    expect(contextD).not.toContain('patrol')
  })

  it('infers ai tag from ai-related message content', () => {
    const entry = learnFromBobExchange({
      userId: 'user-e',
      userMessage: 'What model does Bob use for inference?',
      assistantReply: 'Bob uses GPT-4 via the AI gateway.',
    })

    expect(entry?.tags).toContain('ai')
  })

  it('infers schema tag from schema-related message content', () => {
    const entry = learnFromBobExchange({
      userId: 'user-f',
      userMessage: 'What tables are in the schema?',
      assistantReply: 'The main tables include observations, user_profiles, and zones.',
    })

    expect(entry?.tags).toContain('schema')
  })
})

describe('bobLearningMemory buildBobLearningContext', () => {
  it('returns empty string when no entries exist for a user', () => {
    expect(buildBobLearningContext('user-unknown')).toBe('')
  })

  it('returns formatted context string with stored entries', () => {
    learnFromBobExchange({
      userId: 'user-ctx',
      userMessage: 'What is the patrol shift compliance procedure?',
      assistantReply: 'Review the patrol shift schedule and compliance dashboard.',
    })

    const context = buildBobLearningContext('user-ctx')

    expect(context).toContain('Long-term memory from prior conversations')
    expect(context).toContain('patrol')
    expect(context).toContain('Prior user intent:')
    expect(context).toContain('Prior Bob outcome:')
  })

  it('respects maxEntries limit', () => {
    for (let i = 0; i < 5; i += 1) {
      learnFromBobExchange({
        userId: 'user-max',
        userMessage: `Unique question number ${i} about compliance enforcement procedures`,
        assistantReply: `Answer number ${i} about how to handle compliance`,
      })
    }

    const context = buildBobLearningContext('user-max', 2)
    const lines = context.split('\n').filter((l) => l.match(/^\d+\./))

    expect(lines.length).toBeLessThanOrEqual(2)
  })
})

describe('bobLearningMemory clearBobLearningMemory', () => {
  it('removes all entries for a specific user', () => {
    learnFromBobExchange({ userId: 'user-clear', userMessage: 'patrol compliance', assistantReply: 'check roster' })
    learnFromBobExchange({ userId: 'user-keep', userMessage: 'patrol compliance', assistantReply: 'check roster' })

    clearBobLearningMemory('user-clear')

    expect(buildBobLearningContext('user-clear')).toBe('')
    expect(buildBobLearningContext('user-keep')).not.toBe('')
  })

  it('clears all entries when no userId is provided', () => {
    learnFromBobExchange({ userId: 'user-all-1', userMessage: 'breach alert', assistantReply: 'create breach record' })
    learnFromBobExchange({ userId: 'user-all-2', userMessage: 'dispatch job', assistantReply: 'assign officer' })

    clearBobLearningMemory()

    expect(buildBobLearningContext('user-all-1')).toBe('')
    expect(buildBobLearningContext('user-all-2')).toBe('')
  })
})
