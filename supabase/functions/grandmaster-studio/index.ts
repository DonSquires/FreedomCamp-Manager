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
  | 'inference_endpoint_health'

const MASTER_ALLOWED_ACTIONS = new Set<Action>([
  'health_check',
  'doctor_health',
  'doctor_timeline',
  'doctor_playbook_run',
  'bob_automation_status',
  'inference_endpoint_health',
])

const GRANDMASTER_OWNER_EMAIL = (Deno.env.get('GRANDMASTER_OWNER_EMAIL') || 'squires.don@live.com').toLowerCase().trim()

const OWNER_ONLY_ACTIONS = new Set<Action>([
  'code_task_submit',
  'code_task_skip',
  'code_task_delete',
  'doctor_playbook_run',
  'ask_copilot_submit',
])

const ACTION_MUTATION_CONTRACT_MAP: Partial<Record<Action, string>> = {
  code_task_submit: 'queue_bob_code_change_task',
  code_task_skip: 'queue_bob_code_change_task',
  code_task_delete: 'queue_bob_code_change_task',
  doctor_health: 'run_grandmaster_diagnostics',
  doctor_timeline: 'run_grandmaster_diagnostics',
  doctor_playbook_run: 'run_grandmaster_diagnostics',
  inference_endpoint_health: 'run_grandmaster_diagnostics',
  ask_copilot_submit: 'queue_owner_research_task',
}

type BobExecutionMode = 'owner_full' | 'master_balanced' | 'officer_assist'

const SERVER_MUTATION_RULES: Record<string, BobExecutionMode[]> = {
  queue_bob_code_change_task: ['owner_full'],
  run_grandmaster_diagnostics: ['owner_full', 'master_balanced'],
  queue_owner_research_task: ['owner_full'],
}

function resolveExecutionModeFromRole(role: string): BobExecutionMode {
  const normalized = String(role || '').toLowerCase()
  if (normalized === 'grand_master') return 'owner_full'
  if (normalized === 'master' || normalized === 'admin' || normalized === 'client_admin') return 'master_balanced'
  return 'officer_assist'
}

function validateRequestedMutationContract(input: {
  requestedContract: string | null
  actionContract: string | null
  mode: BobExecutionMode
}): { allowed: boolean; reason: string } {
  if (!input.actionContract) {
    return {
      allowed: input.requestedContract === null,
      reason: input.requestedContract
        ? 'No mutation contract is allowed for this action.'
        : 'No mutation contract required for this action.',
    }
  }

  if (!input.requestedContract) {
    return {
      allowed: false,
      reason: `Missing required mutation contract ${input.actionContract} for this action.`,
    }
  }

  if (input.requestedContract !== input.actionContract) {
    return {
      allowed: false,
      reason: `Requested mutation contract ${input.requestedContract} does not match required contract ${input.actionContract}.`,
    }
  }

  const allowedModes = SERVER_MUTATION_RULES[input.requestedContract] ?? []
  if (!allowedModes.includes(input.mode)) {
    return {
      allowed: false,
      reason: `Requested mutation contract ${input.requestedContract} is blocked for mode ${input.mode}.`,
    }
  }

  return {
    allowed: true,
    reason: `Requested mutation contract ${input.requestedContract} is allowed.`,
  }
}

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
  return String(raw ?? '').trim().replace(/\/+$/, '').replace(/\/(?:runsync|run)\/?$/i, '')
}

function isRunpodServerlessBaseUrl(url: string): boolean {
  return /https:\/\/api\.runpod\.ai\/v2\//i.test(String(url || ''))
}

function unknownActionMessage(data: any): string {
  const candidates = [
    data?.error,
    data?.message,
    data?.output?.error,
    data?.output?.message,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && /Unknown action:/i.test(value)) {
      return value
    }
  }
  return ''
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

function normalizeIntelType(input: unknown): 'law' | 'security' | 'jurisdiction' | 'system' | 'other' {
  const value = String(input ?? '').trim().toLowerCase()
  if (value === 'law' || value === 'security' || value === 'jurisdiction' || value === 'system') return value
  return 'other'
}

function resolveIntelOrganizationId(body: any, profile: any): string | null {
  const fromBody = String(body?.organization_id ?? body?.org_id ?? '').trim()
  if (fromBody) return fromBody
  const fromProfile = String(profile?.organization_id ?? '').trim()
  return fromProfile || null
}

function parsePublishedAt(input: unknown): string | null {
  const value = String(input ?? '').trim()
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function sanitizeSourceUrl(input: unknown): string | null {
  const value = String(input ?? '').trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) return null
  return value.slice(0, 2000)
}

function getRunpodEndpointContext() {
  const endpointId = (Deno.env.get('RUNPOD_ENDPOINT_ID') || '').trim()
  const endpointLabel = (Deno.env.get('RUNPOD_ENDPOINT_LABEL') || endpointId || 'Configured endpoint').trim()
  const workerProfile = (Deno.env.get('RUNPOD_WORKER_PROFILE') || Deno.env.get('RUNPOD_PRIMARY_GPU_PROFILE') || 'Serverless worker').trim()
  const targetWorkers = parseInteger(Deno.env.get('RUNPOD_TARGET_WORKERS'), parseInteger(Deno.env.get('RUNPOD_TARGET_PODS'), 0))
  const activeWorkers = parseInteger(Deno.env.get('RUNPOD_ACTIVE_WORKERS'), parseInteger(Deno.env.get('RUNPOD_ACTIVE_PODS'), targetWorkers))
  const balanceHintUsd = parseFloatValue(Deno.env.get('RUNPOD_BALANCE_HINT_USD'))

  return {
    endpointId,
    endpointLabel,
    workerProfile,
    targetWorkers,
    activeWorkers,
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
      .select('role, first_name, last_name, organization_id')
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

    const executionMode = resolveExecutionModeFromRole(role)
    const actionContract = ACTION_MUTATION_CONTRACT_MAP[action] ?? null
    const requestedContract = typeof body?.requested_mutation_contract === 'string'
      ? String(body.requested_mutation_contract).trim()
      : null
    const contractAccess = validateRequestedMutationContract({
      requestedContract,
      actionContract,
      mode: executionMode,
    })

    if (!contractAccess.allowed) {
      return new Response(
        JSON.stringify({ error: `Mutation contract blocked by server policy: ${contractAccess.reason}` }),
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

    async function bobRunsync(action: string, payload: Record<string, unknown> = {}) {
      const resp = await fetch(`${inferenceUrl}/runsync`, {
        method: 'POST',
        headers: bobHeaders,
        body: JSON.stringify({
          input: {
            action,
            ...payload,
          },
        }),
      })
      const text = await resp.text()
      return { ok: resp.ok, status: resp.status, data: tryParse(text) }
    }

    const useRunpodServerlessRouting = isRunpodServerlessBaseUrl(inferenceUrl)

    // ── Route by action ──────────────────────────────────────────────────────

    if (action === 'code_task_submit') {
      const { task, context, target_files, priority } = body
      if (!task || typeof task !== 'string' || !task.trim()) {
        return json400('task must be a non-empty string describing what to build or fix', req)
      }
      const payload = {
        task: task.trim(),
        context: context || undefined,
        target_files: Array.isArray(target_files) ? target_files : [],
        priority: priority === 'high' ? 'high' : 'normal',
        requested_by: user.email ?? user.id,
      }
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_task_submit', payload)
        : await bobPost('/code/task', payload)

      if (useRunpodServerlessRouting) {
        const unknownAction = unknownActionMessage(result.data)
        if (unknownAction) {
          const brief = await bobRunsync('plan', {
            objective: `Create a concise execution-ready code-change plan for this task: ${payload.task}`,
            task: payload.task,
          })

          result = {
            ok: true,
            status: 200,
            data: {
              success: false,
              status: 'fallback',
              mode: 'serverless-plan',
              warning: 'Serverless endpoint does not support code_task_submit; generated a Bob execution plan instead.',
              error: unknownAction,
              plan: brief.data,
              requested_task: payload,
            },
          }
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_tasks_list') {
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_tasks_list', {
            status: body?.status ? String(body.status) : undefined,
          })
        : await bobGet(`/code/tasks${body?.status ? `?status=${encodeURIComponent(String(body.status))}` : ''}`)

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: true,
            mode: 'serverless-no-queue',
            tasks: [],
            warning: 'Serverless endpoint does not expose queue list actions.',
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_task_get') {
      const { task_id } = body
      if (!task_id) return json400('task_id is required', req)
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_task_get', { task_id: String(task_id) })
        : await bobGet(`/code/tasks/${encodeURIComponent(String(task_id))}`)

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: false,
            mode: 'serverless-no-queue',
            warning: 'Serverless endpoint does not expose queue get actions.',
            task_id: String(task_id),
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_task_skip') {
      const { task_id } = body
      if (!task_id) return json400('task_id is required', req)
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_task_skip', { task_id: String(task_id) })
        : await bobPost(`/code/tasks/${encodeURIComponent(String(task_id))}/skip`, {})

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: false,
            mode: 'serverless-no-queue',
            warning: 'Serverless endpoint does not expose queue skip actions.',
            task_id: String(task_id),
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_task_delete') {
      const { task_id } = body
      if (!task_id) return json400('task_id is required', req)
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_task_delete', { task_id: String(task_id) })
        : await bobDelete(`/code/tasks/${encodeURIComponent(String(task_id))}`)

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: false,
            mode: 'serverless-no-queue',
            warning: 'Serverless endpoint does not expose queue delete actions.',
            task_id: String(task_id),
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_patterns') {
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_patterns')
        : await bobGet('/code/patterns')

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: true,
            mode: 'serverless-fallback',
            patterns: [],
            warning: 'Serverless endpoint does not expose code_patterns action.',
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_conventions') {
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_conventions')
        : await bobGet('/code/conventions')

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: true,
            mode: 'serverless-fallback',
            conventions: [],
            warning: 'Serverless endpoint does not expose code_conventions action.',
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_tech_stack') {
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_tech_stack')
        : await bobGet('/code/tech-stack')

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        result = {
          ok: true,
          status: 200,
          data: {
            success: true,
            mode: 'serverless-fallback',
            tech_stack: [],
            warning: 'Serverless endpoint does not expose code_tech_stack action.',
          },
        }
      }
      return proxyResponse(result, req)
    }

    if (action === 'code_assist') {
      const { question } = body
      if (!question || typeof question !== 'string') return json400('question is required', req)
      let result = useRunpodServerlessRouting
        ? await bobRunsync('code_assist', { question: question.trim() })
        : await bobPost('/code/assist', { question: question.trim() })

      if (useRunpodServerlessRouting && unknownActionMessage(result.data)) {
        const chatFallback = await bobRunsync('chat', {
          message: `Provide concise coding assistance for this question: ${question.trim()}`,
        })
        result = {
          ok: true,
          status: 200,
          data: {
            success: false,
            status: 'fallback',
            mode: 'serverless-chat',
            warning: 'Serverless endpoint does not expose code_assist action; used chat fallback.',
            response: chatFallback.data,
          },
        }
      }
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

    if (action === 'inference_endpoint_health') {
      const PROBE_TIMEOUT_MS = 7000
      const PROBE_PROMPT = 'ping'

      const inferenceEnv = {
        primary: Deno.env.get('INFERENCE_SERVICE_URL') ?? '',
        fallback: Deno.env.get('INFERENCE_SERVICE_FALLBACK_URL') ?? '',
        secondary: Deno.env.get('INFERENCE_SERVICE_URL_SECONDARY') ?? '',
        runpod: Deno.env.get('RUNPOD_ENDPOINT_URL') ?? Deno.env.get('INFERENCE_SERVICE_URL_RUNPOD') ?? '',
        list: Deno.env.get('BOB_INFERENCE_URLS') ?? '',
      }

      const seen = new Set<string>()
      const candidates: string[] = [
        inferenceEnv.primary,
        inferenceEnv.fallback,
        inferenceEnv.secondary,
        inferenceEnv.runpod,
        ...inferenceEnv.list.split(',').map((s) => s.trim()),
      ]
        .filter(Boolean)
        .map((u) => {
          const t = u.trim().replace(/\/$/, '')
          return /^https?:\/\//i.test(t) ? t : `https://${t}`
        })
        .filter((u) => {
          if (seen.has(u)) return false
          seen.add(u)
          return true
        })

      if (candidates.length === 0) {
        return json400('No inference endpoints configured', req)
      }

      const apiKey = Deno.env.get('INFERENCE_SERVICE_API_KEY') ?? Deno.env.get('RUNPOD_API_KEY') ?? ''
      const probeHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) probeHeaders['Authorization'] = `Bearer ${apiKey}`

      function isRunpod(url: string) { return /api\.runpod\.ai\/v2\/[^/]+/i.test(url) }

      const results = await Promise.all(
        candidates.map(async (base) => {
          const probeUrl = isRunpod(base)
            ? `${base.replace(/\/(run|runsync)\/?$/i, '')}/runsync`
            : `${base}/api/chat`
          const probeBody = isRunpod(base)
            ? JSON.stringify({ input: { prompt: PROBE_PROMPT, max_tokens: 1, stream: false } })
            : JSON.stringify({ model: Deno.env.get('OLLAMA_MODEL') ?? 'llama3', messages: [{ role: 'user', content: PROBE_PROMPT }], stream: false, options: { num_predict: 1 } })

          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
          const start = Date.now()
          try {
            const res = await fetch(probeUrl, { method: 'POST', headers: probeHeaders, body: probeBody, signal: controller.signal })
            const latencyMs = Date.now() - start
            clearTimeout(timer)
            const status = res.ok ? 'healthy' : (res.status >= 500 || res.status === 503) ? 'down' : 'degraded'
            return { url: base, status, latencyMs, httpStatus: res.status, checkedAt: new Date().toISOString() }
          } catch (err: unknown) {
            const latencyMs = Date.now() - start
            clearTimeout(timer)
            const isTimeout = (err as { name?: string }).name === 'AbortError'
            return { url: base, status: 'down' as const, latencyMs, httpStatus: null, detail: isTimeout ? 'timeout' : String(err), checkedAt: new Date().toISOString() }
          }
        }),
      )

      const healthy = results.filter((r) => r.status === 'healthy')
      const payload = {
        generatedAt: new Date().toISOString(),
        totalEndpoints: candidates.length,
        healthyCount: healthy.length,
        recommended: healthy[0]?.url ?? results.find((r) => r.status === 'degraded')?.url ?? null,
        endpoints: results,
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
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

      const intelType = normalizeIntelType(type)
      const sourceName = String(source || 'grandmaster-studio-copilot').trim().slice(0, 120)
      const metadataObject = metadata && typeof metadata === 'object' ? metadata : {}

      if (isRunpodServerlessBaseUrl(inferenceUrl)) {
        const organizationId = resolveIntelOrganizationId(body, profile)
        if (!organizationId) {
          return json400('organization_id is required for Supabase intel fallback', req)
        }

        const row = {
          organization_id: organizationId,
          type: intelType,
          title: title.trim(),
          summary: summary.trim(),
          source_url: sanitizeSourceUrl(body?.source_url ?? metadataObject?.source_url ?? null),
          published_at: parsePublishedAt(body?.published_at ?? metadataObject?.published_at ?? null),
          metadata: {
            ...(metadataObject as Record<string, unknown>),
            source: sourceName,
            ingest_mode: 'grandmaster-runsync-supabase-fallback',
            inference_url: inferenceUrl,
            submitted_by: String(user.id),
            submitted_at: new Date().toISOString(),
          },
        }

        const { data: inserted, error: insertError } = await (supabaseAdmin
          .from('external_intel_bulletins') as any)
          .insert(row)
          .select('id, organization_id, type, title, created_at')
          .single()

        if (insertError) {
          return new Response(
            JSON.stringify({
              error: 'Failed to persist intel bulletin to Supabase fallback store',
              detail: insertError.message,
            }),
            { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
          )
        }

        return new Response(
          JSON.stringify({
            ok: true,
            mode: 'supabase-fallback',
            persisted: true,
            guidance: 'Runsync-only endpoint detected. Bulletin stored in external_intel_bulletins for durable memory.',
            bulletin: inserted,
          }),
          { status: 201, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
        )
      }

      const bulletin = {
        title: title.trim(),
        summary: summary.trim(),
        type: intelType,
        source: sourceName,
        metadata: metadataObject,
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
      if (isRunpodServerlessBaseUrl(inferenceUrl)) {
        const organizationId = resolveIntelOrganizationId(body, profile)
        const requestedLimit = Number(body?.limit)
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(200, Math.floor(requestedLimit)))
          : 25

        let query = (supabaseAdmin
          .from('external_intel_bulletins') as any)
          .select('id, organization_id, type, title, source_url, published_at, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(limit)

        if (organizationId) {
          query = query.eq('organization_id', organizationId)
        }

        const { data: rows, error: queryError } = await query
        if (queryError) {
          return new Response(
            JSON.stringify({
              error: 'Failed to load Supabase fallback intel state',
              detail: queryError.message,
            }),
            { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
          )
        }

        const safeRows = Array.isArray(rows) ? rows : []
        const byType = safeRows.reduce((acc: Record<string, number>, row: any) => {
          const key = normalizeIntelType(row?.type)
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})

        return new Response(
          JSON.stringify({
            ok: true,
            mode: 'supabase-fallback',
            persisted: true,
            inferenceUrl,
            organization_id: organizationId,
            recent_count: safeRows.length,
            by_type: byType,
            latest_created_at: safeRows[0]?.created_at ?? null,
            records: safeRows,
            guidance: 'Runsync-only endpoint detected. Returning durable state from external_intel_bulletins.',
          }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
        )
      }

      const result = await bobGet('/intel/state')
      return proxyResponse(result, req)
    }

    if (action === 'bob_automation_status') {
      const health = await bobGet('/health')
      const doctor = await bobGet('/doctor/health')
      const runpodDollars = await getRunpodDollarRemaining()
      const runpodEndpoint = getRunpodEndpointContext()

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
          runpodEndpoint,
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
