#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');
const BASELINE_PATH = path.join(ROOT, 'data', 'admin-officer-endpoints-baseline.json');
const OUT_PATH = path.join(ROOT, 'data', 'prepared', 'admin-officer-endpoints-report.json');
const TREND_OUT_PATH = path.join(ROOT, 'data', 'prepared', 'admin-officer-endpoints-trend.json');

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function objectsEqual(a, b) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (!arraysEqual(aKeys, bKeys)) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function toEndpointSignatureMap(endpoints) {
  const map = new Map();
  for (const endpoint of endpoints) {
    map.set(endpoint.name, {
      hasIndexFile: endpoint.hasIndexFile,
      hasDenoServe: endpoint.hasDenoServe,
      hasOptionsHandler: endpoint.hasOptionsHandler,
      usesCorsHelper: endpoint.usesCorsHelper,
    });
  }
  return map;
}

async function collectEndpointSignatures(endpointNames) {
  const signatures = [];

  for (const endpointName of endpointNames) {
    const endpointDir = path.join(FUNCTIONS_DIR, endpointName);
    const indexPath = path.join(endpointDir, 'index.ts');

    let hasDirectory = false;
    let hasIndexFile = false;
    let hasDenoServe = false;
    let hasOptionsHandler = false;
    let usesCorsHelper = false;

    try {
      const stat = await fs.stat(endpointDir);
      hasDirectory = stat.isDirectory();
    } catch {
      hasDirectory = false;
    }

    if (hasDirectory) {
      try {
        const content = await fs.readFile(indexPath, 'utf8');
        hasIndexFile = true;
        hasDenoServe = /Deno\.serve\s*\(/.test(content) || /serve\s*\(async\s*\(/.test(content);
        hasOptionsHandler = /req\.method\s*===\s*['"]OPTIONS['"]/.test(content);
        usesCorsHelper = /(corsHeaders|getCorsHeaders|withCors)/.test(content);
      } catch {
        hasIndexFile = false;
      }
    }

    signatures.push({
      name: endpointName,
      path: path.relative(ROOT, endpointDir).replace(/\\/g, '/'),
      hasDirectory,
      hasIndexFile,
      hasDenoServe,
      hasOptionsHandler,
      usesCorsHelper,
    });
  }

  return signatures;
}

async function main() {
  const baseline = await readJson(BASELINE_PATH);

  const thresholds = baseline.thresholds || {};
  const requiredEndpoints = asArray(baseline.requiredEndpoints);
  const minAdminOfficerEndpointCount = Number(thresholds.minAdminOfficerEndpointCount || requiredEndpoints.length || 1);

  const endpointRequirements = baseline.endpointRequirements && typeof baseline.endpointRequirements === 'object'
    ? baseline.endpointRequirements
    : {};
  const endpointRequirementOverrides = baseline.endpointRequirementOverrides && typeof baseline.endpointRequirementOverrides === 'object'
    ? baseline.endpointRequirementOverrides
    : {};

  const regressionConfig = baseline.regressionSnapshot && typeof baseline.regressionSnapshot === 'object'
    ? baseline.regressionSnapshot
    : null;
  const regressionSnapshotPath = regressionConfig?.path
    ? path.join(ROOT, asString(regressionConfig.path))
    : null;
  const allowEndpointAdditions = regressionConfig?.allowEndpointAdditions === true;
  const allowEndpointRemovals = regressionConfig?.allowEndpointRemovals === true;
  const enforceEndpointDiff = regressionConfig?.enforceEndpointDiff !== false;

  const endpointSignatures = await collectEndpointSignatures(requiredEndpoints);
  const regressionSnapshot = regressionSnapshotPath ? await readJsonIfExists(regressionSnapshotPath) : null;

  const currentEndpointMap = toEndpointSignatureMap(endpointSignatures);
  const snapshotEndpointMap = toEndpointSignatureMap(
    asArray(regressionSnapshot?.endpointSignatures).map((endpoint) => ({
      name: asString(endpoint.name),
      hasIndexFile: endpoint.hasIndexFile !== false,
      hasDenoServe: endpoint.hasDenoServe !== false,
      hasOptionsHandler: endpoint.hasOptionsHandler !== false,
      usesCorsHelper: endpoint.usesCorsHelper !== false,
    })),
  );

  const failures = [];
  const checks = {
    adminOfficerEndpointCount: endpointSignatures.length,
    minAdminOfficerEndpointCount,
    endpointChecks: [],
    regressionChecks: {
      enabled: Boolean(regressionConfig),
      snapshotPath: regressionConfig?.path || null,
      snapshotFound: Boolean(regressionSnapshot),
      addedEndpoints: [],
      removedEndpoints: [],
      changedEndpoints: [],
    },
  };

  if (endpointSignatures.length < minAdminOfficerEndpointCount) {
    failures.push(`Admin officer endpoint count below minimum: ${endpointSignatures.length} < ${minAdminOfficerEndpointCount}`);
  }

  const requireDenoServe = endpointRequirements.requireDenoServe !== false;
  const requireOptionsHandler = endpointRequirements.requireOptionsHandler !== false;
  const requireCorsHelper = endpointRequirements.requireCorsHelper !== false;

  for (const endpoint of endpointSignatures) {
    const endpointOverride = endpointRequirementOverrides[endpoint.name] && typeof endpointRequirementOverrides[endpoint.name] === 'object'
      ? endpointRequirementOverrides[endpoint.name]
      : {};
    const endpointRequireDenoServe = endpointOverride.requireDenoServe === undefined
      ? requireDenoServe
      : endpointOverride.requireDenoServe !== false;
    const endpointRequireOptionsHandler = endpointOverride.requireOptionsHandler === undefined
      ? requireOptionsHandler
      : endpointOverride.requireOptionsHandler !== false;
    const endpointRequireCorsHelper = endpointOverride.requireCorsHelper === undefined
      ? requireCorsHelper
      : endpointOverride.requireCorsHelper !== false;

    const passDirectory = endpoint.hasDirectory;
    const passIndex = endpoint.hasIndexFile;
    const passServe = endpointRequireDenoServe ? endpoint.hasDenoServe : true;
    const passOptions = endpointRequireOptionsHandler ? endpoint.hasOptionsHandler : true;
    const passCors = endpointRequireCorsHelper ? endpoint.usesCorsHelper : true;

    checks.endpointChecks.push({
      ...endpoint,
      requireDenoServe: endpointRequireDenoServe,
      requireOptionsHandler: endpointRequireOptionsHandler,
      requireCorsHelper: endpointRequireCorsHelper,
      passDirectory,
      passIndex,
      passServe,
      passOptions,
      passCors,
    });

    if (!passDirectory) {
      failures.push(`Missing admin officer endpoint directory: ${endpoint.name}`);
      continue;
    }
    if (!passIndex) {
      failures.push(`Admin officer endpoint missing index.ts: ${endpoint.name}`);
      continue;
    }
    if (!passServe) {
      failures.push(`Admin officer endpoint missing Deno.serve handler: ${endpoint.name}`);
    }
    if (!passOptions) {
      failures.push(`Admin officer endpoint missing OPTIONS preflight handler: ${endpoint.name}`);
    }
    if (!passCors) {
      failures.push(`Admin officer endpoint missing CORS helper usage: ${endpoint.name}`);
    }
  }

  if (regressionConfig) {
    if (!regressionSnapshot) {
      failures.push(`Admin officer endpoint regression snapshot not found: ${regressionConfig.path}`);
    } else {
      const currentNames = [...currentEndpointMap.keys()].sort();
      const snapshotNames = [...snapshotEndpointMap.keys()].sort();
      const addedEndpoints = currentNames.filter((name) => !snapshotEndpointMap.has(name));
      const removedEndpoints = snapshotNames.filter((name) => !currentEndpointMap.has(name));
      const changedEndpoints = [];

      for (const endpointName of currentNames) {
        if (!snapshotEndpointMap.has(endpointName)) continue;
        const current = currentEndpointMap.get(endpointName);
        const previous = snapshotEndpointMap.get(endpointName);
        if (enforceEndpointDiff && !objectsEqual(current, previous)) {
          changedEndpoints.push({ path: endpointName, previous, current });
        }
      }

      checks.regressionChecks.addedEndpoints = addedEndpoints;
      checks.regressionChecks.removedEndpoints = removedEndpoints;
      checks.regressionChecks.changedEndpoints = changedEndpoints;

      if (!allowEndpointAdditions && addedEndpoints.length > 0) {
        failures.push(`Admin officer endpoints added since snapshot: ${addedEndpoints.join(', ')}`);
      }
      if (!allowEndpointRemovals && removedEndpoints.length > 0) {
        failures.push(`Admin officer endpoints removed since snapshot: ${removedEndpoints.join(', ')}`);
      }
      if (enforceEndpointDiff && changedEndpoints.length > 0) {
        failures.push(`Admin officer endpoint implementation signature changed since snapshot: ${changedEndpoints.map((item) => item.path).join(', ')}`);
      }
    }
  }

  const trend = {
    checkedAt: new Date().toISOString(),
    baselineSnapshotPath: regressionConfig?.path || null,
    snapshotFound: Boolean(regressionSnapshot),
    current: {
      adminOfficerEndpointCount: endpointSignatures.length,
    },
    snapshot: {
      adminOfficerEndpointCount: Number(regressionSnapshot?.adminOfficerEndpointCount || 0),
    },
    delta: {
      adminOfficerEndpointCount: endpointSignatures.length - Number(regressionSnapshot?.adminOfficerEndpointCount || 0),
    },
    endpointDiff: {
      added: checks.regressionChecks.addedEndpoints,
      removed: checks.regressionChecks.removedEndpoints,
      changed: checks.regressionChecks.changedEndpoints.map((item) => item.path),
    },
  };

  const result = {
    checkedAt: new Date().toISOString(),
    functionsPath: path.relative(ROOT, FUNCTIONS_DIR),
    baselinePath: path.relative(ROOT, BASELINE_PATH),
    endpointSignatures,
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
  console.error(`Admin officer endpoints check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
