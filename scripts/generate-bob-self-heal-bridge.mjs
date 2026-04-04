import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);

const inputPath = path.resolve(repoRoot, args[0] || 'tools/bob-build-review-evidence.json');
const outputPath = path.resolve(repoRoot, args[1] || 'tools/bob-self-heal-bridge.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function topIssues(issues, maxCount = 8) {
  return (issues || []).slice(0, maxCount).map((issue) => {
    const rel = path.relative(repoRoot, issue.file || 'unknown');
    return `${rel}:${issue.line ?? 0} ${issue.severity} ${issue.rule}`;
  });
}

function buildSummary(evidence) {
  const errorCount = evidence?.lint?.totalErrors ?? 0;
  const warningCount = evidence?.lint?.totalWarnings ?? 0;
  const largestChunk = evidence?.build?.largeChunks?.[0];
  const chunkText = largestChunk
    ? `${largestChunk.file} ${largestChunk.sizeKb}kB`
    : 'no large chunk data';

  return `Build review: ${errorCount} lint errors, ${warningCount} warnings, largest bundle hotspot ${chunkText}.`;
}

function inferSeverity(evidence) {
  const errors = evidence?.lint?.totalErrors ?? 0;
  const warningCount = evidence?.lint?.totalWarnings ?? 0;
  const largestChunk = evidence?.build?.largeChunks?.[0]?.sizeKb ?? 0;

  if (errors > 0 || largestChunk > 1000) return 'high';
  if (warningCount > 0 || largestChunk > 600) return 'medium';
  return 'low';
}

function buildReport(evidence) {
  const issues = topIssues(evidence?.lint?.fileIssues, 10);
  const largeChunks = (evidence?.build?.largeChunks || []).slice(0, 6).map((chunk) => `${chunk.file} ${chunk.sizeKb}kB`);
  const hasChunkWarning = Boolean(evidence?.build?.hasChunkWarning);

  return {
    summary: buildSummary(evidence),
    severity: inferSeverity(evidence),
    stack_trace: '',
    expected_behavior: 'Build succeeds, lint is clean, and Bob can review the state using internal evidence only.',
    actual_behavior: `Build success=${Boolean(evidence?.build?.succeeded)}; lint errors=${evidence?.lint?.totalErrors ?? 0}; lint warnings=${evidence?.lint?.totalWarnings ?? 0}; chunk warning=${hasChunkWarning}.`,
    reproduction_steps: [
      'Run bun run review:evidence to refresh build and lint evidence.',
      'Inspect generated Bob evidence JSON and identify top lint/build issues.',
      'Feed the summary into Bob collaboration or self-heal planner for remediation guidance.',
    ],
    environment: 'local-self-contained',
    evidence: {
      lint_issues: issues,
      large_chunks: largeChunks,
      privacy_mode: evidence?.privacyMode || 'self-contained',
    },
  };
}

function buildCollaborationPacket(report, evidence) {
  const promptLines = [
    'You are Bob operating in self-contained internal mode.',
    'Review this engineering incident and propose a safe remediation path.',
    `Summary: ${report.summary}`,
    `Severity: ${report.severity}`,
    `Actual behavior: ${report.actual_behavior}`,
    `Top lint issues: ${(report.evidence.lint_issues || []).join('; ') || 'none'}`,
    `Top chunk hotspots: ${(report.evidence.large_chunks || []).join('; ') || 'none'}`,
    'Return sections: blockers, root cause hypotheses, minimal fixes, regression checks, privacy-safe rollout notes.',
  ];

  return {
    source: 'copilot',
    title: 'Copilot Self-Heal Review Request',
    summary: report.summary,
    autoSubmit: false,
    returnRoute: '/bob-assistant',
    prompt: promptLines.join(' '),
    metadata: {
      workflow: 'bob-copilot-self-heal-bridge',
      privacyMode: evidence?.privacyMode || 'self-contained',
      generatedAt: new Date().toISOString(),
    },
  };
}

const evidence = readJson(inputPath);
const report = buildReport(evidence);

const bridge = {
  generatedAt: new Date().toISOString(),
  inputPath: path.relative(repoRoot, inputPath),
  privacyMode: evidence?.privacyMode || 'self-contained',
  report,
  selfHealRequest: {
    report,
  },
  collaborationPacketDraft: buildCollaborationPacket(report, evidence),
  notes: [
    'This artifact is internal-only and safe for self-contained Bob review workflows.',
    'Use with /self-heal/bug-report, /self-heal/patch-task, or the in-app Bob collaboration queue.',
    'No external/cloud inference is required or assumed.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(bridge, null, 2));

console.log(`Wrote Bob self-heal bridge to ${path.relative(repoRoot, outputPath)}`);