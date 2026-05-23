#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    strict: flags.has('--strict'),
    json: flags.has('--json'),
    templates: flags.has('--templates'),
  };
}

async function safeRead(relativePath, baseDir = repoRoot) {
  const target = path.resolve(baseDir, relativePath);
  try {
    return await readFile(target, 'utf8');
  } catch {
    return '';
  }
}

function hasAll(text, probes) {
  return probes.every((probe) => text.includes(probe));
}

function printTemplates() {
  const base = '${BOB_BACKEND_URL:-http://localhost:4000}';
  console.log('Bob one-line command templates');
  console.log('');
  console.log('1) Research agent deep scrape + synthesis');
  console.log(
    `curl -sS -X POST "${base}/api/heal" -H "Authorization: Bearer $BOB_USER_BEARER" -H "Content-Type: application/json" -d '{"sessionId":"research-'"$(date +%s)'","text":"@research_agent Scan latest release notes and migration guides for <library>, summarize breaking changes and exact remediation steps for this repo."}'`
  );
  console.log('');
  console.log('2) Mobile preview APK build (grand master only)');
  console.log(
    `curl -sS -X POST "${base}/api/mobile/build-preview" -H "Authorization: Bearer $BOB_GRANDMASTER_BEARER" -H "Content-Type: application/json" -d '{}'`
  );
  console.log('');
  console.log('3) Mobile OTA hotfix (grand master only)');
  console.log(
    `curl -sS -X POST "${base}/api/mobile/ota-hotfix" -H "Authorization: Bearer $BOB_GRANDMASTER_BEARER" -H "Content-Type: application/json" -d '{"message":"<hotfix message>"}'`
  );
}

async function runAudit() {
  const backendIndex = await safeRead('src/index.ts', backendRoot);
  const pmTools = await safeRead('src/pmTools.ts', backendRoot);
  const easTools = await safeRead('src/easTools.ts', backendRoot);
  const agentTools = await safeRead('src/agentTools.ts', backendRoot);
  const envExample = await safeRead('.env.example', backendRoot);
  const runtimeWrapper = await safeRead('scripts/bob-env-run.sh', backendRoot);

  const checks = [
    {
      id: 'cognitive.dual_mode',
      required: true,
      ok: hasAll(backendIndex, ['isObviousAutonomous', 'consultativeResponse', 'formatCognitiveRiskRewardMarkdown']),
      detail: 'Autonomous vs consultative reasoning gate present.',
    },
    {
      id: 'cognitive.reasoning_ledger',
      required: true,
      ok: hasAll(backendIndex, ["from('ai_reasoning_ledger')", 'persistAiReasoningLedger']),
      detail: 'Reasoning ledger persistence wired.',
    },
    {
      id: 'cognitive.chat_memory',
      required: true,
      ok: hasAll(backendIndex, ["from('chat_sessions')", 'appendChatSessionMessage', 'loadRecentChatSessionMessages']),
      detail: 'Short-term conversation memory table wiring present.',
    },
    {
      id: 'agents.personas',
      required: true,
      ok: hasAll(backendIndex, ['dr_bob', 'bob', 'emulator', 'writer_agent', 'research_agent']),
      detail: 'Five specialized personas declared in runtime roles.',
    },
    {
      id: 'tools.gitea_pm',
      required: true,
      ok: hasAll(pmTools, ['createGiteaIssue', 'closeGiteaIssue', 'updateMarkdownTodo']) && hasAll(envExample, ['GITEA_BASE_URL', 'GITEA_TOKEN', 'GITEA_OWNER', 'GITEA_REPO']),
      detail: 'Gitea issue + markdown PM tooling and env vars are present.',
    },
    {
      id: 'tools.gitea_propose_pr',
      required: true,
      ok: hasAll(backendIndex, ["app.post('/api/gitea/propose-pr'", 'executeGiteaProposePr']),
      detail: 'Gitea propose PR route exists.',
    },
    {
      id: 'tools.railway_variable_upsert',
      required: true,
      ok: hasAll(agentTools, ['variableUpsert', 'VariableUpsertInput', 'RAILWAY_GRAPHQL_ENDPOINT']),
      detail: 'Railway GraphQL variableUpsert mutation exists.',
    },
    {
      id: 'tools.mobile_eas',
      required: true,
      ok: hasAll(easTools, ['triggerPreviewApkBuild', 'triggerOtaHotfix', "['build', '--platform', 'android', '--profile', 'preview'", "['update', '--branch', 'production'" ]) && hasAll(backendIndex, ["app.post('/api/mobile/build-preview'", "app.post('/api/mobile/ota-hotfix'"]),
      detail: 'EAS build/update tooling and protected API endpoints exist.',
    },
    {
      id: 'tools.research_core',
      required: true,
      ok: hasAll(backendIndex, ['buildPrioritizedResearchQueries', 'executeWebSearch', 'fetchWebpageContent', 'isTrustedResearchDomain']),
      detail: 'Research/web retrieval path is wired.',
    },
    {
      id: 'guardrails.playwright_webhook_gate',
      required: true,
      ok: hasAll(backendIndex, ["app.post('/api/gitea-webhook'", 'isHundredPercentGreen', 'AUTOMATION_WEBHOOK_TOKEN']),
      detail: 'Webhook-driven Playwright gate and auth middleware exist.',
    },
    {
      id: 'guardrails.admin_auth',
      required: true,
      ok: hasAll(backendIndex, ['requireAdminAuth', 'requireGrandMasterAuth']),
      detail: 'Admin/grand-master auth middleware exists for privileged routes.',
    },
    {
      id: 'guardrails.sandbox_emulator',
      required: true,
      ok: hasAll(backendIndex, ['runInSandboxEmulator', 'BLOCKED_BY_SANDBOX']),
      detail: 'Sandbox emulator can block unsafe patches before deployment.',
    },
    {
      id: 'guardrails.deterministic_backend_runtime',
      required: true,
      ok: hasAll(runtimeWrapper, ['.node-version', 'Node version mismatch', 'packageManager must be npm@<version>', 'corepack npm --version']),
      detail: 'Backend wrapper pins deterministic Node/NPM runtime.',
    },
    {
      id: 'voice.whisper_proxy_foundation',
      required: false,
      ok: hasAll(envExample, ['WHISPER_PROXY_URL']) || hasAll(backendIndex, ['chat_sessions']),
      detail: 'Voice path reference detected (or chat memory fallback present).',
    },
  ];

  const requiredFailed = checks.filter((entry) => entry.required && !entry.ok);
  const summary = {
    total: checks.length,
    passed: checks.filter((entry) => entry.ok).length,
    failedRequired: requiredFailed.length,
    failedOptional: checks.filter((entry) => !entry.required && !entry.ok).length,
    status: requiredFailed.length === 0 ? 'READY' : 'BLOCKED',
  };

  return { checks, summary };
}

function printAuditTable(report) {
  console.log('Bob capability matrix audit');
  console.log('');
  for (const check of report.checks) {
    const status = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    const scope = check.required ? 'required' : 'optional';
    console.log(`${status}  [${scope}] ${check.id}`);
    console.log(`      ${check.detail}`);
  }

  console.log('');
  console.log(`Summary: ${report.summary.status} (${report.summary.passed}/${report.summary.total} checks passed)`);
  if (report.summary.failedRequired > 0) {
    console.log(`Required failures: ${report.summary.failedRequired}`);
  }
  if (report.summary.failedOptional > 0) {
    console.log(`Optional warnings: ${report.summary.failedOptional}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.templates) {
    printTemplates();
    return;
  }

  const report = await runAudit();

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printAuditTable(report);
  }

  if (args.strict && report.summary.failedRequired > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bob-capability-matrix-audit] fatal: ${message}`);
  process.exitCode = 1;
});