import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

async function createOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: `D3 ${label} ${crypto.randomUUID()}`,
      organization_type: 'client',
      is_active: true,
      overnight_verification_mode: 'two_photo_verification',
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('org')
  return data.id as string
}

async function deleteOrg(id?: string) {
  if (supabaseAdmin && id) await supabaseAdmin.from('organizations').delete().eq('id', id)
}

function asRow<T>(data: unknown): T {
  if (Array.isArray(data)) return (data[0] ?? null) as T
  return data as T
}

interface ActiveContextRow {
  workspace_name: string
  ptt_id: string
  translation_language: string
}

test.describe('Phase D3 — Transition / Handshake / Offline Replay Gate', () => {
  test('get_active_context remains bounded (0..1 rows) for provider context polling', async () => {
    if (!supabaseAdmin) test.skip()
    const providerOrgId = await createOrg('ctx')
    try {
      const { data, error } = await supabaseAdmin!.rpc('get_active_context', {
        officer_lat: -36.8485,
        officer_lng: 174.7633,
        provider_id: providerOrgId,
      })

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      expect((data ?? []).length).toBeLessThanOrEqual(1)

      if ((data ?? []).length === 1) {
        const row = asRow<ActiveContextRow>(data)
        expect(typeof row.workspace_name).toBe('string')
        expect(typeof row.ptt_id).toBe('string')
        expect(typeof row.translation_language).toBe('string')
      }
    } finally {
      await deleteOrg(providerOrgId)
    }
  })

  test('record_offline_replay_event_d3 returns accepted then duplicate for same org/idempotency', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('dup')
    const idempotencyKey = `d3-key-${crypto.randomUUID()}`

    try {
      const first = await supabaseAdmin!.rpc('record_offline_replay_event_d3', {
        p_organization_id: orgId,
        p_idempotency_key: idempotencyKey,
        p_source: 'offline_queue',
      })
      expect(first.error).toBeNull()
      const firstRow = asRow<{
        replay_status: 'accepted' | 'duplicate'
        replay_conflict: boolean
        replay_attempts: number
      }>(first.data)
      expect(firstRow?.replay_status).toBe('accepted')
      expect(firstRow?.replay_conflict).toBe(false)
      expect(firstRow?.replay_attempts).toBe(1)

      const second = await supabaseAdmin!.rpc('record_offline_replay_event_d3', {
        p_organization_id: orgId,
        p_idempotency_key: idempotencyKey,
        p_source: 'offline_queue',
      })
      expect(second.error).toBeNull()
      const secondRow = asRow<{
        replay_status: 'accepted' | 'duplicate'
        replay_conflict: boolean
        replay_attempts: number
      }>(second.data)
      expect(secondRow?.replay_status).toBe('duplicate')
      expect(secondRow?.replay_conflict).toBe(true)
      expect((secondRow?.replay_attempts ?? 0) >= 2).toBe(true)
    } finally {
      await deleteOrg(orgId)
    }
  })

  test('same idempotency key in different orgs is accepted independently', async () => {
    if (!supabaseAdmin) test.skip()
    const orgA = await createOrg('isoA')
    const orgB = await createOrg('isoB')
    const sharedKey = `d3-org-scope-${crypto.randomUUID()}`

    try {
      const firstA = await supabaseAdmin!.rpc('record_offline_replay_event_d3', {
        p_organization_id: orgA,
        p_idempotency_key: sharedKey,
        p_source: 'offline_queue',
      })
      const firstB = await supabaseAdmin!.rpc('record_offline_replay_event_d3', {
        p_organization_id: orgB,
        p_idempotency_key: sharedKey,
        p_source: 'offline_queue',
      })

      expect(firstA.error).toBeNull()
      expect(firstB.error).toBeNull()

      const rowA = asRow<{ replay_status: 'accepted' | 'duplicate'; replay_conflict: boolean }>(firstA.data)
      const rowB = asRow<{ replay_status: 'accepted' | 'duplicate'; replay_conflict: boolean }>(firstB.data)

      expect(rowA?.replay_status).toBe('accepted')
      expect(rowA?.replay_conflict).toBe(false)
      expect(rowB?.replay_status).toBe('accepted')
      expect(rowB?.replay_conflict).toBe(false)
    } finally {
      await deleteOrg(orgA)
      await deleteOrg(orgB)
    }
  })
})
