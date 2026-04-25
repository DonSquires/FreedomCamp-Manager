import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { bobChat, bobTranslate, bobAssess } from '../_shared/bobInfer.ts'

type Dict = Record<string, unknown>

const FUNCTION_SEGMENT = '/bob-multimodal-gateway'
const DEFAULT_REDACT = true
const DEFAULT_RETENTION_DAYS = 30

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g
const TOKEN_RE = /\b(?:[A-Za-z0-9]{24,}|eyJ[A-Za-z0-9._-]+)\b/g

function routeSuffix(req: Request): string {
  const url = new URL(req.url)
  const idx = url.pathname.indexOf(FUNCTION_SEGMENT)
  if (idx === -1) return '/'
  const suffix = url.pathname.slice(idx + FUNCTION_SEGMENT.length)
  return suffix || '/'
}

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asObj(value: unknown): Dict {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {}
}

function redactText(input: string): string {
  return input
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]')
    .replace(TOKEN_RE, '[REDACTED_TOKEN]')
}

function minimizeContext(context: Dict): Dict {
  return {
    input_text: asStr(context.input_text).slice(0, 4000),
    channel: asStr(context.channel).slice(0, 64),
    timestamp: asStr(context.timestamp).slice(0, 64),
    modality: asStr(context.modality).slice(0, 32),
  }
}

function detectIntent(inputText: string): { intent: string; planned: string[] } {
  const t = inputText.toLowerCase()
  if (/diagram|draw|flowchart|architecture/.test(t)) return { intent: 'generate_diagram', planned: ['drawing'] }
  if (/image|photo|vision|detect/.test(t)) return { intent: 'analyze_image', planned: ['vision'] }
  if (/speak|voice|tts|audio output/.test(t)) return { intent: 'synthesize_speech', planned: ['speech'] }
  if (/transcribe|stt|audio to text/.test(t)) return { intent: 'transcribe_audio', planned: ['speech'] }
  if (/translate|language/.test(t)) return { intent: 'translate_content', planned: ['text', 'speech'] }
  return { intent: 'general_assist', planned: ['text'] }
}

function requireIdempotencyKey(req: Request): string | null {
  const v = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key')
  return v && v.trim() ? v.trim() : null
}

function parseScopes(req: Request): Set<string> {
  const header = req.headers.get('x-bob-scopes') || req.headers.get('x-capability-scopes') || ''
  return new Set(
    header
      .split(/[ ,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

function enforceScope(req: Request, needed: string): string | null {
  const scopes = parseScopes(req)
  if (scopes.size === 0) return null
  if (!scopes.has(needed)) return `Missing required scope: ${needed}`
  return null
}

async function writeAudit(params: {
  req: Request
  userId: string
  endpoint: string
  status: number
  requestSummary?: Dict
  responseSummary?: Dict
}) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceRoleKey) return

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const payload = {
    user_id: params.userId,
    endpoint: params.endpoint,
    status_code: params.status,
    request_summary: params.requestSummary ?? {},
    response_summary: params.responseSummary ?? {},
    request_id: params.req.headers.get('x-request-id') || null,
    created_at: new Date().toISOString(),
  }

  const { error } = await (admin.from('bob_multimodal_audit_log') as any).insert(payload)
  if (error) {
    console.warn('bob-multimodal-gateway: audit insert failed', error.message)
  }
}

async function handleInterpret(req: Request, userId: string): Promise<Response> {
  const scopeError = enforceScope(req, 'bob:interpret')
  if (scopeError) return errorResponse(scopeError, req, 403)

  const body = asObj(await req.json().catch(() => ({})))
  const context = minimizeContext(asObj(body.context))
  const requestedCapabilities = Array.isArray(body.requested_capabilities)
    ? body.requested_capabilities.map((x) => String(x)).slice(0, 10)
    : []
  const privacy = asObj(body.privacy_preferences)
  const redactPII = privacy.redact_pii !== false ? DEFAULT_REDACT : false

  const rawInput = asStr(context.input_text)
  const inputText = redactPII ? redactText(rawInput) : rawInput

  if (!inputText.trim()) {
    return errorResponse('context.input_text is required', req, 400)
  }

  const inferred = detectIntent(inputText)
  const planned = inferred.planned.filter((cap) => requestedCapabilities.length === 0 || requestedCapabilities.includes(cap))

  const response = {
    session_id: asStr(body.session_id),
    intent: inferred.intent,
    entities: {
      channel: asStr(context.channel),
      modality: asStr(context.modality || 'text'),
    },
    confidence: 0.82,
    planned_capabilities: planned,
    notes: redactPII
      ? 'High privacy mode enabled; PII redaction applied.'
      : 'Standard privacy mode.',
  }

  await writeAudit({
    req,
    userId,
    endpoint: '/v1/bob/interpret',
    status: 200,
    requestSummary: { has_session: Boolean(body.session_id), caps: requestedCapabilities },
    responseSummary: { intent: response.intent, planned_capabilities: response.planned_capabilities },
  })

  return jsonResponse(response, req)
}

async function handleRequestAi(req: Request, userId: string): Promise<Response> {
  const scopeError = enforceScope(req, 'bob:request_ai')
  if (scopeError) return errorResponse(scopeError, req, 403)

  const body = asObj(await req.json().catch(() => ({})))
  const aiType = asStr(body.ai_type).toLowerCase()
  const payload = asObj(body.payload)
  const privacy = asObj(payload.privacy)
  const redactPII = privacy.redact_pii !== false ? DEFAULT_REDACT : false

  if (!aiType) {
    return errorResponse('ai_type is required', req, 400)
  }

  let result: Dict = {}
  let status = 'in_progress'

  if (aiType === 'translate') {
    const text = asStr(payload.text)
    const target = asStr(payload.target_language, 'en-NZ')
    if (!text) return errorResponse('payload.text is required for ai_type=translate', req, 400)
    const translated = await bobTranslate({
      text: redactPII ? redactText(text) : text,
      targetLanguage: target,
      sourceLanguage: asStr(payload.source_language) || undefined,
    })
    result = { translated_text: translated.translation, model: translated.model }
    status = 'completed'
  } else if (aiType === 'assess' || aiType === 'vision' || aiType === 'speech') {
    const assessed = await bobAssess({
      type: aiType,
      description: redactPII ? redactText(asStr(payload.description)) : asStr(payload.description),
      symptom: redactPII ? redactText(asStr(payload.symptom)) : asStr(payload.symptom),
      imageDescription: redactPII ? redactText(asStr(payload.image_description)) : asStr(payload.image_description),
      context: asObj(payload.context),
    })
    result = { assessment: assessed.assessment, model: assessed.model, provider: assessed.provider }
    status = 'completed'
  } else {
    const prompt = redactPII ? redactText(asStr(payload.prompt)) : asStr(payload.prompt)
    if (!prompt.trim()) return errorResponse('payload.prompt is required', req, 400)
    const chat = await bobChat({
      message: `Capability: ${aiType}\n\n${prompt}`,
      context: asObj(payload.context),
    })
    result = { content: chat.response, model: chat.model, provider: chat.provider }
    status = 'completed'
  }

  const response = {
    session_id: asStr(body.session_id),
    ai_type: aiType,
    execution_id: `exec-${crypto.randomUUID()}`,
    status,
    result,
  }

  await writeAudit({
    req,
    userId,
    endpoint: '/v1/bob/request_ai',
    status: 200,
    requestSummary: { ai_type: aiType, has_session: Boolean(body.session_id) },
    responseSummary: { status, has_result: Object.keys(result).length > 0 },
  })

  return jsonResponse(response, req)
}

async function handleExecution(req: Request, userId: string): Promise<Response> {
  const scopeError = enforceScope(req, 'bob:execution')
  if (scopeError) return errorResponse(scopeError, req, 403)

  const idem = requireIdempotencyKey(req)
  if (!idem) return errorResponse('idempotency-key header is required', req, 400)

  const body = asObj(await req.json().catch(() => ({})))
  const actions = Array.isArray(body.actions) ? body.actions.map((x) => asObj(x)).slice(0, 25) : []

  const confirmedActions = actions.map((a) => ({
    action: asStr(a.action),
    accepted: true,
    provenance: {
      actor: userId,
      capability: asStr(a.capability || 'unknown'),
      ai_service: asStr(a.ai_service || 'bob'),
      timestamp: new Date().toISOString(),
      version: '1.0',
    },
  }))

  const response = {
    session_id: asStr(body.session_id),
    execution_id: `exec-${crypto.randomUUID()}`,
    status: 'ok',
    idempotency_key: idem,
    result: { confirmed_actions: confirmedActions },
  }

  await writeAudit({
    req,
    userId,
    endpoint: '/v1/bob/execution',
    status: 200,
    requestSummary: { action_count: actions.length },
    responseSummary: { confirmed_count: confirmedActions.length },
  })

  return jsonResponse(response, req)
}

async function handlePrivacyConsent(req: Request, userId: string): Promise<Response> {
  const scopeError = enforceScope(req, 'bob:privacy')
  if (scopeError) return errorResponse(scopeError, req, 403)

  const idem = requireIdempotencyKey(req)
  if (!idem) return errorResponse('idempotency-key header is required', req, 400)

  const body = asObj(await req.json().catch(() => ({})))
  const consent = asObj(body.consent)
  const limits = asObj(consent.limits)

  const response = {
    session_id: asStr(body.session_id),
    status: 'accepted',
    idempotency_key: idem,
    consent: {
      sharing_with: Array.isArray(consent.sharing_with) ? consent.sharing_with.map(String).slice(0, 20) : [],
      granularity: asStr(consent.granularity, 'per-feature'),
      limits: {
        retention_days: Number(limits.retention_days) || DEFAULT_RETENTION_DAYS,
        redaction_level: asStr(limits.redaction_level, 'PII_strict'),
      },
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
  }

  await writeAudit({
    req,
    userId,
    endpoint: '/v1/bob/privacy/consent',
    status: 202,
    requestSummary: { has_session: Boolean(body.session_id), has_consent: Object.keys(consent).length > 0 },
    responseSummary: { accepted: true },
  })

  return jsonResponse(response, req, 202)
}

async function handlePrivacyDelete(req: Request, userId: string): Promise<Response> {
  const scopeError = enforceScope(req, 'bob:privacy')
  if (scopeError) return errorResponse(scopeError, req, 403)

  const idem = requireIdempotencyKey(req)
  if (!idem) return errorResponse('idempotency-key header is required', req, 400)

  const body = asObj(await req.json().catch(() => ({})))
  const processingId = `del-${crypto.randomUUID()}`

  const response = {
    session_id: asStr(body.session_id),
    status: 'accepted',
    idempotency_key: idem,
    processing_id: processingId,
    estimated_completion: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  await writeAudit({
    req,
    userId,
    endpoint: '/v1/bob/privacy/delete',
    status: 202,
    requestSummary: { scope_count: Array.isArray(body.scope) ? body.scope.length : 0 },
    responseSummary: { processing_id: processingId },
  })

  return jsonResponse(response, req, 202)
}

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error || 'Unauthorized', req, 401)
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const suffix = routeSuffix(req)

  try {
    if (suffix === '/v1/bob/interpret' || suffix === '/interpret') {
      return await handleInterpret(req, authResult.user.id)
    }
    if (suffix === '/v1/bob/request_ai' || suffix === '/request_ai') {
      return await handleRequestAi(req, authResult.user.id)
    }
    if (suffix === '/v1/bob/execution' || suffix === '/execution') {
      return await handleExecution(req, authResult.user.id)
    }
    if (suffix === '/v1/bob/privacy/consent' || suffix === '/privacy/consent') {
      return await handlePrivacyConsent(req, authResult.user.id)
    }
    if (suffix === '/v1/bob/privacy/delete' || suffix === '/privacy/delete') {
      return await handlePrivacyDelete(req, authResult.user.id)
    }

    return errorResponse(`Unknown route: ${suffix}`, req, 404)
  } catch (err: any) {
    const message = String(err?.message || 'Gateway failure')
    return errorResponse(message, req, 502)
  }
}))
