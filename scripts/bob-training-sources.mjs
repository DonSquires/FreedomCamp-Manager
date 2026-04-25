#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import path from 'node:path';

export const TRAINING_DOC_SOURCES = [
  'docs/DECISIONS.md',
  'docs/LESSONS_LEARNED.md',
  'docs/BUILD_PLAN.md',
  'docs/BUILD_PLAN_V3.md',
  'docs/BOB_CONFIGURATION.md',
  'docs/BOB_SYSTEM_REVIEW.md',
  'docs/BOB_READINESS_SCORECARD.md',
  'docs/BOB_TRAINING_INGESTION_GUIDE.md',
  'docs/BOB_TRAINING_SELF_EVAL_LOOP.md',
  'docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md',
  'docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md',
  'docs/BOB_FAILURE_SUMMARY.md',
  'docs/BOB_AUTONOMOUS_LEARNING.md',
  'docs/BOB_FIELD_INTELLIGENCE.md',
  'docs/BOB_TRAINING_TRUTH_PROTOCOL.md',
  'docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md',
  'spec.md',
  'plan.md',
];

export const CONTEXT_SOURCES = [
  'docs/architecture-drivers',
  'docs/architecture',
  'docs/adr',
  'docs/rules',
  'docs/templates/clients',
  'src/pages',
  'src/components',
  'src/hooks',
  'src/stores',
  'supabase/functions',
  'scripts',
  'data/client-geofence-registry.json',
  'data/roster-active-shifts.json',
  'src/modules',
  'package.json',
  'system_state.json',
  '.github/copilot-instructions.md',
];

export function listDynamicBobTrainingDocs(workspaceRoot) {
  try {
    const docsDir = path.join(workspaceRoot, 'docs');
    return readdirSync(docsDir)
      .filter((name) => /^BOB_.*\.md$/i.test(name))
      .map((name) => path.posix.join('docs', name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export function buildCanonicalTrainingSources(workspaceRoot, { includeContext = false } = {}) {
  const combined = [
    ...TRAINING_DOC_SOURCES,
    ...listDynamicBobTrainingDocs(workspaceRoot),
    ...(includeContext ? CONTEXT_SOURCES : []),
  ];
  return [...new Set(combined)];
}
