#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const outputPath = path.join(workspaceRoot, 'runpod-worker', 'training_memory.json');

const sourceFiles = {
  autonomousLearning: 'docs/BOB_AUTONOMOUS_LEARNING.md',
  advancedArchitect: 'docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md',
  intelState: 'inference-service/data/intel-state.json',
  lessonsLearned: 'docs/LESSONS_LEARNED.md',
  decisions: 'docs/DECISIONS.md',
  failureSummary: 'data/bob-failure-summary.json',
  failureSummaryDoc: 'docs/BOB_FAILURE_SUMMARY.md',
};

function absolute(relativePath) {
  return path.join(workspaceRoot, relativePath);
}

async function readText(relativePath) {
  return fs.readFile(absolute(relativePath), 'utf8');
}

async function readJson(relativePath) {
  const raw = await readText(relativePath);
  return JSON.parse(raw);
}

function normalizedLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractBulletsUnderHeading(markdown, heading) {
  const lines = String(markdown || '').split(/\r?\n/);
  const target = heading.trim().toLowerCase();
  const results = [];
  let active = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,6}\s+/.test(line)) {
      const current = line.replace(/^#{1,6}\s+/, '').trim().toLowerCase();
      active = current === target;
      continue;
    }

    if (!active) continue;
    if (/^[-*]\s+/.test(line)) results.push(line.replace(/^[-*]\s+/, '').trim());
    if (/^\d+\.\s+/.test(line)) results.push(line.replace(/^\d+\.\s+/, '').trim());
  }

  return results;
}

async function latestDrBobReviews(limit = 6) {
  const reviewDir = absolute('data/dr-bob-reviews');
  let entries = [];
  try {
    entries = await fs.readdir(reviewDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const fullPath = path.join(reviewDir, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      name: entry.name,
      relativePath: path.posix.join('data/dr-bob-reviews', entry.name),
      fullPath,
      mtimeMs: stat.mtimeMs,
    });
  }

  files.sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = [];
  for (const file of files.slice(0, limit)) {
    try {
      const parsed = JSON.parse(await fs.readFile(file.fullPath, 'utf8'));
      latest.push({
        relativePath: file.relativePath,
        decision: String(parsed.decision || '').trim() || 'unknown',
        summary: String(parsed.summary || '').trim(),
        findings: Array.isArray(parsed.findings)
          ? parsed.findings.slice(0, 3).map((finding) => ({
              severity: String(finding.severity || '').trim() || 'unknown',
              title: String(finding.title || '').trim(),
              requiredAction: String(finding.requiredAction || '').trim(),
            }))
          : [],
      });
    } catch {
      // Ignore malformed review artifacts.
    }
  }

  return latest;
}

function latestBlockerFacts(reviews) {
  const facts = [];
  for (const review of reviews) {
    for (const finding of review.findings || []) {
      if (String(finding.severity).toLowerCase() !== 'blocker') continue;
      const text = [finding.title, finding.requiredAction].filter(Boolean).join(' — ');
      if (text) facts.push(text);
    }
  }
  return Array.from(new Set(facts)).slice(0, 6);
}

function extractRecentTraining(autonomousLearningDoc) {
  const items = extractBulletsUnderHeading(autonomousLearningDoc, 'Automated Workflow')
    .concat(extractBulletsUnderHeading(autonomousLearningDoc, 'Autonomous Learning Prompt'));
  return Array.from(new Set(items)).slice(0, 6);
}

function extractArchitectRules(advancedArchitectDoc) {
  const items = extractBulletsUnderHeading(advancedArchitectDoc, 'Summary Checklist');
  if (items.length > 0) return items.slice(0, 6);

  return normalizedLines(advancedArchitectDoc)
    .filter((line) => /spec|self-test|state check|feedback loop/i.test(line))
    .slice(0, 6);
}

function buildReviewSections(intelState) {
  const bulletins = Array.isArray(intelState.bulletins) ? intelState.bulletins : [];
  const findBySection = (section) => bulletins.find((item) => item?.metadata?.section === section);

  const reviewOrderSummary = String(findBySection('gold-answer-outline')?.summary || '');
  const acceptanceSummary = String(findBySection('execution-loop-and-acceptance-gate')?.summary || '');
  const baselineSummary = String(findBySection('baseline-and-objective')?.summary || '');
  const policySummary = String(findBySection('ground-rules')?.summary || '');

  return {
    reviewOrder: [
      'critical blockers',
      'performance risks',
      'reliability risks',
      'privacy checks',
      '14-day remediation plan',
    ],
    acceptanceGate: [
      'zero lint errors before release',
      'successful builds',
      'chunk strategy for large routes',
      'review scores of at least 9 across 3 consecutive runs',
      'no outbound dependency in the training loop',
    ],
    evidenceSources: [
      'build logs',
      'lint logs',
      'repository code context',
      'system_state.json',
      'stored training intel',
    ],
    failurePatterns: [
      'generic QA checklists instead of repo-specific acceptance gates',
      'hallucinated modules or architecture',
      'cloud-dependent advice for self-contained review work',
      'missing tenant isolation or org-scoping concerns when architecture is involved',
    ],
    summaries: [policySummary, baselineSummary, reviewOrderSummary, acceptanceSummary].filter(Boolean),
  };
}

async function main() {
  const [
    autonomousLearningDoc,
    advancedArchitectDoc,
    intelState,
    failureSummary,
    reviews,
  ] = await Promise.all([
    readText(sourceFiles.autonomousLearning),
    readText(sourceFiles.advancedArchitect),
    readJson(sourceFiles.intelState),
    readJson(sourceFiles.failureSummary),
    latestDrBobReviews(),
  ]);

  const buildReview = buildReviewSections(intelState);
  const trainingMemory = {
    version: new Date().toISOString(),
    generated_from: [
      sourceFiles.autonomousLearning,
      sourceFiles.advancedArchitect,
      sourceFiles.intelState,
      sourceFiles.failureSummary,
      sourceFiles.failureSummaryDoc,
      ...reviews.map((review) => review.relativePath),
    ],
    bob: {
      identity: 'Bob is the internal AI assistant for FieldOps Manager. Stay repo-grounded, concise, and actionable. Prefer exact repo-specific rules over generic QA advice.',
      rules: [
        'Check system_state.json before making architecture assumptions.',
        'Do not invent modules, routes, tables, services, migrations, or package-manager choices.',
        'Use internal evidence only for build-review and self-contained training tasks: build logs, lint logs, repository code context, and stored intel.',
        'When asked about build review or go-live gates, answer with the exact acceptance gate from training memory rather than generic best practice.',
        'When asked a question or triage request, synthesize research, repo evidence, system_state, logs, and protocol checks into one concrete answer or action plan.',
        'When a failure is reproduced, teach the loop explicitly: Repro, RootCause, Fix, Test, Result, NextCheck.',
      ],
      recent_training: extractRecentTraining(autonomousLearningDoc),
      architect_rules: extractArchitectRules(advancedArchitectDoc),
      synthesis_workflow: [
        'define the concrete question or failure mode',
        'gather local repo and system facts',
        'review relevant docs and research',
        'apply the 5-question protocol when behavior is failing',
        'write a minimal reproduction path and a minimal repair plan',
        'run the narrowest executable validation for the patch',
        'reconcile contradictions before concluding',
        'finish with the smallest safe next action',
      ],
    },
    dr_bob: {
      identity: 'Dr Bob is the blocking reviewer before implementation begins. Challenge ungrounded assumptions and regressions before approval.',
      rules: [
        'Block plans that reference modules not grounded in system_state.json or repo files.',
        'Block invented data models, routes, services, or migrations.',
        'Require explicit validation steps and executable checks before completion claims.',
        'Prefer concrete blocker findings with evidence and required actions over generic project-management risks.',
        'When judging a triage or repair plan, require evidence from the repo, system_state, and the 5-question protocol before approval.',
      ],
      recent_reviews: reviews,
      recent_blocker_facts: latestBlockerFacts(reviews),
    },
    build_review: {
      review_order: buildReview.reviewOrder,
      acceptance_gate: buildReview.acceptanceGate,
      evidence_sources: buildReview.evidenceSources,
      failure_patterns: buildReview.failurePatterns,
      summaries: buildReview.summaries,
      live_recommendations: Array.isArray(failureSummary.recommendations) ? failureSummary.recommendations.slice(0, 5) : [],
      top_flagged_artifacts: Array.isArray(failureSummary.topFlaggedArtifacts)
        ? failureSummary.topFlaggedArtifacts.slice(0, 5).map((item) => item.name)
        : [],
    },
    review_protocol: {
      required_checks: [
        'read system_state.json first',
        'cite grounded repo evidence',
        'use approve, needs-revision, or block decisions with concrete findings',
        'require validation steps after implementation',
      ],
      blockers: latestBlockerFacts(reviews),
    },
  };

  await fs.writeFile(outputPath, `${JSON.stringify(trainingMemory, null, 2)}\n`, 'utf8');
  console.log(`RunPod training memory updated: ${path.relative(workspaceRoot, outputPath)}`);
  console.log(`Sources: ${trainingMemory.generated_from.length}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});