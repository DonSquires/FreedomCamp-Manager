import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearBobCollaborationPackets,
  consumeBobResponse,
  consumeLatestBobCollaborationPacket,
  peekBobCollaborationPackets,
  peekBobResponses,
  publishBobCollaborationPacket,
  publishBobResponse,
} from '@/lib/bobCollaboration'

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('bobCollaboration response queue', () => {
  it('publishes and consumes a response by requestId', () => {
    publishBobResponse('req-1', 'Bob replied here', 'short summary')
    const response = consumeBobResponse('req-1')

    expect(response).not.toBeNull()
    expect(response?.requestId).toBe('req-1')
    expect(response?.responseText).toBe('Bob replied here')
    expect(response?.summary).toBe('short summary')
  })

  it('auto-generates summary from responseText when not provided', () => {
    const text = 'Auto summary should come from the first 140 chars of this response'
    publishBobResponse('req-auto', text)
    const response = consumeBobResponse('req-auto')

    expect(response?.summary).toBe(text.slice(0, 140))
  })

  it('returns null when no matching requestId is in the queue', () => {
    expect(consumeBobResponse('no-such-id')).toBeNull()
  })

  it('removes consumed response from the queue', () => {
    publishBobResponse('req-remove', 'some reply')
    consumeBobResponse('req-remove')

    expect(consumeBobResponse('req-remove')).toBeNull()
  })

  it('peekBobResponses returns all responses without removing them', () => {
    publishBobResponse('req-a', 'reply a')
    publishBobResponse('req-b', 'reply b')

    const first = peekBobResponses()
    const second = peekBobResponses()

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
  })

  it('queues multiple responses and each is independently consumable', () => {
    publishBobResponse('req-x', 'response x')
    publishBobResponse('req-y', 'response y')

    const x = consumeBobResponse('req-x')
    const y = consumeBobResponse('req-y')

    expect(x?.responseText).toBe('response x')
    expect(y?.responseText).toBe('response y')
  })
})

describe('bobCollaboration packet queue', () => {
  it('publishes a collaboration packet and returns it with generated id and timestamp', () => {
    const packet = publishBobCollaborationPacket({
      source: 'dispatch',
      title: 'Check patrol status',
      prompt: 'What is the current patrol status for zone 4?',
    })

    expect(packet.id).toBeTruthy()
    expect(packet.createdAt).toBeTruthy()
    expect(packet.source).toBe('dispatch')
    expect(packet.title).toBe('Check patrol status')
    expect(packet.prompt).toBe('What is the current patrol status for zone 4?')
  })

  it('peekBobCollaborationPackets returns packets without removing them', () => {
    publishBobCollaborationPacket({ source: 'system', title: 'T1', prompt: 'P1' })
    publishBobCollaborationPacket({ source: 'copilot', title: 'T2', prompt: 'P2' })

    const firstPeek = peekBobCollaborationPackets()
    const secondPeek = peekBobCollaborationPackets()

    expect(firstPeek).toHaveLength(2)
    expect(secondPeek).toHaveLength(2)
  })

  it('consumeLatestBobCollaborationPacket removes and returns the most recent packet', () => {
    publishBobCollaborationPacket({ source: 'feedback-ai', title: 'Old', prompt: 'Old prompt' })
    const newer = publishBobCollaborationPacket({ source: 'officer-portal', title: 'New', prompt: 'New prompt' })

    const consumed = consumeLatestBobCollaborationPacket()

    expect(consumed?.id).toBe(newer.id)
    expect(peekBobCollaborationPackets()).toHaveLength(1)
  })

  it('returns null when collaboration queue is empty', () => {
    expect(consumeLatestBobCollaborationPacket()).toBeNull()
  })

  it('clearBobCollaborationPackets empties the queue', () => {
    publishBobCollaborationPacket({ source: 'system', title: 'T', prompt: 'P' })
    clearBobCollaborationPackets()

    expect(peekBobCollaborationPackets()).toHaveLength(0)
  })

  it('filters out expired packets when peeking', () => {
    const past = new Date(Date.now() - 5000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()

    publishBobCollaborationPacket({ source: 'system', title: 'Expired', prompt: 'gone', expiresAt: past })
    publishBobCollaborationPacket({ source: 'system', title: 'Valid', prompt: 'here', expiresAt: future })

    const packets = peekBobCollaborationPackets()

    expect(packets).toHaveLength(1)
    expect(packets[0].title).toBe('Valid')
  })
})
