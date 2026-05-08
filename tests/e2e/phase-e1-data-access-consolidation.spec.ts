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
  { page: 'VehicleManagement', baselineDirectSupabaseFromCalls: 21, reductionTarget: 'Reduce by moving vehicle, owner, and enforcement reads into hooks/services.' },
  { page: 'BreachAlerts', baselineDirectSupabaseFromCalls: 20, reductionTarget: 'Reduce by moving alert queue and decision mutations into breach hooks/services.' },
  { page: 'AdminPortal', baselineDirectSupabaseFromCalls: 20, reductionTarget: 'Reduce by consolidating admin summary reads behind shared dashboard hooks.' },
  { page: 'NoiseControlPortal', baselineDirectSupabaseFromCalls: 13, reductionTarget: 'Reduce by moving noise complaint and evidence reads into domain hooks.' },
  { page: 'ClientAccountPage', baselineDirectSupabaseFromCalls: 0, reductionTarget: 'Keep page free of direct Supabase query clusters.' },
  { page: 'RosterPlanner', baselineDirectSupabaseFromCalls: 0, reductionTarget: 'Keep page free of direct Supabase query clusters.' },
]

const PAGE_DIRECT_QUERY_PATTERN = /\bsupabase\s*\.\s*from\s*\(/g

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

  test('aggregate Phase E1 target-page direct queries do not drift upward', () => {
    const currentTotal = PHASE_E1_TARGETS.reduce((total, target) => total + countDirectPageQueries(target.page), 0)
    const baselineTotal = PHASE_E1_TARGETS.reduce((total, target) => total + target.baselineDirectSupabaseFromCalls, 0)

    expect(currentTotal).toBeLessThanOrEqual(baselineTotal)
  })

  test('roadmap documents the Phase E data movement gate', () => {
    const roadmap = fs.readFileSync(path.join(process.cwd(), 'docs', 'MODULE_ROADMAP.md'), 'utf8')

    expect(roadmap).toContain('Phase E — Data Movement Reduction and Enterprise Hardening')
    expect(roadmap).toContain('Target fragmentation pages show downward direct-query drift')
    for (const target of PHASE_E1_TARGETS) {
      expect(roadmap).toContain(target.page)
    }
  })
})
