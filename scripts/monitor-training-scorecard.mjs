#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

const SCORE_LOG_PATH = path.join(workspaceRoot, 'data', 'bob-response-scores.jsonl');
const DEFAULT_OUT_PATH = path.join(workspaceRoot, 'data', 'bob-training-live-scorecard.json');
const DEFAULT_HISTORY_PATH = path.join(workspaceRoot, 'data', 'bob-training-live-scorecard-history.jsonl');
const DEFAULT_ESCALATION_LATEST_PATH = path.join(workspaceRoot, 'data', 'bob-training-escalation-latest.json');
const DEFAULT_ESCALATION_QUEUE_PATH = path.join(workspaceRoot, 'data', 'bob-training-escalation-queue.jsonl');
const DEFAULT_TRIAGE_STATE_PATH = path.join(workspaceRoot, 'data', 'bob-training-escalation-triage-state.json');

function arg(name, fallback = '') {
  const key = `--${name}`;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (token === key) return String(argv[i + 1] || fallback);
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback;
  }
  return fallback;
}

function hasFlag(name) {
  const key = `--${name}`;
  return process.argv.slice(2).some((token) => String(token || '') === key);
}

function boolArg(name, fallback = false) {
  if (hasFlag(name)) return true;
  const raw = String(arg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toSortedEntries(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function loadScoreEntries(hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  try {
    const raw = await fs.readFile(SCORE_LOG_PATH, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean)
      .filter((entry) => {
        const stamp = Date.parse(entry.timestamp || '');
        return Number.isFinite(stamp) && stamp >= cutoff;
      });
  } catch {
    return [];
  }
}

function toPenaltyPoints(entry) {
  const reasons = Array.isArray(entry?.failureReasons) ? entry.failureReasons : [];
  let total = 0;

  for (const reason of reasons) {
    const text = String(reason || '').toLowerCase();
    if (text.includes('hallucinated_modules')) total -= 6;
    else if (text.includes('quality_gate_failed')) total -= 4;
    else if (text.includes('delivery_failed') || text.includes('network failure') || text.includes('empty_response')) total -= 3;
    else if (text.includes('fallback_applied')) total -= 2;
    else total -= 1;
  }

  return total;
}

function toPrizePoints(entry) {
  const signals = Array.isArray(entry?.positiveSignals) ? entry.positiveSignals : [];
  let total = 0;

  for (const signal of signals) {
    const text = String(signal || '').toLowerCase();
    if (text === 'checked_system_state') total += 1;
    else if (text === 'truthful_uncertainty') total += 1;
    else if (text === 'spec_driven_language') total += 1;
  }

  return total;
}

function scoreBand(score) {
  if (score >= 30) return 'excellent';
  if (score >= 10) return 'healthy';
  if (score >= 0) return 'watch';
  return 'critical';
}

function firstNonEmptyEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fetchBugReports({ hours }) {
  const supabaseUrl = firstNonEmptyEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/+$/, '');
  const serviceRole = firstNonEmptyEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRole) {
    return {
      available: false,
      reason: 'missing_supabase_env',
      open: [],
      recentlyResolved: [],
    };
  }

  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const openUrl = `${supabaseUrl}/rest/v1/bug_reports?select=id,severity,status,created_at,updated_at,title&status=not.in.(resolved,closed,wont_fix,duplicate)&order=created_at.asc&limit=200`;
  const resolvedUrl = `${supabaseUrl}/rest/v1/bug_reports?select=id,severity,status,created_at,updated_at,title&status=in.(resolved,closed)&updated_at=gte.${encodeURIComponent(cutoffIso)}&order=updated_at.desc&limit=200`;

  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
  };

  const [openRes, resolvedRes] = await Promise.all([
    fetch(openUrl, { headers }),
    fetch(resolvedUrl, { headers }),
  ]);

  const [openText, resolvedText] = await Promise.all([openRes.text(), resolvedRes.text()]);

  let open = [];
  let recentlyResolved = [];
  try {
    open = openText ? JSON.parse(openText) : [];
  } catch {
    open = [];
  }

  try {
    recentlyResolved = resolvedText ? JSON.parse(resolvedText) : [];
  } catch {
    recentlyResolved = [];
  }

  if (!openRes.ok || !resolvedRes.ok) {
    return {
      available: false,
      reason: `query_failed_open_${openRes.status}_resolved_${resolvedRes.status}`,
      open: [],
      recentlyResolved: [],
    };
  }

  return {
    available: true,
    reason: null,
    open: Array.isArray(open) ? open : [],
    recentlyResolved: Array.isArray(recentlyResolved) ? recentlyResolved : [],
  };
}

function evaluateBugPoints({ open, recentlyResolved }) {
  const nowMs = Date.now();
  let penaltyPoints = 0;
  let prizePoints = 0;

  let criticalOpen = 0;
  let highOpen = 0;
  let staleInProgress = 0;

  for (const row of open) {
    const severity = String(row?.severity || '').toLowerCase();
    const status = String(row?.status || '').toLowerCase();
    const createdMs = Date.parse(row?.created_at || '');
    const ageHours = Number.isFinite(createdMs) ? (nowMs - createdMs) / (1000 * 60 * 60) : 0;

    if (severity === 'critical') {
      criticalOpen += 1;
      penaltyPoints -= 4;
    } else if (severity === 'high') {
      highOpen += 1;
      penaltyPoints -= 2;
    }

    if ((status === 'in_progress' || status === 'investigating') && ageHours >= 3) {
      staleInProgress += 1;
      penaltyPoints -= 2;
    }
  }

  for (const row of recentlyResolved) {
    const severity = String(row?.severity || '').toLowerCase();
    if (severity === 'critical') prizePoints += 8;
    else if (severity === 'high') prizePoints += 6;
    else prizePoints += 4;
  }

  return {
    penaltyPoints,
    prizePoints,
    counts: {
      openTotal: open.length,
      resolvedRecently: recentlyResolved.length,
      criticalOpen,
      highOpen,
      staleInProgress,
    },
  };
}

async function generateScorecard({ hours, outPath, historyPath }) {
  const entries = await loadScoreEntries(hours);
  const bugData = await fetchBugReports({ hours });

  const reasonCounts = new Map();
  const signalCounts = new Map();
  const targetCounts = new Map();

  let rewardCount = 0;
  let penalizeCount = 0;
  let reviewCount = 0;

  let basePrizePoints = 0;
  let basePenaltyPoints = 0;
  let signalPrizePoints = 0;
  let reasonPenaltyPoints = 0;

  for (const entry of entries) {
    const disposition = String(entry?.disposition || '').toLowerCase();
    if (disposition === 'reward') {
      rewardCount += 1;
      basePrizePoints += 2;
    } else if (disposition === 'penalize') {
      penalizeCount += 1;
      basePenaltyPoints -= 3;
    } else {
      reviewCount += 1;
    }

    increment(targetCounts, String(entry?.target || 'unknown'));

    for (const reason of entry?.failureReasons || []) increment(reasonCounts, String(reason));
    for (const signal of entry?.positiveSignals || []) increment(signalCounts, String(signal));

    reasonPenaltyPoints += toPenaltyPoints(entry);
    signalPrizePoints += toPrizePoints(entry);
  }

  const bugPoints = evaluateBugPoints({
    open: bugData.open,
    recentlyResolved: bugData.recentlyResolved,
  });

  const totalScore =
    basePrizePoints +
    signalPrizePoints +
    bugPoints.prizePoints +
    basePenaltyPoints +
    reasonPenaltyPoints +
    bugPoints.penaltyPoints;

  const scorecard = {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    monitoringMode: 'monitor-and-train',
    score: {
      total: totalScore,
      band: scoreBand(totalScore),
      components: {
        responsePrizePoints: basePrizePoints,
        signalPrizePoints,
        bugFixPrizePoints: bugPoints.prizePoints,
        responsePenaltyPoints: basePenaltyPoints,
        reasonPenaltyPoints,
        bugPenaltyPoints: bugPoints.penaltyPoints,
      },
    },
    outcomes: {
      rewards: rewardCount,
      penalties: penalizeCount,
      reviews: reviewCount,
      entriesAnalyzed: entries.length,
    },
    bugReports: {
      available: bugData.available,
      reasonUnavailable: bugData.reason,
      openTotal: bugPoints.counts.openTotal,
      resolvedRecently: bugPoints.counts.resolvedRecently,
      criticalOpen: bugPoints.counts.criticalOpen,
      highOpen: bugPoints.counts.highOpen,
      staleInProgress: bugPoints.counts.staleInProgress,
    },
    topPenaltyReasons: toSortedEntries(reasonCounts).slice(0, 8),
    topPrizeSignals: toSortedEntries(signalCounts).slice(0, 8),
    contributionByTarget: toSortedEntries(targetCounts),
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.appendFile(
    historyPath,
    `${JSON.stringify({
      timestamp: scorecard.generatedAt,
      score: scorecard.score.total,
      band: scorecard.score.band,
      rewards: rewardCount,
      penalties: penalizeCount,
      reviews: reviewCount,
      entriesAnalyzed: entries.length,
      bugReports: scorecard.bugReports,
    })}\n`,
    'utf8'
  );

  return scorecard;
}

async function maybeWriteEscalation({
  scorecard,
  escalationThreshold,
  escalationLatestPath,
  escalationQueuePath,
}) {
  if (!Number.isFinite(escalationThreshold)) {
    return null;
  }

  if (scorecard.score.total > escalationThreshold) {
    return null;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    source: 'monitor-training-scorecard',
    reason: 'training-score-threshold-breached',
    threshold: escalationThreshold,
    score: scorecard.score.total,
    band: scorecard.score.band,
    outcomes: scorecard.outcomes,
    bugReports: scorecard.bugReports,
    topPenaltyReasons: scorecard.topPenaltyReasons.slice(0, 5),
    topPrizeSignals: scorecard.topPrizeSignals.slice(0, 5),
    actionHint:
      'Dr Bob should prioritize stale in_progress bugs and repeated delivery/empty-response failures before next cycle.',
  };

  await fs.mkdir(path.dirname(escalationLatestPath), { recursive: true });
  await fs.writeFile(escalationLatestPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

  await fs.mkdir(path.dirname(escalationQueuePath), { recursive: true });
  await fs.appendFile(escalationQueuePath, `${JSON.stringify(entry)}\n`, 'utf8');

  return entry;
}

function toEscalationKey(escalation) {
  return [
    String(escalation?.reason || 'unknown'),
    String(escalation?.score || 0),
    String(escalation?.threshold || 0),
    String(escalation?.bugReports?.openTotal || 0),
    String(escalation?.bugReports?.staleInProgress || 0),
    (escalation?.topPenaltyReasons || []).map((item) => `${item.name}:${item.count}`).join(','),
  ].join('|');
}

async function maybeRunTriageOnEscalation({
  escalation,
  enabled,
  command,
  cooldownMinutes,
  statePath,
  timeoutMs,
}) {
  if (!enabled || !escalation) {
    return { attempted: false, reason: 'disabled_or_no_escalation' };
  }

  const escalationKey = toEscalationKey(escalation);
  const nowMs = Date.now();
  const cooldownMs = Math.max(1, Number(cooldownMinutes || 30)) * 60 * 1000;

  const previousState = await readJsonIfExists(statePath, {
    lastEscalationKey: null,
    lastTriggeredAt: null,
    lastStatus: null,
  });

  const lastKey = String(previousState?.lastEscalationKey || '');
  const lastStatus = String(previousState?.lastStatus || '');
  const lastTriggeredAtMs = Date.parse(String(previousState?.lastTriggeredAt || ''));
  const withinCooldown =
    Number.isFinite(lastTriggeredAtMs) && nowMs - lastTriggeredAtMs < cooldownMs;

  if (lastKey === escalationKey && ['success', 'launched'].includes(lastStatus) && withinCooldown) {
    return {
      attempted: false,
      reason: 'cooldown_active_same_escalation',
      cooldownMinutes: Math.ceil((cooldownMs - (nowMs - lastTriggeredAtMs)) / (60 * 1000)),
    };
  }

  let status = 'launched';
  let exitCode = 0;
  let stderr = '';
  let pid = null;

  try {
    const child = spawn(command, {
      cwd: workspaceRoot,
      env: process.env,
      shell: true,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    pid = Number.isFinite(child.pid) ? child.pid : null;
  } catch (error) {
    status = 'failed';
    exitCode = Number.isFinite(error?.status) ? Number(error.status) : 1;
    stderr = String(error?.message || error).trim();
  }

  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    `${JSON.stringify(
      {
        lastEscalationKey: escalationKey,
        lastTriggeredAt: new Date().toISOString(),
        lastStatus: status,
        lastExitCode: exitCode,
        lastPid: pid,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    attempted: true,
    status,
    exitCode,
    stderrPreview: stderr.slice(0, 500),
    pid,
  };
}

function printSummary(scorecard, outPath) {
  console.log(`[monitor-training-scorecard] generated=${scorecard.generatedAt}`);
  console.log(`[monitor-training-scorecard] score=${scorecard.score.total} band=${scorecard.score.band}`);
  console.log(
    `[monitor-training-scorecard] rewards=${scorecard.outcomes.rewards} penalties=${scorecard.outcomes.penalties} reviews=${scorecard.outcomes.reviews} entries=${scorecard.outcomes.entriesAnalyzed}`
  );
  if (scorecard.bugReports.available) {
    console.log(
      `[monitor-training-scorecard] bugs open=${scorecard.bugReports.openTotal} resolved_recent=${scorecard.bugReports.resolvedRecently} critical_open=${scorecard.bugReports.criticalOpen} stale=${scorecard.bugReports.staleInProgress}`
    );
  } else {
    console.log(`[monitor-training-scorecard] bug telemetry unavailable: ${scorecard.bugReports.reasonUnavailable}`);
  }
  console.log(`[monitor-training-scorecard] out=${outPath}`);
}

async function runOnce() {
  const hoursRaw = Number.parseInt(arg('hours', '24'), 10);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 24;
  const outPath = path.resolve(process.cwd(), arg('out', DEFAULT_OUT_PATH));
  const historyPath = path.resolve(process.cwd(), arg('history', DEFAULT_HISTORY_PATH));
  const escalationThresholdRaw = Number.parseInt(arg('escalation-threshold', '-10'), 10);
  const escalationThreshold = Number.isFinite(escalationThresholdRaw) ? escalationThresholdRaw : -10;
  const escalationLatestPath = path.resolve(
    process.cwd(),
    arg('escalation-latest', DEFAULT_ESCALATION_LATEST_PATH)
  );
  const escalationQueuePath = path.resolve(
    process.cwd(),
    arg('escalation-queue', DEFAULT_ESCALATION_QUEUE_PATH)
  );
  const autoTriageOnEscalation = boolArg('auto-triage-on-escalation', false);
  const defaultTriageCommand = `${JSON.stringify(process.execPath)} scripts/rerun-open-bug-reports-dr-bob.mjs --limit=500`;
  const triageCommand = String(arg('triage-command', defaultTriageCommand)).trim();
  const triageCooldownRaw = Number.parseInt(arg('triage-cooldown-minutes', '30'), 10);
  const triageCooldownMinutes = Number.isFinite(triageCooldownRaw) && triageCooldownRaw > 0 ? triageCooldownRaw : 30;
  const triageStatePath = path.resolve(process.cwd(), arg('triage-state', DEFAULT_TRIAGE_STATE_PATH));
  const triageTimeoutRaw = Number.parseInt(arg('triage-timeout-ms', '600000'), 10);
  const triageTimeoutMs = Number.isFinite(triageTimeoutRaw) && triageTimeoutRaw > 0 ? triageTimeoutRaw : 600000;

  const scorecard = await generateScorecard({ hours, outPath, historyPath });
  const escalation = await maybeWriteEscalation({
    scorecard,
    escalationThreshold,
    escalationLatestPath,
    escalationQueuePath,
  });
  printSummary(scorecard, outPath);
  if (escalation) {
    console.log(
      `[monitor-training-scorecard] escalation_triggered threshold=${escalationThreshold} latest=${escalationLatestPath}`
    );
    console.log(`[monitor-training-scorecard] escalation_queue=${escalationQueuePath}`);

    const triageResult = await maybeRunTriageOnEscalation({
      escalation,
      enabled: autoTriageOnEscalation,
      command: triageCommand,
      cooldownMinutes: triageCooldownMinutes,
      statePath: triageStatePath,
      timeoutMs: triageTimeoutMs,
    });

    if (triageResult.attempted) {
      console.log(
        `[monitor-training-scorecard] triage_triggered status=${triageResult.status} exit_code=${triageResult.exitCode}`
      );
      if (Number.isFinite(triageResult.pid)) {
        console.log(`[monitor-training-scorecard] triage_pid=${triageResult.pid}`);
      }
      if (triageResult.stderrPreview) {
        console.log(`[monitor-training-scorecard] triage_stderr=${triageResult.stderrPreview}`);
      }
    } else {
      console.log(`[monitor-training-scorecard] triage_skipped reason=${triageResult.reason}`);
      if (Number.isFinite(triageResult.cooldownMinutes)) {
        console.log(`[monitor-training-scorecard] triage_cooldown_minutes=${triageResult.cooldownMinutes}`);
      }
    }
  }
}

async function main() {
  const watch = boolArg('watch', false);
  const intervalRaw = Number.parseInt(arg('interval-sec', '60'), 10);
  const intervalMs = (Number.isFinite(intervalRaw) && intervalRaw >= 15 ? intervalRaw : 60) * 1000;

  await runOnce();

  if (!watch) return;

  console.log(`[monitor-training-scorecard] watch enabled interval_sec=${Math.floor(intervalMs / 1000)}`);
  setInterval(() => {
    runOnce().catch((error) => {
      console.error(`[monitor-training-scorecard] iteration failed: ${String(error?.message || error)}`);
    });
  }, intervalMs);
}

main().catch((error) => {
  console.error(`[monitor-training-scorecard] fatal: ${String(error?.message || error)}`);
  process.exit(1);
});
