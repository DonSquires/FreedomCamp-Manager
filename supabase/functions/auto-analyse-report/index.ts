/**
 * auto-analyse-report
 *
 * Automatically analyses a newly-submitted bug report using inference-service
 * self-healing and (optionally) live GitHub Actions CI status. Called
 * fire-and-forget from FeedbackModal
 * immediately after the report row is inserted.
 *
 * Flow:
 *   1. Fetch the bug_report row by ID.
 *   2. If GITHUB_TOKEN is set, fetch the 5 most recent workflow runs from GitHub
 *      Actions and include their status in the AI prompt context.
 *   3. Build structured self-heal input (report + console errors + CI status).
 *   4. Call inference-service /self-heal/bug-report.
 *   5. Persist the analysis back to bug_reports, moving status from
 *      'submitted' → 'acknowledged' when picked up, then → 'in_progress'
 *      once analysis is stored (unless already resolved/closed).
 *
 * Environment secrets:
 *   GITHUB_TOKEN      — GitHub PAT with optional `repo` read access for CI context.
 *                       read access to fetch CI status).
 *   GITHUB_REPO       — Repository slug, e.g. "DonSquires/FreedomCamp-Manager"
 *                       (default: "DonSquires/FreedomCamp-Manager")
 *   INFERENCE_SERVICE_URL   — Railway inference-service URL.
 *   INFERENCE_API_KEY       — Optional shared key for inference auth.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'
import { nextStatusAfterAnalysis, shouldAutoAcknowledge } from '../_shared/bugReportStatus.ts'

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function getProjectRefFromSupabaseUrl(value: string): string | null {
  try {
    const host = new URL(value).host
    const [ref] = host.split('.')
    return ref || null
  } catch {
    return null
  }
}

function looksLikeServiceRoleOpaqueKey(value: string): boolean {
  return value.startsWith('sb_secret_') && value.length > 'sb_secret_'.length + 16
}

function isServiceRoleCaller(req: Request, token: string | null): boolean {
  if (!token) return false

  const apikey = (req.headers.get('apikey') || req.headers.get('x-api-key') || '').trim()

  // Fast path: exact match with configured service-role key.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (serviceRoleKey.length > 0 && (token === serviceRoleKey || apikey === serviceRoleKey)) return true

  // Compatibility path: accept a valid-looking service_role JWT for this project.
  // This avoids brittle exact-string coupling when automation secrets rotate out
  // of sync with edge env while still requiring project-scoped service role.
  const projectRef = getProjectRefFromSupabaseUrl(Deno.env.get('SUPABASE_URL') ?? '')
  const candidates = [token, apikey].filter(Boolean)
  for (const candidate of candidates) {
    const payload = decodeJwtPayload(candidate)
    if (!payload) continue

    const role = String(payload.role ?? '')
    const ref = String(payload.ref ?? '')
    if (role === 'service_role' && !!projectRef && ref === projectRef) {
      return true
    }
  }

  // Opaque-key path (newer Supabase secrets). Require both Authorization and
  // apikey to match the same opaque key and use service-role key prefix.
  if (apikey && token === apikey && looksLikeServiceRoleOpaqueKey(token)) {
    return true
  }

  return false
}

/** Fetch the last N workflow runs from GitHub Actions for context. */
async function fetchCiStatus(githubToken: string, repo: string): Promise<string> {
  try {
    const url = `https://api.github.com/repos/${repo}/actions/runs?per_page=5`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return `GitHub API returned ${res.status} — CI status unavailable.`

    const { workflow_runs } = await res.json()
    if (!Array.isArray(workflow_runs) || workflow_runs.length === 0) {
      return 'No recent CI runs found.'
    }

    const lines = workflow_runs.map((r: any) =>
      `- [${r.conclusion ?? r.status ?? 'unknown'}] ${r.name} (${r.head_branch}) — ${r.display_title ?? r.head_commit?.message?.slice(0, 80) ?? ''}`
    )
    return lines.join('\n')
  } catch (err: any) {
    return `CI status fetch failed: ${err?.message ?? 'unknown error'}`
  }
}

function planToText(plan: any): string {
  const list = (items: unknown) => Array.isArray(items) ? items.map((item) => `- ${String(item)}`).join('\n') : '- (none)'
  const automation = Array.isArray(plan?.automation)
    ? plan.automation.map((a: any) => `- ${a?.action ?? 'action'}: ${a?.enabled ? 'enabled' : 'disabled'} (${a?.detail ?? ''})`).join('\n')
    : '- (none)'

  return [
    `## Self-Healing Analysis`,
    `Severity: ${plan?.severity ?? 'unknown'}`,
    `Bug Type: ${plan?.bug_type ?? 'unknown'}`,
    `Recommended Owner: ${plan?.recommended_owner ?? 'platform-engineering'}`,
    '',
    `### Reproduction`,
    list(plan?.reproduction),
    '',
    `### Remediation`,
    list(plan?.remediation),
    '',
    `### Safeguards`,
    list(plan?.safeguards),
    '',
    `### Automation`,
    automation,
    '',
    `### Compliance Note`,
    String(plan?.legal_note ?? 'Operational guidance only.'),
  ].join('\n')
}

function isDesignChangeIssueType(issueType: string | null | undefined): boolean {
  const normalized = String(issueType ?? '').toLowerCase()
  return normalized === 'feature_request' || normalized === 'enhancement' || normalized === 'ui_ux'
}

function deriveComplexity(severity: string | null | undefined): 'simple' | 'moderate' | 'complex' {
  const normalized = String(severity ?? 'medium').toLowerCase()
  if (normalized === 'critical' || normalized === 'high') return 'complex'
  if (normalized === 'low') return 'simple'
  return 'moderate'
}

function normalizeServiceBaseUrl(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '')
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

    // Permit internal automation callers (e.g., synthetic monitor workflow)
    // that authenticate with the exact service-role key. Regular browser
    // callers must still present a valid user bearer token.
    if (!isServiceRoleCaller(req, token)) {
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired session' }),
          { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    const { report_id } = await req.json()
    if (!report_id) {
      return new Response(
        JSON.stringify({ error: 'report_id is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // ── Fetch report ──────────────────────────────────────────────────────────
    const { data: report, error: fetchErr } = await supabaseAdmin
      .from('bug_reports')
      .select('*')
      .eq('id', report_id)
      .single()

    if (fetchErr || !report) {
      return new Response(
        JSON.stringify({ error: 'Report not found', details: fetchErr?.message }),
        { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // ── GitHub CI Status ─────────────────────────────────────────────────────
    const githubToken = Deno.env.get('GITHUB_TOKEN')
    const githubRepo = Deno.env.get('GITHUB_REPO') ?? 'DonSquires/FreedomCamp-Manager'
    let ciStatus = 'CI status not available (GITHUB_TOKEN not configured).'

    if (githubToken) {
      ciStatus = await fetchCiStatus(githubToken, githubRepo)
    }

    // ── Mark as acknowledged if still newly submitted ────────────────────────
    let statusForTransition = report.status

    if (shouldAutoAcknowledge(report.status)) {
      const { error: ackErr } = await supabaseAdmin
        .from('bug_reports')
        .update({ status: 'acknowledged' })
        .eq('id', report_id)
      if (ackErr) {
        console.error(`[auto-analyse] failed to acknowledge report ${report_id}: ${ackErr.message}`)
      } else {
        statusForTransition = 'acknowledged'
      }
    }

    // ── Build self-heal input ────────────────────────────────────────────────
    const navHistory: any[] = report.browser_info?.navigationHistory ?? []
    const consoleErrors: any[] = Array.isArray(report.console_errors) ? report.console_errors : []

    // ── Inference-service self-heal provider ────────────────────────────────
    const inferenceUrl = normalizeServiceBaseUrl(Deno.env.get('INFERENCE_SERVICE_URL') ?? '')
    const inferenceApiKey = Deno.env.get('INFERENCE_API_KEY') ?? ''

    if (!inferenceUrl) {
      console.warn(`[auto-analyse] INFERENCE_SERVICE_URL not configured — skipping analysis for report ${report_id}`)
      return new Response(
        JSON.stringify({ error: 'AI service not configured', report_id }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const healPayload = {
      report: {
        summary: `${report.title ?? 'Untitled'}: ${report.description ?? ''}`.trim(),
        severity: report.severity ?? 'medium',
        issue_type: report.issue_type ?? 'bug',
        current_page: report.current_page ?? 'unknown',
        user_role: report.user_role ?? 'unknown',
        app_version: report.app_version ?? 'unknown',
        steps_to_reproduce: report.steps_to_reproduce ?? null,
        expected_behavior: report.expected_behavior ?? null,
        actual_behavior: report.actual_behavior ?? null,
        navigation: navHistory.slice(-10),
        console_errors: consoleErrors.slice(-10),
        ci_status: ciStatus,
      },
    }

    const healHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) healHeaders['x-inference-api-key'] = inferenceApiKey

    const healResp = await fetch(`${inferenceUrl}/self-heal/bug-report`, {
      method: 'POST',
      headers: healHeaders,
      body: JSON.stringify(healPayload),
      signal: AbortSignal.timeout(55_000),
    })

    if (!healResp.ok) {
      const details = await healResp.text()
      return new Response(
        JSON.stringify({ error: `Inference self-heal returned ${healResp.status}`, details: details.slice(0, 300) }),
        { status: healResp.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const healJson = await healResp.json()
    const responseText: string = planToText(healJson?.plan)

    // ── Stage 2: GitHub-assist escalation for non-design bug fixes ─────────
    const designChange = isDesignChangeIssueType(report.issue_type)
    const complexity = deriveComplexity(report.severity)
    const shouldEscalateToGithubAssist = !designChange

    let escalationResult: Record<string, unknown> | null = null
    if (shouldEscalateToGithubAssist) {
      try {
        const patchPayload = {
          report: {
            summary: `${report.title ?? 'Untitled'}: ${report.description ?? ''}`.trim(),
            severity: report.severity ?? 'medium',
            issue_type: report.issue_type ?? 'bug',
            details: responseText,
            stack_trace: typeof report.actual_behavior === 'string' ? report.actual_behavior : '',
            source: 'auto-analyse-report',
            requested_at: new Date().toISOString(),
            execution_mode_hint: 'github_assist',
            complexity,
          },
          plan: healJson?.plan,
        }

        const patchResp = await fetch(`${inferenceUrl}/self-heal/patch-task`, {
          method: 'POST',
          headers: healHeaders,
          body: JSON.stringify(patchPayload),
          signal: AbortSignal.timeout(30_000),
        })

        if (patchResp.ok) {
          const patchJson = await patchResp.json()
          escalationResult = {
            requested: true,
            routed_to: 'github_assist',
            complexity,
            patch_task: patchJson?.patch_task ?? patchJson,
            generated_at: new Date().toISOString(),
          }
        } else {
          const patchErrText = await patchResp.text()
          escalationResult = {
            requested: true,
            routed_to: 'github_assist',
            complexity,
            error: `patch-task returned HTTP ${patchResp.status}`,
            details: patchErrText.slice(0, 300),
          }
        }
      } catch (patchErr: any) {
        escalationResult = {
          requested: true,
          routed_to: 'github_assist',
          complexity,
          error: patchErr?.message ?? 'Patch-task escalation failed',
        }
      }
    }

    // ── Persist analysis ──────────────────────────────────────────────────────
    const nextStatus = nextStatusAfterAnalysis(statusForTransition)

    const { error: updateErr } = await supabaseAdmin
      .from('bug_reports')
      .update({
        ai_analyzed: true,
        ai_suggested_fix: responseText,
        ai_analysis: {
          analyzed_at: new Date().toISOString(),
          model: 'self-healing-plan-v1',
          provider: 'inference-self-heal',
          auto: true,
          ci_status_included: githubToken ? true : false,
          design_change: designChange,
          github_assist_escalation: escalationResult,
        },
        status: nextStatus,
        requires_human_review: true,
      })
      .eq('id', report_id)

    if (updateErr) {
      console.error(`[auto-analyse] Failed to persist analysis:`, updateErr.message)
    } else {
      console.log(`[auto-analyse] Analysis persisted for report ${report_id} (${responseText.length} chars)`)
    }

    return new Response(
      JSON.stringify({ success: true, report_id, provider: 'inference-self-heal' }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('[auto-analyse] Request timed out after 55s')
      return new Response(
        JSON.stringify({ error: 'AI request timed out' }),
        { status: 504, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }
    console.error('[auto-analyse] Unhandled error:', err?.message)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }
})
