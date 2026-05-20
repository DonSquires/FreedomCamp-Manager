import { describe, expect, it } from 'vitest'
import {
  shouldEnableRosterPlannerClientScopedQueries,
  shouldEnableRosterPlannerQueries,
} from './rosterPlannerQueryGuards'

describe('rosterPlannerQueryGuards', () => {
  it('enables planner queries only on planner tab with an organization', () => {
    expect(shouldEnableRosterPlannerQueries('planner', true)).toBe(true)
    expect(shouldEnableRosterPlannerQueries('users', true)).toBe(false)
    expect(shouldEnableRosterPlannerQueries('planner', false)).toBe(false)
  })

  it('enables client-scoped queries only when planner queries are enabled and org IDs finished loading', () => {
    expect(shouldEnableRosterPlannerClientScopedQueries('planner', true, false)).toBe(true)
    expect(shouldEnableRosterPlannerClientScopedQueries('planner', true, true)).toBe(false)
    expect(shouldEnableRosterPlannerClientScopedQueries('users', true, false)).toBe(false)
  })
})
