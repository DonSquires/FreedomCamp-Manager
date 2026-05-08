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

  if (error || !data) throw error ?? new Error('org create failed')
  return data.id as string
}

async function createZone(orgId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('zones')
    .insert({
      name: `D3 Zone ${crypto.randomUUID()}`,
      organization_id: orgId,
      is_active: true,
      zone_type: 'freedom_camping',
    })
    .select('id')
    .single()

  if (error || !data) throw error ?? new Error('zone create failed')
  return data.id as string
}

async function createObservationWithIdempotency(orgId: string, zoneId: string, idempotencyKey: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('observations')
    .insert({
      organization_id: orgId,
      zone_id: zoneId,
      plate_number: `D3${Date.now().toString().slice(-6)}`,
      recorded_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      photo_url: 'https://example.com/d3-photo.jpg',
    })
    .select('id, observation_id')
    .single()

  if (error || !data) throw error ?? new Error('observation create failed')
  return data as { id: string; observation_id: string }
}

test.describe('Phase D3 — Transition / Handshake / Offline replay hardening', () => {
  test('resolve_hybrid_workspace_handshake is callable and returns bounded structure', async () => {
    if (!supabaseAdmin) test.skip()

    const orgId = await createOrg('handshake')
    try {
      const { data, error } = await supabaseAdmin!.rpc('resolve_hybrid_workspace_handshake', {
        p_provider_org_id: orgId,
        p_longitude: 174.7633,
        p_latitude: -36.8485,
        p_preferred_client_org_id: null,
        p_user_id: null,
        p_default_translation_lang: 'mi-NZ',
      })

      expect(error).toBeNull()
      expect(data).toBeTruthy()
      expect(typeof data?.matched).toBe('boolean')
      expect(typeof data?.handshake_active).toBe('boolean')
    } finally {
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('get_active_context is callable and bounded for transition polling', async () => {
    if (!supabaseAdmin) test.skip()

    const orgId = await createOrg('active-context')
    try {
      const { data, error } = await supabaseAdmin!.rpc('get_active_context', {
        officer_lat: -36.8485,
        officer_lng: 174.7633,
        provider_id: orgId,
      })

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    } finally {
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('record_offline_replay_event_d3 returns accepted when no duplicate exists', async () => {
    if (!supabaseAdmin) test.skip()

    const orgId = await createOrg('accepted')
    try {
      const idempotencyKey = `d3-replay-accepted-${crypto.randomUUID()}`
      const { data, error } = await supabaseAdmin!.rpc('record_offline_replay_event_d3', {
        p_organization_id: orgId,
        p_idempotency_key: idempotencyKey,
        p_source: 'phase-d3-gate',
      })

      expect(error).toBeNull()
      expect(data?.replay_status).toBe('accepted')
      expect(data?.replay_conflict).toBe(false)
      expect(typeof data?.replay_event_id).toBe('string')
    } finally {
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('record_offline_replay_event_d3 returns duplicate when idempotency key already exists', async () => {
    if (!supabaseAdmin) test.skip()

    const orgId = await createOrg('duplicate')
    let zoneId: string | null = null
    try {
      zoneId = await createZone(orgId)
      const idempotencyKey = `d3-replay-duplicate-${crypto.randomUUID()}`
      const existing = await createObservationWithIdempotency(orgId, zoneId, idempotencyKey)

      const { data, error } = await supabaseAdmin!.rpc('record_offline_replay_event_d3', {
        p_organization_id: orgId,
        p_idempotency_key: idempotencyKey,
        p_source: 'phase-d3-gate',
      })

      expect(error).toBeNull()
      expect(data?.replay_status).toBe('duplicate')
      expect(data?.replay_conflict).toBe(true)
      expect(data?.observation_id).toBe(existing.observation_id ?? existing.id)
    } finally {
      if (zoneId) {
        await supabaseAdmin!.from('zones').delete().eq('id', zoneId)
      }
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })
})
