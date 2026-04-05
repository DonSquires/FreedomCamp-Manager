function trimText(value, maxLen = 1200) {
  const text = String(value || '').trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

const KNOWLEDGE_PACKS = {
  build_context: {
    name: 'fieldops-build-context',
    summary: 'React + TypeScript frontend, Supabase backend, Railway inference microservice, strict self-contained mode supported.',
    key_points: [
      'Frontend stack: React 18, TypeScript, Vite, Tailwind, shadcn/ui.',
      'Backend stack: Supabase Postgres + Edge Functions + RLS.',
      'Inference stack: Node/Express + ONNX + OCR with local-first pathways.',
      'Strict mode goal: block outbound cloud egress and keep processing local.',
      'CI gates should validate build, API behavior, and mobile compatibility.',
    ],
  },
  nz_compliance_context: {
    name: 'nz-compliance-context',
    summary: 'Operational guidance for privacy-by-design and evidence handling in New Zealand deployments.',
    key_points: [
      'Minimize personal data collection and retain only what is operationally necessary.',
      'Apply access controls, audit logging, and least privilege for enforcement data.',
      'Treat legal/compliance output as engineering guidance, not formal legal advice.',
      'Prefer deterministic local processing for sensitive imagery and identifiers.',
      'Ensure traceability of automated decisions and allow human review.',
    ],
  },
  coding_context: {
    name: 'solution-engineering-context',
    summary: 'Structured debugging and remediation planning for production systems.',
    key_points: [
      'Reproduce first, isolate root cause, then apply minimal targeted fix.',
      'Prioritize severity-based mitigation: security, data integrity, availability, UX.',
      'Add tests for regression prevention before shipping high-risk fixes.',
      'Prefer reversible rollout with feature flags when impact is uncertain.',
      'Document assumptions and unknowns in every remediation plan.',
    ],
  },
  runtime_service_topology: {
    name: 'runtime-service-topology',
    summary: 'Live operational topology and credential wiring for Bob, PTT, proxy, and inference services.',
    key_points: [
      'Bob chat path: Supabase edge function onspace-ai-chat -> Railway inference-service /chat.',
      'Inference provider target is Ollama-first (CHAT_PROVIDER=ollama, TABULAR_NLP_PROVIDER=ollama).',
      'PTT stack: frontend -> ptt-signaling-token edge function -> Railway ptt-server.',
      'Proxy stack: app services -> Railway NZSCV proxy via PROXY_SERVER_URL/NZSCV_PROXY_URL.',
      'Critical env wiring: INFERENCE_SERVICE_URL, INFERENCE_API_KEY, PTT_SERVER_URL, PTT_SERVER_SECRET.',
      'Credential checks should confirm INFERENCE_API_KEY_SET and SUPABASE_SERVICE_ROLE_KEY_SET on inference /health.',
      'When deploying via CI only, prefer GitHub Actions workflow triggers over local Railway CLI access.',
    ],
  },
  deployment_context: {
    name: 'railway-bun-deployment-context',
    summary: 'Railway uses Railpack with bun install --frozen-lockfile. bun.lock must be committed and in sync with package.json or builds fail.',
    key_points: [
      'Railpack (Railpack 0.23+) detects bun and runs: bun install --frozen-lockfile then bun run build.',
      'Error "lockfile had changes, but lockfile is frozen" means bun.lock is out of sync with package.json.',
      'Root cause: a dependency was added or changed in package.json but bun.lock was not regenerated.',
      'Fix: run "bun install" locally (without --frozen-lockfile) and commit the updated bun.lock.',
      'Railpack copies ALL subdirectory package.json files (inference-service, mobile-app, proxy-server, ptt-server) into the install layer.',
      'bun.lock is a JSON file with lockfileVersion:1; it records exact resolved versions for every package.',
      'When adding devDependencies (e.g. vitest, jsdom, @testing-library/*), always commit the regenerated bun.lock.',
      'Verify the fix locally with: bun install --frozen-lockfile (should output "no changes").',
      'PR #365 added vitest@4.1.2, jsdom@29.0.1, @testing-library/react@16.3.2, @testing-library/jest-dom@6.9.1 — bun.lock was regenerated to include these on 2026-04-05.',
    ],
  },
  testing_context: {
    name: 'vitest-unit-testing-context',
    summary: 'Vitest unit testing framework added in PR #365: 195 tests across 10 suites covering core utility modules.',
    key_points: [
      'Test runner: Vitest with jsdom environment; config in vitest.config.ts with @/* path alias.',
      'Test scripts: "test:unit" (bun run test:unit) and "test:unit:watch" for watch mode.',
      'Test files located in src/**/__tests__/*.test.ts pattern.',
      'Setup file: src/test/setup.ts imports @testing-library/jest-dom matchers.',
      'Coverage: timezone.ts, globalFiltersStore.ts, supabase client, auth utils, and other core lib modules.',
      'NZ timezone functions use fixed offsets (not DST-aware): nzDateToUTCStart +13:00, nzDateToUTCEnd +12:00.',
      'Run unit tests with: npx vitest run or bun run test:unit.',
      'E2E tests remain in Playwright (tests/e2e/) — vitest is for unit/integration only.',
    ],
  },
};

function classifyBugType(report) {
  const text = `${report.summary || ''}\n${report.stack_trace || ''}`.toLowerCase();
  if (text.includes('timeout') || text.includes('latency')) return 'performance';
  if (text.includes('permission') || text.includes('forbidden') || text.includes('unauthorized')) return 'auth';
  if (text.includes('frozen') || text.includes('lockfile') || text.includes('bun install') || text.includes('frozen-lockfile')) return 'deployment';
  if (text.includes('cannot') && text.includes('module')) return 'dependency';
  if (text.includes('null') || text.includes('undefined') || text.includes('typeerror')) return 'runtime';
  if (text.includes('cors')) return 'cors';
  if (text.includes('migration') || text.includes('schema') || text.includes('column')) return 'database';
  return 'general';
}

function severityWeight(severity) {
  const value = String(severity || 'medium').toLowerCase();
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'low') return 1;
  return 2;
}

function buildSelfHealingPlan(report, options = {}) {
  const bugType = classifyBugType(report);
  const sev = String(report.severity || 'medium').toLowerCase();
  const weight = severityWeight(sev);
  const inSelfContainedMode = Boolean(options.selfContainedMode);

  const reproduction = [
    'Capture request payload and endpoint path from logs.',
    'Replay with minimal input that still reproduces the issue.',
    'Confirm expected vs actual behavior with one deterministic test case.',
  ];

  const remediation = [
    'Patch the smallest code path that triggers the failure.',
    'Add a regression test tied to the reproduced case.',
    'Deploy behind a guarded rollout if severity is high or critical.',
  ];

  if (bugType === 'auth') {
    remediation.unshift('Validate auth token source and required claims before handler logic.');
  }
  if (bugType === 'database') {
    remediation.unshift('Verify migration state and table/column compatibility against runtime types.');
  }
  if (bugType === 'dependency') {
    remediation.unshift('Check runtime image includes required module/native library artifacts.');
  }
  if (bugType === 'deployment') {
    remediation.unshift(
      'Run "bun install" (without --frozen-lockfile) locally and commit the updated bun.lock.',
      'Check which package.json dependency was added or changed without regenerating bun.lock.',
      'Verify fix with: bun install --frozen-lockfile (should output "no changes").',
    );
  }
  if (inSelfContainedMode) {
    remediation.push('Verify no external network dependency is introduced by the fix.');
  }

  const safeguards = [
    'Enable structured logging for this failure signature.',
    'Add alerting threshold for recurrence in 15-minute windows.',
    'Store incident timeline and final patch reference for audit.',
  ];

  const automation = [
    {
      action: 'triage',
      enabled: true,
      detail: `Classified bug type: ${bugType}`,
    },
    {
      action: 'auto_patch',
      enabled: weight <= 2,
      detail: weight <= 2
        ? 'Low/medium severity can auto-open patch task.'
        : 'High severity requires human approval before patching.',
    },
    {
      action: 'auto_deploy',
      enabled: false,
      detail: 'Require human review before production rollout.',
    },
  ];

  return {
    summary: trimText(report.summary, 500),
    severity: sev,
    bug_type: bugType,
    recommended_owner: bugType === 'database' ? 'backend-data-team' : 'platform-engineering',
    reproduction,
    remediation,
    safeguards,
    automation,
    legal_note: 'Guidance is operational and technical only; obtain legal review for statutory interpretation.',
    context_used: Object.keys(KNOWLEDGE_PACKS),
  };
}

function getKnowledgePacks() {
  return KNOWLEDGE_PACKS;
}

function buildPatchTask(report, plan) {
  const summary = trimText(report?.summary || plan?.summary || 'Unspecified incident', 300);
  const severity = String(report?.severity || plan?.severity || 'medium').toLowerCase();
  const weight = severityWeight(severity);
  const bugType = plan?.bug_type || classifyBugType(report || {});

  const riskScore = Math.max(1, Math.min(10, weight * 2 + (bugType === 'security' ? 2 : 0)));
  const requiresApproval = riskScore >= 7;

  const tasks = [
    {
      id: 'reproduce',
      title: 'Reproduce issue with deterministic input',
      status: 'pending',
    },
    {
      id: 'fix',
      title: 'Apply minimal targeted code fix',
      status: 'pending',
    },
    {
      id: 'regression-test',
      title: 'Add regression test for incident signature',
      status: 'pending',
    },
    {
      id: 'deploy-check',
      title: 'Run deployment gate checks before release',
      status: 'pending',
    },
  ];

  return {
    version: 1,
    summary,
    severity,
    bug_type: bugType,
    risk_score: riskScore,
    requires_human_approval: requiresApproval,
    owner: plan?.recommended_owner || 'platform-engineering',
    tasks,
    safeguards: plan?.safeguards || [],
    notes: [
      'No automatic production deploy without human approval.',
      'Preserve audit trace of analysis, patch, and verification.',
    ],
  };
}

module.exports = {
  buildSelfHealingPlan,
  buildPatchTask,
  getKnowledgePacks,
};
