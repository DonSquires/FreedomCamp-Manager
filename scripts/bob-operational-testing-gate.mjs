#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scoreLogPath = path.join(repoRoot, 'data', 'bob-response-scores.jsonl');

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const args = {
    hours: 24,
    artifacts: ['spec.md'],
    functionalCmd: 'bun run -s test:bob:governance',
    outputRoot: 'tools/bob-operational-testing',
    maxLowScoreCount: 0,
    maxRepeatedHallucinations: 0,
    maxChannelBiasGap: 4,
    minChannelSamples: 2,
    maxFallbackRate: 0.5,
    failOnRedTeamRevision: true,
    ragasCmd: '. .venv-ragas/bin/activate && python scripts/run_ragas_eval.py',
    trulensCmd: '. .venv-trulens/bin/activate && python scripts/run_trulens_eval.py',
    skipRag: false,
    skipRedTeam: false,
    skipFunctional: false,
    skipBias: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    const next = String(argv[i + 1] || '');

    if (token === '--help') args.help = true;
    else if (token === '--hours' && next) args.hours = Number.parseInt(next, 10) || args.hours;
    else if (token.startsWith('--hours=')) args.hours = Number.parseInt(token.slice('--hours='.length), 10) || args.hours;
    else if (token === '--artifacts' && next) args.artifacts = next.split(',').map((x) => x.trim()).filter(Boolean);
    else if (token.startsWith('--artifacts=')) args.artifacts = token.slice('--artifacts='.length).split(',').map((x) => x.trim()).filter(Boolean);
    else if (token === '--functional-cmd' && next) args.functionalCmd = next;
    else if (token.startsWith('--functional-cmd=')) args.functionalCmd = token.slice('--functional-cmd='.length);
    else if (token === '--output-root' && next) args.outputRoot = next;
    else if (token.startsWith('--output-root=')) args.outputRoot = token.slice('--output-root='.length);
    else if (token === '--max-low-score-count' && next) args.maxLowScoreCount = Number.parseInt(next, 10) || args.maxLowScoreCount;
    else if (token.startsWith('--max-low-score-count=')) args.maxLowScoreCount = Number.parseInt(token.slice('--max-low-score-count='.length), 10) || args.maxLowScoreCount;
    else if (token === '--max-repeated-hallucinations' && next) args.maxRepeatedHallucinations = Number.parseInt(next, 10) || args.maxRepeatedHallucinations;
    else if (token.startsWith('--max-repeated-hallucinations=')) args.maxRepeatedHallucinations = Number.parseInt(token.slice('--max-repeated-hallucinations='.length), 10) || args.maxRepeatedHallucinations;
    else if (token === '--max-channel-bias-gap' && next) args.maxChannelBiasGap = Number.parseFloat(next) || args.maxChannelBiasGap;
    else if (token.startsWith('--max-channel-bias-gap=')) args.maxChannelBiasGap = Number.parseFloat(token.slice('--max-channel-bias-gap='.length)) || args.maxChannelBiasGap;
    else if (token === '--min-channel-samples' && next) args.minChannelSamples = Number.parseInt(next, 10) || args.minChannelSamples;
    else if (token.startsWith('--min-channel-samples=')) args.minChannelSamples = Number.parseInt(token.slice('--min-channel-samples='.length), 10) || args.minChannelSamples;
    else if (token === '--max-fallback-rate' && next) args.maxFallbackRate = Number.parseFloat(next) || args.maxFallbackRate;
    else if (token.startsWith('--max-fallback-rate=')) args.maxFallbackRate = Number.parseFloat(token.slice('--max-fallback-rate='.length)) || args.maxFallbackRate;
    else if (token === '--fail-on-red-team-revision' && next) args.failOnRedTeamRevision = !['0', 'false', 'no'].includes(next.toLowerCase());
    else if (token.startsWith('--fail-on-red-team-revision=')) args.failOnRedTeamRevision = !['0', 'false', 'no'].includes(token.slice('--fail-on-red-team-revision='.length).toLowerCase());
    else if (token === '--ragas-cmd' && next) args.ragasCmd = next;
    else if (token.startsWith('--ragas-cmd=')) args.ragasCmd = token.slice('--ragas-cmd='.length);
    else if (token === '--trulens-cmd' && next) args.trulensCmd = next;
    else if (token.startsWith('--trulens-cmd=')) args.trulensCmd = token.slice('--trulens-cmd='.length);
    else if (token === '--skip-rag') args.skipRag = true;
    else if (token === '--skip-red-team') args.skipRedTeam = true;
    else if (token === '--skip-functional') args.skipFunctional = true;
    else if (token === '--skip-bias') args.skipBias = true;
  }

  if (!args.artifacts.length) args.artifacts = ['spec.md'];
  return args;
}

function printHelp() {
  console.log(
    [
      'Bob Operational Testing Gate',
      '',
      'Usage:',
      '  node scripts/bob-operational-testing-gate.mjs [options]',
      '',
      'Key options:',
      '  --hours <n>                             Window for log-driven checks (default: 24)',
      '  --artifacts spec.md,plan.md             Files for Dr Bob red-team review',
      '  --functional-cmd "bun run -s test:bob:governance"',
      '  --ragas-cmd "python scripts/run_ragas_eval.py"',
      '  --trulens-cmd "python scripts/run_trulens_eval.py"',
      '  --max-low-score-count <n>               RAG quality threshold (default: 0)',
      '  --max-repeated-hallucinations <n>       Repeated hallucination threshold (default: 0)',
      '  --max-channel-bias-gap <n>              Max channel avg-score gap (default: 4)',
      '  --max-fallback-rate <n>                 Max fallback ratio (default: 0.5)',
      '  --skip-rag --skip-red-team --skip-functional --skip-bias',
    ].join('\n')
  );
}

function extractJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function runCommand(command, options = {}) {
  const cwd = options.cwd || repoRoot;

  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        command,
      });
    });

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${String(error?.message || error)}`,
        command,
      });
    });
  });
}

async function resolveFunctionalCommand(command) {
  const normalized = String(command || '').trim();
  if (!normalized.startsWith('bun ')) return normalized;

  const bunCheck = await runCommand('command -v bun');
  if (bunCheck.exitCode === 0) return normalized;

  const fallback = normalized.replace(/^bun\s+run\s+-s\s+/, 'npm run -s ').replace(/^bun\s+run\s+/, 'npm run ');
  return fallback;
}

async function readScoreEntries(hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  try {
    const raw = await fs.readFile(scoreLogPath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => {
        const stamp = Date.parse(entry.timestamp || '');
        return Number.isFinite(stamp) && stamp >= cutoff;
      });
  } catch {
    return [];
  }
}

function computeBiasMetrics(entries, minChannelSamples) {
  const byChannel = new Map();
  let fallbackCount = 0;

  for (const entry of entries) {
    const channel = String(entry.channel || 'unknown');
    const score = Number(entry.score ?? 0);
    if (!byChannel.has(channel)) {
      byChannel.set(channel, { channel, count: 0, totalScore: 0, avgScore: 0, lowScoreCount: 0 });
    }
    const bucket = byChannel.get(channel);
    bucket.count += 1;
    bucket.totalScore += score;
    if (score <= 3) bucket.lowScoreCount += 1;

    if (entry?.metadata?.fallback === true) fallbackCount += 1;
  }

  const channelStats = [...byChannel.values()].map((item) => ({
    ...item,
    avgScore: item.count > 0 ? Number((item.totalScore / item.count).toFixed(2)) : 0,
    lowScoreRate: item.count > 0 ? Number((item.lowScoreCount / item.count).toFixed(3)) : 0,
  }));

  const comparable = channelStats.filter((item) => item.count >= minChannelSamples);
  const averages = comparable.map((item) => item.avgScore);
  const channelBiasGap = averages.length >= 2 ? Number((Math.max(...averages) - Math.min(...averages)).toFixed(2)) : 0;
  const fallbackRate = entries.length > 0 ? Number((fallbackCount / entries.length).toFixed(3)) : 0;

  return {
    entriesCount: entries.length,
    channelStats,
    comparableChannels: comparable.map((item) => item.channel),
    channelBiasGap,
    fallbackRate,
  };
}

function toMarkdown(scorecard) {
  const lines = [
    '# Bob Operational Testing Scorecard',
    '',
    `- Run ID: ${scorecard.runId}`,
    `- Started: ${scorecard.startedAt}`,
    `- Ended: ${scorecard.endedAt}`,
    `- Final decision: ${scorecard.finalDecision.toUpperCase()}`,
    '',
    '## Stage Results',
    '',
    `- RAG Evaluation: ${scorecard.stages.rag.status.toUpperCase()} (${scorecard.stages.rag.detail})`,
    `- Red Teaming: ${scorecard.stages.redTeam.status.toUpperCase()} (${scorecard.stages.redTeam.detail})`,
    `- Functional and Bias: ${scorecard.stages.functionalBias.status.toUpperCase()} (${scorecard.stages.functionalBias.detail})`,
    '',
    '## Thresholds',
    '',
    `- maxLowScoreCount: ${scorecard.config.maxLowScoreCount}`,
    `- maxRepeatedHallucinations: ${scorecard.config.maxRepeatedHallucinations}`,
    `- maxChannelBiasGap: ${scorecard.config.maxChannelBiasGap}`,
    `- maxFallbackRate: ${scorecard.config.maxFallbackRate}`,
    '',
    '## Notes',
    '',
    ...scorecard.notes.map((item) => `- ${item}`),
    '',
  ];

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const runId = nowStamp();
  const outDir = path.resolve(repoRoot, args.outputRoot, runId);
  const scorecardPath = path.join(outDir, 'scorecard.json');
  const reportPath = path.join(outDir, 'scorecard.md');
  await fs.mkdir(outDir, { recursive: true });

  const scorecard = {
    runId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    config: {
      hours: args.hours,
      artifacts: args.artifacts,
      functionalCmd: args.functionalCmd,
      ragasCmd: args.ragasCmd,
      trulensCmd: args.trulensCmd,
      maxLowScoreCount: args.maxLowScoreCount,
      maxRepeatedHallucinations: args.maxRepeatedHallucinations,
      maxChannelBiasGap: args.maxChannelBiasGap,
      minChannelSamples: args.minChannelSamples,
      maxFallbackRate: args.maxFallbackRate,
      failOnRedTeamRevision: args.failOnRedTeamRevision,
    },
    stages: {
      rag: {
        status: 'skipped',
        detail: 'not executed',
        summarizeFailures: null,
        external: [],
      },
      redTeam: {
        status: 'skipped',
        detail: 'not executed',
        artifacts: [],
      },
      functionalBias: {
        status: 'skipped',
        detail: 'not executed',
        functional: null,
        bias: null,
      },
    },
    finalDecision: 'fail',
    notes: [],
    artifacts: {
      scorecardPath,
      reportPath,
    },
  };

  if (!args.skipRag) {
    const summarize = await runCommand(`node scripts/summarize-failures.mjs --hours ${args.hours}`);
    const summaryJson = extractJsonObject(summarize.stdout);

    const lowScoreCount = Number(summaryJson?.lowScoreCount ?? Number.MAX_SAFE_INTEGER);
    const repeatedHallucinations = Array.isArray(summaryJson?.repeatedHallucinations) ? summaryJson.repeatedHallucinations.length : Number.MAX_SAFE_INTEGER;

    let ragPass = summarize.exitCode === 0;
    ragPass = ragPass && lowScoreCount <= args.maxLowScoreCount;
    ragPass = ragPass && repeatedHallucinations <= args.maxRepeatedHallucinations;

    const externalResults = [];
    const externalCommands = [
      { tool: 'ragas', cmd: args.ragasCmd },
      { tool: 'trulens', cmd: args.trulensCmd },
    ].filter((item) => String(item.cmd || '').trim().length > 0);

    for (const ext of externalCommands) {
      const result = await runCommand(ext.cmd);
      const passed = result.exitCode === 0;
      if (!passed) ragPass = false;
      externalResults.push({
        tool: ext.tool,
        command: ext.cmd,
        exitCode: result.exitCode,
        status: passed ? 'pass' : 'fail',
      });
    }

    scorecard.stages.rag = {
      status: ragPass ? 'pass' : 'fail',
      detail: ragPass
        ? `lowScoreCount=${lowScoreCount}, repeatedHallucinations=${repeatedHallucinations}`
        : `threshold breach or command failure: lowScoreCount=${lowScoreCount}, repeatedHallucinations=${repeatedHallucinations}`,
      summarizeFailures: {
        exitCode: summarize.exitCode,
        lowScoreCount,
        repeatedHallucinations,
        rawSummary: summaryJson,
      },
      external: externalResults,
    };

    if (externalResults.length === 0) {
      scorecard.notes.push('No external RAG evaluator command configured; using internal hallucination and low-score metrics.');
    }
  }

  if (!args.skipRedTeam) {
    let redTeamPass = true;
    const results = [];

    for (const artifact of args.artifacts) {
      const artifactPath = path.resolve(repoRoot, artifact);
      let exists = true;
      try {
        await fs.access(artifactPath);
      } catch {
        exists = false;
      }

      if (!exists) {
        redTeamPass = false;
        results.push({ artifact, status: 'fail', reason: 'missing artifact file', decision: 'missing' });
        continue;
      }

      const review = await runCommand(`node scripts/dr-bob-review.mjs --file ${artifact}`);
      const decisionMatch = review.stdout.match(/Decision:\s*([^\n\r]+)/i);
      const reviewArtifactMatch = review.stdout.match(/Review artifact:\s*([^\n\r]+)/i);
      const decision = String(decisionMatch?.[1] || '').trim().toLowerCase();
      const reviewArtifact = String(reviewArtifactMatch?.[1] || '').trim();

      let passed = review.exitCode === 0;
      if (args.failOnRedTeamRevision) {
        passed = passed && decision === 'approve';
      } else {
        passed = passed && !['block', 'blocked'].includes(decision);
      }

      if (!passed) redTeamPass = false;

      results.push({
        artifact,
        status: passed ? 'pass' : 'fail',
        exitCode: review.exitCode,
        decision: decision || 'unknown',
        reviewArtifact: reviewArtifact || null,
      });
    }

    scorecard.stages.redTeam = {
      status: redTeamPass ? 'pass' : 'fail',
      detail: redTeamPass ? 'all artifact reviews passed' : 'at least one artifact failed red-team review',
      artifacts: results,
    };
  }

  if (!args.skipFunctional || !args.skipBias) {
    let functionalPass = true;
    let functionalResult = null;

    if (!args.skipFunctional) {
      const functionalCmd = await resolveFunctionalCommand(args.functionalCmd);
      functionalResult = await runCommand(functionalCmd);
      functionalPass = functionalResult.exitCode === 0;
      args.functionalCmd = functionalCmd;
    }

    let biasResult = null;
    let biasPass = true;
    if (!args.skipBias) {
      const entries = await readScoreEntries(args.hours);
      const metrics = computeBiasMetrics(entries, args.minChannelSamples);
      biasPass = metrics.channelBiasGap <= args.maxChannelBiasGap && metrics.fallbackRate <= args.maxFallbackRate;
      biasResult = {
        status: biasPass ? 'pass' : 'fail',
        entriesCount: metrics.entriesCount,
        comparableChannels: metrics.comparableChannels,
        channelBiasGap: metrics.channelBiasGap,
        fallbackRate: metrics.fallbackRate,
        channelStats: metrics.channelStats,
      };
    }

    const stagePass = functionalPass && biasPass;

    scorecard.stages.functionalBias = {
      status: stagePass ? 'pass' : 'fail',
      detail: stagePass
        ? 'functional command and bias checks passed'
        : 'functional command failed or bias thresholds breached',
      functional: functionalResult
        ? {
            command: args.functionalCmd,
            exitCode: functionalResult.exitCode,
            status: functionalPass ? 'pass' : 'fail',
          }
        : { status: 'skipped' },
      bias: biasResult || { status: 'skipped' },
    };
  }

  const statuses = [
    scorecard.stages.rag.status,
    scorecard.stages.redTeam.status,
    scorecard.stages.functionalBias.status,
  ].filter((status) => status !== 'skipped');

  scorecard.finalDecision = statuses.every((status) => status === 'pass') ? 'pass' : 'fail';
  scorecard.endedAt = new Date().toISOString();

  await fs.writeFile(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
  await fs.writeFile(reportPath, `${toMarkdown(scorecard)}\n`, 'utf8');

  console.log(`\nOperational testing scorecard: ${scorecardPath}`);
  console.log(`Operational testing report: ${reportPath}`);
  console.log(`Final decision: ${scorecard.finalDecision.toUpperCase()}`);

  process.exit(scorecard.finalDecision === 'pass' ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
