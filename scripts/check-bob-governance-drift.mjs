#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const MANUAL_PATH = 'docs/INSTRUCTION_MANUAL.md'
const FILES = {
  edge: 'src/lib/edgeFunctions.ts',
  catalog: 'src/lib/bobMutationCatalog.ts',
  brain: 'src/lib/bob-brain.ts',
  studio: 'src/pages/BobAssistantStudio.tsx',
  policyTest: 'src/lib/__tests__/edgeFunctionsPolicy.test.ts',
}

const MANUAL_RULES = [
  {
    id: 'manual-approval-contracts',
    description: 'Manual states execution-capable workflows require explicit approval/mutation contracts.',
    regex: /execution-capable workflows must use explicit mutation\/approval contracts/i,
  },
  {
    id: 'manual-emergency-block',
    description: 'Manual states emergency-priority mode blocks non-safety administrative writes.',
    regex: /emergency-priority mode, non-safety administrative writes are blocked/i,
  },
  {
    id: 'manual-tenant-audit',
    description: 'Manual states governed actions remain tenant-scoped and auditable.',
    regex: /governed actions must remain tenant-scoped and auditable/i,
  },
  {
    id: 'manual-data-grounding-artifacts',
    description: 'Manual states Bob claims require dataset inventory, labeling taxonomy, PM gate, and quality baseline artifacts.',
    regex: /dataset inventory: `docs\/BOB_DATASET_MANIFEST_2026-05-18\.md`[\s\S]*label taxonomy and review workflow: `docs\/BOB_DATA_LABELING_RUNBOOK_2026-05-18\.md`[\s\S]*PM-facing acceptance gate: `docs\/BOB_PM_READINESS_GATE_2026-05-18\.md`[\s\S]*quality baseline and freshness policy: `docs\/BOB_MODEL_QUALITY_BASELINE_2026-05-18\.md`/i,
  },
  {
    id: 'manual-unknown-states-visible',
    description: 'Manual states unknown, inconclusive, and manual-review outcomes must remain visible.',
    regex: /unknown`, `inconclusive`, and manual-review states are first-class outcomes/i,
  },
]

const CODE_RULES = [
  {
    id: 'code-gateway-mutation-access',
    file: FILES.edge,
    description: 'Gateway enforces mutation access checks.',
    regex: /assertBobMutationAccess\(/,
  },
  {
    id: 'code-gateway-emergency-block',
    file: FILES.edge,
    description: 'Gateway blocks mutation contracts in emergency gate path.',
    regex: /executionReview\.emergencyGate\?\.blocked/,
  },
  {
    id: 'code-gateway-policy-payload',
    file: FILES.edge,
    description: 'Gateway emits decision reason codes and confidence payload.',
    regex: /decisionReasonCodes:\s*executionReview\.decisionReasonCodes[\s\S]*confidence:\s*executionReview\.confidence/,
  },
  {
    id: 'code-catalog-reason-class',
    file: FILES.catalog,
    description: 'Catalog contains reason codes and governance classes.',
    regex: /reasonCode:[\s\S]*governanceClass:/,
  },
  {
    id: 'code-brain-contract-check',
    file: FILES.brain,
    description: 'Direct actuation enforces explicit provisioning contract.',
    regex: /assertBobMutationAccess\('create_client_site_shift_bundle'/,
  },
  {
    id: 'code-brain-mode-param',
    file: FILES.brain,
    description: 'Direct actuation requires execution mode input.',
    regex: /executionMode:\s*BobExecutionMode/,
  },
  {
    id: 'code-studio-mode-pass-through',
    file: FILES.studio,
    description: 'Bob Studio forwards effective policy mode into actuation path.',
    regex: /executionMode:\s*effectivePolicy\.mode/,
  },
  {
    id: 'code-policy-regression-test',
    file: FILES.policyTest,
    description: 'Policy regression tests cover emergency gate semantics.',
    regex: /edgeFunctions emergency gate policy/,
  },
]

async function readText(relativePath) {
  return fs.readFile(path.resolve(ROOT, relativePath), 'utf8')
}

function evaluateRule(text, rule) {
  return rule.regex.test(text)
}

async function main() {
  const strict = String(process.env.BOB_GOVERNANCE_DRIFT_STRICT || '').toLowerCase() === 'true'
  const failures = []

  const manual = await readText(MANUAL_PATH)
  for (const rule of MANUAL_RULES) {
    if (!evaluateRule(manual, rule)) {
      failures.push({ scope: 'manual', ...rule, file: MANUAL_PATH })
    }
  }

  const cache = new Map()
  for (const rule of CODE_RULES) {
    if (!cache.has(rule.file)) {
      cache.set(rule.file, await readText(rule.file))
    }

    const text = cache.get(rule.file)
    if (!evaluateRule(text, rule)) {
      failures.push({ scope: 'code', ...rule })
    }
  }

  if (failures.length === 0) {
    console.log('[bob-governance-drift] PASS: manual and runtime governance anchors are aligned.')
    return
  }

  console.log('[bob-governance-drift] WARN: potential Bob governance docs/runtime drift detected:')
  for (const failure of failures) {
    console.log(`- (${failure.scope}) ${failure.id}: ${failure.description} [${failure.file}]`)
  }

  if (strict) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[bob-governance-drift] ${error.message}`)
  process.exit(1)
})
