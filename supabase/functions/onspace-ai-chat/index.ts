/**
 * onspace-ai-chat
 *
 * AI-powered analysis and chat for FieldOps Manager admins.
 *
 * Self-contained policy:
 *   This function proxies all AI chat requests to the Railway inference-service
 *   /chat endpoint. It does not call external cloud AI providers directly.
 *
 * Required secrets:
 *   INFERENCE_SERVICE_URL   Railway inference-service base URL.
 *   INFERENCE_API_KEY       Optional shared key for inference auth.
 *   AI_DEFAULT_MODEL        Optional UI hint only (handled by inference-service).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'

const SYSTEM_PROMPT = `You are an AI assistant for FieldOps Manager — a freedom camping enforcement system used by councils and security contractors in New Zealand.

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

Always be professional, concise, and accurate. When citing NZ law, be precise about section numbers. Acknowledge uncertainty when relevant.`

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
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

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json()
    const {
      message,
      context,
      messages: rawMessages,
      model: requestedModel,
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

    // ── Inference-service provider (self-contained only) ───────────────────
    const inferenceUrl = (Deno.env.get('INFERENCE_SERVICE_URL') ?? '').replace(/\/$/, '')
    const inferenceApiKey = Deno.env.get('INFERENCE_API_KEY') ?? ''

    if (!inferenceUrl) {
      return new Response(
        JSON.stringify({
          error: 'AI service not configured',
          details: 'INFERENCE_SERVICE_URL is required for self-contained AI chat.',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim() ?? ''
    if (!latestUserMessage) {
      return new Response(
        JSON.stringify({ error: 'No user message found in conversation.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(0, -1)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60_000)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) headers['x-inference-api-key'] = inferenceApiKey

    const inferResponse = await fetch(`${inferenceUrl}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: latestUserMessage,
        history,
        context: {
          user_email: user.email,
          requested_model: model,
          temperature,
          source: 'onspace-ai-chat',
        },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const inferText = await inferResponse.text()
    if (!inferResponse.ok) {
      return new Response(
        JSON.stringify({
          error: `Inference chat returned ${inferResponse.status}`,
          details: inferText.slice(0, 500),
        }),
        { status: inferResponse.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const inferData = (() => {
      try { return JSON.parse(inferText) } catch { return null }
    })()
    const responseText: string = inferData?.message ?? ''

    if (!responseText) {
      return new Response(
        JSON.stringify({ error: 'Inference chat returned an empty response' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        response: responseText,
        model: 'inference-chat',
        provider: `inference-${inferData?.provider ?? 'heuristic'}`,
        usage: null,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('[AI] Request timed out after 60s')
      return new Response(
        JSON.stringify({ error: 'AI request timed out after 60 seconds' }),
        { status: 504, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }
    console.error('[AI] Unhandled error:', err?.message)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }
})
