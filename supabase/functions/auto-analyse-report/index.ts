/**
 * auto-analyse-report
 *
 * Automatically analyses a newly-submitted bug report using AI and (optionally)
 * the live GitHub Actions CI status.  Called fire-and-forget from FeedbackModal
 * immediately after the report row is inserted.
 *
 * Flow:
 *   1. Fetch the bug_report row by ID.
 *   2. If GITHUB_TOKEN is set, fetch the 5 most recent workflow runs from GitHub
 *      Actions and include their status in the AI prompt context.
 *   3. Build a detailed diagnosis prompt (report + console errors + CI status).
 *   4. Call the AI provider (GitHub Copilot preferred, OPENAI_API_KEY fallback).
 *   5. Persist the analysis back to bug_reports, moving status from
 *      'submitted' → 'acknowledged' when picked up, then → 'in_progress'
 *      once analysis is stored (unless already resolved/closed).
 *
 * Environment secrets (shared with onspace-ai-chat):
 *   GITHUB_TOKEN      — GitHub PAT with `copilot` scope (and optionally `repo`
 *                       read access to fetch CI status).
 *   GITHUB_REPO       — Repository slug, e.g. "DonSquires/FreedomCamp-Manager"
 *                       (default: "DonSquires/FreedomCamp-Manager")
 *   OPENAI_API_KEY    — Fallback when GITHUB_TOKEN is absent.
 *   OPENAI_BASE_URL   — Custom OpenAI-compatible endpoint (default: api.openai.com).
 *   AI_DEFAULT_MODEL  — Model name (default: gpt-4o).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'
import { nextStatusAfterAnalysis, shouldAutoAcknowledge } from '../_shared/bugReportStatus.ts'

const SYSTEM_PROMPT = `You are an AI code reviewer and bug triage assistant for FreedomCamp Manager — a NZ freedom camping enforcement SaaS built with React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, TanStack Query v5, Supabase (PostgreSQL + Edge Functions), and react-router-dom v6.

Your job when analysing a bug report:
1. **Diagnose**: Identify the root cause. Reference specific files, components, or edge functions (e.g. src/pages/X.tsx, supabase/functions/Y/index.ts, src/hooks/useZ.ts).
2. **Fix**: Provide a concrete, actionable code-level fix. Include exact file paths, function names, and the change required.
3. **Severity**: Confirm or revise the reported severity (low/medium/high/critical) with justification.
4. **Effort**: Estimate Low (< 1 h) / Medium (half day) / High (1-2 days).

Be specific. Name exact files and line-level changes where possible. If CI is failing, correlate the reported issue with failing workflow steps.`

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
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

    // ── Input ─────────────────────────────────────────────────────────────────
    const { report_id } = await req.json()
    if (!report_id) {
      return new Response(
        JSON.stringify({ error: 'report_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // ── Build Prompt ──────────────────────────────────────────────────────────
    const navHistory: any[] = report.browser_info?.navigationHistory ?? []
    const consoleErrors: any[] = Array.isArray(report.console_errors) ? report.console_errors : []

    const prompt = `You are analysing a bug/feedback report for FreedomCamp Manager.

## Report
**Type**: ${report.issue_type}
**Severity**: ${report.severity}
**Title**: ${report.title}
**Description**: ${report.description}
${report.steps_to_reproduce ? `**Steps to reproduce**:\n${report.steps_to_reproduce}` : ''}
${report.expected_behavior ? `**Expected**: ${report.expected_behavior}` : ''}
${report.actual_behavior ? `**Actual**: ${report.actual_behavior}` : ''}

## Context at time of report
**Page**: ${report.current_page ?? 'unknown'}
**User role**: ${report.user_role}
**App version**: ${report.app_version}

## Navigation breadcrumb (most recent first)
${navHistory.slice(-10).reverse().map((n: any) => `- ${n.path} at ${n.timestamp}`).join('\n') || 'None captured'}

## Console errors
${consoleErrors.slice(-10).map((e: any) => `[${e.level}] ${e.message}${e.stack ? '\n  ' + e.stack.slice(0, 200) : ''}`).join('\n') || 'None captured'}

## GitHub Actions CI Status (last 5 runs)
${ciStatus}

## Task
1. **Diagnose**: Identify the root cause. Reference specific files, components, or edge functions.
2. **Fix**: Provide a concrete, actionable code fix. Include file paths and the specific change.
3. **Severity**: Confirm or revise (low/medium/high/critical) with justification.
4. **Effort**: Low (< 1 h) / Medium (half day) / High (1-2 days).
5. **PR plan**: Outline the PR you would raise (files to change, tests to add/update).
6. **Build impact**: Note any build/devops changes and the expected outcome once applied.
7. **Where to view**: Mention the Admin → Platform → Feedback inbox (grand master only) and that the GitHub AI response is stored with the report.

Be specific. Name exact files and line-level changes where possible.`

    // ── AI Provider ───────────────────────────────────────────────────────────
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!githubToken && !openaiApiKey) {
      console.warn(`[auto-analyse] No AI provider configured — skipping analysis for report ${report_id}`)
      return new Response(
        JSON.stringify({ error: 'AI service not configured', report_id }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const defaultModel = Deno.env.get('AI_DEFAULT_MODEL') ?? 'gpt-4o'

    const providers: Array<{
      name: 'github-copilot' | 'openai'
      apiKey: string
      baseUrl: string
      modelsToTry: string[]
    }> = []

    if (githubToken) {
      const fallbackModels = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini']
      providers.push({
        name: 'github-copilot',
        apiKey: githubToken,
        baseUrl: 'https://api.githubcopilot.com',
        modelsToTry: [defaultModel, ...fallbackModels.filter((m) => m !== defaultModel)],
      })
    }

    if (openaiApiKey) {
      providers.push({
        name: 'openai',
        apiKey: openaiApiKey,
        baseUrl: (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
        modelsToTry: [defaultModel],
      })
    }

    let aiData: any = null
    let providerName: 'github-copilot' | 'openai' = providers[0].name
    let finalModel = defaultModel
    let lastStatus = 500
    let lastErrorText = ''

    for (const provider of providers) {
      providerName = provider.name
      console.log(`[auto-analyse] report=${report_id} provider=${provider.name} model=${defaultModel} candidates=${provider.modelsToTry.join(',')}`)

      for (const candidateModel of provider.modelsToTry) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 55_000)

        const aiResponse = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: candidateModel,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            temperature: 0.4,
            max_tokens: 4000,
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (aiResponse.ok) {
          aiData = await aiResponse.json()
          finalModel = candidateModel
          break
        }

        const errorText = await aiResponse.text()
        lastStatus = aiResponse.status
        lastErrorText = errorText.slice(0, 300)
        console.error(`[auto-analyse] AI provider error ${aiResponse.status} provider=${provider.name} model=${candidateModel}:`, lastErrorText)

        const mayRetryModel = provider.name === 'github-copilot' && (aiResponse.status === 400 || aiResponse.status === 404)
        if (mayRetryModel) {
          continue
        }

        const mayFailoverProvider =
          provider.name === 'github-copilot' &&
          openaiApiKey &&
          (aiResponse.status === 401 || aiResponse.status === 403 || aiResponse.status === 429 || aiResponse.status >= 500)

        if (mayFailoverProvider) {
          console.warn(`[auto-analyse] Falling back from GitHub Copilot to OpenAI provider after ${aiResponse.status}`)
          break
        }

        return new Response(
          JSON.stringify({ error: `AI provider returned ${aiResponse.status}`, details: errorText.slice(0, 200) }),
          { status: aiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (aiData) break
    }

    if (!aiData) {
      return new Response(
        JSON.stringify({ error: `AI provider returned ${lastStatus}`, details: lastErrorText.slice(0, 200) }),
        { status: lastStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const responseText: string = aiData.choices?.[0]?.message?.content ?? ''

    if (!responseText) {
      return new Response(
        JSON.stringify({ error: 'AI returned an empty response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
          model: aiData.model ?? finalModel,
          provider: providerName,
          auto: true,
          ci_status_included: githubToken ? true : false,
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
      JSON.stringify({ success: true, report_id, provider: providerName }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('[auto-analyse] Request timed out after 55s')
      return new Response(
        JSON.stringify({ error: 'AI request timed out' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.error('[auto-analyse] Unhandled error:', err?.message)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
