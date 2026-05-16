#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceRoot = process.cwd();

function parseArgs(argv) {
  const args = {
    apply: false,
    bucket: 'evidence',
    prefix: 'historical-imports',
    limit: '100',
    organizationId: '',
    sinceDate: '',
    reportOut: 'docs/BOB_TUTOR_MASTERY_REPORT.md',
    jsonOut: 'logs/bob-tutor-mastery-report.json',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--bucket' && argv[i + 1]) {
      args.bucket = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--prefix' && argv[i + 1]) {
      args.prefix = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--limit' && argv[i + 1]) {
      args.limit = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--organization-id' && argv[i + 1]) {
      args.organizationId = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--since-date' && argv[i + 1]) {
      args.sinceDate = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--report-out' && argv[i + 1]) {
      args.reportOut = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--json-out' && argv[i + 1]) {
      args.jsonOut = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function runStep(name, command, args = []) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 1200000,
    maxBuffer: 1024 * 1024 * 16,
  });

  return {
    name,
    command: [command, ...args].join(' '),
    ok: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdoutTail: String(result.stdout || '').slice(-5000),
    stderrTail: String(result.stderr || '').slice(-5000),
  };
}

function parseSchemaSnapshot() {
  const typesPath = path.join(workspaceRoot, 'src', 'types', 'database.ts');
  if (!fs.existsSync(typesPath)) {
    return {
      exists: false,
      tableCount: 0,
      sampleTables: [],
    };
  }

  const raw = fs.readFileSync(typesPath, 'utf8');
  const tableNames = new Set();
  const tableRegex = /\n\s{8}([A-Za-z0-9_]+):\s*\{\s*\n\s{10}Row:/g;
  let match;
  while ((match = tableRegex.exec(raw)) !== null) {
    tableNames.add(String(match[1] || '').trim());
  }

  const tables = [...tableNames].sort((a, b) => a.localeCompare(b));
  return {
    exists: true,
    tableCount: tableNames.size,
    sampleTables: tables.slice(0, 30),
  };
}

function writeJson(outPath, payload) {
  const abs = path.join(workspaceRoot, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return abs;
}

function writeMarkdown(outPath, payload) {
  const abs = path.join(workspaceRoot, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const stepLines = payload.steps.map((step) =>
    `- ${step.name}: ${step.ok ? 'ok' : 'failed'} (exit=${step.exitCode}, duration_ms=${step.durationMs})`
  );

  const tableLines = payload.schema.sampleTables.length
    ? payload.schema.sampleTables.map((table) => `- ${table}`).join('\n')
    : '- none detected';

  const content = [
    '# Bob Tutor Mastery Report',
    '',
    `Generated at: ${payload.generatedAt}`,
    '',
    '## Objective',
    '',
    'Train Bob and app workflows to enrich data safely and accurately using grounded schema/app knowledge, research discipline, and policy gates.',
    '',
    '## Mastery Loop',
    '',
    ...stepLines,
    '',
    '## Scope Used',
    '',
    `- mode: ${payload.scope.apply ? 'apply' : 'dry-run'}`,
    `- bucket: ${payload.scope.bucket}`,
    `- prefix: ${payload.scope.prefix}`,
    `- limit: ${payload.scope.limit}`,
    `- organization_id: ${payload.scope.organizationId || '(auto or none)'}`,
    `- since_date: ${payload.scope.sinceDate || '(none)'}`,
    '',
    '## Schema Confidence Snapshot',
    '',
    `- database_types_exists: ${payload.schema.exists}`,
    `- detected_tables: ${payload.schema.tableCount}`,
    '- sample_tables:',
    tableLines,
    '',
    '## Tutor Notes',
    '',
    '- If autonomous org inference is weak, run intake with explicit organization mapping before apply mode.',
    '- Keep enrichment in dry-run until blocker count is zero and confidence gates are green.',
    '- Re-run this cycle after schema changes, route rewires, or major data migrations.',
    '',
  ].join('\n');

  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

function buildEnrichmentArgs(scope) {
  const args = [
    'scripts/run-enrichment-bob-app-training.mjs',
    '--with-feeds',
    '--with-app-checks',
    '--bucket',
    scope.bucket,
    '--prefix',
    scope.prefix,
    '--limit',
    scope.limit,
  ];

  if (scope.organizationId) {
    args.push('--organization-id', scope.organizationId);
  }
  if (scope.sinceDate) {
    args.push('--since-date', scope.sinceDate);
  }
  if (scope.apply) {
    args.push('--apply');
  }

  return args;
}

function printHelp() {
  console.log(`Usage:\n  node scripts/bob-tutor-mastery-cycle.mjs [options]\n\nOptions:\n  --apply                  Execute write-capable enrichment path\n  --bucket <name>          Intake bucket (default: evidence)\n  --prefix <path>          Intake prefix (default: historical-imports)\n  --limit <n>              Intake limit (default: 100)\n  --organization-id <id>   Optional org override\n  --since-date <date>      Optional roster floor date\n  --report-out <file>      Markdown report (default: docs/BOB_TUTOR_MASTERY_REPORT.md)\n  --json-out <file>        JSON report (default: logs/bob-tutor-mastery-report.json)\n  --help, -h               Show help\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const steps = [];

  // Use the existing orchestrator as the source of truth for grounding and learning cycles.
  steps.push(runStep('autonomous_orchestrator', 'bash', ['scripts/run-autonomous-learning-cycle.sh']));

  // Teach Bob enrichment logic and app-consumption behavior with the established enrichment trainer.
  steps.push(runStep('enrichment_training', 'node', buildEnrichmentArgs(args)));

  // Inventory roster/deputy-style sources so Bob learns document families and provenance.
  steps.push(
    runStep('roster_source_inventory', 'node', [
      'scripts/roster-source-inventory.mjs',
      '--artifact-out',
      'logs/roster-source-inventory.tutor.json',
      '--limit-per-bucket',
      '3000',
    ])
  );

  // Validate baseline reasoning capability gate.
  steps.push(runStep('capability_gate', 'node', ['scripts/bob-capability-gate.mjs', '--required', 'chat']));

  const payload = {
    generatedAt: new Date().toISOString(),
    scope: {
      apply: args.apply,
      bucket: args.bucket,
      prefix: args.prefix,
      limit: args.limit,
      organizationId: args.organizationId,
      sinceDate: args.sinceDate,
    },
    schema: parseSchemaSnapshot(),
    steps,
  };

  const jsonAbs = writeJson(args.jsonOut, payload);
  const reportAbs = writeMarkdown(args.reportOut, payload);

  const failedSteps = steps.filter((step) => !step.ok);
  console.log(`Tutor JSON written: ${path.relative(workspaceRoot, jsonAbs)}`);
  console.log(`Tutor report written: ${path.relative(workspaceRoot, reportAbs)}`);
  console.log(`Steps run: ${steps.length}`);
  console.log(`Steps failed: ${failedSteps.length}`);

  if (failedSteps.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
