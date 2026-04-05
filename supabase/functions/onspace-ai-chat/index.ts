/**
 * onspace-ai-chat
 *
 * Bob-powered analysis and chat for FieldOps Manager admins.
 *
 * Self-contained policy:
 *   Primary provider is Railway inference-service (/chat endpoint).
 *   Optional fallback provider is Ollama (/api/chat), controlled via env vars.
 *
 * Required secrets:
 *   INFERENCE_SERVICE_URL   Railway inference-service base URL.
 *   INFERENCE_API_KEY       Optional shared key for inference auth.
 *   AI_DEFAULT_MODEL        Optional UI hint only (handled by inference-service).
 *
 * Optional secrets for Ollama fallback/support:
 *   OLLAMA_BASE_URL         e.g. http://localhost:11434 or http://ollama.railway.internal:3000 (defaults to INFERENCE_SERVICE_URL)
 *   OLLAMA_MODEL            e.g. llama3.1:8b
 *   OLLAMA_API_KEY          Optional bearer key (defaults to INFERENCE_API_KEY)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'

const SYSTEM_PROMPT = `You are Bob, the inference agent and assistant for FieldOps Manager — a freedom camping enforcement system used by councils and security contractors in New Zealand.

You help admins and enforcement managers by:
- Analysing compliance data, breach trends, and patrol performance
- Explaining NZ legislation relevant to freedom camping (Freedom Camping Act 2011, Local Government Act 2002, RMA 1991)
- Suggesting enforcement strategies and zone policy improvements
- Interpreting scan and observation data
- Helping draft notices, reports, and briefings
- Answering questions about noise control, parking enforcement, and vehicle compliance
- Providing guidance on homeless status policies and welfare considerations

Context about the system:
- Vehicles are scanned at freedom camping sites; observations track plate_number, zone, recorded_at
- Compliance is calculated per vehicle per zone (max nights, self-contained status, exemptions)
- Breach alerts are raised when vehicles exceed stay limits or violate zone rules
- Officers can issue Infringement Notices, Notice to Vacate, or Warning Notices
- The system tracks SCV (Self-Contained Vehicle) certification via the NZSCV register
- Zones have legal configuration: allowed days, max consecutive nights, max nights/month
- Homeless/vulnerable vehicle occupants receive different consideration under policy

Always be professional, concise, and accurate. When citing NZ law, be precise about section numbers. Acknowledge uncertainty when relevant.

Conversation style requirements:
- Be warm, calm, and human in both written and spoken-style replies.
- Sound like a trusted operations copilot: confident, practical, and respectful.
- Keep spoken-style responses short and easy to hear (short sentences, clear steps).
- Ask one clarifying question when the request is broad or ambiguous.
- For simple asks, give direct answers first, then brief optional next steps.
- Never pretend to have completed actions you cannot perform; clearly state what you can do next.
- You are the primary point of contact for build and ops support across UI, DB, Expo, Railway, and Vercel workflows, using available connected tools, telemetry, and approved permissions.

Critical policy rules:
- Maintain strict confidentiality. Do not reveal personal user information unless the user has given express permission.
- Be loyal to the authenticated user in-session and protect their privacy by default.
- Grand Master can override normal information restrictions when necessary for lawful operational control.
- If you detect likely criminal behavior, privacy breach, evidence tampering, or deliberate rule/law evasion, you must warn the user and escalate to Grand Master immediately.
- If a user appears to be requesting something unlawful or non-compliant, advise them they may be about to breach policy or law and suggest compliant alternatives.`

const PRIVACY_REQUEST_PATTERN = /(share|show|reveal|give|tell|export|download).*(user|officer|profile|email|phone|address|location|personal|private|details)/i
const EXPLICIT_PERMISSION_PATTERN = /(with permission|has permission|consent|authori[sz]ed by user|user approved|user said yes)/i

const DEFAULT_ESCALATION_KEYWORDS = [
  'illegal',
  'break the law',
  'privacy breach',
  'unauthorized access',
  'steal',
  'hack',
  'cover up',
  'hide evidence',
  'tamper',
  'forge',
  'falsify',
  'dox',
  'blackmail',
  'bribe',
  'harass',
]

function looksLikeEscalationContent(message: string, keywords: string[]): boolean {
  const text = message.toLowerCase()
  return keywords.some((kw) => text.includes(kw))
}

async function loadEscalationKeywords(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<string[]> {
  try {
    const { data } = await (supabaseAdmin.from('bob_policy_controls') as any)
      .select('escalation_keywords')
      .eq('singleton_key', 'default')
      .maybeSingle()

    const keywords = (data?.escalation_keywords ?? []) as string[]
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return DEFAULT_ESCALATION_KEYWORDS
    }

    const cleaned = keywords
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean)

    return cleaned.length ? cleaned : DEFAULT_ESCALATION_KEYWORDS
  } catch {
    return DEFAULT_ESCALATION_KEYWORDS
  }
}

async function notifyGrandMasters(
  supabaseAdmin: ReturnType<typeof createClient>,
  reportingUserId: string,
  reportingUserEmail: string,
  messagePreview: string,
) {
  const { data: grandMasters } = await (supabaseAdmin.from('user_profiles') as any)
    .select('id, is_active')
    .eq('role', 'grand_master')
    .eq('is_active', true)
    .limit(20)

  if (!grandMasters?.length) return

  const rows = grandMasters.map((gm: { id: string }) => ({
    user_id: gm.id,
    type: 'system_alert',
    title: 'Compliance escalation from Bob',
    body: `Potential criminal/privacy-risk behavior detected in Bob conversation by ${reportingUserEmail}.`,
    data: {
      source: 'onspace-ai-chat',
      reporting_user_id: reportingUserId,
      reporting_user_email: reportingUserEmail,
      message_preview: messagePreview,
      escalation_reason: 'possible_criminal_or_privacy_breach',
      escalated_at: new Date().toISOString(),
    },
    priority: 'high',
    read: false,
    delivered: false,
  }))

  await (supabaseAdmin.from('notifications') as any).insert(rows)
}

async function writePrivacyAudit(
  supabaseAdmin: ReturnType<typeof createClient>,
  input: {
    performedBy: string
    organizationId: string | null
    action: string
    message: string
    expressPermission: boolean
    permittedUserIdentity: string | null
    granted: boolean
    reason: string
  },
) {
  await (supabaseAdmin.from('audit_log') as any).insert({
    action: input.action,
    entity_type: 'bob_chat_privacy_request',
    entity_id: input.performedBy,
    performed_by: input.performedBy,
    organization_id: input.organizationId,
    new_values: {
      message_preview: input.message.slice(0, 400),
      express_permission: input.expressPermission,
      permitted_user_identity: input.permittedUserIdentity,
      granted: input.granted,
      reason: input.reason,
      source: 'onspace-ai-chat',
      created_at: new Date().toISOString(),
    },
  })
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function normalizeProviderText(rawText: string, parsed: any): string {
  const fromStructured =
    parsed?.message?.content ??
    parsed?.message ??
    parsed?.response ??
    parsed?.text ??
    parsed?.output_text ??
    parsed?.data?.message ??
    parsed?.data?.response ??
    ''

  if (typeof fromStructured === 'string' && fromStructured.trim()) {
    return fromStructured.trim()
  }

  const trimmedRaw = String(rawText ?? '').trim()
  if (!trimmedRaw) return ''

  // Guard against misconfigured upstream URLs returning HTML app shells.
  if (/^<!doctype html/i.test(trimmedRaw) || /^<html/i.test(trimmedRaw)) {
    return ''
  }

  // If upstream returned plain text (not JSON), use it directly.
  if (!trimmedRaw.startsWith('{') && !trimmedRaw.startsWith('[')) {
    return trimmedRaw
  }

  return ''
}

function normalizeBaseUrl(raw?: string | null): string {
  const trimmed = String(raw ?? '').trim().replace(/\/$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function parseProviderPreference(raw: unknown): 'auto' | 'inference' | 'ollama' {
  const normalized = String(raw ?? '').trim().toLowerCase()
  if (normalized === 'ollama' || normalized === 'inference' || normalized === 'auto') {
    return normalized
  }
  return 'auto'
}

function parseBooleanEnv(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null) return defaultValue
  const normalized = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const token = extractBearerToken(req)
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const { data: profile } = await (supabaseAdmin.from('user_profiles') as any)
      .select('role, first_name, last_name, organization_id')
      .eq('id', user.id)
      .maybeSingle()

    const userRole = (profile?.role ?? 'officer') as string
    const isGrandMaster = userRole === 'grand_master'

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json()
    const {
      message,
      context,
      messages: rawMessages,
      model: requestedModel,
      provider: requestedProvider,
      temperature = 0.7,
    } = body

    const defaultModel = Deno.env.get('AI_DEFAULT_MODEL') ?? 'gpt-4o'
    const model = requestedModel ?? defaultModel

    // Build messages array — accept Format A (full array) or Format B (single message + context)
    let messages: Array<{ role: string; content: string }>

    if (Array.isArray(rawMessages) && rawMessages.length > 0) {
      // Format A: caller provides full messages array; inject system prompt only if not present
      const hasSystem = rawMessages[0]?.role === 'system'
      messages = hasSystem
        ? rawMessages
        : [{ role: 'system', content: SYSTEM_PROMPT }, ...rawMessages]
    } else if (message) {
      // Format B: single message + optional context object
      const userContent = context
        ? `${message}\n\nContext:\n${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}`
        : message
      messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ]
    } else {
      return new Response(
        JSON.stringify({ error: 'Either "messages" array or "message" string is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // ── Provider configuration ──────────────────────────────────────────────
    const inferenceUrl = normalizeBaseUrl(Deno.env.get('INFERENCE_SERVICE_URL'))
    const inferenceApiKey = Deno.env.get('INFERENCE_API_KEY') ?? ''
    // Ollama defaults to the same Railway project location/credential as Bob inference.
    const ollamaBaseUrl = normalizeBaseUrl(Deno.env.get('OLLAMA_BASE_URL') ?? inferenceUrl)
    const ollamaModel = Deno.env.get('OLLAMA_MODEL') ?? model
    const ollamaApiKey = Deno.env.get('OLLAMA_API_KEY') ?? inferenceApiKey
    const configuredProviderPreference = parseProviderPreference(Deno.env.get('BOB_CHAT_PROVIDER') ?? Deno.env.get('AI_CHAT_PROVIDER') ?? 'ollama')
    const providerPreference = parseProviderPreference(requestedProvider ?? configuredProviderPreference)
    const allowProviderFallback = parseBooleanEnv(Deno.env.get('BOB_CHAT_ALLOW_FALLBACK'), false)

    if (!inferenceUrl && !ollamaBaseUrl) {
      return new Response(
        JSON.stringify({
          response:
            'Bob is online, but no inference provider has been configured yet. To enable full Bob chat, set INFERENCE_SERVICE_URL in the edge function secrets. In the meantime, share your question or operational issue and I will provide a structured response using built-in knowledge.',
          model: 'bob-unconfigured',
          provider: 'local-failsafe',
          usage: null,
          diagnostics: 'INFERENCE_SERVICE_URL and OLLAMA_BASE_URL are both missing from edge function secrets.',
        }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim() ?? ''
    if (!latestUserMessage) {
      return new Response(
        JSON.stringify({ error: 'No user message found in conversation.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const privacyContext = (context as any)?.privacy ?? {}
    const expressPermissionFromContext = Boolean(privacyContext?.expressPermission)
    const permittedUserIdentity = privacyContext?.permittedUserIdentity
      ? String(privacyContext.permittedUserIdentity)
      : null

    const isPrivacyRequest = PRIVACY_REQUEST_PATTERN.test(latestUserMessage)
    const hasExplicitPermission = EXPLICIT_PERMISSION_PATTERN.test(latestUserMessage) || expressPermissionFromContext

    // Confidentiality gate: no user-data disclosure requests unless explicit
    // permission is provided, except for grand master override.
    if (isPrivacyRequest && !isGrandMaster && !hasExplicitPermission) {
      try {
        await writePrivacyAudit(supabaseAdmin, {
          performedBy: user.id,
          organizationId: profile?.organization_id ?? null,
          action: 'bob_user_data_request_blocked',
          message: latestUserMessage,
          expressPermission: hasExplicitPermission,
          permittedUserIdentity,
          granted: false,
          reason: 'missing_express_permission',
        })
      } catch (auditErr) {
        console.error('[Bob] Failed to write privacy audit (blocked):', auditErr)
      }

      return new Response(
        JSON.stringify({
          response:
            'I cannot provide personal user information without that user\'s express permission. Please obtain explicit consent first. If this is a security or legal incident, escalate to Grand Master.',
          model: 'policy-guard',
          provider: 'policy-enforcer',
          usage: null,
        }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    if (isPrivacyRequest) {
      try {
        await writePrivacyAudit(supabaseAdmin, {
          performedBy: user.id,
          organizationId: profile?.organization_id ?? null,
          action: isGrandMaster ? 'bob_user_data_request_grand_master_override' : 'bob_user_data_request_allowed',
          message: latestUserMessage,
          expressPermission: hasExplicitPermission,
          permittedUserIdentity,
          granted: true,
          reason: isGrandMaster ? 'grand_master_override' : 'express_permission_present',
        })
      } catch (auditErr) {
        console.error('[Bob] Failed to write privacy audit (allowed):', auditErr)
      }
    }

    const escalationKeywords = await loadEscalationKeywords(supabaseAdmin)
    const shouldEscalate = looksLikeEscalationContent(latestUserMessage, escalationKeywords)
    if (shouldEscalate) {
      try {
        await notifyGrandMasters(
          supabaseAdmin,
          user.id,
          user.email ?? 'unknown@unknown',
          latestUserMessage.slice(0, 400),
        )
      } catch (notifyErr) {
        console.error('[Bob] Failed to notify grand masters for escalation:', notifyErr)
      }
    }

    // Build conversation history for the inference provider.
    // Strip the knowledge/memory context injected as leading assistant messages by the
    // frontend (BobAssistantStudio) — these are large blobs that crowd out real
    // conversation turns inside Bob's Ollama history[-12] slice.
    // Strategy: only include messages from the first user turn onward.
    const firstUserIdx = messages.findIndex((m) => m.role === 'user')
    const conversationMessages = firstUserIdx >= 0 ? messages.slice(firstUserIdx) : messages
    const history = conversationMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(0, -1) // exclude the current user message (sent separately as `message`)

    async function callInferenceProvider() {
      const configuredFallbackUrl = normalizeBaseUrl(Deno.env.get('INFERENCE_SERVICE_FALLBACK_URL'))
      const candidates = Array.from(new Set([
        inferenceUrl,
        configuredFallbackUrl,
      ].filter(Boolean)))

      if (!candidates.length) {
        throw new Error('INFERENCE_SERVICE_URL is not configured')
      }

      // Build ordered list of auth strategies to try against the inference service.
      // Bob accepts: (1) x-inference-api-key matching INFERENCE_API_KEY,
      //              (2) Authorization: Bearer matching SUPABASE_SERVICE_ROLE_KEY,
      //              (3) valid Supabase JWT (user auth).
      // The edge function has SUPABASE_SERVICE_ROLE_KEY available natively, making
      // it a reliable fallback when INFERENCE_API_KEY is absent or rotated.
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      const authStrategies: Array<Record<string, string>> = []
      if (inferenceApiKey) {
        authStrategies.push({ 'x-inference-api-key': inferenceApiKey })
      }
      if (serviceRoleKey && serviceRoleKey !== inferenceApiKey) {
        authStrategies.push({ 'Authorization': `Bearer ${serviceRoleKey}` })
      }
      // Always have at least one strategy (no-auth — Bob allows if no auth configured)
      if (!authStrategies.length) {
        authStrategies.push({})
      }

      let lastError: Error | null = null

      for (const candidateUrl of candidates) {
        for (const authHeaders of authStrategies) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60_000)
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders }

          const inferResponse = await fetch(`${candidateUrl}/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: latestUserMessage,
              history,
              provider: providerPreference === 'inference' ? 'inference' : providerPreference === 'ollama' ? 'ollama' : undefined,
              context: {
                user_email: user.email,
                requested_model: model,
                temperature,
                source: 'onspace-ai-chat',
              },
            }),
            signal: controller.signal,
          })

          const inferText = await inferResponse.text()
          if (!inferResponse.ok) {
            throw new Error(`Inference chat returned ${inferResponse.status}: ${inferText.slice(0, 300)} (${candidateUrl})`)
          }

          const inferData = (() => {
            try { return JSON.parse(inferText) } catch { return null }
          })()

          const responseText = normalizeProviderText(inferText, inferData)
          if (!responseText) throw new Error(`Inference chat returned an empty response (${candidateUrl})`)

          // If the inference service fell back to heuristic mode (Ollama not available),
          // treat it as a failure so the edge function can use its own clearer failsafe message.
          if (inferData?.fallback === true) {
            throw new Error(`Inference is in degraded heuristic mode — no LLM available (${candidateUrl})`)
          }

          return {
            responseText,
            provider: `inference-${inferData?.provider ?? 'heuristic'}`,
            model: 'inference-chat',
          }
        } catch (err: any) {
          lastError = err instanceof Error ? err : new Error(String(err?.message ?? err))
          // Store error and continue to next auth strategy or candidate URL
        } finally {
          clearTimeout(timeoutId)
        }
        } // end authStrategies loop
      } // end candidates loop

      throw lastError ?? new Error('Inference provider failed for all candidate URLs')
    }

    async function callOllamaProvider() {
      if (!ollamaBaseUrl) {
        throw new Error('OLLAMA_BASE_URL is not configured')
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60_000)
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (ollamaApiKey) headers['Authorization'] = `Bearer ${ollamaApiKey}`

        const ollamaMessages = messages.map((m) => ({ role: m.role, content: m.content }))

        const ollamaResponse = await fetch(`${ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: { temperature },
          }),
          signal: controller.signal,
        })

        const ollamaText = await ollamaResponse.text()
        if (!ollamaResponse.ok) {
          throw new Error(`Ollama chat returned ${ollamaResponse.status}: ${ollamaText.slice(0, 300)}`)
        }

        const ollamaData = (() => {
          try { return JSON.parse(ollamaText) } catch { return null }
        })()

        const responseText = normalizeProviderText(ollamaText, ollamaData)
        if (!responseText) throw new Error('Ollama chat returned an empty response')

        return {
          responseText,
          provider: 'ollama',
          model: ollamaModel,
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    const providerOrder = (() => {
      if (providerPreference === 'ollama') {
        return allowProviderFallback ? ['ollama', 'inference'] : ['ollama']
      }
      if (providerPreference === 'inference') {
        return allowProviderFallback ? ['inference', 'ollama'] : ['inference']
      }
      return ['ollama', 'inference']
    })()

    let providerResult: { responseText: string; provider: string; model: string } | null = null
    const providerErrors: string[] = []

    for (const providerName of providerOrder) {
      try {
        providerResult = providerName === 'inference'
          ? await callInferenceProvider()
          : await callOllamaProvider()
        break
      } catch (providerErr: any) {
        providerErrors.push(`${providerName}: ${providerErr?.message ?? 'unknown error'}`)
      }
    }

    if (!providerResult) {
      const fallbackText =
        'Bob is online, but the upstream inference provider is currently unavailable. I can still help with operational triage: share the issue, target route/file, and expected behaviour, and I will provide a structured action plan while services recover.'

      return new Response(
        JSON.stringify({
          response: fallbackText,
          model: 'bob-failsafe',
          provider: 'local-fallback',
          usage: null,
          diagnostics: providerErrors.join(' | ').slice(0, 1200),
        }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const responseText = providerResult.responseText

    if (!responseText) {
      return new Response(
        JSON.stringify({ error: 'Bob inference provider returned an empty response' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const finalResponse = shouldEscalate
      ? `Compliance Notice: This request may indicate a potential policy or legal breach. Grand Master has been advised.\n\n${responseText}`
      : responseText

    return new Response(
      JSON.stringify({
        response: finalResponse,
        model: providerResult.model,
        provider: providerResult.provider,
        usage: null,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('[Bob] Request timed out after 60s')
      return new Response(
        JSON.stringify({ error: 'Bob request timed out after 60 seconds' }),
        { status: 504, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }
    console.error('[Bob] Unhandled error:', err?.message)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }
})
