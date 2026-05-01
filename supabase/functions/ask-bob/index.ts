import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

type AskBobRequest = {
  prompt?: string
  lat?: number
  lng?: number
  organization_id?: string | null
}

function buildSystemPrompt(context: Record<string, unknown> | null): string {
  if (!context) {
    return [
      'You are Bob, an enforcement AI for New Zealand freedom camping operations.',
      'Apply standard NZ Freedom Camping Act and operational policy guidance.',
      'Answer clearly with actionable field advice.',
    ].join(' ')
  }

  const workspaceName = String(context.workspace_name || context.client_name || 'Client jurisdiction')
  const bylaws = context.bylaws
  const bylawsText = bylaws ? JSON.stringify(bylaws) : 'No specific bylaw payload provided.'

  return [
    'You are Bob, an enforcement AI.',
    `You are currently operating in ${workspaceName}.`,
    `Apply these jurisdiction bylaws and constraints: ${bylawsText}`,
    'Respond with practical patrol-ready guidance and clearly call out uncertainty when needed.',
  ].join(' ')
}

function extractAnswer(payload: Record<string, unknown>): string {
  const output = payload.output as Record<string, unknown> | undefined
  const message = output?.message as Record<string, unknown> | undefined
  const choices = output?.choices as Array<Record<string, unknown>> | undefined
  const firstChoice = choices?.[0]?.message as Record<string, unknown> | undefined

  const candidates = [
    payload.response,
    payload.message,
    output?.response,
    output?.message,
    message?.content,
    firstChoice?.content,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const body = await req.json().catch(() => ({})) as AskBobRequest
  const prompt = String(body.prompt || '').trim()

  if (!prompt) {
    return errorResponse('prompt is required', req, 400)
  }

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim()
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('Supabase service role configuration is missing', req, 503)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authResult.user.id)
    .maybeSingle()

  const providerOrgId = String(body.organization_id || profile?.organization_id || '').trim() || null
  const lat = typeof body.lat === 'number' ? body.lat : null
  const lng = typeof body.lng === 'number' ? body.lng : null

  let context: Record<string, unknown> | null = null
  if (providerOrgId && lat !== null && lng !== null) {
    const { data: contextData, error: contextError } = await supabaseAdmin.rpc('get_active_context', {
      officer_lat: lat,
      officer_lng: lng,
      provider_id: providerOrgId,
    })

    if (!contextError && contextData) {
      context = contextData as Record<string, unknown>
    }
  }

  const systemPrompt = buildSystemPrompt(context)

  const inferenceResponse = await fetch(`${supabaseUrl}/functions/v1/onspace-ai-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      'x-client-info': 'ask-bob-edge-function',
    },
    body: JSON.stringify({
      provider: 'inference',
      model: 'qwen2.5:7b',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  })

  const inferencePayload = await inferenceResponse.json().catch(() => ({})) as Record<string, unknown>
  if (!inferenceResponse.ok) {
    const message = String(inferencePayload.error || `Upstream inference failed (${inferenceResponse.status})`)
    return errorResponse(message, req, inferenceResponse.status)
  }

  const answer = extractAnswer(inferencePayload)
  if (!answer) {
    return errorResponse('Inference provider returned empty response', req, 502)
  }

  return jsonResponse({
    answer,
    jurisdiction: String(context?.workspace_name || 'General'),
    is_client_owned: Boolean(context),
    model: String(inferencePayload.model || 'qwen2.5:7b'),
    provider: String(inferencePayload.provider || 'runpod-serverless-ollama'),
  }, req)
}))