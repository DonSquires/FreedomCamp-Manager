import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type Severity = 'low' | 'medium' | 'high' | 'critical'
type Complexity = 'simple' | 'moderate' | 'complex'
type TaskType = 'self_heal_patch' | 'human_test_run'
type AutonomyTier = 'auto_fix_allowed' | 'approval_required' | 'never_auto_fix'
const BOB_REQUEST_TIMEOUT_MS = 60_000
const GRANDMASTER_OWNER_EMAIL = (Deno.env.get('GRANDMASTER_OWNER_EMAIL') || 'squires.don@live.com').toLowerCase().trim()
const PROTECTED_PATH_PREFIXES = [
  'supabase/migrations/',
  'supabase/functions/',
  'src/stores/authStore',
  'src/lib/supabase',
]

type BobExecutionMode = 'owner_full' | 'master_balanced' | 'officer_assist'
const REQUIRED_MUTATION_CONTRACT = 'queue_bob_code_change_task'

function resolveExecutionModeFromRole(role: string): BobExecutionMode {
  const normalized = String(role || '').toLowerCase()
  if (normalized === 'grand_master') return 'owner_full'
  if (normalized === 'master' || normalized === 'admin' || normalized === 'client_admin') return 'master_balanced'
  return 'officer_assist'
}

function validateRequestedMutationContract(contract: string | null, mode: BobExecutionMode): { allowed: boolean; reason: string } {
  if (!contract) {
    return {
      allowed: false,
      reason: `Missing required mutation contract ${REQUIRED_MUTATION_CONTRACT}.`,
    }
  }

  if (contract !== REQUIRED_MUTATION_CONTRACT) {
    return {
      allowed: false,
      reason: `Requested mutation contract ${contract} does not match required contract ${REQUIRED_MUTATION_CONTRACT}.`,
    }
  }

  if (mode !== 'owner_full') {
    return {
      allowed: false,
      reason: `Requested mutation contract ${contract} is blocked for mode ${mode}.`,
    }
  }

  return {
    allowed: true,
    reason: `Requested mutation contract ${contract} is allowed.`,
  }
}

const ARCHITECTURAL_CONTEXT_INJECTION = {
  training_packs: {
    stack_schema_fidelity: 'docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md',
    tenant_isolation_proof: 'docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md',
    self_eval_loop: 'docs/BOB_TRAINING_SELF_EVAL_LOOP.md',
    truth_protocol: 'docs/BOB_TRAINING_TRUTH_PROTOCOL.md',
    advanced_architect_2026: 'docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md',
  },
  advanced_architect_protocol: {
    require_spec_first_flow: true,
    require_self_critique_count: 3,
    require_ticketized_plan: true,
    require_dr_bob_review: true,
    require_tests_before_done: true,
    require_rlhf_scoring_feedback: true,
  },
  truth_protocol: {
    required_before_major_redesign: true,
    system_check_scripts: ['scripts/system-check.sh', 'scripts/system-check.mjs'],
    state_file: 'system_state.json',
    no_assumptions_rule: true,
    package_manager_rules: {
      'package-lock.json': 'use npm',
      package_lock_json: 'use npm',
    },
  },
  multi_org_driver: {
    scope_by: 'organizationId',
    require_context_indicator: true,
    never_cross_tenant_leak: true,
  },
  visual_hierarchy: {
    prefer_spacing_over_borders: true,
    color_logic: {
      action: 'blue',
      success: 'green',
      warning: 'amber',
      danger: 'red',
    },
  },
  realtime_ptt: {
    require_optimistic_updates: true,
    required_states: ['idle', 'processing', 'synced', 'error'],
    account_for_latency_bridge: true,
  },
  modular_architecture: {
    module_root: 'src/modules',
    must_be_self_contained: true,
    avoid_cross_module_coupling: true,
  },
  module_blueprint: {
    required_structure: ['components', 'services', 'hooks', 'types.ts'],
    require_org_hook: true,
    dashboard_pattern: {
      header_active_org_and_breadcrumbs: true,
      grid: '12-column-desktop-1-column-mobile',
      require_empty_state: true,
    },
  },
  validation_checklist: {
    no_cross_org_leakage: true,
    low_spec_vps_support: true,
    keyboard_accessible: true,
    refactoring_ui_hierarchy: true,
  },
  required_output_sections: ['Schema Evidence', 'Tenant Isolation Proof', 'Self-Eval Gates'],
  self_eval_gate_names: [
    'stack_fidelity',
    'org_scope_enforcement',
    'tenant_isolation_proof',
    'ui_hierarchy_color_semantics',
    'realtime_ptt_states',
    'module_blueprint_compliance',
    'accessibility_coverage',
    'low_spec_vps_performance',
  ],
}

function isProtectedPath(pathValue: string): boolean {
  const normalized = String(pathValue || '').trim().replace(/^\/+/, '')
  if (!normalized) return false
  return PROTECTED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function deriveAutonomyTier(input: {
  requestedTier: unknown
  taskType: TaskType
  severity: Severity
  complexity: Complexity
  targetPaths: string[]
}): AutonomyTier {
  const requestedTier = String(input.requestedTier || '').trim() as AutonomyTier
  if (requestedTier === 'auto_fix_allowed' || requestedTier === 'approval_required' || requestedTier === 'never_auto_fix') {
    return requestedTier
  }

  if (input.taskType === 'human_test_run') return 'auto_fix_allowed'
  if (input.severity === 'critical') return 'never_auto_fix'
  if (input.complexity === 'complex') return 'approval_required'
  if (input.severity === 'high') return 'approval_required'
  if (input.targetPaths.some(isProtectedPath)) return 'approval_required'
  return 'auto_fix_allowed'
}

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
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    const role = String(profile?.role || '').trim()
    const email = String(user.email || '').toLowerCase().trim()
    const isOwnerGrandmaster = role === 'grand_master' && email === GRANDMASTER_OWNER_EMAIL
    if (!isOwnerGrandmaster) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden: only the configured Grandmaster owner may run Bob coding/human-test tasks',
        }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const body = await req.json()
    const executionMode = resolveExecutionModeFromRole(role)
    const requestedContract = typeof body?.requested_mutation_contract === 'string'
      ? String(body.requested_mutation_contract).trim()
      : null
    const contractAccess = validateRequestedMutationContract(requestedContract, executionMode)
    if (!contractAccess.allowed) {
      return new Response(
        JSON.stringify({ error: `Mutation contract blocked by server policy: ${contractAccess.reason}` }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const summary = String(body?.summary ?? '').trim()
    const details = String(body?.details ?? '').trim()
    const stackTrace = String(body?.stack_trace ?? '').trim()
    const severity = (body?.severity ?? 'medium') as Severity
    const complexity = (body?.complexity ?? 'moderate') as Complexity
    const taskType = (body?.task_type ?? 'self_heal_patch') as TaskType
    const approved = body?.approved === true
    const targetPaths = Array.isArray(body?.target_paths)
      ? body.target_paths.map((p: unknown) => String(p)).filter(Boolean)
      : []

    const normalizedTaskType: TaskType = taskType === 'human_test_run' ? 'human_test_run' : 'self_heal_patch'
    const autonomyTier = deriveAutonomyTier({
      requestedTier: body?.autonomy_tier,
      taskType: normalizedTaskType,
      severity,
      complexity,
      targetPaths,
    })

    if (autonomyTier === 'never_auto_fix') {
      return new Response(
        JSON.stringify({
          success: false,
          requires_approval: true,
          autonomy_tier: autonomyTier,
          task_type: normalizedTaskType,
          reason: 'Policy blocks autonomous execution for this request.',
        }),
        { status: 202, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    if (autonomyTier === 'approval_required' && !approved) {
      return new Response(
        JSON.stringify({
          success: false,
          requires_approval: true,
          autonomy_tier: autonomyTier,
          task_type: normalizedTaskType,
          reason: 'Approval is required before Bob can execute this task.',
        }),
        { status: 202, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    if (!summary) {
      return new Response(
        JSON.stringify({ error: 'summary is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const inferenceUrl = (Deno.env.get('INFERENCE_SERVICE_URL') ?? '').replace(/\/$/, '')
    const inferenceApiKey =
      Deno.env.get('INFERENCE_API_KEY') ??
      Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ??
      Deno.env.get('RUNPOD_API_KEY') ??
      Deno.env.get('BOB_INFERENCE_API_KEY') ??
      ''

    if (!inferenceUrl) {
      return new Response(
        JSON.stringify({ error: 'INFERENCE_SERVICE_URL is not configured' }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const preferGithubAssist = normalizedTaskType === 'self_heal_patch' && complexity === 'complex'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) {
      headers['x-inference-api-key'] = inferenceApiKey
      headers['Authorization'] = `Bearer ${inferenceApiKey}`
    }

    const reportPayload = {
      summary,
      severity,
      details: details || undefined,
      stack_trace: stackTrace || undefined,
      target_paths: targetPaths.length ? targetPaths : undefined,
      source: 'bob-assistant-studio',
      requested_by: user.email ?? user.id,
      requested_at: new Date().toISOString(),
      execution_mode_hint: preferGithubAssist ? 'github_assist' : 'self_heal_worker',
      task_type: normalizedTaskType,
      autonomy_tier: autonomyTier,
      architecture_context: ARCHITECTURAL_CONTEXT_INJECTION,
    }

    let payload: Record<string, unknown> | null = null
    if (normalizedTaskType === 'self_heal_patch') {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), BOB_REQUEST_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetch(`${inferenceUrl}/self-heal/patch-task`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ report: reportPayload }),
          signal: controller.signal,
        })
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return new Response(
            JSON.stringify({ error: `Bob patch-task request timed out after ${Math.floor(BOB_REQUEST_TIMEOUT_MS / 1000)}s` }),
            { status: 504, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
          )
        }
        throw err
      } finally {
        clearTimeout(timeoutId)
      }

      const text = await response.text()
      payload = (() => {
        try { return JSON.parse(text) } catch { return null }
      })()

      if (!response.ok) {
        return new Response(
          JSON.stringify({
            error: `Patch-task endpoint returned ${response.status}`,
            details: text.slice(0, 500),
          }),
          { status: response.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
        )
      }
    }

    if (!preferGithubAssist) {
      const patchTask = payload?.patch_task && typeof payload.patch_task === 'object'
        ? payload.patch_task
        : null

      const executorRequest = normalizedTaskType === 'human_test_run'
        ? {
            type: 'human_test_run',
            command: 'node',
            args: ['scripts/human-test-engine.mjs', '--skip-ui', 'true'],
            cwd: '.',
            allow_in_dry_run: true,
            timeout_ms: 180000,
            schema_sync_before_test: true,
          }
        : null

      const queueBody = {
        task: normalizedTaskType === 'human_test_run'
          ? `Human Test: ${summary}`
          : `Self-heal: ${summary}`,
        context: JSON.stringify({
          summary,
          severity,
          details: details || null,
          stack_trace: stackTrace || null,
          task_type: normalizedTaskType,
          autonomy_tier: autonomyTier,
          architecture_context: ARCHITECTURAL_CONTEXT_INJECTION,
          patch_task: patchTask,
          executor_request: executorRequest,
          schema_sync_before_test: normalizedTaskType === 'human_test_run',
          schema_sync_required: normalizedTaskType === 'human_test_run',
          requested_by: user.email ?? user.id,
          source: 'bob-code-change-task',
        }),
        target_files: targetPaths.length > 0
          ? targetPaths
          : (normalizedTaskType === 'human_test_run' ? ['scripts/human-test-engine.mjs', 'tools/human-test-engine'] : []),
        priority: severity === 'high' || severity === 'critical' ? 'high' : 'normal',
        requested_by: user.email ?? user.id,
      }

      const queueController = new AbortController()
      const queueTimeoutId = setTimeout(() => queueController.abort(), BOB_REQUEST_TIMEOUT_MS)

      let queueResp: Response
      try {
        queueResp = await fetch(`${inferenceUrl}/code/task`, {
          method: 'POST',
          headers,
          body: JSON.stringify(queueBody),
          signal: queueController.signal,
        })
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return new Response(
            JSON.stringify({ error: `Bob code-task queue request timed out after ${Math.floor(BOB_REQUEST_TIMEOUT_MS / 1000)}s` }),
            { status: 504, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
          )
        }
        throw err
      } finally {
        clearTimeout(queueTimeoutId)
      }

      const queueText = await queueResp.text()
      const queuePayload = (() => {
        try { return JSON.parse(queueText) } catch { return null }
      })()

      if (!queueResp.ok || !queuePayload?.task?.id) {
        return new Response(
          JSON.stringify({
            error: `Code task queue returned ${queueResp.status}`,
            details: queueText.slice(0, 500),
            patch_task: payload,
          }),
          { status: queueResp.ok ? 502 : queueResp.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
        )
      }

      const taskId = String(queuePayload.task.id)

      const execController = new AbortController()
      const execTimeoutId = setTimeout(() => execController.abort(), BOB_REQUEST_TIMEOUT_MS)

      let execResp: Response
      try {
        execResp = await fetch(`${inferenceUrl}/code/tasks/${taskId}/execute-internal`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ source: 'bob-code-change-task' }),
          signal: execController.signal,
        })
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return new Response(
            JSON.stringify({
              error: `Internal code execution timed out after ${Math.floor(BOB_REQUEST_TIMEOUT_MS / 1000)}s`,
              task_id: taskId,
            }),
            { status: 504, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
          )
        }
        throw err
      } finally {
        clearTimeout(execTimeoutId)
      }

      const execText = await execResp.text()
      const execPayload = (() => {
        try { return JSON.parse(execText) } catch { return null }
      })()

      if (!execResp.ok) {
        return new Response(
          JSON.stringify({
            error: `Internal code execution returned ${execResp.status}`,
            details: execText.slice(0, 500),
            task_id: taskId,
            queued_task: queuePayload.task,
          }),
          { status: execResp.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          execution_mode: 'self_heal_worker',
          github_assist_required: false,
          task_type: normalizedTaskType,
          autonomy_tier: autonomyTier,
          patch_task: payload,
          queued_task: queuePayload.task,
          internal_execution: execPayload,
          note: normalizedTaskType === 'human_test_run'
            ? 'Human Test task was queued and executed via Bob internal executor.'
            : 'Simple/moderate issue was queued and executed via Bob internal executor.',
        }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        execution_mode: preferGithubAssist ? 'github_assist' : 'self_heal_worker',
        github_assist_required: preferGithubAssist,
        task_type: normalizedTaskType,
        autonomy_tier: autonomyTier,
        patch_task: payload,
        note: preferGithubAssist
          ? 'Complex issue detected: route this task to GitHub-assisted flow.'
          : 'Task is suitable for self-healing worker flow.',
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  }
})
