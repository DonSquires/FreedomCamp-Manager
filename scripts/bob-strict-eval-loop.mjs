#!/usr/bin/env node

import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const API_URL = String(process.env.VITE_INFERENCE_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.VITE_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim();

if (!API_URL || !API_KEY) {
  console.error('Missing API URL/key. Set VITE_INFERENCE_SERVICE_URL and VITE_INFERENCE_API_KEY (or INFERENCE_*).');
  process.exit(2);
}

const MAX_RETRIES = Number(process.argv[2] || 3);

const baseQuestion = [
  'Draft a high-fidelity User Management module that allows an Org Admin to invite users to their own organization only.',
  'Required output sections:',
  'A) src/modules/user-management scaffold',
  'B) useOrganization contract',
  'C) invite state machine idle/processing/synced/error with optimistic update',
  'D) UI spec with active-org indicator + breadcrumbs + 12-col grid + empty states',
  'E) Playwright acceptance tests proving no cross-tenant leakage',
  'F) Schema Evidence',
  'G) Tenant Isolation Proof',
  'H) Self-Eval Gates with 8 pass/fail items and remediation if fail',
  'Constraints: React+TypeScript only. No Vue/Vuex. No JS-only module files.',
].join('\n');

const gateNames = [
  'stack_fidelity',
  'org_scope_enforcement',
  'tenant_isolation_proof',
  'ui_hierarchy_color_semantics',
  'realtime_ptt_states',
  'module_blueprint_compliance',
  'accessibility_coverage',
  'low_spec_vps_performance',
];

function textIncludesAll(text, needles) {
  const lower = String(text || '').toLowerCase();
  return needles.every((n) => lower.includes(String(n).toLowerCase()));
}

function evaluate(text) {
  const lower = String(text || '').toLowerCase();

  const gates = {
    stack_fidelity:
      !lower.includes('vue') &&
      !lower.includes('vuex') &&
      textIncludesAll(lower, ['react', 'typescript', 'tailwind', 'tanstack', 'zustand', 'react-hook-form', 'zod']),

    org_scope_enforcement:
      textIncludesAll(lower, ['activeorgid', 'organizationid', 'active-org']) ||
      textIncludesAll(lower, ['active org', 'organization id']),

    tenant_isolation_proof:
      textIncludesAll(lower, ['tenant isolation proof']) &&
      textIncludesAll(lower, ['org a', 'org b']) &&
      textIncludesAll(lower, ['no cross-tenant', 'leak']),

    ui_hierarchy_color_semantics:
      textIncludesAll(lower, ['breadcrumbs', '12-col']) &&
      textIncludesAll(lower, ['blue', 'green', 'amber', 'red']),

    realtime_ptt_states:
      textIncludesAll(lower, ['idle', 'processing', 'synced', 'error']) &&
      textIncludesAll(lower, ['optimistic']),

    module_blueprint_compliance:
      textIncludesAll(lower, ['src/modules/user-management']) &&
      textIncludesAll(lower, ['components', 'services', 'hooks', 'types.ts']),

    accessibility_coverage:
      textIncludesAll(lower, ['keyboard']) &&
      (textIncludesAll(lower, ['focus']) || textIncludesAll(lower, ['accessibility'])),

    low_spec_vps_performance:
      textIncludesAll(lower, ['ubuntu vps']) ||
      textIncludesAll(lower, ['low-spec', 'vps']) ||
      textIncludesAll(lower, ['pagination', 'performance']),
  };

  const failed = Object.entries(gates).filter(([, pass]) => !pass).map(([name]) => name);
  return { gates, failed, passedAll: failed.length === 0 };
}

async function askBob(message) {
  const payload = { input: { message } };
  const res = await fetch(`${API_URL}/runsync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { message: raw, raw };
  }

  const msg = parsed?.output?.message || parsed?.output?.response || raw;
  return { message: String(msg), raw: parsed };
}

function buildPrompt(previous, failedGates, attempt) {
  if (!previous) {
    return [
      baseQuestion,
      '',
      'Output format must include explicit headings A through H exactly once.',
      `For section H include each gate name exactly: ${gateNames.join(', ')}`,
    ].join('\n');
  }

  const remediation = failedGates.map((g, i) => `${i + 1}. Fix gate ${g} with explicit, concrete repo-aligned details.`).join('\n');
  return [
    baseQuestion,
    '',
    `Revision attempt ${attempt}: your previous response failed these gates: ${failedGates.join(', ')}`,
    remediation,
    '',
    'Re-issue full answer A-H, with H showing pass/fail and remediation for each gate.',
  ].join('\n');
}

async function main() {
  let previous = '';
  let failed = [];
  const attempts = [];

  for (let i = 1; i <= MAX_RETRIES; i += 1) {
    const prompt = buildPrompt(previous, failed, i);
    const answer = await askBob(prompt);
    const evalResult = evaluate(answer.message);

    attempts.push({
      attempt: i,
      failed: evalResult.failed,
      passedAll: evalResult.passedAll,
      responsePreview: answer.message.slice(0, 600),
    });

    if (evalResult.passedAll) {
      console.log(JSON.stringify({ success: true, attempts, finalFailed: [] }, null, 2));
      return;
    }

    previous = answer.message;
    failed = evalResult.failed;
  }

  console.log(JSON.stringify({ success: false, attempts, finalFailed: failed }, null, 2));
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
