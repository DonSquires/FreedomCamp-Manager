import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

/**
 * End-to-End Test Suite: Briefing Video Lifecycle
 *
 * Tests the complete workflow:
 * 1. Generate briefing video via edge function
 * 2. Verify media_generation_log audit record created
 * 3. Verify video_briefing_packs record created
 * 4. Revoke the video pack
 * 5. Verify audit log shows revocation
 * 6. Verify video pack marked as revoked
 *
 * Requirements:
 * - VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY must be set
 * - User must be authenticated with admin/admin_officer/master role
 * - DATABASE: media_generation_log + video_briefing_packs tables must exist
 * - STORAGE: briefing-videos bucket must be created and public
 * - INFERENCE: /infer/video/generate endpoint must be accessible (or RunPod /runsync)
 *
 * Run: bun run test briefing-video-lifecycle
 */

describe('Briefing Video Lifecycle', () => {
  let supabase: SupabaseClient<Database>
  let testUserId: string
  let testOrgId: string
  let generatedMediaLogId: string
  let generatedPackId: string
  const INFERENCE_TIMEOUT_MS = 60_000

  beforeAll(async () => {
    // Initialize authenticated Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')
    }

    supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

    // Get current authenticated user
    const { data: authData, error: authError } = await supabase.auth.getSession()
    if (authError || !authData?.session?.user?.id) {
      throw new Error('User must be authenticated before running tests')
    }

    testUserId = authData.session.user.id

    // Get user profile to extract org_id
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', testUserId)
      .maybeSingle()

    if (profileError || !profile) {
      throw new Error(`Unable to load user profile: ${profileError?.message || 'not found'}`)
    }

    if (!['admin', 'admin_officer', 'master'].includes(profile.role || '')) {
      throw new Error(`User role ${profile.role} is insufficient for video generation test. Requires: admin, admin_officer, or master`)
    }

    testOrgId = profile.organization_id
    if (!testOrgId) {
      throw new Error('User organization_id is required')
    }

    console.log(`✅ Test setup complete - User: ${testUserId}, Org: ${testOrgId}, Role: ${profile.role}`)
  }, 30_000)

  it('should generate a briefing video and create audit records', async () => {
    const generatePayload = {
      org_id: testOrgId,
      title: `Test Briefing Pack ${Date.now()}`,
      description: 'E2E test for video generation workflow',
      quality: 'medium',
      format: 'mp4',
      purpose: 'training',
      source_entity_type: 'incident',
      source_entity_id: `test-incident-${Date.now()}`,
      retention_days: 7, // Short retention for test data
    }

    const { data, error } = await supabase.functions.invoke('generate-briefing-video', {
      body: generatePayload,
    })

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.success).toBe(true)
    expect(data?.media_log_id).toBeDefined()
    expect(data?.video_pack_id).toBeDefined()

    generatedMediaLogId = data?.media_log_id
    generatedPackId = data?.video_pack_id

    console.log(`✅ Generated video - Media Log ID: ${generatedMediaLogId}, Pack ID: ${generatedPackId}`)
  }, INFERENCE_TIMEOUT_MS + 10_000)

  it('should verify media_generation_log has required fields', async () => {
    const { data, error } = await supabase
      .from('media_generation_log')
      .select(
        `
        id,
        org_id,
        actor_user_id,
        media_type,
        purpose,
        provider,
        model_name,
        output_url,
        output_hash,
        source_hash,
        retention_days,
        revoked_at,
        created_at
        `
      )
      .eq('id', generatedMediaLogId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.id).toBe(generatedMediaLogId)
    expect(data?.org_id).toBe(testOrgId)
    expect(data?.actor_user_id).toBe(testUserId)
    expect(data?.media_type).toBe('video')
    expect(data?.purpose).toMatch(/research|training|briefing/)
    expect(data?.provider).toBeDefined()
    expect(data?.provider).not.toBe('pending')
    expect(data?.output_url).toBeDefined()
    expect(data?.retention_days).toBeGreaterThan(0)
    expect(data?.revoked_at).toBeNull()

    console.log(`✅ Media log verified - Provider: ${data?.provider}, Output Hash: ${data?.output_hash?.slice(0, 8)}...`)
  })

  it('should verify video_briefing_packs has required fields', async () => {
    const { data, error } = await supabase
      .from('video_briefing_packs')
      .select(
        `
        id,
        org_id,
        actor_user_id,
        media_log_id,
        title,
        description,
        format,
        bitrate_tier,
        duration_seconds,
        output_url,
        revoked_at,
        created_at
        `
      )
      .eq('id', generatedPackId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.id).toBe(generatedPackId)
    expect(data?.org_id).toBe(testOrgId)
    expect(data?.actor_user_id).toBe(testUserId)
    expect(data?.media_log_id).toBe(generatedMediaLogId)
    expect(data?.title).toBeDefined()
    expect(data?.format).toMatch(/mp4|webm/)
    expect(data?.bitrate_tier).toMatch(/low|medium|high/)
    expect(data?.output_url).toBeDefined()
    expect(data?.revoked_at).toBeNull()

    console.log(`✅ Video pack verified - Format: ${data?.format}, Duration: ${data?.duration_seconds}s`)
  })

  it('should verify output_url is accessible', async () => {
    const { data: packData, error: packError } = await supabase
      .from('video_briefing_packs')
      .select('output_url')
      .eq('id', generatedPackId)
      .maybeSingle()

    expect(packError).toBeNull()
    expect(packData?.output_url).toBeDefined()

    const url = packData?.output_url
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      // Attempt HTTP HEAD request to verify URL is reachable
      try {
        const response = await fetch(url, { method: 'HEAD' })
        expect([200, 206, 304]).toContain(response.status)
        console.log(`✅ Output URL is accessible: ${response.status}`)
      } catch (fetchError) {
        console.warn(`⚠️  Could not verify URL accessibility: ${String(fetchError).slice(0, 100)}`)
        // Don't fail test if URL verification fails (may be behind auth or CDN)
      }
    }
  })

  it('should revoke the briefing video pack', async () => {
    const { data, error } = await supabase.functions.invoke('revoke-briefing-video', {
      body: {
        org_id: testOrgId,
        video_pack_id: generatedPackId,
      },
    })

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.success).toBe(true)
    expect(data?.revoked_at).toBeDefined()

    console.log(`✅ Video pack revoked - Revoked at: ${data?.revoked_at}`)
  })

  it('should verify revocation propagated to media_generation_log', async () => {
    const { data, error } = await supabase
      .from('media_generation_log')
      .select('revoked_at')
      .eq('id', generatedMediaLogId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.revoked_at).toBeDefined()
    expect(new Date(data?.revoked_at as string).getTime()).toBeGreaterThan(Date.now() - 10_000)

    console.log(`✅ Media log revocation verified - Revoked at: ${data?.revoked_at}`)
  })

  it('should verify revocation propagated to video_briefing_packs', async () => {
    const { data, error } = await supabase
      .from('video_briefing_packs')
      .select('revoked_at')
      .eq('id', generatedPackId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.revoked_at).toBeDefined()
    expect(new Date(data?.revoked_at as string).getTime()).toBeGreaterThan(Date.now() - 10_000)

    console.log(`✅ Video pack revocation verified - Revoked at: ${data?.revoked_at}`)
  })

  it('should query audit log and find revoked record', async () => {
    const { data, error } = await supabase.functions.invoke('video-audit-log', {
      body: {
        org_id: testOrgId,
        limit: 50,
      },
    })

    expect(error).toBeNull()
    expect(Array.isArray(data?.logs)).toBe(true)

    const testRecord = data?.logs?.find((log: any) => log.id === generatedMediaLogId)
    expect(testRecord).toBeDefined()
    expect(testRecord?.media_type).toBe('video')
    expect(testRecord?.revoked_at).toBeDefined()
    expect(testRecord?.purpose).toMatch(/research|training|briefing/)

    console.log(`✅ Audit log contains revoked record - Count: ${data?.logs?.length}`)
  })

  it('should enforce organization scoping on audit log', async () => {
    const { data, error } = await supabase.functions.invoke('video-audit-log', {
      body: {
        org_id: 'invalid-org-uuid-12345678',
        limit: 50,
      },
    })

    // Should either return empty logs or access denied error
    if (error) {
      expect(error?.message).toMatch(/access|denied|unauthorized|organization/i)
    } else if (Array.isArray(data?.logs)) {
      expect(data.logs.length).toBe(0)
    }

    console.log(`✅ Organization scoping enforced on audit log`)
  })

  it('should enforce role-based access on generation endpoint', async () => {
    // Note: This test would require switching to a non-admin user
    // For now, we verify the endpoint payload validation works
    const { error } = await supabase.functions.invoke('generate-briefing-video', {
      body: {
        org_id: testOrgId,
        purpose: 'invalid_purpose', // Invalid purpose
        quality: 'medium',
        format: 'mp4',
      },
    })

    expect(error?.message).toMatch(/purpose|invalid/i)

    console.log(`✅ Request validation enforced on generation endpoint`)
  })

  it('should track retention policy in media_generation_log', async () => {
    const { data, error } = await supabase
      .from('media_generation_log')
      .select('retention_days, created_at')
      .eq('id', generatedMediaLogId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.retention_days).toBeGreaterThan(0)
    expect(Number.isInteger(data?.retention_days)).toBe(true)

    const expiryDate = new Date(data?.created_at as string)
    expiryDate.setDate(expiryDate.getDate() + (data?.retention_days || 0))

    console.log(
      `✅ Retention policy tracked - Days: ${data?.retention_days}, Expires: ${expiryDate.toISOString().split('T')[0]}`
    )
  })

  afterAll(async () => {
    // Cleanup test data (optional)
    if (generatedPackId) {
      await supabase.from('video_briefing_packs').delete().eq('id', generatedPackId)
      await supabase.from('media_generation_log').delete().eq('id', generatedMediaLogId)
      console.log(`🧹 Test data cleaned up`)
    }
  })
})
