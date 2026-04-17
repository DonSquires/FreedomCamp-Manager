import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type Action =
  | 'code_task_submit'
  | 'code_tasks_list'
  | 'code_task_get'
  | 'code_task_skip'
  | 'code_task_delete'
  | 'code_patterns'
  | 'code_conventions'
  | 'code_tech_stack'
  | 'code_assist'
  | 'ask_copilot_submit'
  | 'ask_copilot_list'
  | 'health_check'
  | 'doctor_health'
  | 'doctor_timeline'
  | 'doctor_playbook_run'
  | 'intel_bulletin_submit'
  | 'intel_state'

const MASTER_ALLOWED_ACTIONS = new Set<Action>([
  'health_check',
  'doctor_health',
  'doctor_timeline',
  'doctor_playbook_run',
])

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function tryParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 500) } }
}

function proxyResponse(result: { ok: boolean; status: number; data: unknown }, req: Request): Response {
  return new Response(
    JSON.stringify(result.data),
    { status: result.ok ? result.status : result.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
  )
}

function json400(message: string, req: Request): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const token = extractBearerToken(req)
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const { data: profile } = await (supabaseAdmin.from('user_profiles') as any)
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle()

    const body = await req.json()
    const action = String(body?.action ?? '').trim() as Action

    const role = String(profile?.role || '')
    const isGrandMaster = role === 'grand_master'
    const isMaster = role === 'master'
    const actionAllowedForMaster = MASTER_ALLOWED_ACTIONS.has(action)
    if (!isGrandMaster && !(isMaster && actionAllowedForMaster)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: insufficient role for this action' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const inferenceUrl = (Deno.env.get('INFERENCE_SERVICE_URL') ?? '').replace(/\/$/, '')
    const inferenceApiKey = Deno.env.get('INFERENCE_API_KEY') ?? ''

    if (!inferenceUrl) {
      return new Response(
        JSON.stringify({ error: 'INFERENCE_SERVICE_URL is not configured' }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const bobHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) bobHeaders['x-inference-api-key'] = inferenceApiKey

    async function bobGet(path: string) {
      const resp = await fetch(`${inferenceUrl}${path}`, { headers: bobHeaders })
      const text = await resp.text()
      return { ok: resp.ok, status: resp.status, data: tryParse(text) }
    }

    async function bobPost(path: string, payload: unknown) {
      const resp = await fetch(`${inferenceUrl}${path}`, {
        method: 'POST',
        headers: bobHeaders,
        body: JSON.stringify(payload),
      })
      const text = await resp.text()
      return { ok: resp.ok, status: resp.status, data: tryParse(text) }
    }

    async function bobDelete(path: string) {
      const resp = await fetch(`${inferenceUrl}${path}`, { method: 'DELETE', headers: bobHeaders })
      const text = await resp.text()
      return { ok: resp.ok, status: resp.status, data: tryParse(text) }
    }

    // ── Route by action ──────────────────────────────────────────────────────

    if (action === 'code_task_submit') {
      const { task, context, target_files, priority } = body
      if (!task || typeof task !== 'string' || !task.trim()) {
        return json400('task must be a non-empty string describing what to build or fix', req)
      }
      const result = await bobPost('/code/task', {
        task: task.trim(),
        context: context || undefined,
        target_files: Array.isArray(target_files) ? target_files : [],
        priority: priority === 'high' ? 'high' : 'normal',
        requested_by: user.email ?? user.id,
      })
      return proxyResponse(result, req)
    }

    if (action === 'code_tasks_list') {
      const statusParam = body?.status ? `?status=${encodeURIComponent(String(body.status))}` : ''
      const result = await bobGet(`/code/tasks${statusParam}`)
      return proxyResponse(result, req)
    }

    if (action === 'code_task_get') {
      const { task_id } = body
      if (!task_id) return json400('task_id is required', req)
      const result = await bobGet(`/code/tasks/${encodeURIComponent(String(task_id))}`)
      return proxyResponse(result, req)
    }

    if (action === 'code_task_skip') {
      const { task_id } = body
      if (!task_id) return json400('task_id is required', req)
      const result = await bobPost(`/code/tasks/${encodeURIComponent(String(task_id))}/skip`, {})
      return proxyResponse(result, req)
    }

    if (action === 'code_task_delete') {
      const { task_id } = body
      if (!task_id) return json400('task_id is required', req)
      const result = await bobDelete(`/code/tasks/${encodeURIComponent(String(task_id))}`)
      return proxyResponse(result, req)
    }

    if (action === 'code_patterns') {
      const result = await bobGet('/code/patterns')
      return proxyResponse(result, req)
    }

    if (action === 'code_conventions') {
      const result = await bobGet('/code/conventions')
      return proxyResponse(result, req)
    }

    if (action === 'code_tech_stack') {
      const result = await bobGet('/code/tech-stack')
      return proxyResponse(result, req)
    }

    if (action === 'code_assist') {
      const { question } = body
      if (!question || typeof question !== 'string') return json400('question is required', req)
      const result = await bobPost('/code/assist', { question: question.trim() })
      return proxyResponse(result, req)
    }

    if (action === 'ask_copilot_submit') {
      const { question, category, context } = body
      if (!question || typeof question !== 'string') return json400('question is required', req)
      const result = await bobPost('/ask-copilot', {
        question: question.trim(),
        category: category || undefined,
        context: context || undefined,
        source: 'grandmaster-studio',
      })
      return proxyResponse(result, req)
    }

    if (action === 'ask_copilot_list') {
      const statusParam = body?.status ? `?status=${encodeURIComponent(String(body.status))}` : ''
      const result = await bobGet(`/ask-copilot${statusParam}`)
      return proxyResponse(result, req)
    }

    if (action === 'health_check') {
      const result = await bobGet('/health')
      // Return the full health object — config only contains booleans, no secret values
      return proxyResponse(result, req)
    }

    if (action === 'doctor_health') {
      const result = await bobGet('/doctor/health')
      return proxyResponse(result, req)
    }

    if (action === 'doctor_timeline') {
      const limit = Number(body?.limit || 30)
      const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30
      const result = await bobGet(`/doctor/timeline?limit=${safeLimit}`)
      return proxyResponse(result, req)
    }

    if (action === 'doctor_playbook_run') {
      const playbook = String(body?.playbook || '').trim()
      const dryRun = body?.dry_run !== false
      if (!playbook) return json400('playbook is required', req)
      const result = await bobPost('/doctor/playbook/run', { playbook, dry_run: dryRun })
      return proxyResponse(result, req)
    }

    if (action === 'intel_bulletin_submit') {
      const { title, summary, type, source, metadata } = body
      if (!title || typeof title !== 'string') return json400('title is required', req)
      if (!summary || typeof summary !== 'string') return json400('summary is required', req)

      const bulletin = {
        title: title.trim(),
        summary: summary.trim(),
        type: type || 'operational',
        source: source || 'grandmaster-studio-copilot',
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
      }

      const rawBody = JSON.stringify({ bulletin })

      // Compute HMAC if INTEL_HMAC_KEY is configured (Bob verifies this)
      const hmacKey = Deno.env.get('INTEL_HMAC_KEY') ?? ''
      const extraHeaders: Record<string, string> = {}
      if (hmacKey) {
        const keyData = new TextEncoder().encode(hmacKey)
        const msgData = new TextEncoder().encode(rawBody)
        const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
        const sigHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
        extraHeaders['x-intel-signature'] = sigHex
      }

      const resp = await fetch(`${inferenceUrl}/intel/ingest-bulletin`, {
        method: 'POST',
        headers: { ...bobHeaders, ...extraHeaders },
        body: rawBody,
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    if (action === 'intel_state') {
      const result = await bobGet('/intel/state')
      return proxyResponse(result, req)
    }

    return new Response(
      JSON.stringify({
        error: 'Unknown action',
        available_actions: [
          'code_task_submit', 'code_tasks_list', 'code_task_get',
          'code_task_skip', 'code_task_delete',
          'code_patterns', 'code_conventions', 'code_tech_stack', 'code_assist',
          'ask_copilot_submit', 'ask_copilot_list', 'health_check',
          'doctor_health', 'doctor_timeline', 'doctor_playbook_run',
          'intel_bulletin_submit', 'intel_state',
        ],
      }),
      { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  }
})
