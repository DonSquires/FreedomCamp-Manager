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
  | 'bob_automation_status'

const MASTER_ALLOWED_ACTIONS = new Set<Action>([
  'health_check',
  'doctor_health',
  'doctor_timeline',
  'doctor_playbook_run',
  'bob_automation_status',
])

const GRANDMASTER_OWNER_EMAIL = (Deno.env.get('GRANDMASTER_OWNER_EMAIL') || 'squires.don@live.com').toLowerCase().trim()

const OWNER_ONLY_ACTIONS = new Set<Action>([
  'code_task_submit',
  'code_task_skip',
  'code_task_delete',
  'doctor_playbook_run',
  'ask_copilot_submit',
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

function normalizeBaseUrl(raw?: string | null): string {
  return String(raw ?? '').trim().replace(/\/+$/, '')
}

async function runpodGraphql(apiKey: string, query: string) {
  const response = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })

  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    body: tryParse(text) as any,
  }
}

function numericFromObject(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return null
}

async function getRunpodDollarRemaining() {
  const apiKey =
    (Deno.env.get('RUNPOD_API_KEY') ?? Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ?? '').trim()
  if (!apiKey) {
    return { available: false, reason: 'missing-runpod-api-key' }
  }

  const attempts = [
    {
      label: 'myself-clientBalance',
      query: 'query { myself { clientBalance } }',
      extract: (body: any) => numericFromObject(body?.data?.myself, ['clientBalance']),
    },
    {
      label: 'myself-creditBalance',
      query: 'query { myself { creditBalance } }',
      extract: (body: any) => numericFromObject(body?.data?.myself, ['creditBalance']),
    },
    {
      label: 'myself-balance',
      query: 'query { myself { balance } }',
      extract: (body: any) => numericFromObject(body?.data?.myself, ['balance']),
    },
    {
      label: 'myself-accountBalance',
      query: 'query { myself { accountBalance } }',
      extract: (body: any) => numericFromObject(body?.data?.myself, ['accountBalance']),
    },
  ]

  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      const result = await runpodGraphql(apiKey, attempt.query)
      const value = attempt.extract(result.body)
      if (value !== null) {
        return {
          available: true,
          source: attempt.label,
          usdRemaining: value,
          formatted: `$${value.toFixed(2)}`,
        }
      }

      const errorText = JSON.stringify((result.body as any)?.errors ?? result.body ?? {}).slice(0, 240)
      errors.push(`${attempt.label}: HTTP ${result.status} ${errorText}`)
    } catch (error: any) {
      errors.push(`${attempt.label}: ${String(error?.message || error)}`)
    }
  }

  return {
    available: false,
    reason: 'balance-field-not-accessible',
    attempts: errors,
  }
}

function parseInteger(input: string | null | undefined, fallback: number): number {
  const n = Number(String(input ?? '').trim())
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback
}

function parseFloatValue(input: string | null | undefined): number | null {
  const n = Number(String(input ?? '').trim())
  return Number.isFinite(n) ? n : null
}

function getRunpodPodContext() {
  const podName = (Deno.env.get('RUNPOD_PRIMARY_POD_NAME') || 'bob-automation-pod-v3').trim()
  const gpuProfile = (Deno.env.get('RUNPOD_PRIMARY_GPU_PROFILE') || 'RTX 4090 x1').trim()
  const targetPods = parseInteger(Deno.env.get('RUNPOD_TARGET_PODS'), 3)
  const activePods = parseInteger(Deno.env.get('RUNPOD_ACTIVE_PODS'), targetPods)
  const balanceHintUsd = parseFloatValue(Deno.env.get('RUNPOD_BALANCE_HINT_USD'))

  return {
    podName,
    gpuProfile,
    targetPods,
    activePods,
    ...(balanceHintUsd !== null
      ? {
          balanceHintUsd,
          balanceHintFormatted: `$${balanceHintUsd.toFixed(2)}`,
        }
      : {}),
  }
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

    const email = String(user.email || '').toLowerCase().trim()
    const ownerOnlyAction = OWNER_ONLY_ACTIONS.has(action)
    if (ownerOnlyAction && !(isGrandMaster && email === GRANDMASTER_OWNER_EMAIL)) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden: this action is restricted to the configured Grandmaster owner account',
        }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const inferenceUrl = normalizeBaseUrl(Deno.env.get('INFERENCE_SERVICE_URL'))
    const inferenceApiKey =
      Deno.env.get('INFERENCE_API_KEY') ??
      Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ??
      Deno.env.get('RUNPOD_API_KEY') ??
      ''

    if (!inferenceUrl) {
      return new Response(
        JSON.stringify({ error: 'INFERENCE_SERVICE_URL is not configured' }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const bobHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) {
      bobHeaders['x-inference-api-key'] = inferenceApiKey
      bobHeaders['Authorization'] = `Bearer ${inferenceApiKey}`
    }

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

    if (action === 'bob_automation_status') {
      const health = await bobGet('/health')
      const doctor = await bobGet('/doctor/health')
      const runpodDollars = await getRunpodDollarRemaining()
      const runpodPod = getRunpodPodContext()

      return new Response(
        JSON.stringify({
          ok: health.ok || doctor.ok,
          checkedAt: new Date().toISOString(),
          inference: {
            baseUrl: inferenceUrl,
            health: {
              ok: health.ok,
              status: health.status,
              data: health.data,
            },
            doctor: {
              ok: doctor.ok,
              status: doctor.status,
              data: doctor.data,
            },
          },
          runpodDollars,
          runpodPod,
        }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
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
          'intel_bulletin_submit', 'intel_state', 'bob_automation_status',
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
