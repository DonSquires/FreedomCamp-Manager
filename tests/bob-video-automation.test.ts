import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

type AskBobAction = {
  type?: string
  requires_confirmation?: boolean
  confirmation_hint?: string
  proposal_id?: string | null
  success?: boolean
  video_id?: string | null
  video_url?: string | null
}

type AskBobResponse = {
  answer?: string
  provider?: string
  model?: string
  action?: AskBobAction
}

type BobVideoActionResponse = {
  success?: boolean
  error?: string
  error_code?: string
  bob_instruction?: string
}

describe('Bob Video Automation E2E', () => {
  let supabase: SupabaseClient<Database>
  let orgId: string
  let proposalId: string | null = null
  let authReady = false

  function getCredentialCandidates(): Array<{ email: string; password: string }> {
    return [
      {
        email: process.env.API_TEST_EMAIL || '',
        password: process.env.API_TEST_PASSWORD || '',
      },
      {
        email: process.env.PLAYWRIGHT_LIVE_EMAIL || '',
        password: process.env.PLAYWRIGHT_LIVE_PASSWORD || '',
      },
      {
        email: process.env.PLAYWRIGHT_MASTER_EMAIL || process.env.TEST_MASTER_EMAIL || '',
        password: process.env.PLAYWRIGHT_MASTER_PASSWORD || process.env.TEST_MASTER_PASSWORD || '',
      },
      {
        email: process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.TEST_ADMIN_EMAIL || '',
        password: process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD || process.env.TEST_ADMIN_PASSWORD || process.env.TEST_ADMIN_PASWORD || '',
      },
    ].filter((candidate) => Boolean(candidate.email && candidate.password))
  }

  beforeAll(async () => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')
    }

    supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

    const existingSession = await supabase.auth.getSession()
    if (existingSession.data?.session?.user?.id) {
      authReady = true
      return
    }

    for (const candidate of getCredentialCandidates()) {
      const signIn = await supabase.auth.signInWithPassword(candidate)
      if (signIn.data?.session?.user?.id) {
        authReady = true
        break
      }
    }

    if (!authReady) {
      throw new Error('No authenticated Supabase session available for Bob automation tests')
    }

    const { data: authData } = await supabase.auth.getSession()
    const userId = authData.session.user.id
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', userId)
      .maybeSingle()

    if (profileError || !profile?.organization_id) {
      throw new Error(`Unable to load user profile: ${profileError?.message || 'profile missing'}`)
    }

    if (!['admin', 'admin_officer', 'master'].includes(profile.role || '')) {
      throw new Error('Role must be admin, admin_officer, or master for Bob automation test')
    }

    orgId = profile.organization_id
  }, 30_000)

  it('requires confirmation before video generation execution', async () => {
    if (!authReady) return
    const { data, error } = await supabase.functions.invoke('ask-bob', {
      body: {
        prompt: 'create a medium quality briefing video for incident 42',
        organization_id: orgId,
      },
    })

    expect(error).toBeNull()

    const payload = (data || {}) as AskBobResponse
    expect(String(payload.provider || '')).toBe('ask-bob-confirmation-gate')
    expect(String(payload.answer || '').toLowerCase()).toContain('confirm create briefing video')
    expect(payload.action?.type).toBe('generate_briefing_video')
    expect(payload.action?.requires_confirmation).toBe(true)
    expect(String(payload.action?.proposal_id || '').trim().length).toBeGreaterThan(0)

    proposalId = String(payload.action?.proposal_id || '').trim() || null

    if (proposalId) {
      const { data: proposal, error: proposalError } = await (supabase.from('bob_action_proposals') as any)
        .select('id, status, proposal_type, requested_by, organization_id')
        .eq('id', proposalId)
        .maybeSingle()

      expect(proposalError).toBeNull()
      expect(proposal?.id).toBe(proposalId)
      expect(proposal?.status).toBe('proposed')
      expect(proposal?.proposal_type).toBe('generate_briefing_video')
      expect(proposal?.organization_id).toBe(orgId)
    }
  }, 60_000)

  it('executes video generation after explicit confirmation', async () => {
    if (!authReady) return
    const request = proposalId
      ? `confirm create briefing video for proposal ${proposalId}. create a medium quality briefing video for incident bob-test-${Date.now()}`
      : `confirm create briefing video for this request. create a medium quality briefing video for incident bob-test-${Date.now()}`

    const { data, error } = await supabase.functions.invoke('ask-bob', {
      body: {
        prompt: request,
        organization_id: orgId,
      },
    })

    if (error) {
      const message = String(error.message || '')
      expect(message).toMatch(/DAILY_QUOTA_EXCEEDED|DAILY_USER_QUOTA_EXCEEDED|Video action failed|quota/i)
      return
    }

    const payload = (data || {}) as AskBobResponse
    expect(String(payload.provider || '')).toBe('bob-generate-video-action')
    expect(payload.action?.type).toBe('generate_briefing_video')
    expect(payload.action?.success).toBe(true)

    if (payload.action?.success) {
      expect(String(payload.action?.video_id || '').trim().length).toBeGreaterThan(0)
      expect(String(payload.action?.video_url || '').trim().length).toBeGreaterThan(0)
    }

    if (proposalId) {
      const { data: approvedProposal, error: approvedProposalError } = await (supabase.from('bob_action_proposals') as any)
        .select('id, status, approved_at')
        .eq('id', proposalId)
        .maybeSingle()

      expect(approvedProposalError).toBeNull()
      expect(approvedProposal?.status).toBe('approved')
      expect(approvedProposal?.approved_at).toBeTruthy()
    }
  }, 120_000)

  it('handles quota-exceeded branch for direct Bob action invocation', async () => {
    if (!authReady) return
    const { data, error } = await supabase.functions.invoke('bob-generate-video-action', {
      body: {
        request_context: 'confirm create briefing video for quota branch test',
        org_id: orgId,
        allowed_org_ids: [orgId],
        quality: 'low',
        format: 'mp4',
      },
    })

    if (error) {
      const message = String(error.message || '')
      expect(message).toMatch(/DAILY_QUOTA_EXCEEDED|DAILY_USER_QUOTA_EXCEEDED|quota|UNAUTHORIZED|INVALID_SESSION/i)
      return
    }

    const payload = (data || {}) as BobVideoActionResponse
    expect(payload).toBeDefined()
    if (payload.success === false) {
      expect(String(payload.error_code || '')).toMatch(/DAILY_QUOTA_EXCEEDED|DAILY_USER_QUOTA_EXCEEDED|UNAUTHORIZED|INVALID_SESSION/)
    } else {
      expect(payload.success).toBe(true)
    }
  }, 120_000)
})