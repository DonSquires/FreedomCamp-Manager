import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

interface PriorityPageBaseline {
  page: string
  path: string
  directQueryBaseline: number
}

const priorityPages: PriorityPageBaseline[] = [
  { page: 'PTTRadio', path: 'src/pages/PTTRadio.tsx', directQueryBaseline: 3 },
  { page: 'DispatchConsole', path: 'src/pages/DispatchConsole.tsx', directQueryBaseline: 1 },
  { page: 'FieldOfficerPortal', path: 'src/pages/FieldOfficerPortal.tsx', directQueryBaseline: 4 },
  { page: 'AssetManagement', path: 'src/pages/AssetManagement.tsx', directQueryBaseline: 0 },
  { page: 'VehicleManagement', path: 'src/pages/VehicleManagement.tsx', directQueryBaseline: 19 },
  { page: 'BreachAlerts', path: 'src/pages/BreachAlerts.tsx', directQueryBaseline: 15 },
  { page: 'AdminPortal', path: 'src/pages/AdminPortal.tsx', directQueryBaseline: 14 },
  { page: 'NoiseControlPortal', path: 'src/pages/NoiseControlPortal.tsx', directQueryBaseline: 0 },
  { page: 'ClientAccountPage', path: 'src/pages/ClientAccountPage.tsx', directQueryBaseline: 0 },
  { page: 'RosterPlanner', path: 'src/pages/RosterPlanner.tsx', directQueryBaseline: 0 },
]

function repoPath(relativePath: string) {
  return path.resolve(process.cwd(), relativePath)
}

function directQueryCount(filePath: string) {
  const source = fs.readFileSync(repoPath(filePath), 'utf8')
  // This gate intentionally uses a lightweight lexical count for drift detection.
  // If a baseline changes, the expected follow-up is to inspect the page and
  // lower the count when direct Supabase calls move into hooks/services.
  return (source.match(/\bsupabase\.(from|rpc)\s*\(/g) ?? []).length
}

test.describe('Phase E1 — Data-access consolidation gate', () => {
  test('priority consolidation pages remain present', () => {
    for (const page of priorityPages) {
      expect(fs.existsSync(repoPath(page.path)), `${page.page} should remain at ${page.path}`).toBe(true)
    }
  })

  test('priority page direct Supabase access does not drift above E1 baseline', () => {
    const counts = priorityPages.map((page) => ({
      ...page,
      currentDirectQueries: directQueryCount(page.path),
    }))

    const regressions = counts.filter((page) => page.currentDirectQueries > page.directQueryBaseline)
    expect(regressions, JSON.stringify(regressions, null, 2)).toEqual([])
  })

  test('E1 priority total direct query count does not drift upward', () => {
    const baselineTotal = priorityPages.reduce((sum, page) => sum + page.directQueryBaseline, 0)
    const currentTotal = priorityPages.reduce((sum, page) => sum + directQueryCount(page.path), 0)

    expect(currentTotal).toBeLessThanOrEqual(baselineTotal)
  })
})
