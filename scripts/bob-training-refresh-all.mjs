#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const scriptsDir = path.join(workspaceRoot, 'scripts');

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipConnectivity = process.argv.includes('--skip-connectivity-test');

  const startedAt = Date.now();
  console.log('\n=== Bob Training Refresh (Consolidated) ===\n');

  const step1 = await run('node', [path.join(scriptsDir, 'auto-ingest.mjs')]);
  if (step1.code !== 0) {
    console.error('Step 1 failed: auto-ingest.mjs');
    process.exit(step1.code);
  }

  const step2 = await run('node', [path.join(scriptsDir, 'verify-bob-training-wiring.mjs'), '--json-only'], { capture: true });
  if (step2.code !== 0) {
    console.error('Step 2 failed: verify-bob-training-wiring.mjs');
    process.stderr.write(step2.stderr || '');
    process.stdout.write(step2.stdout || '');
    process.exit(step2.code);
  }

  let verifyReport = null;
  try {
    verifyReport = JSON.parse(step2.stdout);
  } catch {
    verifyReport = null;
  }

  const ingestArgs = [path.join(scriptsDir, 'bob-ingest-all-training.mjs'), '--skip-verify'];
  if (dryRun) ingestArgs.push('--dry-run');
  if (skipConnectivity) ingestArgs.push('--skip-connectivity-test');

  const step3 = await run('node', ingestArgs);
  if (step3.code !== 0) {
    console.error('Step 3 failed: bob-ingest-all-training.mjs');
    process.exit(step3.code);
  }

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log('\n=== Consolidation Stats ===');
  if (verifyReport) {
    console.log(`Canonical training sources: ${verifyReport.totals.canonicalTraining}`);
    console.log(`Existing training files:    ${verifyReport.totals.existingTrainingFiles}`);
    console.log(`Missing in brain dump:      ${verifyReport.totals.missingInBrainDump}`);
  } else {
    console.log('Verification report parsing failed; run verify-bob-training-wiring.mjs manually.');
  }
  console.log(`Elapsed seconds:            ${elapsedSeconds}`);
  console.log('Status:                     SUCCESS\n');
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
