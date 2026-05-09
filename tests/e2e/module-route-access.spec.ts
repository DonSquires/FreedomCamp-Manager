/**
 * Module Route Access — registry-driven gate test
 *
 * This spec is the canonical entry point for route-access assertions across
 * all service modules. It is referenced by:
 *   - scripts/run-human-module-suite.mjs
 *   - scripts/run-tests-on-runpod.mjs
 *   - scripts/trigger-bob-self-test.mjs
 *   - scripts/bob-agentic-test-orchestrator.mjs
 *   - playwright.focused.config.ts
 *
 * Test strategy
 * ─────────────
 * Routes are derived from SERVICE_MODULES registry so coverage automatically
 * expands as new modules are registered. Parameterised routes (containing `:`)
 * are skipped because they require valid DB IDs.
 *
 * Admin routes — assert the page loads for an adminOrg1 account.
 * Officer routes — assert that an officer can reach officer-only surfaces
 *                  and is redirected/blocked from admin-only surfaces.
 *
 * Screenshots are captured on every test to support Bob UI assessment.
 */

import { test } from '@playwright/test'
import { loginAs, isCredentialConfigured } from './auth'
import { assertRouteBlocked, assertRouteLoads } from './helpers/route-access-helpers'
import { SERVICE_MODULES } from '../../src/modules/registry'

test.use({ screenshot: 'on' })

// ─── Route collection helpers ─────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])

/** Matches route paths containing a dynamic parameter segment (e.g. `/crm/client/:orgId`). */
const HAS_ROUTE_PARAM = /:[^/]+/

type CollectedRoute = { path: string; label: string }

function collectRoutesForRoles(allowedRoles: Set<string>): CollectedRoute[] {
  const seen = new Set<string>()
  const result: CollectedRoute[] = []

  for (const module of Object.values(SERVICE_MODULES)) {
    for (const route of module.routes) {
      if (seen.has(route.path)) continue
      // Skip parameterised routes — they need real DB IDs
      if (HAS_ROUTE_PARAM.test(route.path)) continue
      if (!route.path.startsWith('/')) continue

      const hasRole = route.roles.some((r) => allowedRoles.has(r))
      if (!hasRole) continue

      seen.add(route.path)
      result.push({ path: route.path, label: route.label })
    }
  }

  return result.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Admin-accessible routes (admin, admin_officer, master, grand_master).
 * `collectRoutesForRoles` already excludes routes that require only officer roles,
 * so no additional filtering is needed here.
 */
const adminRoutes = collectRoutesForRoles(ADMIN_ROLES)

/** Officer-only routes (officer-portal surfaces). */
const officerOnlyRoutes = Object.values(SERVICE_MODULES)
  .flatMap((m) => m.routes)
  .filter((r) => r.officerOnly && r.path.startsWith('/') && !HAS_ROUTE_PARAM.test(r.path))
  .reduce<CollectedRoute[]>((acc, r) => {
    if (!acc.find((x) => x.path === r.path)) {
      acc.push({ path: r.path, label: r.label })
    }
    return acc
  }, [])

/** Admin-only routes that officers must not reach. */
const adminBlockedForOfficerPaths = ['/admin', '/users', '/compliance', '/invoicing', '/pricing']

// ─── Admin suite ──────────────────────────────────────────────────────────────

test.describe('module-route-access: admin can reach all admin routes', () => {
  test.describe.configure({ mode: 'serial' })

  for (const { path, label } of adminRoutes) {
    test(`admin loads ${path} (${label})`, async ({ page }) => {
      await loginAs(page, 'adminOrg1')
      await assertRouteLoads(page, path)
    })
  }
})

// ─── Officer suite ────────────────────────────────────────────────────────────

test.describe('module-route-access: officer can reach officer routes', () => {
  test.describe.configure({ mode: 'serial' })

  for (const { path, label } of officerOnlyRoutes) {
    test(`officer loads ${path} (${label})`, async ({ page }) => {
      test.skip(
        !isCredentialConfigured('officerOrg1'),
        'Officer credentials not configured in this environment.',
      )
      await loginAs(page, 'officerOrg1')
      await assertRouteLoads(page, path)
    })
  }
})

// ─── Officer blocked from admin surfaces ─────────────────────────────────────

test.describe('module-route-access: officer is blocked from admin-only routes', () => {
  test.describe.configure({ mode: 'serial' })

  for (const path of adminBlockedForOfficerPaths) {
    test(`officer cannot access ${path}`, async ({ page }) => {
      test.skip(
        !isCredentialConfigured('officerOrg1'),
        'Officer credentials not configured in this environment.',
      )
      await loginAs(page, 'officerOrg1')
      await assertRouteBlocked(page, path)
    })
  }
})
