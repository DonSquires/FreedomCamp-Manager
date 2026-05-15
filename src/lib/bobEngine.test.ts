import { describe, expect, it, vi } from 'vitest'

import {
  buildShortTermHistory,
  fetchLedgerHistoryWithFallback,
  insertLedgerRowWithFallback,
  isMissingOrganizationIdError,
} from './bobEngine'

describe('bobEngine ledger fallback helpers', () => {
  it('detects organization_id schema drift from error messages', () => {
    expect(isMissingOrganizationIdError({ message: 'column "organization_id" does not exist' })).toBe(true)
    expect(isMissingOrganizationIdError({ message: 'some other error' })).toBe(false)
    expect(isMissingOrganizationIdError(null)).toBe(false)
  })

  it('retries ledger history lookup without organization_id when the schema lacks the column', async () => {
    const orderMock = vi.fn()
    const firstLimitMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'column "organization_id" does not exist' },
    })
    const secondLimitMock = vi.fn().mockResolvedValue({
      data: [{ content: 'history row' }],
      error: null,
    })

    const firstBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: orderMock.mockReturnValue({ limit: firstLimitMock }),
    }

    const secondBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue({ limit: secondLimitMock }),
    }

    const fromMock = vi.fn()
      .mockReturnValueOnce(firstBuilder)
      .mockReturnValueOnce(secondBuilder)

    const supabase = { from: fromMock }

    const result = await fetchLedgerHistoryWithFallback(supabase, {
      sessionId: 'session-1',
      userId: 'user-1',
      orgId: 'org-1',
      limit: 6,
    })

    expect(result.error).toBeNull()
    expect(result.data).toEqual([{ content: 'history row' }])
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(firstBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1')
    expect(secondBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1')
  })

  it('retries ledger insert without organization_id when the schema lacks the column', async () => {
    const insertFirst = vi.fn().mockResolvedValue({
      error: { message: 'column "organization_id" does not exist' },
    })
    const insertSecond = vi.fn().mockResolvedValue({ error: null })

    const fromMock = vi.fn()
      .mockReturnValueOnce({ insert: insertFirst })
      .mockReturnValueOnce({ insert: insertSecond })

    const supabase = { from: fromMock }

    const row = {
      session_id: 'session-1',
      user_id: 'user-1',
      operator_id: 'operator-1',
      organization_id: 'org-1',
      record_type: 'short_term' as const,
      content: 'User: hi | Bob: hello',
    }

    const result = await insertLedgerRowWithFallback(supabase, row)

    expect(result.error).toBeNull()
    expect(insertFirst).toHaveBeenCalledWith(row)
    expect(insertSecond).toHaveBeenCalledWith({
      session_id: 'session-1',
      user_id: 'user-1',
      operator_id: 'operator-1',
      record_type: 'short_term',
      content: 'User: hi | Bob: hello',
    })
  })

  it('builds short-term history in chronological order for prompt context', () => {
    expect(buildShortTermHistory([
      { content: 'Newest reply' },
      { content: 'Middle step' },
      { content: 'Oldest prompt' },
    ])).toBe('Oldest prompt\nMiddle step\nNewest reply')
  })
})
