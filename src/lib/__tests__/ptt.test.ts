import { describe, expect, it } from 'vitest'
import { extractPTTRetryAfterSeconds, normalizePTTErrorMessage } from '@/lib/ptt'

describe('ptt error normalization', () => {
  it('extracts retryAfter seconds from edge-function wrapped error payloads', () => {
    const error = new Error('[Code: 502] PTT server error: {"error":"Token mint rate limited","message":"Retry shortly.","retryAfter":2}')
    expect(extractPTTRetryAfterSeconds(error)).toBe(2)
  })

  it('maps token mint throttling to a user-friendly message', () => {
    const error = new Error('[Code: 429] {"error":"Token mint rate limited","retryAfter":3}')
    expect(normalizePTTErrorMessage(error)).toContain('Please retry in 3s')
  })
})
