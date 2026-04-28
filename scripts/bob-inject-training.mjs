#!/usr/bin/env node
/**
 * Bob Knowledge Injector — Push Copilot Reasoning Framework + Project Knowledge to Bob
 * Usage: node scripts/bob-inject-training.mjs [--full|--coding|--autonomous|--architecture|--security]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL_RUNPOD || 
  process.env.INFERENCE_SERVICE_URL || 
  'https://api.runpod.ai/v2/n0bp1ifmq01cx2';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || '';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(level, msg) {
  const timestamp = new Date().toISOString();
  const prefix = {
    'info': `${colors.blue}[INFO]${colors.reset}`,
    'success': `${colors.green}[✓]${colors.reset}`,
    'warn': `${colors.yellow}[!]${colors.reset}`,
    'error': `${colors.red}[✗]${colors.reset}`,
  }[level] || '';
  console.log(`${prefix} ${timestamp} ${msg}`);
}

async function loadTrainingFile(filePath) {
  try {
    const fullPath = path.join(REPO_ROOT, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    return { path: filePath, size: content.length, content };
  } catch (err) {
    log('warn', `Could not load ${filePath}: ${err.message}`);
    return null;
  }
}

async function injectTrainingToBob(trainingData) {
  if (!INFERENCE_API_KEY) {
    log('error', 'INFERENCE_API_KEY not set. Set via: export INFERENCE_API_KEY=rpa_...');
    process.exit(1);
  }

  log('info', `Injecting ${trainingData.length} training packs to Bob...`);

  for (const training of trainingData) {
    if (!training) continue;

    log('info', `Sending: ${training.path} (${(training.size / 1024).toFixed(1)} KB)`);

    const payload = {
      input: {
        action: 'training',
        category: 'coding-logic',
        source: training.path,
        content: training.content.substring(0, 10000), // First 10KB per message
      },
    };

    try {
      const response = await fetch(`${INFERENCE_SERVICE_URL}/runsync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${INFERENCE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        log('warn', `Bob returned status ${response.status} for ${training.path}`);
      } else {
        log('success', `✓ ${training.path} injected`);
      }
    } catch (err) {
      log('warn', `Failed to send ${training.path}: ${err.message}`);
    }
  }

  log('success', 'Training injection complete!');
}

async function listAvailableTraining() {
  log('info', 'Available training modules:');

  const modules = {
    'coding-logic': [
      'docs/BOB_CODING_LOGIC_TRAINING.md',
      '.github/copilot-instructions.md',
    ],
    'autonomous': [
      'docs/BOB_CODING_LOGIC_TRAINING.md',
      'BOB_INTEGRATION_QUICKSTART.md',
      '.github/copilot-instructions.md',
    ],
    'architecture': [
      'docs/adr/001-*.md',
      'docs/ARCHITECTURE_PLAN.md',
      'docs/DECISIONS.md',
    ],
    'security': [
      'docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md',
      'docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md',
      'docs/BOB_LEGAL_FRAMEWORK.md',
    ],
    'domain': [
      'docs/BOB_NZ_BUSINESS_GROWTH_TRAINING.md',
      'docs/BOB_FIELD_INTELLIGENCE.md',
    ],
  };

  for (const [category, files] of Object.entries(modules)) {
    console.log(`\n  ${colors.blue}${category}:${colors.reset}`);
    files.forEach(f => console.log(`    - ${f}`));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--full';

  if (mode === '--list') {
    await listAvailableTraining();
    return;
  }

  // Load training based on mode
  let trainingFiles = [];

  if (mode === '--full' || mode === '--coding') {
    trainingFiles.push(...[
      'docs/BOB_CODING_LOGIC_TRAINING.md',
      '.github/copilot-instructions.md',
    ]);
  }

  if (mode === '--full' || mode === '--autonomous') {
    trainingFiles.push(...[
      'docs/BOB_CODING_LOGIC_TRAINING.md',
      'BOB_INTEGRATION_QUICKSTART.md',
      '.github/copilot-instructions.md',
    ]);
  }

  if (mode === '--full' || mode === '--architecture') {
    trainingFiles.push(...[
      'docs/DECISIONS.md',
      'docs/LESSONS_LEARNED.md',
    ]);
  }

  if (mode === '--full' || mode === '--security') {
    trainingFiles.push(...[
      'docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md',
      'docs/BOB_TRAINING_TRUTH_PROTOCOL.md',
    ]);
  }

  trainingFiles = [...new Set(trainingFiles)];

  // Load files
  log('info', `Loading training files (mode: ${mode})...`);
  const trainingData = await Promise.all(
    trainingFiles.map(f => loadTrainingFile(f))
  );

  const loaded = trainingData.filter(t => t !== null);
  log('success', `Loaded ${loaded.length}/${trainingFiles.length} files`);

  if (loaded.length === 0) {
    log('error', 'No training files loaded');
    process.exit(1);
  }

  // Send to Bob
  await injectTrainingToBob(loaded);
}

main().catch(err => {
  log('error', `Unexpected error: ${err.message}`);
  process.exit(1);
});
