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

    if (profile?.role !== 'grand_master') {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Grand Master access required' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const body = await req.json()
    const action = String(body?.action ?? '').trim() as Action

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

    return new Response(
      JSON.stringify({
        error: 'Unknown action',
        available_actions: [
          'code_task_submit', 'code_tasks_list', 'code_task_get',
          'code_task_skip', 'code_task_delete',
          'code_patterns', 'code_conventions', 'code_tech_stack', 'code_assist',
          'ask_copilot_submit', 'ask_copilot_list', 'health_check',
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
