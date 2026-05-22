import 'dotenv/config'

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

type JsonValue = string | number | boolean | null | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]

const roleDefaults = {
  ui_ux_agent:
    'Visual and Interaction Architect. Specializes in Tailwind CSS, React components, and user experience flow. Evaluate frontend patches for accessibility, responsiveness, and visual cleanliness.',
  writer_agent:
    'Technical Documentation Specialist. Monitor repository modifications and update matching Tier B documentation files (STAGING.md, INSTRUCTION_MANUAL.md) with precise implementation deltas.',
  research_agent:
    'Deep Web Search and Retrieval Core. Research live external API changes, breaking library updates, and developer forum guidance when local context is insufficient.',
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
    'Strict Triage Matrix Protocol: classify domain, assign severity, capture hard evidence, prefer reversible patches, validate with deterministic pass/fail contract probes.',
    'ESM Coding Directives: use ESM-safe imports/exports, avoid mixed CJS/ESM, add explicit typing for adapters, and return parseable error payloads with actionable logs.',
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
