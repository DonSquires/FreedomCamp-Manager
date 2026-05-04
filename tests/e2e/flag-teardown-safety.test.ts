import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

const FLAG_NAME = 'FF_PHASE_B_PATROL_EVENTS'

type FeatureFlagRow = {
  id: string
  enabled: boolean
  rollout_percentage: number
}

type RolloutHistoryRow = {
  id: string
  flag_id: string
  from_percentage: number
  to_percentage: number
  stage: string | null
  change_reason: string | null
}

function isMissingTableError(error: unknown): boolean {
  const maybeError = error as { code?: string; message?: string } | null
  return maybeError?.code === 'PGRST205' || /Could not find the table/i.test(String(maybeError?.message || ''))
}

async function getFeatureFlag(name: string): Promise<FeatureFlagRow | null> {
  if (!supabaseAdmin) return null

  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('id, enabled, rollout_percentage')
    .eq('name', name)
    .maybeSingle<FeatureFlagRow>()

  if (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
  return data
}

async function createRolloutHistoryEntry(input: {
  flagId: string
  fromPercentage: number
  toPercentage: number
  stage: string
  changeReason: string
  monitoringNotes: string
}): Promise<RolloutHistoryRow> {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for feature flag rollback safety tests')
  }

  const { data, error } = await supabaseAdmin
    .from('feature_flag_rollout_history')
    .insert({
      flag_id: input.flagId,
      from_percentage: input.fromPercentage,
      to_percentage: input.toPercentage,
      stage: input.stage,
      change_reason: input.changeReason,
      monitoring_notes: input.monitoringNotes,
    })
    .select('id, flag_id, from_percentage, to_percentage, stage, change_reason')
    .single<RolloutHistoryRow>()

  if (error || !data) {
    throw error || new Error('Failed to create rollout history entry')
  }

  return data
}

test.describe('Feature Flag Teardown Safety', () => {
  test('preserves source records when a flag is disabled mid-workflow', async () => {
    test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY is required for rollback safety validation')

    const originalFlag = await getFeatureFlag(FLAG_NAME)
    test.skip(!originalFlag, `Feature flag ${FLAG_NAME} is not available in this environment`)
    if (!originalFlag) return
    const flag = originalFlag

    const createdHistoryIds: string[] = []

    try {
      let sourceRecord: RolloutHistoryRow
      try {
        sourceRecord = await createRolloutHistoryEntry({
          flagId: flag.id,
          fromPercentage: flag.rollout_percentage,
          toPercentage: flag.rollout_percentage,
          stage: 'canary',
          changeReason: 'manual_increase',
          monitoringNotes: '[Playwright] Source record before rollback safety validation',
        })
      } catch (error) {
        test.skip(isMissingTableError(error), 'feature_flag_rollout_history table is not available in this environment')
        throw error
      }

      createdHistoryIds.push(sourceRecord.id)

      const { error: disableError } = await supabaseAdmin!
        .from('feature_flags')
        .update({ enabled: false, rollout_percentage: 0 })
        .eq('id', flag.id)

      expect(disableError, 'Feature flag should disable successfully').toBeNull()

      const rollbackRecord = await createRolloutHistoryEntry({
        flagId: flag.id,
        fromPercentage: sourceRecord.to_percentage,
        toPercentage: 0,
        stage: 'emergency_rollback',
        changeReason: 'manual_rollback',
        monitoringNotes: '[Playwright] Mid-workflow rollback safety validation',
      })
      createdHistoryIds.push(rollbackRecord.id)

      const { data: sourceAfterRollback, error: sourceReloadError } = await supabaseAdmin!
        .from('feature_flag_rollout_history')
        .select('id, flag_id, from_percentage, to_percentage, stage, change_reason')
        .eq('id', sourceRecord.id)
        .maybeSingle<RolloutHistoryRow>()

      expect(sourceReloadError, 'Source record should still be queryable after rollback').toBeNull()
      expect(sourceAfterRollback).not.toBeNull()
      expect(sourceAfterRollback?.flag_id).toBe(flag.id)
      expect(sourceAfterRollback?.from_percentage).toBe(flag.rollout_percentage)
      expect(sourceAfterRollback?.to_percentage).toBe(flag.rollout_percentage)

      const { data: rollbackAfterInsert, error: rollbackReloadError } = await supabaseAdmin!
        .from('feature_flag_rollout_history')
        .select('id, stage, change_reason, to_percentage')
        .eq('id', rollbackRecord.id)
        .maybeSingle<{ id: string; stage: string | null; change_reason: string | null; to_percentage: number }>()

      expect(rollbackReloadError, 'Rollback record should be persisted').toBeNull()
      expect(rollbackAfterInsert?.stage).toBe('emergency_rollback')
      expect(rollbackAfterInsert?.change_reason).toBe('manual_rollback')
      expect(rollbackAfterInsert?.to_percentage).toBe(0)
    } finally {
      await supabaseAdmin!
        .from('feature_flags')
        .update({
          enabled: flag.enabled,
          rollout_percentage: flag.rollout_percentage,
        })
        .eq('id', flag.id)

      if (createdHistoryIds.length > 0) {
        await supabaseAdmin!
          .from('feature_flag_rollout_history')
          .delete()
          .in('id', createdHistoryIds)
      }
    }
  })
})