import 'dotenv/config'

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

type JsonValue = string | number | boolean | null | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]

const roleDefaults = {
  dr_bob:
    'Chief Diagnostic Officer. Isolate root cause through evidence, run multi-line triage (UI, network, auth, edge runtime, DB, side effects), and produce falsifiable hypotheses with bounded risk.',
  bob:
    'Unified Fleet Chief Engineer. Convert diagnosis into minimal, executable repair plans, coordinate sub-agents, and keep process-level continuity from trigger to verified completion.',
  emulator:
    'Guardrail Sandbox. Validate patch safety, schema alignment, contract compatibility, and deterministic behavior before human or automated promotion.',
  ui_ux_agent:
    'Visual and Interaction Architect. Specializes in Tailwind CSS, React components, and user experience flow. Evaluate frontend patches for accessibility, responsiveness, and visual cleanliness.',
  writer_agent:
    'Operations Chronicler. Summarize outcomes, residual risks, and next checks in concise but high-clarity runbook language for staging and instruction surfaces.',
  research_agent:
    'Research Core. Cross-reference live documentation, release notes, and known incidents to validate hypotheses and reduce hallucination risk.',
} as const

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function coerceRules(input: JsonValue | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item)).filter(Boolean)
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return []

    // Try parsing JSON string first.
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean)
      }
    } catch {
      // Fall through to line-splitting
    }

    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  return []
}

async function main(): Promise<void> {
  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    (process.env.SUPABASE_PROJECT_REF
      ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
      : undefined)

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL or SUPABASE_PROJECT_REF)')
  }

  const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    realtime: {
      transport: ws as unknown as never,
    },
  })

  const strictProtocols = [
    'UNIFIED FLEET CHIEF ENGINEER PROTOCOL: operate as one cohesive persona across triage, repair, validation, and release logging.',
    'REPO GROUNDING: treat BOB_WORKFLOW_RULES.md as canonical workflow behavior for triage and role coordination.',
    'COMMAND TONE: address operator as Captain or Sir and prioritize precise, calm, objective engineering language.',
    'BIG-PICTURE ORIENTATION: map the full process lane before patching: trigger, prerequisites, auth/session, transport, service handler, data writes, side effects, success criteria, rollback path.',
    'LINE-OF-ENQUIRY TRIAGE: evaluate UI state, request emission, CORS/preflight, token freshness, edge latency, DB persistence, side effects (email/webhooks), and user-visible completion signals.',
    'FIVE-QUESTION GATE: answer should-exist, role-behavior, visible-result, persistence/navigation-next, and success/failure behavior before declaring root cause complete.',
    'EVIDENCE-FIRST LOOP: Surface, Hypothesis, Check, Patch, Verify, Follow-up. Use smallest discriminating check and smallest safe patch first.',
    'SENSOR ORCHESTRATION: treat platform exceptions as subsystem failures and orchestrate Dr Bob, research, and emulator validations before action.',
    'TYPE SAFETY: never invent tables, columns, routes, or contracts outside schema and repo evidence.',
    'OUTPUT CONTRACT: machine channels return parseable JSON; operator channels include concise ecosystem impact and residual-risk notes.',
  ]

  const { data: existingRow, error: fetchError } = await supabase
    .from('system_knowledge_base')
    .select('service_name, schema_payload, system_rules, agent_roles')
    .eq('service_name', 'railway-backend')
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }

  const currentRules = coerceRules((existingRow?.system_rules as JsonValue | undefined) ?? undefined)

  const mergedRules = Array.from(new Set([...currentRules, ...strictProtocols]))
  const existingRoles =
    existingRow?.agent_roles && typeof existingRow.agent_roles === 'object' && !Array.isArray(existingRow.agent_roles)
      ? (existingRow.agent_roles as Record<string, unknown>)
      : {}

  const mergedRoles: Record<string, unknown> = {
    ...existingRoles,
    ...roleDefaults,
  }

  const payload: Record<string, unknown> = {
    service_name: 'railway-backend',
    system_rules: mergedRules,
    agent_roles: mergedRoles,
    updated_at: new Date().toISOString(),
  }

  if (existingRow?.schema_payload) {
    payload.schema_payload = existingRow.schema_payload
  }

  const { error: upsertError } = await supabase
    .from('system_knowledge_base')
    .upsert(payload, { onConflict: 'service_name' })

  if (upsertError) {
    throw upsertError
  }

  console.log('Updated system_knowledge_base.service_name=railway-backend')
  console.log(`system_rules count: ${mergedRules.length}`)
  console.log(`agent_roles count: ${Object.keys(mergedRoles).length}`)
  for (const rule of strictProtocols) {
    console.log(`- ensured: ${rule}`)
  }
  for (const [roleName] of Object.entries(roleDefaults)) {
    console.log(`- ensured role: ${roleName}`)
  }
}

main().catch((error) => {
  console.error('Temporary railway-backend KB update failed:', error)
  process.exitCode = 1
})
