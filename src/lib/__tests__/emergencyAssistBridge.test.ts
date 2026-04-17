import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeLatestEmergencyAssistRequest,
  EMERGENCY_ASSIST_REQUEST_EVENT,
  peekEmergencyAssistRequests,
  publishEmergencyAssistRequest,
} from '@/lib/emergencyAssistBridge'

describe('emergencyAssistBridge', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('publishes a request, dispatches the event, and allows consumption in FIFO order', () => {
    const eventSpy = vi.fn()
    window.addEventListener(EMERGENCY_ASSIST_REQUEST_EVENT, eventSpy)

    const first = publishEmergencyAssistRequest({
      source: 'welfare_panic_button',
      organizationId: 'org-1',
      officerId: 'officer-1',
      officerName: 'Taylor',
      locationLabel: '123 Main St',
      latitude: -36.8485,
      longitude: 174.7633,
      reason: 'Welfare panic button activated',
    })

    const second = publishEmergencyAssistRequest({
      source: 'manual',
      organizationId: 'org-1',
      reason: 'Manual escalation',
    })

    expect(eventSpy).toHaveBeenCalledTimes(2)

    const queued = peekEmergencyAssistRequests()
    expect(queued).toHaveLength(2)
    expect(queued[0].id).toBe(second.id)
    expect(queued[1].id).toBe(first.id)

    const consumedFirst = consumeLatestEmergencyAssistRequest()
    const consumedSecond = consumeLatestEmergencyAssistRequest()
    const consumedThird = consumeLatestEmergencyAssistRequest()

    expect(consumedFirst?.id).toBe(second.id)
    expect(consumedSecond?.id).toBe(first.id)
    expect(consumedThird).toBeNull()

    window.removeEventListener(EMERGENCY_ASSIST_REQUEST_EVENT, eventSpy)
  })

  it('caps retained queue entries at 30', () => {
    for (let i = 0; i < 35; i++) {
      publishEmergencyAssistRequest({
        source: 'manual',
        organizationId: `org-${i}`,
        reason: `reason-${i}`,
      })
    }

    const queued = peekEmergencyAssistRequests()
    expect(queued).toHaveLength(30)
    expect(queued[0].reason).toBe('reason-34')
    expect(queued[29].reason).toBe('reason-5')
  })
})
