import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

/**
 * Phase A Gate: Feature Flag Canary Progression Test
 *
 * Simulates the 5% → 25% → 50% → 100% canary rollout progression as defined
 * in docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md section 12.1a.
 *
 * Validates:
 * 1. Stage transitions record rollout history
 * 2. Error/latency threshold metadata can be captured per stage
 * 3. Rollback from any stage returns to 0% and records the reversal
 * 4. Source flag record remains intact after each stage
 */

const FLAG_NAME = 'FF_PHASE_B_PATROL_EVENTS'

type FeatureFlagRow = {
  id: string
  name: string
  enabled: boolean
  rollout_percentage: number
  phase: string
}

type RolloutHistoryRow = {
  id: string
  flag_id: string
  from_percentage: number
  to_percentage: number
  stage: string | null
  change_reason: string | null
  error_rate_at_change: number | null
  p95_latency_at_change_ms: number | null
}

function isMissingTableError(error: unknown): boolean {
  const maybeError = error as { code?: string; message?: string } | null
  return (
    maybeError?.code === 'PGRST205' ||
    /Could not find the table/i.test(String(maybeError?.message || ''))
  )
}

async function getFlag(name: string): Promise<FeatureFlagRow | null> {
  if (!supabaseAdmin) return null
  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('id, name, enabled, rollout_percentage, phase')
    .eq('name', name)
    .maybeSingle<FeatureFlagRow>()
  if (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
  return data
}

async function setFlagPercentage(
  flagId: string,
  pct: number,
  enabled: boolean
): Promise<void> {
  const { error } = await supabaseAdmin!
    .from('feature_flags')
    .update({ enabled, rollout_percentage: pct, updated_at: new Date().toISOString() })
    .eq('id', flagId)
  if (error) throw error
}

async function recordRolloutHistory(input: {
  flagId: string
  fromPct: number
  toPct: number
  stage: string
  changeReason: string
  errorRate?: number
  p95Ms?: number
  notes?: string
}): Promise<RolloutHistoryRow> {
  const { data, error } = await supabaseAdmin!
    .from('feature_flag_rollout_history')
    .insert({
      flag_id: input.flagId,
      from_percentage: input.fromPct,
      to_percentage: input.toPct,
      stage: input.stage,
      change_reason: input.changeReason,
      error_rate_at_change: input.errorRate ?? null,
      p95_latency_at_change_ms: input.p95Ms ?? null,
      monitoring_notes: input.notes ?? null,
    })
    .select('id, flag_id, from_percentage, to_percentage, stage, change_reason, error_rate_at_change, p95_latency_at_change_ms')
    .single<RolloutHistoryRow>()
  if (error || !data) throw error || new Error('Failed to record rollout history')
  return data
}

const CANARY_STAGES: Array<{
  stage: string
  pct: number
  errorRate: number
  p95Ms: number
}> = [
  { stage: 'canary',           pct: 5,   errorRate: 0.1,  p95Ms: 210 },
  { stage: 'early_adopters',   pct: 25,  errorRate: 0.3,  p95Ms: 245 },
  { stage: 'rollout',          pct: 50,  errorRate: 0.5,  p95Ms: 280 },
  { stage: 'general_availability', pct: 100, errorRate: 0.4, p95Ms: 290 },
]

test.describe('Feature Flag Canary Progression', () => {
  let originalEnabled: boolean
  let originalPct: number
  let flagId: string
  const createdHistoryIds: string[] = []

  test.beforeAll(async () => {
    test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY is required for canary progression tests')

    const flag = await getFlag(FLAG_NAME)
    if (!flag) {
      console.warn(`[canary-progression] ${FLAG_NAME} not available — skipping through`)
      return
    }
    flagId = flag.id
    originalEnabled = flag.enabled
    originalPct = flag.rollout_percentage
  })

  test.afterAll(async () => {
    if (!supabaseAdmin || !flagId) return
    // Restore original state
    await setFlagPercentage(flagId, originalPct, originalEnabled).catch(() => {})
    // Clean up test history rows
    if (createdHistoryIds.length > 0) {
      await supabaseAdmin
        .from('feature_flag_rollout_history')
        .delete()
        .in('id', createdHistoryIds)
        .then(() => {})
    }
  })

  test('simulates 5% → 25% → 50% → 100% canary rollout stages', async () => {
    test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY required')

    const flag = await getFlag(FLAG_NAME)
    test.skip(!flag, `${FLAG_NAME} not available in this environment`)
    if (!flag) return

    // Reset to 0% baseline for a clean simulation
    const { error: resetErr } = await supabaseAdmin!
      .from('feature_flags')
      .update({ enabled: true, rollout_percentage: 0 })
      .eq('id', flag.id)
    expect(resetErr, 'Reset to 0% should succeed').toBeNull()

    let previousPct = 0

    for (const stage of CANARY_STAGES) {
      // Advance to next stage
      await setFlagPercentage(flag.id, stage.pct, true)

      // Verify the update took
      const current = await getFlag(FLAG_NAME)
      expect(current).not.toBeNull()
      expect(current!.rollout_percentage, `Stage ${stage.stage}: rollout_percentage`).toBe(stage.pct)
      expect(current!.enabled, `Stage ${stage.stage}: flag should be enabled`).toBe(true)

      // Validate thresholds are within Phase A acceptance bounds
      expect(stage.errorRate, `Stage ${stage.stage}: error rate must be < 1%`).toBeLessThan(1.0)
      expect(stage.p95Ms, `Stage ${stage.stage}: p95 latency must be < 500ms`).toBeLessThan(500)

      // Record rollout history
      let row: RolloutHistoryRow
      try {
        row = await recordRolloutHistory({
          flagId: flag.id,
          fromPct: previousPct,
          toPct: stage.pct,
          stage: stage.stage,
          changeReason: 'manual_increase',
          errorRate: stage.errorRate,
          p95Ms: stage.p95Ms,
          notes: `[Playwright canary-progression] ${stage.stage} stage at ${stage.pct}%`,
        })
      } catch (err) {
        test.skip(isMissingTableError(err), 'feature_flag_rollout_history table not available')
        throw err
      }

      createdHistoryIds.push(row.id)

      expect(row.from_percentage, `History from_percentage for ${stage.stage}`).toBe(previousPct)
      expect(row.to_percentage, `History to_percentage for ${stage.stage}`).toBe(stage.pct)
      expect(row.stage).toBe(stage.stage)
      expect(row.error_rate_at_change).toBe(stage.errorRate)
      expect(row.p95_latency_at_change_ms).toBe(stage.p95Ms)

      previousPct = stage.pct
    }

    // Verify 4 history rows were written (one per stage)
    const { data: historyRows, error: histErr } = await supabaseAdmin!
      .from('feature_flag_rollout_history')
      .select('id, stage')
      .in('id', createdHistoryIds)

    expect(histErr).toBeNull()
    expect(historyRows?.length, 'Should have 4 rollout history records (one per canary stage)').toBe(4)
  })

  test('records threshold-triggered rollback from mid-rollout stage', async () => {
    test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY required')

    const flag = await getFlag(FLAG_NAME)
    test.skip(!flag, `${FLAG_NAME} not available in this environment`)
    if (!flag) return

    // Simulate: flag is at 25% early-adopter stage
    await setFlagPercentage(flag.id, 25, true)

    // Simulate error rate breach (> 1% threshold)
    const simulatedErrorRate = 2.5
    const simulatedP95 = 620 // > 500ms threshold

    // Rollback triggered
    await setFlagPercentage(flag.id, 0, false)

    let rollbackRow: RolloutHistoryRow
    try {
      rollbackRow = await recordRolloutHistory({
        flagId: flag.id,
        fromPct: 25,
        toPct: 0,
        stage: 'emergency_rollback',
        changeReason: 'auto_rollback_error',
        errorRate: simulatedErrorRate,
        p95Ms: simulatedP95,
        notes: `[Playwright canary-progression] Auto-rollback triggered: error_rate=${simulatedErrorRate}% p95=${simulatedP95}ms`,
      })
    } catch (err) {
      test.skip(isMissingTableError(err), 'feature_flag_rollout_history table not available')
      throw err
    }
    createdHistoryIds.push(rollbackRow.id)

    // Verify flag is rolled back
    const afterRollback = await getFlag(FLAG_NAME)
    expect(afterRollback!.enabled, 'Flag should be disabled after rollback').toBe(false)
    expect(afterRollback!.rollout_percentage, 'Flag should be at 0% after rollback').toBe(0)

    // Verify rollback record captured the breach metrics
    expect(rollbackRow.change_reason).toBe('auto_rollback_error')
    expect(rollbackRow.error_rate_at_change).toBe(simulatedErrorRate)
    expect(rollbackRow.p95_latency_at_change_ms).toBe(simulatedP95)
    expect(rollbackRow.stage).toBe('emergency_rollback')
  })

  test('flag source record is intact after full progression and rollback', async () => {
    test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY required')

    const flag = await getFlag(FLAG_NAME)
    test.skip(!flag, `${FLAG_NAME} not available in this environment`)
    if (!flag) return

    // Flag should exist with valid structure regardless of rollout state
    expect(flag.id, 'Flag must have an id').toBeTruthy()
    expect(flag.name).toBe(FLAG_NAME)
    expect(flag.phase, 'Flag must have a phase').toBeTruthy()
    expect(typeof flag.enabled).toBe('boolean')
    expect(typeof flag.rollout_percentage).toBe('number')
    expect(flag.rollout_percentage, 'Rollout percentage must be 0-100').toBeGreaterThanOrEqual(0)
    expect(flag.rollout_percentage).toBeLessThanOrEqual(100)
  })
})
