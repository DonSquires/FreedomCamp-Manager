#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const clientsRoot = path.join(workspaceRoot, 'docs', 'templates', 'clients');
const outputPath = path.join(workspaceRoot, 'data', 'client-geofence-registry.json');

const REQUIRED_KEYS = [
  'clientId',
  'clientName',
  'siteName',
  'siteType',
  'primaryContact',
  'geofence',
  'jobModes',
  'compliance',
];

function isCoordinatePair(pair) {
  return Array.isArray(pair) && pair.length === 2 && pair.every((n) => Number.isFinite(n));
}

function validateIntake(data, sourcePath) {
  const issues = [];
  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) issues.push(`Missing required key: ${key}`);
  }

  if (!data.geofence || !Array.isArray(data.geofence.polygon) || data.geofence.polygon.length < 3) {
    issues.push('geofence.polygon must contain at least 3 coordinate pairs');
  } else {
    for (const pair of data.geofence.polygon) {
      if (!isCoordinatePair(pair)) {
        issues.push('geofence.polygon contains invalid coordinate pair');
        break;
      }
    }
  }

  if (!data.compliance || !Number.isFinite(data.compliance.noiseThresholdDb)) {
    issues.push('compliance.noiseThresholdDb must be a number');
  }

  if (!data.compliance || typeof data.compliance.seizurePolicy !== 'string') {
    issues.push('compliance.seizurePolicy must be a string');
  }

  return {
    valid: issues.length === 0,
    issues,
    sourcePath,
  };
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.json') &&
      entry.name.startsWith('intake')
    ) {
      files.push(full);
    }
  }
  return files;
}

function toRegistryRecord(intake) {
  return {
    id: intake.clientId,
    name: intake.siteName,
    clientName: intake.clientName,
    clientType: 'private-enterprise',
    polygon: intake.geofence.polygon,
    sopPath: `docs/templates/clients/${intake.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/sop.md`,
    accessCodeRef: intake.sop?.accessControlProcedure || 'Client access control procedure required.',
    terminology: intake.sop?.terminology || [],
    jobModes: intake.jobModes || [],
    compliance: {
      jurisdictionId: intake.compliance.jurisdictionId,
      noiseLimit: intake.compliance.noiseThresholdDb,
      seizureRule: intake.compliance.seizurePolicy,
      councilBylawRefs: intake.compliance.councilBylawRefs || [],
    },
    source: intake.__source,
  };
}

async function main() {
  let files = [];
  try {
    files = await walk(clientsRoot);
  } catch {
    files = [];
  }

  const registry = [];
  const errors = [];

  for (const filePath of files) {
    const rel = path.relative(workspaceRoot, filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push({ sourcePath: rel, issues: [`Invalid JSON: ${error.message}`] });
      continue;
    }

    const validation = validateIntake(parsed, rel);
    if (!validation.valid) {
      errors.push({ sourcePath: rel, issues: validation.issues });
      continue;
    }

    parsed.__source = rel;
    registry.push(toRegistryRecord(parsed));
  }

  const deduped = [];
  const seen = new Set();
  for (const item of registry) {
    if (seen.has(item.id)) {
      errors.push({ sourcePath: item.source, issues: [`Duplicate clientId: ${item.id}`] });
      continue;
    }
    seen.add(item.id);
    deduped.push(item);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    total: deduped.length,
    records: deduped,
    errors,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Client geofence registry updated: ${path.relative(workspaceRoot, outputPath)}`);
  console.log(`Imported records: ${deduped.length}`);
  console.log(`Validation errors: ${errors.length}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
