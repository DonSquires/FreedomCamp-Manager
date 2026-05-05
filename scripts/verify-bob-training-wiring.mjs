#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildCanonicalTrainingSources } from './bob-training-sources.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

function toAbsolute(relativePath) {
  return path.join(workspaceRoot, relativePath);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const jsonOnly = process.argv.includes('--json-only');
  const nonStrict = process.argv.includes('--non-strict');
  const BRAIN_DUMP_RELATIVE_PATH = 'docs/BOB_BRAIN_DUMP.md';
  const brainDumpPath = toAbsolute('docs/BOB_BRAIN_DUMP.md');
  const canonicalTraining = buildCanonicalTrainingSources(workspaceRoot, { includeContext: false });

  const existingTrainingFiles = [];
  for (const relPath of canonicalTraining) {
    if (await pathExists(toAbsolute(relPath))) existingTrainingFiles.push(relPath);
  }

  const brainDumpExists = await pathExists(brainDumpPath);
  if (!brainDumpExists) {
    console.error('BOB_BRAIN_DUMP.md not found. Run scripts/auto-ingest.mjs first.');
    process.exit(2);
  }

  const brainDump = await fs.readFile(brainDumpPath, 'utf8');
  // The brain dump is generated output and should not be required to include itself.
  const missingInBrainDump = existingTrainingFiles
    .filter((relPath) => relPath !== BRAIN_DUMP_RELATIVE_PATH)
    .filter((relPath) => !brainDump.includes(`## FILE: ${relPath}`));

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      canonicalTraining: canonicalTraining.length,
      existingTrainingFiles: existingTrainingFiles.length,
      missingInBrainDump: missingInBrainDump.length,
    },
    missingInBrainDump,
  };

  console.log(JSON.stringify(report, null, 2));

  if (missingInBrainDump.length > 0) {
    if (!jsonOnly) {
      console.error('\nTraining wiring drift detected: some canonical training files are missing from BOB_BRAIN_DUMP.md');
    }
    process.exit(nonStrict ? 0 : 1);
  }

  if (!jsonOnly) {
    console.log('\nTraining wiring is consolidated and in sync.');
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
