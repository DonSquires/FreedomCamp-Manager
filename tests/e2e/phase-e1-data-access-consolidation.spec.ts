import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

type PhaseE1Target = {
  page: string
  baselineDirectSupabaseFromCalls: number
  reductionTarget: string
}

const PHASE_E1_TARGETS: PhaseE1Target[] = [
  { page: 'PTTRadio', baselineDirectSupabaseFromCalls: 3, reductionTarget: 'Hold at or below baseline while shared radio hooks remain the data boundary.' },
  { page: 'DispatchConsole', baselineDirectSupabaseFromCalls: 3, reductionTarget: 'Hold at or below baseline while dispatch contract hooks absorb new reads.' },
  { page: 'FieldOfficerPortal', baselineDirectSupabaseFromCalls: 15, reductionTarget: 'Reduce by migrating patrol, welfare, and observation clusters into hooks/services.' },
  { page: 'AssetManagement', baselineDirectSupabaseFromCalls: 0, reductionTarget: 'Keep page free of direct Supabase query clusters.' },
  { page: 'VehicleManagement', baselineDirectSupabaseFromCalls: 16, reductionTarget: 'Reduce by moving vehicle, owner, and enforcement reads into hooks/services.' },
  { page: 'BreachAlerts', baselineDirectSupabaseFromCalls: 0, reductionTarget: 'Keep page free of direct Supabase query clusters after breach hook consolidation.' },
  { page: 'AdminPortal', baselineDirectSupabaseFromCalls: 20, reductionTarget: 'Reduce by consolidating admin summary reads behind shared dashboard hooks.' },
  { page: 'NoiseControlPortal', baselineDirectSupabaseFromCalls: 13, reductionTarget: 'Reduce by moving noise complaint and evidence reads into domain hooks.' },
  { page: 'ClientAccountPage', baselineDirectSupabaseFromCalls: 0, reductionTarget: 'Keep page free of direct Supabase query clusters.' },
  { page: 'RosterPlanner', baselineDirectSupabaseFromCalls: 0, reductionTarget: 'Keep page free of direct Supabase query clusters.' },
]

// Phase E1 tracks the page-owned query clusters that use the project-standard `supabase.from(...)` pattern.
// Destructured aliases such as `const { from } = supabase` are out of scope and should not be introduced in page components.
const PAGE_DIRECT_QUERY_PATTERN = /\bsupabase\s*\.\s*from\s*\(/g
const DESTRUCTURED_SUPABASE_FROM_PATTERN = /\bconst\s*\{[^}]*\bfrom\b[^}]*\}\s*=\s*supabase\b/g

function pagePath(page: string) {
  return path.join(process.cwd(), 'src', 'pages', `${page}.tsx`)
}

function readPage(page: string) {
  return fs.readFileSync(pagePath(page), 'utf8')
}

function countDirectPageQueries(page: string) {
  return readPage(page).match(PAGE_DIRECT_QUERY_PATTERN)?.length ?? 0
}

test.describe('Phase E1 — direct page-query reduction baseline', () => {
  test('publishes grounded baselines for all Phase E1 target pages', () => {
    expect(PHASE_E1_TARGETS).toHaveLength(10)

    for (const target of PHASE_E1_TARGETS) {
      expect(fs.existsSync(pagePath(target.page)), `${target.page} page should exist`).toBe(true)
      expect(target.reductionTarget.length, `${target.page} should document a reduction target`).toBeGreaterThan(20)
    }
  })

  for (const target of PHASE_E1_TARGETS) {
    test(`${target.page} does not exceed Phase E1 direct-query baseline`, () => {
      expect(countDirectPageQueries(target.page)).toBeLessThanOrEqual(target.baselineDirectSupabaseFromCalls)
    })
  }

  test('target pages do not bypass the gate with destructured Supabase aliases', () => {
    for (const target of PHASE_E1_TARGETS) {
      expect(readPage(target.page).match(DESTRUCTURED_SUPABASE_FROM_PATTERN) ?? []).toHaveLength(0)
    }
  })

  test('aggregate Phase E1 target-page direct queries do not drift upward', () => {
    const currentTotal = PHASE_E1_TARGETS.reduce((total, target) => total + countDirectPageQueries(target.page), 0)
    const baselineTotal = PHASE_E1_TARGETS.reduce((total, target) => total + target.baselineDirectSupabaseFromCalls, 0)

    expect(currentTotal).toBeLessThanOrEqual(baselineTotal)
  })

  test('roadmap documents the Phase E data movement gate', () => {
    const roadmap = fs.readFileSync(path.join(process.cwd(), 'docs', 'MODULE_ROADMAP.md'), 'utf8')
    const baselineTable = roadmap.split('## Phase E1 Data-Access Consolidation Baseline')[1] ?? ''

    expect(roadmap).toContain('Phase E — Data Movement Reduction and Enterprise Hardening')
    expect(roadmap).toContain('Target fragmentation pages show downward direct-query drift')
    expect(baselineTable).toContain('| Target page | Current direct `supabase.from(...)` calls | Phase E1 target |')
    for (const target of PHASE_E1_TARGETS) {
      expect(baselineTable).toContain(`| ${target.page} | ${target.baselineDirectSupabaseFromCalls} |`)
    }
  })
})
