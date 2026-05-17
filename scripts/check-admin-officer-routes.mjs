#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, 'src', 'App.tsx');
const BASELINE_PATH = path.join(ROOT, 'data', 'admin-officer-routes-baseline.json');
const OUT_PATH = path.join(ROOT, 'data', 'prepared', 'admin-officer-routes-report.json');
const TREND_OUT_PATH = path.join(ROOT, 'data', 'prepared', 'admin-officer-routes-trend.json');

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return [...new Set(values)];
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function compileRegexes(patterns) {
  return asArray(patterns)
    .map((pattern) => new RegExp(asString(pattern), 'i'))
    .filter(Boolean);
}

function matchesAnyRegex(text, regexes) {
  if (regexes.length === 0) return false;
  return regexes.some((regex) => regex.test(text));
}

function extractRoles(segment) {
  const roles = [];
  const regex = /allowedRoles=\{\[([^\]]+)\]\}/g;
  let match;
  while ((match = regex.exec(segment)) !== null) {
    const found = match[1]
      .split(',')
      .map((item) => item.replace(/['"\s]/g, ''))
      .filter(Boolean);
    roles.push(...found);
  }
  return uniq(roles);
}

function extractComponentNames(segment, wrapperComponents = []) {
  const components = [];
  const wrapperSet = new Set(wrapperComponents);
  const regex = /<([A-Z][A-Za-z0-9_]+)\b/g;
  let match;
  while ((match = regex.exec(segment)) !== null) {
    const component = match[1];
    if (!wrapperSet.has(component)) {
      components.push(component);
    }
  }
  return uniq(components);
}

function extractAllRoutes(appContent, wrapperComponents = []) {
  const lines = appContent.split(/\r?\n/);
  const routes = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const pathMatch = line.match(/path="([^\"]+)"/);
    if (!pathMatch) continue;

    const routePath = pathMatch[1];
    const start = i;
    let end = i;
    if (!line.includes('/>')) {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === '/>') {
          end = j;
          break;
        }
      }
    }

    const segment = lines.slice(start, end + 1).join('\n');
    routes.push({
      path: routePath,
      line: i + 1,
      roles: extractRoles(segment),
      components: extractComponentNames(segment, wrapperComponents),
      hasRoleGuard: segment.includes('allowedRoles={['),
    });
  }

  return routes;
}

function consolidateRoutes(routes) {
  const byPath = new Map();
  const duplicateSignatureConflicts = [];

  for (const route of routes) {
    if (!byPath.has(route.path)) {
      byPath.set(route.path, [route]);
      continue;
    }
    byPath.get(route.path).push(route);
  }

  const consolidated = [];
  for (const [routePath, entries] of byPath.entries()) {
    const first = entries[0];
    consolidated.push(first);

    const firstRoles = first.roles.slice().sort().join('|');
    const firstComponents = first.components.slice().sort().join('|');

    for (const entry of entries.slice(1)) {
      const entryRoles = entry.roles.slice().sort().join('|');
      const entryComponents = entry.components.slice().sort().join('|');
      if (entryRoles !== firstRoles || entryComponents !== firstComponents || entry.hasRoleGuard !== first.hasRoleGuard) {
        duplicateSignatureConflicts.push({
          path: routePath,
          firstLine: first.line,
          duplicateLine: entry.line,
          firstRoles: first.roles,
          duplicateRoles: entry.roles,
          firstComponents: first.components,
          duplicateComponents: entry.components,
          firstHasRoleGuard: first.hasRoleGuard,
          duplicateHasRoleGuard: entry.hasRoleGuard,
        });
      }
    }
  }

  return {
    routes: consolidated.sort((a, b) => a.line - b.line),
    duplicateSignatureConflicts,
  };
}

function toRouteSignatureMap(routes) {
  const map = new Map();
  for (const route of routes) {
    map.set(route.path, {
      roles: uniq(route.roles).slice().sort(),
      components: uniq(route.components).slice().sort(),
      hasRoleGuard: route.hasRoleGuard,
    });
  }
  return map;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function main() {
  const baseline = await readJson(BASELINE_PATH);
  const appContent = await fs.readFile(APP_PATH, 'utf8');

  const thresholds = baseline.thresholds || {};
  const includeRouteRegexes = compileRegexes(thresholds.includeRouteRegexes);
  const excludeRouteRegexes = compileRegexes(thresholds.excludeRouteRegexes);
  const includeRoutesWithAdminOfficerRole = thresholds.includeRoutesWithAdminOfficerRole !== false;
  const minAdminOfficerRouteCount = Number(thresholds.minAdminOfficerRouteCount || 1);
  const requireRoleGuard = thresholds.requireRoleGuard !== false;
  const requiredRolesAnyOf = asArray(thresholds.requiredRolesAnyOf);
  const wrapperComponents = asArray(thresholds.wrapperComponents).length > 0
    ? asArray(thresholds.wrapperComponents)
    : ['Route', 'ProtectedRoute', 'RoleRoute', 'AreaRoute', 'Navigate'];

  const routeRoleRequirements = baseline.routeRoleRequirements && typeof baseline.routeRoleRequirements === 'object'
    ? baseline.routeRoleRequirements
    : {};
  const routeComponentAllowlist = baseline.routeComponentAllowlist && typeof baseline.routeComponentAllowlist === 'object'
    ? baseline.routeComponentAllowlist
    : {};
  const criticalRoutes = asArray(baseline.criticalRoutes);

  const regressionConfig = baseline.regressionSnapshot && typeof baseline.regressionSnapshot === 'object'
    ? baseline.regressionSnapshot
    : null;
  const regressionSnapshotPath = regressionConfig?.path
    ? path.join(ROOT, asString(regressionConfig.path))
    : null;
  const allowRouteAdditions = regressionConfig?.allowRouteAdditions === true;
  const allowRouteRemovals = regressionConfig?.allowRouteRemovals === true;
  const enforceRoleDiff = regressionConfig?.enforceRoleDiff !== false;
  const enforceComponentDiff = regressionConfig?.enforceComponentDiff !== false;
  const enforceRoleGuardDiff = regressionConfig?.enforceRoleGuardDiff !== false;

  const allRoutes = extractAllRoutes(appContent, wrapperComponents);
  const scopedRoutes = allRoutes.filter((route) => {
    const includedByRole = includeRoutesWithAdminOfficerRole && route.roles.includes('admin_officer');
    const includedByRegex = includeRouteRegexes.length > 0 && matchesAnyRegex(route.path, includeRouteRegexes);
    const included = includedByRole || includedByRegex;
    const excluded = excludeRouteRegexes.length > 0 && matchesAnyRegex(route.path, excludeRouteRegexes);
    return included && !excluded;
  });

  const { routes: adminOfficerRoutes, duplicateSignatureConflicts } = consolidateRoutes(scopedRoutes);
  const regressionSnapshot = regressionSnapshotPath ? await readJsonIfExists(regressionSnapshotPath) : null;

  const currentRouteMap = toRouteSignatureMap(adminOfficerRoutes);
  const snapshotRouteMap = toRouteSignatureMap(
    asArray(regressionSnapshot?.routeSignatures).map((route) => ({
      path: asString(route.path),
      roles: asArray(route.roles),
      components: asArray(route.components),
      hasRoleGuard: route.hasRoleGuard !== false,
    })),
  );

  const failures = [];
  const checks = {
    adminOfficerRouteCount: adminOfficerRoutes.length,
    minAdminOfficerRouteCount,
    routeChecks: [],
    routeComponentChecks: [],
    criticalRouteChecks: [],
    duplicateRouteConflicts: duplicateSignatureConflicts,
    regressionChecks: {
      enabled: Boolean(regressionConfig),
      snapshotPath: regressionConfig?.path || null,
      snapshotFound: Boolean(regressionSnapshot),
      addedRoutes: [],
      removedRoutes: [],
      changedRoleRoutes: [],
      changedComponentRoutes: [],
      changedRoleGuardRoutes: [],
    },
  };

  if (adminOfficerRoutes.length < minAdminOfficerRouteCount) {
    failures.push(`Admin officer route count below minimum: ${adminOfficerRoutes.length} < ${minAdminOfficerRouteCount}`);
  }

  for (const conflict of duplicateSignatureConflicts) {
    failures.push(`Duplicate admin officer route signature mismatch: ${conflict.path} (${conflict.firstLine} vs ${conflict.duplicateLine})`);
  }

  for (const route of adminOfficerRoutes) {
    const routeSpecificRequiredRoles = Array.isArray(routeRoleRequirements[route.path])
      ? routeRoleRequirements[route.path]
      : requiredRolesAnyOf;
    const passRole = routeSpecificRequiredRoles.length === 0
      ? true
      : route.roles.some((role) => routeSpecificRequiredRoles.includes(role));
    const passGuard = requireRoleGuard ? route.hasRoleGuard : true;

    const allowedComponents = Array.isArray(routeComponentAllowlist[route.path])
      ? routeComponentAllowlist[route.path]
      : null;
    const unexpectedComponents = allowedComponents
      ? route.components.filter((component) => !allowedComponents.includes(component))
      : [];
    const passComponentAllowlist = !allowedComponents || unexpectedComponents.length === 0;

    checks.routeChecks.push({
      path: route.path,
      line: route.line,
      roles: route.roles,
      components: route.components,
      hasRoleGuard: route.hasRoleGuard,
      roleRequirement: routeSpecificRequiredRoles,
      roleRequirementSource: Array.isArray(routeRoleRequirements[route.path]) ? 'route-specific' : 'global',
      passRole,
      passGuard,
    });

    checks.routeComponentChecks.push({
      path: route.path,
      line: route.line,
      components: route.components,
      allowlist: allowedComponents,
      unexpectedComponents,
      pass: passComponentAllowlist,
    });

    if (!passRole) {
      failures.push(`Admin officer route missing required role (${routeSpecificRequiredRoles.join('|')}): ${route.path}`);
    }
    if (!passGuard) {
      failures.push(`Admin officer route missing explicit role guard: ${route.path}`);
    }
    if (!passComponentAllowlist) {
      failures.push(`Admin officer route has unexpected component wiring for ${route.path}. Unexpected: ${unexpectedComponents.join(', ')}`);
    }
  }

  for (const critical of criticalRoutes) {
    const route = adminOfficerRoutes.find((item) => item.path === asString(critical.path));
    if (!route) {
      failures.push(`Missing critical admin officer route: ${critical.path}`);
      checks.criticalRouteChecks.push({
        path: critical.path,
        found: false,
        requiredRoles: asArray(critical.requiredRoles),
        requiredComponents: asArray(critical.requiredComponents),
        pass: false,
      });
      continue;
    }

    const requiredRoles = asArray(critical.requiredRoles);
    const requiredComponents = asArray(critical.requiredComponents);
    const missingRoles = requiredRoles.filter((role) => !route.roles.includes(role));
    const missingComponents = requiredComponents.filter((component) => !route.components.includes(component));
    const pass = missingRoles.length === 0 && missingComponents.length === 0;

    checks.criticalRouteChecks.push({
      path: critical.path,
      found: true,
      routeRoles: route.roles,
      routeComponents: route.components,
      requiredRoles,
      requiredComponents,
      missingRoles,
      missingComponents,
      pass,
    });

    if (missingRoles.length > 0) {
      failures.push(`Critical admin officer route roles mismatch for ${critical.path}. Missing: ${missingRoles.join(', ')}`);
    }
    if (missingComponents.length > 0) {
      failures.push(`Critical admin officer route components mismatch for ${critical.path}. Missing: ${missingComponents.join(', ')}`);
    }
  }

  if (regressionConfig) {
    if (!regressionSnapshot) {
      failures.push(`Admin officer regression snapshot not found: ${regressionConfig.path}`);
    } else {
      const currentPaths = [...currentRouteMap.keys()].sort();
      const snapshotPaths = [...snapshotRouteMap.keys()].sort();
      const addedRoutes = currentPaths.filter((routePath) => !snapshotRouteMap.has(routePath));
      const removedRoutes = snapshotPaths.filter((routePath) => !currentRouteMap.has(routePath));
      const changedRoleRoutes = [];
      const changedComponentRoutes = [];
      const changedRoleGuardRoutes = [];

      for (const routePath of currentPaths) {
        if (!snapshotRouteMap.has(routePath)) continue;
        const current = currentRouteMap.get(routePath);
        const previous = snapshotRouteMap.get(routePath);

        if (enforceRoleDiff && !arraysEqual(current.roles, previous.roles)) {
          changedRoleRoutes.push({ path: routePath, previous: previous.roles, current: current.roles });
        }
        if (enforceComponentDiff && !arraysEqual(current.components, previous.components)) {
          changedComponentRoutes.push({ path: routePath, previous: previous.components, current: current.components });
        }
        if (enforceRoleGuardDiff && current.hasRoleGuard !== previous.hasRoleGuard) {
          changedRoleGuardRoutes.push({ path: routePath, previous: previous.hasRoleGuard, current: current.hasRoleGuard });
        }
      }

      checks.regressionChecks.addedRoutes = addedRoutes;
      checks.regressionChecks.removedRoutes = removedRoutes;
      checks.regressionChecks.changedRoleRoutes = changedRoleRoutes;
      checks.regressionChecks.changedComponentRoutes = changedComponentRoutes;
      checks.regressionChecks.changedRoleGuardRoutes = changedRoleGuardRoutes;

      if (!allowRouteAdditions && addedRoutes.length > 0) {
        failures.push(`Admin officer routes added since snapshot: ${addedRoutes.join(', ')}`);
      }
      if (!allowRouteRemovals && removedRoutes.length > 0) {
        failures.push(`Admin officer routes removed since snapshot: ${removedRoutes.join(', ')}`);
      }
      if (enforceRoleDiff && changedRoleRoutes.length > 0) {
        failures.push(`Admin officer route roles changed since snapshot: ${changedRoleRoutes.map((item) => item.path).join(', ')}`);
      }
      if (enforceComponentDiff && changedComponentRoutes.length > 0) {
        failures.push(`Admin officer route components changed since snapshot: ${changedComponentRoutes.map((item) => item.path).join(', ')}`);
      }
      if (enforceRoleGuardDiff && changedRoleGuardRoutes.length > 0) {
        failures.push(`Admin officer route role-guard state changed since snapshot: ${changedRoleGuardRoutes.map((item) => item.path).join(', ')}`);
      }
    }
  }

  const trend = {
    checkedAt: new Date().toISOString(),
    baselineSnapshotPath: regressionConfig?.path || null,
    snapshotFound: Boolean(regressionSnapshot),
    current: {
      adminOfficerRouteCount: adminOfficerRoutes.length,
    },
    snapshot: {
      adminOfficerRouteCount: Number(regressionSnapshot?.adminOfficerRouteCount || 0),
    },
    delta: {
      adminOfficerRouteCount: adminOfficerRoutes.length - Number(regressionSnapshot?.adminOfficerRouteCount || 0),
    },
    routeDiff: {
      added: checks.regressionChecks.addedRoutes,
      removed: checks.regressionChecks.removedRoutes,
      roleChanged: checks.regressionChecks.changedRoleRoutes.map((item) => item.path),
      componentChanged: checks.regressionChecks.changedComponentRoutes.map((item) => item.path),
      roleGuardChanged: checks.regressionChecks.changedRoleGuardRoutes.map((item) => item.path),
    },
  };

  const result = {
    checkedAt: new Date().toISOString(),
    appPath: path.relative(ROOT, APP_PATH),
    baselinePath: path.relative(ROOT, BASELINE_PATH),
    adminOfficerRoutes,
    checks,
    passed: failures.length === 0,
    failures,
  };

  await ensureDir(path.dirname(OUT_PATH));
  await fs.writeFile(OUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await fs.writeFile(TREND_OUT_PATH, `${JSON.stringify(trend, null, 2)}\n`, 'utf8');

  if (result.passed) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Admin officer routes check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
