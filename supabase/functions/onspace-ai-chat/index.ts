/**
 * onspace-ai-chat
 *
 * AI-powered analysis and chat for FreedomCamp Manager admins.
 * Supports any OpenAI-compatible API endpoint so operators can point it at
 * their own self-hosted model (e.g. Ollama, vLLM, LM Studio) or the default
 * OpenAI service.
 *
 * Configuration (Supabase Edge Function secrets):
 *   OPENAI_API_KEY    — API key for the AI provider
 *   OPENAI_BASE_URL   — Base URL of the OpenAI-compatible API
 *                       (default: https://api.openai.com/v1)
 *                       Set to e.g. http://my-server:11434/v1 for Ollama
 *   AI_DEFAULT_MODEL  — Model name to use (default: gpt-4o)
 *
 * POST body (two accepted formats):
 *   Format A — full messages array (advanced):
 *     { messages: [{role,content},...], model?, temperature? }
 *   Format B — single message + optional context (simple, used by edgeFunctions.ts):
 *     { message: string, context?: any, model?, temperature? }
 *
 * Response:
 *   { response: string, model: string, usage: { prompt_tokens, completion_tokens, total_tokens } }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'

const SYSTEM_PROMPT = `You are OnSpace AI, an intelligent assistant for FreedomCamp Manager — a freedom camping enforcement system used by councils and security contractors in New Zealand.

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
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const token = extractBearerToken(req)
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── AI Provider ──────────────────────────────────────────────────────────
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    const baseUrl = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '')

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'AI service not configured',
          details: 'OPENAI_API_KEY secret is not set. Configure it in Supabase Dashboard > Edge Functions > Secrets, or point OPENAI_BASE_URL to your own AI server.',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[OnSpace AI] user=${user.email} model=${model} messages=${messages.length} provider=${baseUrl}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60_000)

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: 4000 }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error(`[OnSpace AI] Provider error ${aiResponse.status}:`, errorText.slice(0, 500))
      return new Response(
        JSON.stringify({ error: `AI provider returned ${aiResponse.status}`, details: errorText.slice(0, 300) }),
        { status: aiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiData = await aiResponse.json()
    const responseText: string = aiData.choices?.[0]?.message?.content ?? ''

    if (!responseText) {
      console.error('[OnSpace AI] Empty response from provider:', JSON.stringify(aiData).slice(0, 300))
      return new Response(
        JSON.stringify({ error: 'AI returned an empty response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[OnSpace AI] OK — ${responseText.length} chars`)

    return new Response(
      JSON.stringify({
        response: responseText,
        model: aiData.model ?? model,
        usage: aiData.usage ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('[OnSpace AI] Request timed out after 60s')
      return new Response(
        JSON.stringify({ error: 'AI request timed out after 60 seconds' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.error('[OnSpace AI] Unhandled error:', err?.message)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
