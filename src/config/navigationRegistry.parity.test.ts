import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { NAVIGATION_REGISTRY_V1 } from '@/config/navigationRegistry'
import { pinnedItems, navigationGroups } from '@/components/features/AppLayout'
import { primaryLinks, moreGroups } from '@/components/features/AdminNavigationMenu'

function getAppRoutePaths(): Set<string> {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx')
  const content = fs.readFileSync(appPath, 'utf8')
  const matches = content.matchAll(/path="([^"]+)"/g)
  return new Set(Array.from(matches, (m) => m[1]))
}

function getSidebarPaths(): Set<string> {
  const groupPaths = navigationGroups.flatMap((group) => group.items.map((item) => item.path))
  return new Set([...pinnedItems.map((item) => item.path), ...groupPaths])
}

function getAdminMenuPaths(): Set<string> {
  const grouped = moreGroups.flatMap((group) => group.links.map((link) => link.to))
  return new Set([...primaryLinks.map((link) => link.to), ...grouped])
}

const navAliasMap: Record<string, string[]> = {
  '/field-officer': ['/field'],
}

function isPathPresent(path: string, surfaces: Set<string>[]): boolean {
  if (surfaces.some((surface) => surface.has(path))) return true
  const aliases = navAliasMap[path] || []
  return aliases.some((alias) => surfaces.some((surface) => surface.has(alias)))
}

describe('navigation registry parity', () => {
  it('has unique registry paths', () => {
    const paths = NAVIGATION_REGISTRY_V1.map((entry) => entry.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('maps every registry entry to a real app route', () => {
    const appRoutes = getAppRoutePaths()
    const missing = NAVIGATION_REGISTRY_V1
      .filter((entry) => !appRoutes.has(entry.path))
      .map((entry) => entry.path)

    expect(missing).toEqual([])
  })

  it('maps sidebar registry entries to an active navigation surface', () => {
    const sidebarPaths = getSidebarPaths()
    const adminMenuPaths = getAdminMenuPaths()

    const missing = NAVIGATION_REGISTRY_V1
      .filter((entry) => entry.navSurface === 'sidebar')
      .filter((entry) => !isPathPresent(entry.path, [sidebarPaths, adminMenuPaths]))
      .map((entry) => entry.path)

    expect(missing).toEqual([])
  })

  it('requires role metadata on all registry entries', () => {
    const invalid = NAVIGATION_REGISTRY_V1
      .filter((entry) => !Array.isArray(entry.allowedRoles) || entry.allowedRoles.length === 0)
      .map((entry) => entry.path)

    expect(invalid).toEqual([])
  })
})
