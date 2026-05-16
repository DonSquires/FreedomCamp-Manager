#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const workspaceRoot = process.cwd();

function parseArgs(argv) {
  const args = {
    withTruthBroadcast: false,
    reportOut: 'docs/BOB_SELF_GROUNDING_REPORT.md',
    jsonOut: 'logs/bob-self-grounding-report.json',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--with-truth-broadcast') {
      args.withTruthBroadcast = true;
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
    timeout: 600000,
    maxBuffer: 1024 * 1024 * 8,
  });

  return {
    name,
    command: [command, ...args].join(' '),
    ok: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdoutTail: String(result.stdout || '').slice(-4000),
    stderrTail: String(result.stderr || '').slice(-4000),
  };
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function countFilesInDir(relativeDir, extensions = null) {
  const root = path.join(workspaceRoot, relativeDir);
  if (!pathExists(root)) return 0;

  let count = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (Array.isArray(extensions) && extensions.length > 0) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.includes(ext)) continue;
      }
      count += 1;
    }
  }

  return count;
}

function parseDatabaseTypesSummary() {
  const typesPath = path.join(workspaceRoot, 'src', 'types', 'database.ts');
  if (!pathExists(typesPath)) {
    return {
      typesPath: 'src/types/database.ts',
      exists: false,
      tableCount: 0,
      viewCount: 0,
      enumCount: 0,
      sampleTables: [],
    };
  }

  const raw = fs.readFileSync(typesPath, 'utf8');
  const tableSet = new Set();
  const viewSet = new Set();
  const enumSet = new Set();

  const tableRegex = /Tables:\s*\{([\s\S]*?)\n\s*\}\s*\n\s*Views:/m;
  const viewRegex = /Views:\s*\{([\s\S]*?)\n\s*\}\s*\n\s*Functions:/m;
  const enumRegex = /Enums:\s*\{([\s\S]*?)\n\s*\}\s*\n\s*CompositeTypes:/m;

  const scanKeys = (block, targetSet) => {
    if (!block) return;
    const keyRegex = /\n\s{4}([A-Za-z0-9_]+):\s*\{/g;
    let match;
    while ((match = keyRegex.exec(block)) !== null) {
      targetSet.add(String(match[1] || '').trim());
    }
  };

  const tableMatch = raw.match(tableRegex);
  const viewMatch = raw.match(viewRegex);
  const enumMatch = raw.match(enumRegex);

  scanKeys(tableMatch?.[1], tableSet);
  scanKeys(viewMatch?.[1], viewSet);
  if (enumMatch?.[1]) {
    const keyRegex = /\n\s{4}([A-Za-z0-9_]+):\s*[^\n]+/g;
    let match;
    while ((match = keyRegex.exec(enumMatch[1])) !== null) {
      enumSet.add(String(match[1] || '').trim());
    }
  }

  const tables = [...tableSet].sort((a, b) => a.localeCompare(b));

  return {
    typesPath: 'src/types/database.ts',
    exists: true,
    tableCount: tableSet.size,
    viewCount: viewSet.size,
    enumCount: enumSet.size,
    sampleTables: tables.slice(0, 25),
  };
}

function buildAppSurfaceSummary() {
  return {
    pages: countFilesInDir('src/pages', ['.tsx', '.ts']),
    components: countFilesInDir('src/components', ['.tsx', '.ts']),
    hooks: countFilesInDir('src/hooks', ['.tsx', '.ts']),
    stores: countFilesInDir('src/stores', ['.tsx', '.ts']),
    edgeFunctions: countFilesInDir('supabase/functions', ['.ts']),
    migrations: countFilesInDir('supabase/migrations', ['.sql']),
    scripts: countFilesInDir('scripts', ['.mjs', '.js', '.sh']),
  };
}

function writeJson(filePath, payload) {
  const absolute = path.join(workspaceRoot, filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return absolute;
}

function writeMarkdown(filePath, payload) {
  const absolute = path.join(workspaceRoot, filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const stepLines = payload.steps.map((step) => {
    const status = step.ok ? 'ok' : 'failed';
    return `- ${step.name}: ${status} (exit=${step.exitCode}, duration_ms=${step.durationMs})`;
  });

  const tableSamples = payload.schema.sampleTables.length > 0
    ? payload.schema.sampleTables.map((name) => `- ${name}`).join('\n')
    : '- none detected';

  const content = [
    '# Bob Self Grounding Report',
    '',
    `Generated at: ${payload.generatedAt}`,
    '',
    '## Intent',
    '',
    'Give Bob live, grounded context before autonomous actions: runtime state, architecture corpus, and schema/app surface snapshot.',
    '',
    '## Pipeline Steps',
    '',
    ...stepLines,
    '',
    '## Schema Snapshot (from src/types/database.ts)',
    '',
    `- types_file_exists: ${payload.schema.exists}`,
    `- table_count: ${payload.schema.tableCount}`,
    `- view_count: ${payload.schema.viewCount}`,
    `- enum_count: ${payload.schema.enumCount}`,
    '- sample_tables:',
    tableSamples,
    '',
    '## App Surface Snapshot',
    '',
    `- pages: ${payload.app.pages}`,
    `- components: ${payload.app.components}`,
    `- hooks: ${payload.app.hooks}`,
    `- stores: ${payload.app.stores}`,
    `- edge_functions: ${payload.app.edgeFunctions}`,
    `- migrations: ${payload.app.migrations}`,
    `- scripts: ${payload.app.scripts}`,
    '',
    '## Next Actions',
    '',
    '- Run this workflow at the start of each Bob-heavy session.',
    '- If schema file and migrations diverge, regenerate database types before enrichment writes.',
    '- Keep using intake dry-runs before any apply writes.',
    '',
  ].join('\n');

  fs.writeFileSync(absolute, content, 'utf8');
  return absolute;
}

function printHelp() {
  console.log(`Usage:\n  node scripts/bob-self-grounding-bootstrap.mjs [options]\n\nOptions:\n  --with-truth-broadcast      Also send Truth Protocol message to Bob/Dr Bob\n  --report-out <path>         Markdown report output path (default: docs/BOB_SELF_GROUNDING_REPORT.md)\n  --json-out <path>           JSON report output path (default: logs/bob-self-grounding-report.json)\n  --help, -h                  Show help\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const steps = [];
  // Primary grounding path delegates to the existing orchestrator.
  steps.push(runStep('autonomous_learning_cycle', 'bash', ['scripts/run-autonomous-learning-cycle.sh']));

  if (args.withTruthBroadcast) {
    steps.push(runStep('broadcast_truth_protocol', 'node', ['scripts/broadcast-truth-protocol.mjs']));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: parseDatabaseTypesSummary(),
    app: buildAppSurfaceSummary(),
    steps,
  };

  const jsonPath = writeJson(args.jsonOut, payload);
  const reportPath = writeMarkdown(args.reportOut, payload);

  const hasFailedSteps = steps.some((step) => !step.ok);
  console.log(`Self-grounding JSON written: ${path.relative(workspaceRoot, jsonPath)}`);
  console.log(`Self-grounding report written: ${path.relative(workspaceRoot, reportPath)}`);
  console.log(`Steps run: ${steps.length}`);
  console.log(`Steps failed: ${steps.filter((step) => !step.ok).length}`);

  if (hasFailedSteps) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
