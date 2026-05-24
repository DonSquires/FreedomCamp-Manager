import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import jwt, { JwtPayload } from 'jsonwebtoken';
import ws from 'ws';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAgentPatch } from './agentTools.js';
import { runInSandboxEmulator } from './validator.js';
import { triggerOtaHotfix, triggerPreviewApkBuild } from './easTools.js';
import { closeGiteaIssue, createGiteaIssue, updateMarkdownTodo } from './pmTools.js';
import { discoverEnvironmentKey } from './intelTools.js';
import { orchestrateMissingTestFixtures } from './testTools.js';
import { evaluateUserJourneyPracticality } from './uxTools.js';
import { executeLiveDatabaseSchemaAudit } from './schemaAuditTools.js';
import { auditSupabaseStorageBuckets } from './storageTools.js';
import {
  buildPrioritizedResearchQueries,
  executeWebSearch,
  fetchWebpageContent,
  isTrustedResearchDomain,
} from './researchTool.js';

function hydrateEnvFromFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const delimiterIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, delimiterIndex).trim();
    if (!key || key in process.env) {
      continue;
    }

    const value = trimmed.slice(delimiterIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

function hydrateProcessEnvFromCommonFiles(): void {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '.env.local'),
    path.resolve(cwd, 'backend/.env'),
    path.resolve(cwd, 'backend/.env.local'),
    path.resolve(cwd, '../.env'),
    path.resolve(cwd, '../.env.local'),
  ];

  for (const candidate of candidates) {
    hydrateEnvFromFile(candidate);
  }
}

hydrateProcessEnvFromCommonFiles();

type DocumentationLibraryRow = {
  file_path: string;
  content: string;
  intent_keywords: string[] | null;
  priority: 'low' | 'medium' | 'high' | 'critical' | null;
  allowed_agents: string[] | null;
};

type HealChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatSessionMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type RoutedBobResponse = {
  intentType?: 'conversation' | 'patch';
  conversationalReply?: string;
  targetVariable?: string;
  patchValue?: string;
};

type TierAContext = {
  schemaPayload: string;
  systemRules: string;
  agentRoles: Record<string, string>;
};

type InitiativePatchCandidate = {
  isObviousAutonomous?: boolean;
  explanation?: string;
  targetFile?: string;
  patchValue?: string;
};

type InitiativeDecision = {
  isObviousAutonomous: boolean;
  explanation: string;
  targetFile: string;
  patchValue: string;
};

const DEFAULT_AGENT_ROLES: Record<string, string> = {
  dr_bob:
    'Chief Diagnostic Officer. Diagnose root cause using evidence across UI, network, auth, runtime, database, and side-effect layers.',
  bob:
    'Unified Fleet Chief Engineer. Coordinate end-to-end process recovery from trigger to verified completion with minimal blast-radius changes.',
  emulator:
    'Guardrail Sandbox. Validate safety, deterministic behavior, and contract compatibility before approval or promotion.',
  ui_ux_agent:
    'Visual and Interaction Architect. Specialize in React, Tailwind, accessibility, responsiveness, and visual coherence.',
  writer_agent:
    'Operations Chronicler. Generate concise, accurate updates for STAGING.md and INSTRUCTION_MANUAL.md grounded in live code changes and validated outcomes.',
  research_agent:
    'Research Core. Gather external release notes and docs updates, then synthesize actionable guidance for this stack and current incident context.',
};

type GiteaFileChange = {
  path: string;
  content: string;
};

type GiteaCreatePrRequest = {
  owner?: string;
  repo?: string;
  baseBranch?: string;
  branchName?: string;
  title?: string;
  body?: string;
  commitMessage?: string;
  files?: GiteaFileChange[];
  dryRun?: boolean;
};

type GiteaProposeResult = {
  statusCode: number;
  body: Record<string, unknown>;
};

type PlaywrightVerificationWebhookPayload = {
  status?: string;
  verificationTag?: string;
  managerStatus?: string;
  eventName?: string;
  ref?: string;
  branch?: string;
  repository?: string;
  commitSha?: string;
  command?: string;
  output?: string;
  capturedAt?: string;
  logId?: number | string;
  passRate?: number | string;
  greenScore?: number | string;
  testsPassed?: number | string;
  testsTotal?: number | string;
  recoveryAttempt?: number | string;
  retryCount?: number | string;
};

type CognitiveActionPayload = {
  mode: 'none' | 'gitea_propose_pr';
  giteaProposePr?: GiteaCreatePrRequest | null;
};

type CognitiveReasoningResult = {
  reasoningTrace: string;
  intentContext: string;
  riskAnalysis: string;
  rewardAnalysis: string;
  confidenceScore: number;
  isObviousAutonomous: boolean;
  actionPayload: CognitiveActionPayload;
  consultativeResponse: string;
};

type MaterializationCandidate = {
  path: string;
  content: string;
  source: 'gitea_files' | 'target_file_patch_value' | 'sql_fence';
};

type HealProviderTelemetry = {
  routeEngineUsed: 'local_deterministic' | 'model_synthesis';
  providersTried: string[];
  providerErrors: string[];
  externalCallsCount: number;
  cacheHit: boolean;
  supportSignalsUsed: boolean;
};

type PatrolWaypoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

type DocumentIntelKeyword = {
  keyword: string;
  score: number;
};

type DocumentIntelRow = {
  path: string;
  ext: string;
  category: string;
  bytes: number;
  textSource: string;
  text: string;
  textPreview: string;
  textChars: number;
  sha256: string;
  keywords: DocumentIntelKeyword[];
  topicTags: string[];
  indexedAt?: string;
};

type DocumentIntelPayload = {
  generatedAt: string;
  source: string;
  includeDirs: string[];
  ocrDir: string;
  totalDocuments: number;
  documents: DocumentIntelRow[];
};

const CHAT_DB_TIMEOUT_MS = Number(process.env.CHAT_DB_TIMEOUT_MS ?? 2500);
const CHAT_CONTEXT_TIMEOUT_MS = Number(process.env.CHAT_CONTEXT_TIMEOUT_MS ?? 3500);
const OLLAMA_MODEL_TIMEOUT_MS = Number(process.env.OLLAMA_MODEL_TIMEOUT_MS ?? 7000);
const OLLAMA_TOTAL_TIMEOUT_MS = Number(process.env.OLLAMA_TOTAL_TIMEOUT_MS ?? 18000);
const OLLAMA_STREAM_TIMEOUT_MS = Number(process.env.OLLAMA_STREAM_TIMEOUT_MS ?? 25000);
const OLLAMA_MAX_CANDIDATES = Math.max(1, Number(process.env.OLLAMA_MAX_CANDIDATES ?? 3));
const RUNPOD_REQUEST_TIMEOUT_MS = Number(process.env.RUNPOD_REQUEST_TIMEOUT_MS ?? 120000);
const RUNPOD_POLL_INTERVAL_MS = Math.max(500, Number(process.env.RUNPOD_POLL_INTERVAL_MS ?? 2500));
const RUNPOD_POLL_TIMEOUT_MS = Math.max(2000, Number(process.env.RUNPOD_POLL_TIMEOUT_MS ?? RUNPOD_REQUEST_TIMEOUT_MS));
const RUNPOD_STATUS_REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.RUNPOD_STATUS_REQUEST_TIMEOUT_MS ?? 20000));
const DOC_INTEL_DEFAULT_LIMIT = Math.max(1, Number(process.env.DOC_INTEL_DEFAULT_LIMIT ?? 20));
const DOC_INTEL_MAX_LIMIT = Math.max(1, Number(process.env.DOC_INTEL_MAX_LIMIT ?? 100));
const PRIVACY_REDACTION_ENABLED = parseBool(process.env.PRIVACY_REDACTION_ENABLED ?? 'true');
const SUPABASE_AUTH_LOOKUP_TIMEOUT_MS = Number(process.env.SUPABASE_AUTH_LOOKUP_TIMEOUT_MS ?? 3000);
const PATROL_SCAN_TIMEOUT_MS = Number(process.env.PATROL_SCAN_TIMEOUT_MS ?? 20000);
const PATROL_DRY_RUN_DEFAULT = parseBool(process.env.PATROL_DRY_RUN ?? 'false');
const PATROL_DRY_RUN_SKIP_MODEL = parseBool(process.env.PATROL_DRY_RUN_SKIP_MODEL ?? 'true');

const CURRENT_FILE = fileURLToPath(import.meta.url);
const BACKEND_DIR = path.dirname(CURRENT_FILE);
const REPO_ROOT = path.resolve(BACKEND_DIR, '..', '..');
const DOC_INTEL_INDEX_FILE = path.resolve(
  process.env.DOC_INTEL_INDEX_PATH ?? path.join(REPO_ROOT, 'data/internal-research/document-intelligence-index.json'),
);
const INSTRUCTION_MANUAL_FILE = path.resolve(
  process.env.INSTRUCTION_MANUAL_PATH ?? path.join(REPO_ROOT, 'docs/INSTRUCTION_MANUAL.md'),
);

let docIntelCache: {
  mtimeMs: number;
  payload: DocumentIntelPayload;
} | null = null;

let instructionManualCache: {
  mtimeMs: number;
  content: string;
} | null = null;

type RedactionResult = {
  text: string;
  hasSensitiveData: boolean;
  redactedFields: string[];
};

const SENSITIVE_PATTERNS: Array<{ label: string; regex: RegExp; replacement: string }> = [
  {
    label: 'email',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    label: 'phone',
    regex: /\b(?:\+?64|0)(?:[\s-]?\d){8,10}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  {
    label: 'address_number',
    regex: /\b\d{1,5}\s+[A-Za-z][A-Za-z0-9\s.-]{2,40}\s(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|close|crescent|place|pl|court|ct)\b/gi,
    replacement: '[REDACTED_ADDRESS]',
  },
  {
    label: 'plate',
    regex: /\b[A-Z]{2,3}[0-9]{2,4}\b/g,
    replacement: '[REDACTED_PLATE]',
  },
  {
    label: 'person_name',
    regex: /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g,
    replacement: '[REDACTED_NAME]',
  },
];

function redactSensitivePersonalData(input: string): RedactionResult {
  let output = String(input ?? '');
  const labels = new Set<string>();

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(output)) {
      labels.add(pattern.label);
      output = output.replace(pattern.regex, pattern.replacement);
    }
    pattern.regex.lastIndex = 0;
  }

  return {
    text: output,
    hasSensitiveData: labels.size > 0,
    redactedFields: Array.from(labels),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseBool(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseIssueNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function extractIssueNumberFromPayload(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  return (
    parseIssueNumber(record.giteaIssueNumber) ??
    parseIssueNumber(record.issueNumber) ??
    parseIssueNumber(record.gitea_issue_number)
  );
}

async function persistSelfHealingLog(args: {
  serviceName: string;
  errorMessage: string;
  payload: Record<string, unknown>;
  status: 'PENDING_HUMAN_REVIEW' | 'BLOCKED_BY_SANDBOX' | 'BLOCKED_BY_POLICY' | 'ORCHESTRATOR_CRASHED';
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('self_healing_logs')
    .insert({
      status: args.status,
      service_name: args.serviceName,
      error_message: args.errorMessage,
      error_payload: args.payload,
      created_at: nowIso,
    } as Record<string, unknown>);

  if (error) {
    console.warn('[/api/heal] self_healing_logs insert failed', error);
  }
}

function evaluateRootCausePolicy(args: {
  variableName: string;
  variableValue: string;
  justification: string;
}): { ok: boolean; reasons: string[] } {
  const variableName = String(args.variableName ?? '').trim();
  const variableValue = String(args.variableValue ?? '').trim();
  const justification = String(args.justification ?? '').trim();
  const lowerJustification = justification.toLowerCase();
  const reasons: string[] = [];

  if (justification.length < 24) {
    reasons.push('Justification is too short to demonstrate root-cause reasoning.');
  }

  const rootCauseMarkers = ['root cause', 'caused by', 'due to', 'because', 'underlying'];
  if (!rootCauseMarkers.some((marker) => lowerJustification.includes(marker))) {
    reasons.push('Justification must explicitly describe the underlying/root cause.');
  }

  const disallowedMarkers = ['quick fix', 'temporary', 'workaround', 'bypass', 'hack', 'band-aid'];
  const matchedDisallowed = disallowedMarkers.find((marker) => lowerJustification.includes(marker));
  if (matchedDisallowed) {
    reasons.push(`Policy rejected: justification contains disallowed phrase "${matchedDisallowed}".`);
  }

  if (/(disable|bypass|skip)/i.test(variableName) && /^(true|1|yes|on)$/i.test(variableValue)) {
    reasons.push('Policy rejected: disabling/bypass flags are not allowed as primary remediation.');
  }

  return { ok: reasons.length === 0, reasons };
}

function evaluateTestIntegrityPolicy(args: {
  variableName: string;
  variableValue: string;
  justification: string;
}): { ok: boolean; reasons: string[] } {
  const combined = [args.variableName, args.variableValue, args.justification]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');
  const reasons: string[] = [];

  const testTargetMarkers = [
    'test',
    'tests/',
    '__tests__',
    '.spec.',
    '.test.',
    'jest',
    'vitest',
    'playwright',
    'cypress',
    'mocha',
  ];
  const testBypassMarkers = [
    ' skip ',
    ' only ',
    ' xit ',
    ' xdescribe ',
    'disable test',
    'ignore failing',
    'mute failure',
  ];

  const matchedTarget = testTargetMarkers.find((marker) => combined.includes(marker));
  const matchedBypass = testBypassMarkers.find((marker) => combined.includes(marker));

  if (matchedTarget && matchedBypass) {
    reasons.push(
      `Policy rejected: autonomous patch appears to modify or bypass tests (${matchedTarget.trim()} + ${matchedBypass.trim()}).`,
    );
  }

  if (/(jest|vitest|playwright|cypress).*?(disable|skip|only)/i.test(combined)) {
    reasons.push('Policy rejected: test framework configuration bypass detected.');
  }

  return { ok: reasons.length === 0, reasons };
}

async function loadDocumentIntelIndex(): Promise<DocumentIntelPayload> {
  const fileStat = await stat(DOC_INTEL_INDEX_FILE);
  if (docIntelCache && docIntelCache.mtimeMs === fileStat.mtimeMs) {
    return docIntelCache.payload;
  }

  const raw = await readFile(DOC_INTEL_INDEX_FILE, 'utf8');
  const parsed = JSON.parse(raw) as DocumentIntelPayload;

  if (!parsed || !Array.isArray(parsed.documents)) {
    throw new Error('Invalid document intelligence index structure.');
  }

  docIntelCache = {
    mtimeMs: fileStat.mtimeMs,
    payload: parsed,
  };

  return parsed;
}

function timeoutError(label: string, ms: number): Error {
  return new Error(`${label} timed out after ${ms}ms`);
}

async function withTimeout<T>(task: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function requireAnyEnv(names: string[]): string {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) {
    throw new Error(`Missing required environment variable. Expected one of: ${names.join(', ')}`);
  }
  return value;
}

function optionalAnyEnv(names: string[]): string | undefined {
  return names.map((name) => process.env[name]).find(Boolean);
}

function hasAutomationToken(req: Request): boolean {
  const expected = String(process.env.AUTOMATION_WEBHOOK_TOKEN ?? process.env.GITEA_WEBHOOK_SECRET ?? '').trim();
  if (!expected) {
    return true;
  }

  const provided = String(req.headers['x-automation-token'] ?? '').trim();
  return provided.length > 0 && provided === expected;
}

function secureCompareHeaderValue(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function verifyGiteaWebhookSignature(req: Request): { ok: boolean; reason: string } {
  const expected = String(process.env.GITEA_WEBHOOK_SECRET ?? '').trim();
  if (!expected) {
    return { ok: false, reason: 'GITEA_WEBHOOK_SECRET is not configured.' };
  }

  const rawHeader = req.headers['x-gitea-signature'] ?? req.headers['x-gitea-token'];
  if (Array.isArray(rawHeader)) {
    return { ok: false, reason: 'Malformed webhook signature header.' };
  }

  const provided = String(rawHeader ?? '').trim();
  if (!provided) {
    return { ok: false, reason: 'Missing webhook signature header.' };
  }

  if (!secureCompareHeaderValue(provided, expected)) {
    return { ok: false, reason: 'Unauthorized webhook signature.' };
  }

  return { ok: true, reason: 'OK' };
}

function toShortString(value: unknown, fallback = 'unknown'): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function truncateTail(value: unknown, maxChars = 120000): string {
  const normalized = String(value ?? '');
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(-maxChars);
}

function parseLogId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function parsePositiveIntOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function triggerPlaywrightRecoveryRerun(branch: string): boolean {
  const enabled = parseBool(process.env.AUTO_PLAYWRIGHT_RECOVERY_RERUN ?? 'true');
  if (!enabled) {
    return false;
  }

  const command =
    String(process.env.PLAYWRIGHT_RECOVERY_COMMAND ?? 'MOCK_MODE=true npx playwright test --config playwright.config.ts').trim();

  if (!command) {
    return false;
  }

  try {
    const child = spawn('sh', ['-lc', command], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PLAYWRIGHT_RECOVERY_BRANCH: branch,
        PLAYWRIGHT_RECOVERY_TRIGGER: 'fixture-infusion',
      },
    });

    child.unref();
    return true;
  } catch (error) {
    console.warn('[/api/automation/playwright-result] Failed to trigger autonomous rerun', error);
    return false;
  }
}

async function resolveBugReportActor(): Promise<{ userId: string; userRole: string } | null> {
  const explicitUserId = String(process.env.BOB_AUTOMATION_USER_ID ?? '').trim();
  const explicitUserRole = String(process.env.BOB_AUTOMATION_USER_ROLE ?? 'admin').trim() || 'admin';
  if (explicitUserId) {
    return { userId: explicitUserId, userRole: explicitUserRole };
  }

  const { data: recentReport } = await supabase
    .from('bug_reports')
    .select('user_id, user_role')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const candidateUserId = String((recentReport as any)?.user_id ?? '').trim();
  const candidateUserRole = String((recentReport as any)?.user_role ?? 'admin').trim() || 'admin';
  if (candidateUserId) {
    return { userId: candidateUserId, userRole: candidateUserRole };
  }

  return null;
}

async function upsertPlaywrightFailureBugReport(args: {
  repository: string;
  branch: string;
  verificationTag: string;
  output: string;
  command: string;
  managerStatus: string;
  recoverySummary: Record<string, unknown>;
  attemptCount: number;
}): Promise<string | null> {
  const actor = await resolveBugReportActor();
  if (!actor) {
    console.warn('[/api/automation/playwright-result] Unable to resolve bug-report actor for escalation.');
    return null;
  }

  const title = `[PLAYWRIGHT][AUTO] ${args.repository} ${args.branch} verification failed`;
  const description = [
    `Playwright verification failed and escalated after recovery attempt ${args.attemptCount}.`,
    `Manager status: ${args.managerStatus}`,
    `Verification tag: ${args.verificationTag}`,
    `Command: ${args.command}`,
    `Recovery summary: ${JSON.stringify(args.recoverySummary)}`,
    '',
    'Output excerpt:',
    args.output || '[No output captured]',
  ].join('\n');

  const upsertPayload = {
    user_id: actor.userId,
    user_role: actor.userRole,
    issue_type: 'functional_bug',
    severity: 'high',
    priority: 'high',
    title,
    description,
    current_page: '/api/automation/playwright-result',
    app_version: `playwright-webhook:${args.repository}`,
    status: 'investigating',
    requires_human_review: true,
    ai_analyzed: true,
    ai_analysis: {
      source: 'playwright-recovery-escalation',
      branch: args.branch,
      attemptCount: args.attemptCount,
      managerStatus: args.managerStatus,
      recoverySummary: args.recoverySummary,
      escalatedAt: new Date().toISOString(),
    },
    auto_reported: true,
    admin_notified: false,
    user_notified: false,
  } as Record<string, unknown>;

  const { data: existing } = await supabase
    .from('bug_reports')
    .select('id')
    .eq('title', title)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((existing as any)?.id) {
    const bugReportId = String((existing as any).id);
    const { error } = await supabase
      .from('bug_reports')
      .update(upsertPayload)
      .eq('id', bugReportId);

    if (error) {
      console.warn('[/api/automation/playwright-result] Failed to update bug report escalation', error);
      return null;
    }

    return bugReportId;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('bug_reports')
    .insert(upsertPayload)
    .select('id')
    .single();

  if (insertError) {
    console.warn('[/api/automation/playwright-result] Failed to insert bug report escalation', insertError);
    return null;
  }

  return String((inserted as any)?.id ?? '');
}

const discoveredSupabaseUrl = await discoverEnvironmentKey('SUPABASE_URL');
const discoveredViteSupabaseUrl = await discoverEnvironmentKey('VITE_SUPABASE_URL');
const discoveredSupabaseProjectRef =
  (await discoverEnvironmentKey('SUPABASE_PROJECT_REF')) ?? String(process.env.SUPABASE_PROJECT_REF ?? '').trim();
const discoveredGiteaBaseUrl = await discoverEnvironmentKey('GITEA_BASE_URL');
const discoveredGiteaToken = await discoverEnvironmentKey('GITEA_TOKEN');
const discoveredGiteaOwner = await discoverEnvironmentKey('GITEA_OWNER');
const discoveredGiteaRepo = await discoverEnvironmentKey('GITEA_REPO');

if (discoveredGiteaBaseUrl && !process.env.GITEA_BASE_URL) {
  process.env.GITEA_BASE_URL = discoveredGiteaBaseUrl;
}
if (discoveredGiteaToken && !process.env.GITEA_TOKEN) {
  process.env.GITEA_TOKEN = discoveredGiteaToken;
}
if (discoveredGiteaOwner && !process.env.GITEA_OWNER) {
  process.env.GITEA_OWNER = discoveredGiteaOwner;
}
if (discoveredGiteaRepo && !process.env.GITEA_REPO) {
  process.env.GITEA_REPO = discoveredGiteaRepo;
}

const SUPABASE_URL =
  discoveredSupabaseUrl ??
  discoveredViteSupabaseUrl ??
  (discoveredSupabaseProjectRef ? `https://${discoveredSupabaseProjectRef}.supabase.co` : undefined);

const SUPABASE_SERVICE_ROLE_KEY =
  (await discoverEnvironmentKey('SUPABASE_SERVICE_ROLE_KEY')) ?? optionalAnyEnv(['SUPABASE_SERVICE_ROLE_KEY']);
const SUPABASE_JWT_SECRET = optionalAnyEnv(['SUPABASE_JWT_SECRET']);
const EFFECTIVE_SUPABASE_URL = SUPABASE_URL ?? 'http://127.0.0.1:54321';
const EFFECTIVE_SUPABASE_SERVICE_ROLE_KEY = SUPABASE_SERVICE_ROLE_KEY ?? 'missing-service-role-key';
const supabaseConfigReady = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const STRICT_STARTUP = parseBool(process.env.STRICT_STARTUP ?? 'false');

if (!supabaseConfigReady && STRICT_STARTUP) {
  throw new Error(
    'Supabase configuration is incomplete and STRICT_STARTUP is enabled. ' +
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or disable STRICT_STARTUP.'
  );
}

if (!supabaseConfigReady) {
  console.warn(
    '[FieldOps Backend] Supabase configuration is incomplete; starting in degraded mode. ' +
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for full functionality.'
  );
}

const app = express();

const allowedOrigins = (
  process.env.CORS_ALLOW_ORIGINS ??
  process.env.FRONTEND_ORIGIN ??
  'http://localhost:5173'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

app.use((req, res, next) => {
  if (supabaseConfigReady) {
    next();
    return;
  }

  if (req.path === '/health') {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    res.status(503).json({
      error: 'Service temporarily unavailable',
      code: 'SUPABASE_CONFIG_MISSING',
      message: 'Backend is running in degraded mode. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
    return;
  }

  next();
});

// ── Supabase (service role — backend only, never expose to client) ──────────
const supabase = createClient(
  EFFECTIVE_SUPABASE_URL,
  EFFECTIVE_SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      transport: ws as unknown as never,
    },
  }
);

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master', 'developer']);
const GRAND_MASTER_ROLES = new Set(['grand_master']);

type AdminAuthContext = {
  userId: string;
  role: string | null;
  isActive: boolean;
  isAdmin: boolean;
  isGrandMaster: boolean;
};

type TelemetrySourceLayer =
  | 'SUPABASE_SCHEMA'
  | 'API_CONTRACT'
  | 'CONTAINER_METRICS'
  | 'CORS_POLICY'
  | 'ENV_VARS';

type MultiAgentAssemblyResult = {
  status: 'PENDING_HUMAN_REVIEW' | 'BLOCKED_BY_SANDBOX';
  patchId: string;
  patch: {
    variableName: string;
    variableValue: string;
    justification: string;
  };
  drBobAnalysis: string;
  issueNumber: number | null;
};

function formatAuthRoleForPrompt(auth: AdminAuthContext | null): string {
  if (!auth) return 'unauthenticated';
  if (auth.isGrandMaster) return 'grand_master';
  if (auth.isAdmin) return 'admin';
  return 'user';
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function verifySupabaseToken(token: string): JwtPayload | null {
  if (!SUPABASE_JWT_SECRET) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
    });

    if (!decoded || typeof decoded === 'string') {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

async function resolveTokenSubject(token: string): Promise<string | null> {
  const localClaims = verifySupabaseToken(token);
  const localSubject = String(localClaims?.sub ?? '').trim();
  if (localSubject) {
    return localSubject;
  }

  if (SUPABASE_JWT_SECRET) {
    return null;
  }

  try {
    // Fallback only for environments where SUPABASE_JWT_SECRET is not configured.
    const { data, error } = await withTimeout(
      supabase.auth.getUser(token),
      SUPABASE_AUTH_LOOKUP_TIMEOUT_MS,
      'supabase.auth.getUser',
    );
    if (error) {
      return null;
    }

    const remoteSubject = String(data?.user?.id ?? '').trim();
    return remoteSubject || null;
  } catch {
    return null;
  }
}

async function resolveAdminAuth(req: Request): Promise<AdminAuthContext | null> {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const subject = await resolveTokenSubject(token);
  if (!subject) {
    return null;
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', subject)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const role = typeof data.role === 'string' ? data.role : null;
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  const isActive = data.is_active !== false;

  return {
    userId: data.id,
    role,
    isActive,
    isAdmin: isActive && ADMIN_ROLES.has(normalizedRole),
    isGrandMaster: isActive && GRAND_MASTER_ROLES.has(normalizedRole),
  };
}

async function requireUserAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await resolveAdminAuth(req);

  if (!auth) {
    res.status(401).json({ error: 'Unauthorized. Valid bearer token required.' });
    return;
  }

  if (!auth.isActive) {
    res.status(403).json({ error: 'Forbidden. User is inactive.' });
    return;
  }

  res.locals.auth = auth;
  next();
}

async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await resolveAdminAuth(req);

  if (!auth) {
    res.status(401).json({ error: 'Unauthorized. Valid bearer token required.' });
    return;
  }

  if (!auth.isAdmin) {
    res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
    return;
  }

  next();
}

async function requireGrandMasterAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await resolveAdminAuth(req);

  if (!auth) {
    res.status(401).json({ error: 'Unauthorized. Valid bearer token required.' });
    return;
  }

  if (!auth.isGrandMaster) {
    res.status(403).json({ error: 'Forbidden. Grand master privileges required.' });
    return;
  }

  next();
}

function triggerTrainingSync(source: string): void {
  const child = spawn('node', ['--loader', 'ts-node/esm', 'scripts/sync-training.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, TRAINING_TRIGGER_SOURCE: source },
  });
  child.unref();
}

async function persistMobileBuildReviewRecord(args: {
  initiatedBy: string;
  buildUrl: string | null;
  qrCodeUrl: string | null;
  command: string;
  output: string;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const outputTail = args.output.slice(-6000);
  const payload = {
    route: '/api/mobile/build-preview',
    command: args.command,
    buildUrl: args.buildUrl,
    qrCodeUrl: args.qrCodeUrl,
    initiatedBy: args.initiatedBy,
    recordedAt: nowIso,
    outputTail,
  };

  const { error } = await supabase
    .from('self_healing_logs')
    .insert({
      status: 'PENDING_HUMAN_REVIEW',
      service_name: 'mobile-app',
      error_message: 'Preview APK build completed and awaiting approval.',
      error_payload: payload,
      created_at: nowIso,
    } as Record<string, unknown>);

  if (!error) {
    return;
  }

  console.warn('[/api/mobile/build-preview] self_healing_logs insert failed; mirroring to heal_patches', error);

  await supabase
    .from('heal_patches')
    .insert({
      status: 'PENDING_HUMAN_REVIEW',
      service_name: 'mobile-app',
      error_message: 'Preview APK build completed and awaiting approval.',
      target_variable: 'mobile_preview_apk',
      patch_value: args.buildUrl ?? args.qrCodeUrl ?? 'Build completed',
      patch: {
        action: 'build_preview_apk',
        command: args.command,
        buildUrl: args.buildUrl,
        qrCodeUrl: args.qrCodeUrl,
      },
      error_payload: payload,
      dr_bob_analysis: 'Bob executed EAS preview APK build. Human review pending before rollout.',
      created_at: nowIso,
    });
}

async function persistMobileOtaReviewRecord(args: {
  initiatedBy: string;
  message: string;
  command: string;
  output: string;
  buildUrl: string | null;
  qrCodeUrl: string | null;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const outputTail = args.output.slice(-6000);
  const payload = {
    route: '/api/mobile/ota-hotfix',
    message: args.message,
    command: args.command,
    buildUrl: args.buildUrl,
    qrCodeUrl: args.qrCodeUrl,
    initiatedBy: args.initiatedBy,
    recordedAt: nowIso,
    outputTail,
  };

  const { error } = await supabase
    .from('self_healing_logs')
    .insert({
      status: 'PENDING_HUMAN_REVIEW',
      service_name: 'mobile-app',
      error_message: 'OTA hotfix command completed and awaiting approval.',
      error_payload: payload,
      created_at: nowIso,
    } as Record<string, unknown>);

  if (!error) {
    return;
  }

  console.warn('[/api/mobile/ota-hotfix] self_healing_logs insert failed; mirroring to heal_patches', error);

  await supabase
    .from('heal_patches')
    .insert({
      status: 'PENDING_HUMAN_REVIEW',
      service_name: 'mobile-app',
      error_message: 'OTA hotfix command completed and awaiting approval.',
      target_variable: 'mobile_ota_hotfix',
      patch_value: args.message,
      patch: {
        action: 'ota_hotfix',
        command: args.command,
        message: args.message,
        buildUrl: args.buildUrl,
        qrCodeUrl: args.qrCodeUrl,
      },
      error_payload: payload,
      dr_bob_analysis: 'Bob executed an EAS OTA hotfix. Human review pending before rollout.',
      created_at: nowIso,
    });
}

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: 'fieldops-backend',
    degraded: !supabaseConfigReady,
    strict_startup: STRICT_STARTUP,
    checks: {
      supabase_url: Boolean(SUPABASE_URL),
      supabase_service_role_key: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    },
  });
});

app.get('/api/research/document-intelligence', async (req: Request, res: Response) => {
  const adminAuth = await resolveAdminAuth(req);
  const hasAdminAccess = Boolean(adminAuth?.isAdmin);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const category = String(req.query.category ?? '').trim().toLowerCase();
  const tag = String(req.query.tag ?? '').trim().toLowerCase();
  const pathPrefix = String(req.query.pathPrefix ?? '').trim().toLowerCase();
  const includeTextRequested = parseBool(String(req.query.includeText ?? ''));
  const includeKeywords = parseBool(String(req.query.includeKeywords ?? ''));
  const redactRequested = parseBool(String(req.query.redact ?? 'true'));
  const includeText = hasAdminAccess ? includeTextRequested : false;
  const redact = hasAdminAccess ? redactRequested : true;
  const limit = Math.min(
    DOC_INTEL_MAX_LIMIT,
    parsePositiveInt(String(req.query.limit ?? ''), DOC_INTEL_DEFAULT_LIMIT),
  );

  try {
    const payload = await loadDocumentIntelIndex();

    const filtered = payload.documents
      .filter((row) => {
        if (category && row.category.toLowerCase() !== category) {
          return false;
        }

        if (tag) {
          const hasTag = (row.topicTags ?? []).some((topicTag) => String(topicTag).toLowerCase() === tag);
          if (!hasTag) {
            return false;
          }
        }

        if (pathPrefix && !row.path.toLowerCase().startsWith(pathPrefix)) {
          return false;
        }

        if (!q) {
          return true;
        }

        const haystack = [
          row.path,
          row.ext,
          row.category,
          row.textPreview,
          (row.topicTags ?? []).join(' '),
          (row.keywords ?? []).map((kw) => kw.keyword).join(' '),
          includeText ? row.text : '',
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(q);
      })
      .slice(0, limit)
      .map((row) => {
        const redactedPreview = redact ? redactSensitivePersonalData(row.textPreview).text : row.textPreview;
        const redactedText = redact && includeText ? redactSensitivePersonalData(row.text).text : row.text;

        return {
          path: row.path,
          ext: row.ext,
          category: row.category,
          bytes: row.bytes,
          textSource: row.textSource,
          textPreview: redactedPreview,
          textChars: row.textChars,
          topicTags: row.topicTags,
          indexedAt: row.indexedAt ?? null,
          ...(includeKeywords ? { keywords: row.keywords } : {}),
          ...(includeText ? { text: redactedText } : {}),
        };
      });

    res.status(200).json({
      status: 'OK',
      generatedAt: payload.generatedAt,
      totalDocuments: payload.totalDocuments,
      filteredCount: filtered.length,
      appliedFilters: {
        q: q || null,
        category: category || null,
        tag: tag || null,
        pathPrefix: pathPrefix || null,
        includeText,
        includeKeywords,
        redact,
        authLevel: hasAdminAccess ? 'admin' : 'public',
        limit,
      },
      results: filtered,
    });
  } catch (error) {
    console.error('[/api/research/document-intelligence] Failed to load index', error);
    res.status(500).json({
      status: 'ERROR',
      error: 'Failed to read compiled document intelligence index.',
      indexPath: DOC_INTEL_INDEX_FILE,
    });
  }
});

// ── Ollama helpers ───────────────────────────────────────────────────────────
function normalizeRunpodInvokeUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/\/runsync$/i.test(value)) return value;
  if (/\/run-sync$/i.test(value)) return value.replace(/\/run-sync$/i, '/runsync');
  if (/\/run$/i.test(value)) return value.replace(/\/run$/i, '/runsync');
  if (/\/v2\/[^/]+$/i.test(value)) return `${value}/runsync`;
  return value;
}

function toRunpodBaseUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return value
    .replace(/\/(?:runsync|run-sync|run|status\/[^/]+)$/i, '')
    .replace(/\/+$/, '');
}

function endpointIdFromUrl(rawUrl: string): string {
  const match = String(rawUrl || '').match(/api\.runpod\.ai\/v2\/([^/]+)/i);
  return String(match?.[1] || '').trim();
}

function deriveRunpodStatusUrl(invokeUrl: string, endpointId: string, jobId: string): string {
  if (endpointId) {
    return `https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(jobId)}`;
  }

  const parsedEndpointId = endpointIdFromUrl(invokeUrl);
  if (parsedEndpointId) {
    return `https://api.runpod.ai/v2/${parsedEndpointId}/status/${encodeURIComponent(jobId)}`;
  }

  const base = toRunpodBaseUrl(invokeUrl);
  if (base) {
    return `${base}/status/${encodeURIComponent(jobId)}`;
  }

  throw new Error('Unable to derive RunPod status URL');
}

function isRunpodTerminalStatus(status: string): boolean {
  const value = String(status || '').toUpperCase();
  return value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELLED' || value === 'TIMED_OUT';
}

function getRunpodConfig(): { invokeUrl: string; apiKey: string; model: string } | null {
  const endpointUrl = String(
    process.env.RUNPOD_ENDPOINT_URL
      ?? process.env.RUNPOD_RUNSYNC_URL
      ?? process.env.INFERENCE_SERVICE_URL
      ?? process.env.BOB_SERVICE_URL
      ?? '',
  ).trim();
  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID ?? '').trim();
  const baseUrl = endpointUrl || (endpointId ? `https://api.runpod.ai/v2/${endpointId}` : '');
  const invokeUrl = normalizeRunpodInvokeUrl(baseUrl);
  const apiKey = String(
    process.env.RUNPOD_ENDPOINT_API_KEY
      ?? process.env.RUNPOD_API_KEY
      ?? process.env.DR_BOB_API
      ?? '',
  ).trim();
  const model = String(
    process.env.RUNPOD_CHAT_MODEL
      ?? process.env.BOB_CHAT_MODEL
      ?? process.env.OLLAMA_CHAT_MODEL
      ?? '',
  ).trim();

  if (!invokeUrl || !apiKey) {
    return null;
  }

  return { invokeUrl, apiKey, model };
}

function parseRunpodResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const root = payload as Record<string, unknown>;
  const output = root.output && typeof root.output === 'object' ? (root.output as Record<string, unknown>) : root;
  const textCandidates = [
    output.message,
    output.response,
    output.text,
    output.result,
    root.message,
    root.response,
    root.text,
    root.result,
  ];

  for (const candidate of textCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return '';
}

async function generateWithRunpod(systemPrompt: string, userMessage: string): Promise<{ responseText: string; modelUsed: string }> {
  const config = getRunpodConfig();
  if (!config) {
    throw new Error('RunPod is not configured');
  }

  const payload = {
    input: {
      action: 'chat',
      message: userMessage,
      prompt: userMessage,
      system_prompt: systemPrompt,
      ...(config.model ? { model: config.model } : {}),
    },
  };

  const response = await axios.post(config.invokeUrl, payload, {
    timeout: RUNPOD_REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  const status = String((response.data as { status?: string })?.status ?? '').toUpperCase();
  const jobId = String((response.data as { id?: string; jobId?: string })?.id ?? (response.data as { jobId?: string })?.jobId ?? '').trim();
  let finalPayload: unknown = response.data;

  if (status === 'IN_PROGRESS' && jobId) {
    const statusUrl = deriveRunpodStatusUrl(config.invokeUrl, String(process.env.RUNPOD_ENDPOINT_ID ?? '').trim(), jobId);
    const startedAt = Date.now();

    let completed = false;
    while (Date.now() - startedAt <= RUNPOD_POLL_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, RUNPOD_POLL_INTERVAL_MS));
      const statusResp = await axios.get(statusUrl, {
        timeout: RUNPOD_STATUS_REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const polledStatus = String((statusResp.data as { status?: string })?.status ?? '').toUpperCase();
      if (!isRunpodTerminalStatus(polledStatus)) {
        continue;
      }

      if (polledStatus !== 'COMPLETED') {
        const failedPayload = statusResp.data as { error?: unknown };
        const detail = typeof failedPayload.error === 'string'
          ? failedPayload.error.slice(0, 800)
          : JSON.stringify(failedPayload.error ?? {}).slice(0, 800);
        throw new Error(`RunPod job ${jobId} ended with status ${polledStatus}: ${detail}`);
      }

      finalPayload = statusResp.data;
      completed = true;
      break;
    }

    if (!completed) {
      throw new Error(`RunPod job ${jobId} did not reach terminal status within ${RUNPOD_POLL_TIMEOUT_MS}ms`);
    }
  }

  const responseText = parseRunpodResponseText(finalPayload);
  if (!responseText) {
    throw new Error('RunPod returned an empty response');
  }

  const resolvedModel = String((finalPayload as { output?: { model?: string }; model?: string })?.output?.model ?? (finalPayload as { model?: string })?.model ?? config.model ?? '').trim();
  return {
    responseText,
    modelUsed: resolvedModel ? `runpod:${resolvedModel}` : 'runpod',
  };
}

function getOllamaModelCandidates(): string[] {
  const configured = [
    process.env.BOB_CHAT_MODELS,
    process.env.BOB_CHAT_MODEL,
    process.env.OLLAMA_CHAT_MODEL,
  ]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // Keep robust defaults so chat still works when one model is missing.
  const defaults = ['llama3.2-vision:11b', 'llama3.2:3b', 'llama3:70b', 'llama3'];
  return [...new Set([...configured, ...defaults])];
}

function isMissingModelError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  const body = error.response?.data;
  const message = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return status === 404 && /model\s+'.+'\s+not\s+found/i.test(message);
}

async function generateWithOpenAi(systemPrompt: string, userMessage: string): Promise<{ responseText: string; modelUsed: string }> {
  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = String(process.env.OPENAI_MODEL ?? process.env.OPENAI_RESEARCH_MODEL ?? 'gpt-4.1-mini').trim();
  const response = await axios.post(
    'https://api.openai.com/v1/responses',
    {
      model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt || '' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userMessage }],
        },
      ],
    },
    {
      timeout: OLLAMA_MODEL_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  );

  const data = response.data as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  const outputText = String(data.output_text ?? '').trim();
  if (outputText) {
    return { responseText: outputText, modelUsed: `openai:${model}` };
  }

  const chunks: string[] = [];
  for (const block of data.output ?? []) {
    for (const content of block.content ?? []) {
      const text = String(content.text ?? '').trim();
      if (text) {
        chunks.push(text);
      }
    }
  }

  return {
    responseText: chunks.join('\n').trim(),
    modelUsed: `openai:${model}`,
  };
}

async function generateWithModelFallback(systemPrompt: string, userMessage: string): Promise<{ responseText: string; modelUsed: string }> {
  const gatewayUrl = String(process.env.MODEL_GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
  const baseUrl = process.env.OLLAMA_PROXY_URL ?? 'http://ollama:11434';
  const models = getOllamaModelCandidates().slice(0, OLLAMA_MAX_CANDIDATES);
  let lastError: unknown = null;
  const startedAt = Date.now();

  try {
    return await generateWithRunpod(systemPrompt, userMessage);
  } catch (error) {
    lastError = error;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[model-fallback] runpod invocation failed: ${message}`);
  }

  if (gatewayUrl) {
    for (const model of models) {
      const elapsed = Date.now() - startedAt;
      const remainingBudget = OLLAMA_TOTAL_TIMEOUT_MS - elapsed;
      if (remainingBudget <= 500) {
        break;
      }

      const requestTimeoutMs = Math.max(1000, Math.min(OLLAMA_MODEL_TIMEOUT_MS, remainingBudget));
      try {
        const response = await axios.post(
          `${gatewayUrl}/api/generate`,
          {
            model,
            system: systemPrompt,
            prompt: userMessage,
            stream: false,
          },
          {
            timeout: requestTimeoutMs,
          },
        );

        return {
          responseText: String((response.data as { response?: string }).response ?? ''),
          modelUsed: `model_gateway:${model}`,
        };
      } catch (error) {
        lastError = error;
        console.warn(`[model-fallback] model gateway failed for ${model}`, error);
      }
    }
  }

  for (const model of models) {
    const elapsed = Date.now() - startedAt;
    const remainingBudget = OLLAMA_TOTAL_TIMEOUT_MS - elapsed;
    if (remainingBudget <= 500) {
      break;
    }

    const requestTimeoutMs = Math.max(1000, Math.min(OLLAMA_MODEL_TIMEOUT_MS, remainingBudget));
    try {
      const response = await axios.post(
        `${baseUrl}/api/generate`,
        {
          model,
          system: systemPrompt,
          prompt: userMessage,
          stream: false,
        },
        {
          timeout: requestTimeoutMs,
        },
      );

      return {
        responseText: String((response.data as { response?: string }).response ?? ''),
        modelUsed: model,
      };
    } catch (error) {
      lastError = error;
      if (isMissingModelError(error)) {
        console.warn(`[ollama] Model not available, falling back to next candidate: ${model}`);
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ollama] Model invocation failed for ${model}, trying next provider: ${message}`);
      continue;
    }
  }

  try {
    return await generateWithOpenAi(systemPrompt, userMessage);
  } catch (openAiError) {
    console.error('[model-fallback] OpenAI fallback failed', openAiError);
  }

  throw lastError instanceof Error ? lastError : new Error('No model providers succeeded');
}

async function promptOllama(role: string, systemPrompt: string, userMessage: string): Promise<string> {
  const { responseText, modelUsed } = await generateWithModelFallback(systemPrompt, userMessage);
  console.log(`[ollama] ${role} generated response via model ${modelUsed}`);
  return responseText;
}

function extractIntentTokens(input: string): Set<string> {
  const normalized = input.toLowerCase();
  const tokens = normalized
    .split(/[^a-z0-9_]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 1);
  return new Set(tokens);
}

function truncateRunbookContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n\n[TRUNCATED]`;
}

async function loadInstructionManualText(): Promise<string> {
  try {
    const fileStats = await stat(INSTRUCTION_MANUAL_FILE);
    const cached = instructionManualCache;
    if (cached && cached.mtimeMs === fileStats.mtimeMs) {
      return cached.content;
    }

    const content = await readFile(INSTRUCTION_MANUAL_FILE, 'utf8');
    instructionManualCache = {
      mtimeMs: fileStats.mtimeMs,
      content,
    };
    return content;
  } catch (error) {
    console.warn('[instruction-manual] Failed to load instruction manual context', error);
    return '';
  }
}

function extractInstructionManualGuidance(manualText: string, query: string, maxChars = 2400): string {
  const text = String(manualText ?? '').trim();
  if (!text) {
    return 'Instruction manual context unavailable.';
  }

  const queryTokens = extractIntentTokens(String(query ?? ''));
  for (const token of ['patrol', 'dispatch', 'route', 'response', 'incident', 'traffic']) {
    queryTokens.add(token);
  }

  const sections = text.split(/\n(?=##\s+)/g);
  const ranked = sections
    .map((section) => {
      const lower = section.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        if (token.length < 3) continue;
        if (lower.includes(token)) {
          score += 1;
        }
      }
      return { section, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = ranked
    .filter((row) => row.score > 0)
    .slice(0, 3)
    .map((row) => row.section.trim());

  const guidance = selected.length > 0 ? selected.join('\n\n') : truncateRunbookContent(text, Math.min(maxChars, 1200));
  return truncateRunbookContent(guidance, maxChars);
}

const UNIFIED_DEEP_SYSTEM_PROTOCOL = [
  'UNIFIED DEEP-SYSTEM INTEROPERABILITY PROTOCOL:',
  'When commanded to execute a comprehensive pre-beta system review, you must run a multi-dimensional analysis matching text documentation, binary cloud storage assets, and human visual friction metrics:',
  '',
  '1. DOCUMENTATION EXTRACTION: Read `docs/INSTRUCTION_MANUAL.md`. Isolate the intended workflow states for user onboarding, incident reporting, and data uploads.',
  '2. BINARY STORAGE CORRELATION: Invoke `auditSupabaseStorageBuckets()`. Compare the live files and image sizes inside your cloud buckets against the intended documentation parameters. Hunt for unlinked media blocks or file structure drifts.',
  '3. FRICTION LEDGER MERGE: Cross-reference your storage findings with the active user entries inside `public.ui_ux_friction_ledger`. Determine if slow page latencies or high user friction scores are directly correlated to unoptimized image sizes or missing bucket assets.',
  '4. STRATEGIC RECONCILIATION OUTPUT: Because deep-system updates modify multiple architectural layers, you are strictly forbidden from auto-deploying code. Synthesize your analysis into a comprehensive Markdown report mapping: (a) Structural Documentation Gaps, (b) Storage Bucket Anomalies, (c) UX Performance Traps, and (d) Explicit Risk vs. Reward Recommendations. Write this output to the ledger table and hold for the Captain\'s sign-off.',
].join('\n');

function parseSystemRulesAsArray(rawRules: unknown): string[] {
  if (Array.isArray(rawRules)) {
    return rawRules.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }

  if (typeof rawRules === 'string') {
    const trimmed = rawRules.trim();
    return trimmed ? [trimmed] : [];
  }

  if (rawRules && typeof rawRules === 'object') {
    return [JSON.stringify(rawRules)];
  }

  return [];
}

async function upsertUnifiedDeepSystemProtocol(): Promise<{ updated: boolean; totalRules: number }> {
  const serviceName = 'railway-backend';
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('system_knowledge_base')
    .select('service_name, schema_payload, system_rules, agent_roles')
    .eq('service_name', serviceName)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load system_knowledge_base rules: ${String(error.message || error)}`);
  }

  const currentRules = parseSystemRulesAsArray(data?.system_rules);
  const hasProtocol = currentRules.some((rule) => rule.includes('UNIFIED DEEP-SYSTEM INTEROPERABILITY PROTOCOL'));

  if (hasProtocol) {
    return { updated: false, totalRules: currentRules.length };
  }

  const nextRules = [...currentRules, UNIFIED_DEEP_SYSTEM_PROTOCOL];

  if (data) {
    const { error: updateError } = await supabase
      .from('system_knowledge_base')
      .update({
        system_rules: nextRules,
        updated_at: nowIso,
      })
      .eq('service_name', serviceName);

    if (updateError) {
      throw new Error(`Failed to update system_knowledge_base rules: ${String(updateError.message || updateError)}`);
    }

    return { updated: true, totalRules: nextRules.length };
  }

  const { error: insertError } = await supabase.from('system_knowledge_base').insert({
    service_name: serviceName,
    schema_payload: '{}',
    system_rules: nextRules,
    agent_roles: DEFAULT_AGENT_ROLES,
    created_at: nowIso,
    updated_at: nowIso,
  } as Record<string, unknown>);

  if (insertError) {
    throw new Error(`Failed to insert system_knowledge_base rules: ${String(insertError.message || insertError)}`);
  }

  return { updated: true, totalRules: nextRules.length };
}

function extractDeepSystemDocumentationState(instructionManualText: string): {
  onboarding: string;
  incidentReporting: string;
  dataUploads: string;
  gaps: string[];
} {
  const onboarding = extractInstructionManualGuidance(
    instructionManualText,
    'user onboarding login invite registration account setup',
    1400,
  );
  const incidentReporting = extractInstructionManualGuidance(
    instructionManualText,
    'incident reporting breaches evidence compliance response workflow',
    1400,
  );
  const dataUploads = extractInstructionManualGuidance(
    instructionManualText,
    'data uploads media upload image upload file upload',
    1400,
  );

  const gaps: string[] = [];
  if (onboarding.toLowerCase().includes('unavailable')) {
    gaps.push('Onboarding guidance could not be extracted from INSTRUCTION_MANUAL.');
  }
  if (incidentReporting.toLowerCase().includes('unavailable')) {
    gaps.push('Incident reporting guidance could not be extracted from INSTRUCTION_MANUAL.');
  }
  if (dataUploads.toLowerCase().includes('unavailable')) {
    gaps.push('Data upload guidance could not be extracted from INSTRUCTION_MANUAL.');
  }

  return {
    onboarding,
    incidentReporting,
    dataUploads,
    gaps,
  };
}

function buildDeepSystemAuditMarkdownReport(args: {
  sessionId: string;
  protocolPatch: { updated: boolean; totalRules: number };
  documentation: ReturnType<typeof extractDeepSystemDocumentationState>;
  storageSnapshot: any;
  frictionLogs: any[];
}): string {
  const { sessionId, protocolPatch, documentation, storageSnapshot, frictionLogs } = args;

  const anomalies = Array.isArray(storageSnapshot?.anomalies) ? storageSnapshot.anomalies : [];
  const bucketSummaries = Array.isArray(storageSnapshot?.bucketSummaries) ? storageSnapshot.bucketSummaries : [];
  const highSeverityAnomalies = anomalies.filter((entry: any) => String(entry?.severity ?? '') === 'high');
  const oversizedImageCount = anomalies.filter((entry: any) => String(entry?.issue ?? '') === 'oversized_image_asset').length;

  const scoredRows = (Array.isArray(frictionLogs) ? frictionLogs : []).filter((row) => {
    const score = Number((row as any)?.ux_practicality_score);
    return Number.isFinite(score);
  });
  const avgScore = scoredRows.length > 0
    ? scoredRows.reduce((sum, row) => sum + Number((row as any)?.ux_practicality_score), 0) / scoredRows.length
    : null;
  const highFrictionRows = (Array.isArray(frictionLogs) ? frictionLogs : []).filter((row) => {
    const score = Number((row as any)?.ux_practicality_score);
    const pathLen = Number((row as any)?.path_length_count);
    return (Number.isFinite(score) && score < 0.7) || (Number.isFinite(pathLen) && pathLen > 3);
  });

  const correlationSignals: string[] = [];
  if (oversizedImageCount > 0 && highFrictionRows.length > 0) {
    correlationSignals.push('Potential correlation detected: oversized storage image assets and elevated UX friction entries coexist.');
  }
  if (highSeverityAnomalies.length > 0 && highFrictionRows.length > 0) {
    correlationSignals.push('Potential correlation detected: high-severity storage anomalies overlap with poor UX score records.');
  }
  if (correlationSignals.length === 0) {
    correlationSignals.push('No direct high-confidence storage-to-UX correlation detected in this pass.');
  }

  const riskSummary = [
    documentation.gaps.length > 0 ? 'Documentation extraction has incomplete sections.' : 'Documentation extraction appears complete for targeted workflows.',
    highSeverityAnomalies.length > 0 ? `${highSeverityAnomalies.length} high-severity storage anomalies require remediation.` : 'No high-severity storage anomalies detected.',
    highFrictionRows.length > 0 ? `${highFrictionRows.length} UX ledger entries exceed practical thresholds.` : 'UX friction ledger does not show critical path-length/score breaches in sampled rows.',
  ].join(' ');

  const rewardSummary = [
    'Unified audit consolidates design intent, binary asset hygiene, and production UX telemetry into one governance artifact.',
    'Protocol synchronization ensures future deep-system sweeps follow non-autodeploy safety constraints.',
  ].join(' ');

  return [
    '# Unified Deep-System Audit Report',
    '',
    `- Session: ${sessionId}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Protocol patch applied: ${protocolPatch.updated ? 'yes' : 'no'} (total rule blocks: ${protocolPatch.totalRules})`,
    '',
    '## Structural Documentation Gaps',
    '',
    '| Workflow Domain | Extracted State | Gap Status |',
    '| --- | --- | --- |',
    `| User Onboarding | ${documentation.onboarding.replace(/\n/g, ' ').slice(0, 220)} | ${documentation.gaps.some((gap) => gap.toLowerCase().includes('onboarding')) ? 'Gap detected' : 'Aligned'} |`,
    `| Incident Reporting | ${documentation.incidentReporting.replace(/\n/g, ' ').slice(0, 220)} | ${documentation.gaps.some((gap) => gap.toLowerCase().includes('incident')) ? 'Gap detected' : 'Aligned'} |`,
    `| Data Uploads | ${documentation.dataUploads.replace(/\n/g, ' ').slice(0, 220)} | ${documentation.gaps.some((gap) => gap.toLowerCase().includes('upload')) ? 'Gap detected' : 'Aligned'} |`,
    '',
    documentation.gaps.length > 0 ? documentation.gaps.map((gap) => `- ${gap}`).join('\n') : '- No critical documentation extraction gaps detected.',
    '',
    '## Storage Bucket Anomalies',
    '',
    `- Buckets scanned: ${bucketSummaries.length}`,
    `- Total anomalies: ${anomalies.length}`,
    `- High severity anomalies: ${highSeverityAnomalies.length}`,
    '',
    '| Bucket | Objects | Total Bytes | Anomalous Objects |',
    '| --- | ---: | ---: | ---: |',
    ...(bucketSummaries.length > 0
      ? bucketSummaries.slice(0, 20).map((summary: any) => `| ${String(summary.bucket ?? 'unknown')} | ${Number(summary.objectCount ?? 0)} | ${Number(summary.totalBytes ?? 0)} | ${Number(summary.anomalousObjectCount ?? 0)} |`)
      : ['| n/a | 0 | 0 | 0 |']),
    '',
    '## UX Performance Traps',
    '',
    `- Friction rows sampled: ${(Array.isArray(frictionLogs) ? frictionLogs.length : 0)}`,
    `- High-friction rows: ${highFrictionRows.length}`,
    `- Average practicality score: ${avgScore === null ? 'n/a' : avgScore.toFixed(2)}`,
    '',
    '## Risk vs Reward Recommendations',
    '',
    '| Dimension | Assessment |',
    '| --- | --- |',
    `| Risk | ${riskSummary} |`,
    `| Reward | ${rewardSummary} |`,
    '',
    '### Cross-Layer Correlation Signals',
    ...correlationSignals.map((signal) => `- ${signal}`),
    '',
    '### Governance Hold',
    '- Auto-deployment is intentionally disabled for this deep-system path.',
    '- Review this report and approve manually before any infrastructure or code rollout.',
  ].join('\n');
}

function buildConversationTranscript(messages: HealChatMessage[] = []): string {
  const recentMessages = messages.slice(-20)
  if (recentMessages.length === 0) {
    return 'No prior conversation history.'
  }

  return recentMessages
    .map((message, index) => {
      const role = message.role === 'assistant' ? 'Bob' : message.role === 'system' ? 'System' : 'Human'
      return `${index + 1}. ${role}: ${String(message.content ?? '').trim()}`
    })
    .join('\n')
}

function normalizeChatSessionId(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) {
    return `session-${Date.now()}`;
  }

  return value.slice(0, 120);
}

function parseJsonObjectFromText(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [trimmed, fencedMatch?.[1]?.trim()].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function normalizeRelativeWorkspacePath(rawPath: string): string {
  return String(rawPath ?? '').trim().replace(/^\.\//, '').replace(/\\/g, '/');
}

function extractMaterializationCandidates(rawModelText: string): MaterializationCandidate[] {
  const candidates: MaterializationCandidate[] = [];
  const parsed = parseJsonObjectFromText(rawModelText);

  if (parsed) {
    const targetFile = typeof parsed.targetFile === 'string' ? normalizeRelativeWorkspacePath(parsed.targetFile) : '';
    const patchValue = typeof parsed.patchValue === 'string' ? parsed.patchValue.trim() : '';
    if (targetFile && patchValue) {
      candidates.push({
        path: targetFile,
        content: patchValue,
        source: 'target_file_patch_value',
      });
    }

    const actionPayload = parsed.actionPayload;
    if (actionPayload && typeof actionPayload === 'object' && !Array.isArray(actionPayload)) {
      const giteaPayload = (actionPayload as Record<string, unknown>).giteaProposePr;
      if (giteaPayload && typeof giteaPayload === 'object' && !Array.isArray(giteaPayload)) {
        const files = (giteaPayload as Record<string, unknown>).files;
        if (Array.isArray(files)) {
          for (const file of files) {
            if (!file || typeof file !== 'object' || Array.isArray(file)) {
              continue;
            }
            const filePath = typeof (file as Record<string, unknown>).path === 'string'
              ? normalizeRelativeWorkspacePath((file as Record<string, unknown>).path as string)
              : '';
            const content = typeof (file as Record<string, unknown>).content === 'string'
              ? ((file as Record<string, unknown>).content as string).trim()
              : '';
            if (!filePath || !content) {
              continue;
            }
            candidates.push({
              path: filePath,
              content,
              source: 'gitea_files',
            });
          }
        }
      }
    }
  }

  const sqlPathMatch = rawModelText.match(/supabase\/migrations\/[A-Za-z0-9._-]+\.sql/i);
  const sqlFenceMatch = rawModelText.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlPathMatch?.[0] && sqlFenceMatch?.[1]?.trim()) {
    candidates.push({
      path: normalizeRelativeWorkspacePath(sqlPathMatch[0]),
      content: sqlFenceMatch[1].trim(),
      source: 'sql_fence',
    });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.path}\n${candidate.content}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function materializeCandidatesToDisk(candidates: MaterializationCandidate[]): {
  written: string[];
  skipped: Array<{ path: string; reason: string }>;
} {
  const written: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const candidate of candidates) {
    const relPath = normalizeRelativeWorkspacePath(candidate.path);
    if (!relPath) {
      skipped.push({ path: candidate.path, reason: 'empty_path' });
      continue;
    }

    // Restrict autonomous materialization to migration scripts only.
    if (!relPath.startsWith('supabase/migrations/') || !relPath.endsWith('.sql')) {
      skipped.push({ path: relPath, reason: 'path_not_allowed' });
      continue;
    }

    const absolutePath = path.resolve(REPO_ROOT, relPath);
    if (!absolutePath.startsWith(REPO_ROOT + path.sep)) {
      skipped.push({ path: relPath, reason: 'outside_workspace' });
      continue;
    }

    const content = candidate.content.trim();
    if (!content) {
      skipped.push({ path: relPath, reason: 'empty_content' });
      continue;
    }

    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const normalized = content.endsWith('\n') ? content : `${content}\n`;
    writeFileSync(absolutePath, normalized, 'utf8');
    written.push(relPath);
  }

  return { written, skipped };
}

function shouldForcePerformanceMigrationMaterialization(inboundText: string, sessionId: string): boolean {
  const normalized = String(inboundText || '').toLowerCase();
  const sessionAuthorized = String(sessionId || '').trim() === 'production-performance-index-rollout';
  return sessionAuthorized
    && normalized.includes('supabase/migrations/20260524000004_bob_architect_performance_indices.sql')
    && normalized.includes('roster_schedules')
    && normalized.includes('incident_reports');
}

function buildForcedPerformanceMigrationSql(): string {
  return [
    '-- Auto-materialized by Bob backend fallback: performance index rollout',
    '-- Generated because model output did not include direct file mutation content.',
    '',
    'BEGIN;',
    '',
    '-- Candidate 1: roster_schedules organization/time access pattern',
    'DO $$',
    'DECLARE',
    "  org_col text;",
    "  time_col text;",
    'BEGIN',
    "  SELECT col INTO org_col FROM (VALUES ('organization_id'), ('org_id')) AS v(col)",
    "  WHERE EXISTS (",
    "    SELECT 1 FROM information_schema.columns",
    "    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col",
    '  ) LIMIT 1;',
    "  SELECT col INTO time_col FROM (VALUES ('schedule_date'), ('scheduled_date'), ('shift_date'), ('shift_start_time'), ('start_time')) AS v(col)",
    "  WHERE EXISTS (",
    "    SELECT 1 FROM information_schema.columns",
    "    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col",
    '  ) LIMIT 1;',
    '  IF org_col IS NOT NULL AND time_col IS NOT NULL THEN',
    "    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.roster_schedules (%I, %I)', 'idx_roster_schedules_org_time_bob_20260524', org_col, time_col);",
    '  END IF;',
    'END $$;',
    '',
    '-- Candidate 2: roster_schedules officer/time dispatch pattern',
    'DO $$',
    'DECLARE',
    "  officer_col text;",
    "  time_col text;",
    'BEGIN',
    "  SELECT col INTO officer_col FROM (VALUES ('officer_id'), ('assigned_officer_id'), ('user_id')) AS v(col)",
    "  WHERE EXISTS (",
    "    SELECT 1 FROM information_schema.columns",
    "    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col",
    '  ) LIMIT 1;',
    "  SELECT col INTO time_col FROM (VALUES ('shift_start_time'), ('start_time'), ('scheduled_date'), ('schedule_date')) AS v(col)",
    "  WHERE EXISTS (",
    "    SELECT 1 FROM information_schema.columns",
    "    WHERE table_schema = 'public' AND table_name = 'roster_schedules' AND column_name = v.col",
    '  ) LIMIT 1;',
    '  IF officer_col IS NOT NULL AND time_col IS NOT NULL THEN',
    "    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.roster_schedules (%I, %I)', 'idx_roster_schedules_officer_time_bob_20260524', officer_col, time_col);",
    '  END IF;',
    'END $$;',
    '',
    '-- Candidate 3: incident_reports organization/time query pattern',
    'DO $$',
    'DECLARE',
    "  org_col text;",
    "  ts_col text;",
    'BEGIN',
    "  SELECT col INTO org_col FROM (VALUES ('organization_id'), ('org_id')) AS v(col)",
    "  WHERE EXISTS (",
    "    SELECT 1 FROM information_schema.columns",
    "    WHERE table_schema = 'public' AND table_name = 'incident_reports' AND column_name = v.col",
    '  ) LIMIT 1;',
    "  SELECT col INTO ts_col FROM (VALUES ('created_at'), ('reported_at'), ('incident_time'), ('occurred_at')) AS v(col)",
    "  WHERE EXISTS (",
    "    SELECT 1 FROM information_schema.columns",
    "    WHERE table_schema = 'public' AND table_name = 'incident_reports' AND column_name = v.col",
    '  ) LIMIT 1;',
    '  IF org_col IS NOT NULL AND ts_col IS NOT NULL THEN',
    "    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.incident_reports (%I, %I DESC)', 'idx_incident_reports_org_time_bob_20260524', org_col, ts_col);",
    '  END IF;',
    'END $$;',
    '',
    'COMMIT;',
    '',
  ].join('\n');
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)
    .slice(0, 12);
}

function normalizeConfidenceValue(value: unknown, fallback = 0.7): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed > 0 && parsed <= 1) {
    return Math.max(0, Math.min(1, parsed));
  }

  return Math.max(0, Math.min(1, parsed / 100));
}

function formatIntelReportToMarkdown(report: Record<string, unknown>): string {
  const summary = String(report.summary ?? report.overview ?? 'No situational summary was produced.').trim();
  const activeRisks = normalizeStringArray(report.activeRisks);
  const recommendedActions = normalizeStringArray(report.recommendedActions);
  const sources = normalizeStringArray(report.sources);
  const confidence = normalizeConfidenceValue(report.confidence, 0.7);

  return [
    '## Situational Intelligence Brief',
    '',
    `Summary: ${summary}`,
    '',
    'Active Risks:',
    activeRisks.length > 0 ? activeRisks.map((risk) => `- ${risk}`).join('\n') : '- No active risks identified from current evidence.',
    '',
    'Recommended Actions:',
    recommendedActions.length > 0
      ? recommendedActions.map((action) => `- ${action}`).join('\n')
      : '- Continue monitoring and re-run intelligence sweep when new telemetry is available.',
    '',
    'Sources:',
    sources.length > 0 ? sources.map((source) => `- ${source}`).join('\n') : '- No explicit source URLs returned by synthesis model.',
    '',
    `Confidence: ${(confidence * 100).toFixed(0)}%`,
  ].join('\n');
}

function isPatrolRouteIntent(input: string): boolean {
  return /(patrol\s*route|best\s*route|route\s*plan|routing|waypoint|traffic|congestion|roadworks|closure|detour|stops?\s+order|dispatch|unit\s+assignment|incident\s+response|response\s+plan|deployment\s+plan)/i.test(input);
}

function getConfiguredResearchProviders(): string[] {
  const configured: string[] = [];
  const googleApiKey = String(
    process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
  ).trim();
  const googleCseId = String(process.env.GOOGLE_CSE_ID ?? process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID ?? '').trim();

  if (googleApiKey && googleCseId) {
    configured.push('google_cse');
  }

  if (String(process.env.OPENAI_API_KEY ?? '').trim()) {
    configured.push('openai_web_search');
  }

  if (String(process.env.RESEARCH_SEARCH_PROXY_URL ?? '').trim()) {
    configured.push('research_proxy');
  }

  if (String(process.env.SERPER_API_KEY ?? '').trim()) {
    configured.push('serper');
  }

  configured.push('duckduckgo');
  return configured;
}

function parseProviderTelemetryFromSearchOutput(raw: string): { providersTried: string[]; providerErrors: string[] } {
  const providers = new Set<string>();
  const errors: string[] = [];
  const trimmed = String(raw ?? '').trim();

  if (!trimmed) {
    return { providersTried: [], providerErrors: [] };
  }

  const fallbackMarker = '[provider-fallback]';
  if (trimmed.includes(fallbackMarker)) {
    const afterMarker = trimmed.split(fallbackMarker).slice(1).join(fallbackMarker).trim();
    const lines = afterMarker.split('\n');
    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned) {
        break;
      }

      const sepIndex = cleaned.indexOf(':');
      if (sepIndex > 0) {
        const provider = cleaned.slice(0, sepIndex).trim().toLowerCase();
        providers.add(provider);
        errors.push(cleaned);
      }
    }

    if (trimmed.match(/^-\s+/m)) {
      providers.add('duckduckgo');
    }
  } else {
    const configured = getConfiguredResearchProviders();
    if (configured.length > 0) {
      providers.add(configured[0]);
    }
  }

  return {
    providersTried: Array.from(providers),
    providerErrors: errors,
  };
}

function extractCoordinateWaypoints(input: string): PatrolWaypoint[] {
  const regex = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;
  const waypoints: PatrolWaypoint[] = [];
  let match: RegExpExecArray | null = regex.exec(input);
  let index = 1;

  while (match) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      waypoints.push({
        id: `wp-${index}`,
        label: `Waypoint ${index}`,
        lat,
        lng,
      });
      index += 1;
    }

    match = regex.exec(input);
  }

  return waypoints.slice(0, 12);
}

function haversineKm(a: PatrolWaypoint, b: PatrolWaypoint): number {
  const deg2rad = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = deg2rad(b.lat - a.lat);
  const dLng = deg2rad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return earthRadiusKm * c;
}

function orderWaypointsNearestNeighbor(waypoints: PatrolWaypoint[]): PatrolWaypoint[] {
  if (waypoints.length <= 2) {
    return [...waypoints];
  }

  const remaining = [...waypoints.slice(1)];
  const route: PatrolWaypoint[] = [waypoints[0]];

  while (remaining.length > 0) {
    const current = route[route.length - 1];
    let nextIndex = 0;
    let nextDistance = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < remaining.length; idx += 1) {
      const distance = haversineKm(current, remaining[idx]);
      if (distance < nextDistance) {
        nextDistance = distance;
        nextIndex = idx;
      }
    }

    route.push(remaining[nextIndex]);
    remaining.splice(nextIndex, 1);
  }

  return route;
}

function buildDefaultPatrolWaypoints(): PatrolWaypoint[] {
  return [
    { id: 'sector-start', label: 'Central staging point', lat: -41.2706, lng: 173.284 },
    { id: 'sector-north', label: 'Northern perimeter sweep', lat: -41.2615, lng: 173.2865 },
    { id: 'sector-east', label: 'Eastern perimeter sweep', lat: -41.2698, lng: 173.296 },
    { id: 'sector-south', label: 'Southern perimeter sweep', lat: -41.2788, lng: 173.2857 },
    { id: 'sector-west', label: 'Western perimeter sweep', lat: -41.2704, lng: 173.2722 },
  ];
}

async function fetchSelfHostedRoutePlan(waypoints: PatrolWaypoint[]): Promise<{
  routeSteps: string[];
  source: string;
  googleSupportUsed: boolean;
  metadata?: Record<string, unknown>;
}> {
  const mappingGatewayUrl = String(process.env.MAPPING_GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
  if (!mappingGatewayUrl || waypoints.length < 2) {
    const ordered = orderWaypointsNearestNeighbor(waypoints);
    return {
      routeSteps: ordered.map((point, index) => {
        const suffix = index === 0 ? ' (start)' : '';
        return `Stop ${index + 1}: ${point.label}${suffix} (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
      }),
      source: 'inbuilt-patrol-route-engine',
      googleSupportUsed: false,
    };
  }

  const response = await axios.post(
    `${mappingGatewayUrl}/route-plan`,
    {
      waypoints,
      includeTraffic: true,
    },
    {
      timeout: Number(process.env.MAPPING_GATEWAY_TIMEOUT_MS ?? 12000),
    },
  );

  const payload = response.data as {
    orderedWaypoints?: Array<{ label?: string; lat?: number; lng?: number }>;
    support?: { google?: { used?: boolean } };
    provider?: string;
    route?: Record<string, unknown>;
  };

  const ordered = Array.isArray(payload.orderedWaypoints)
    ? payload.orderedWaypoints
        .map((row, index) => ({
          label: String(row?.label ?? `Waypoint ${index + 1}`),
          lat: Number(row?.lat),
          lng: Number(row?.lng),
        }))
        .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
    : [];

  if (ordered.length < 2) {
    throw new Error('Mapping gateway returned insufficient waypoint data');
  }

  const routeSteps = ordered.map((point, index) => {
    const suffix = index === 0 ? ' (start)' : '';
    return `Stop ${index + 1}: ${point.label}${suffix} (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
  });

  return {
    routeSteps,
    source: String(payload.provider ?? 'self_hosted_mapping_gateway'),
    googleSupportUsed: Boolean(payload.support?.google?.used),
    metadata: payload.route,
  };
}

function buildDeterministicPatrolIntelReport(
  query: string,
  liveSupportSnippets: string,
  routeSteps: string[],
  routeSource: string,
  googleSupportUsed: boolean,
  manualGuidance: string,
): Record<string, unknown> {
  const hasTrafficTerms = /\b(traffic|congestion|roadworks|closure|incident|detour|crash)\b/i.test(query);
  const supportSignalsUsed = Boolean(String(liveSupportSnippets ?? '').trim());

  const activeRisks = [
    hasTrafficTerms
      ? 'Route request includes traffic/closure concerns; dynamic checks are required before dispatch.'
      : 'No explicit traffic signals in prompt; assume normal patrol variability.',
    supportSignalsUsed
      ? 'External support snippets were consulted; verify each signal against official agency feeds before action.'
      : 'No external support snippets were used; treat this route as deterministic baseline only.',
    googleSupportUsed
      ? 'Google support signals were used as secondary enrichment; self-hosted mapping remained primary.'
      : 'Google support enrichment was not used for this route build.',
  ];

  const recommendedActions = [
    ...routeSteps,
    manualGuidance
      ? 'Align dispatch and response actions with instruction manual guidance before field execution.'
      : 'Instruction manual guidance could not be loaded; use approved patrol SOP checklist manually.',
    'Validate closure/congestion conditions with dispatcher telemetry before rolling each leg.',
    'Re-run route planning when new incidents arrive or patrol priorities change.',
  ];

  const sources = [routeSource || 'inbuilt-patrol-route-engine'];
  if (supportSignalsUsed) {
    sources.push('external-support-signals');
  }
  if (googleSupportUsed) {
    sources.push('google-support-enrichment');
  }
  if (manualGuidance) {
    sources.push('instruction-manual-guidance');
  }

  return {
    summary: 'Deterministic patrol route generated from self-hosted mapping stack. External providers are optional support only.',
    activeRisks,
    recommendedActions,
    sources,
    confidence: supportSignalsUsed ? 0.82 : 0.74,
  };
}

function formatTelemetryBlock(telemetry: HealProviderTelemetry): string {
  const providers = telemetry.providersTried.length > 0 ? telemetry.providersTried.join(', ') : 'none';
  const errors = telemetry.providerErrors.length > 0 ? telemetry.providerErrors.map((err) => `- ${err}`).join('\n') : '- none';

  return [
    'Telemetry:',
    `- routeEngineUsed: ${telemetry.routeEngineUsed}`,
    `- externalCallsCount: ${telemetry.externalCallsCount}`,
    `- supportSignalsUsed: ${telemetry.supportSignalsUsed}`,
    `- cacheHit: ${telemetry.cacheHit}`,
    `- providersTried: ${providers}`,
    '- providerErrors:',
    errors,
  ].join('\n');
}

function formatPatrolRouteReportToMarkdown(
  report: Record<string, unknown>,
  telemetry: HealProviderTelemetry,
): string {
  const core = formatIntelReportToMarkdown(report);
  return `${core}\n\n${formatTelemetryBlock(telemetry)}`;
}

type PatrolSystemCheckResult = {
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
};

async function runPatrolSystemChecks(): Promise<{
  checks: PatrolSystemCheckResult[];
  passed: number;
  failed: number;
}> {
  const checks: PatrolSystemCheckResult[] = [];
  const mappingGatewayUrl = String(process.env.MAPPING_GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
  const modelGatewayUrl = String(process.env.MODEL_GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
  const runpodConfig = getRunpodConfig();
  const sampleWaypoints = buildDefaultPatrolWaypoints();

  if (!mappingGatewayUrl) {
    checks.push({
      name: 'mapping_gateway_configured',
      status: 'FAIL',
      detail: 'MAPPING_GATEWAY_URL is not configured.',
    });
  } else {
    try {
      const health = await axios.get(`${mappingGatewayUrl}/health`, {
        timeout: Number(process.env.MAPPING_GATEWAY_TIMEOUT_MS ?? 12000),
      });
      const ok = health.status >= 200 && health.status < 300;
      checks.push({
        name: 'mapping_gateway_health',
        status: ok ? 'PASS' : 'FAIL',
        detail: ok
          ? `health=ok, googleSupportConfigured=${Boolean((health.data as { providers?: { googleSupportConfigured?: boolean } }).providers?.googleSupportConfigured)}`
          : `Unexpected HTTP status ${health.status}`,
      });
    } catch (error) {
      checks.push({
        name: 'mapping_gateway_health',
        status: 'FAIL',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }

    try {
      const requestBody = {
        waypoints: sampleWaypoints,
        includeTraffic: true,
      };
      const [first, second] = await Promise.all([
        axios.post(`${mappingGatewayUrl}/route-plan`, requestBody, {
          timeout: Number(process.env.MAPPING_GATEWAY_TIMEOUT_MS ?? 12000),
        }),
        axios.post(`${mappingGatewayUrl}/route-plan`, requestBody, {
          timeout: Number(process.env.MAPPING_GATEWAY_TIMEOUT_MS ?? 12000),
        }),
      ]);

      const firstOrder = Array.isArray((first.data as { orderedWaypoints?: Array<{ id?: string; label?: string }> }).orderedWaypoints)
        ? ((first.data as { orderedWaypoints?: Array<{ id?: string; label?: string }> }).orderedWaypoints ?? [])
            .map((row) => String(row.id ?? row.label ?? '').trim())
            .filter(Boolean)
        : [];
      const secondOrder = Array.isArray((second.data as { orderedWaypoints?: Array<{ id?: string; label?: string }> }).orderedWaypoints)
        ? ((second.data as { orderedWaypoints?: Array<{ id?: string; label?: string }> }).orderedWaypoints ?? [])
            .map((row) => String(row.id ?? row.label ?? '').trim())
            .filter(Boolean)
        : [];

      const deterministic = firstOrder.length > 1 && JSON.stringify(firstOrder) === JSON.stringify(secondOrder);
      checks.push({
        name: 'route_order_deterministic',
        status: deterministic ? 'PASS' : 'FAIL',
        detail: deterministic
          ? `order=${firstOrder.join(' -> ')}`
          : `order mismatch first=${firstOrder.join(' -> ')} second=${secondOrder.join(' -> ')}`,
      });
    } catch (error) {
      checks.push({
        name: 'route_order_deterministic',
        status: 'FAIL',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  if (runpodConfig) {
    try {
      const response = await axios.post(
        runpodConfig.invokeUrl,
        {
          input: {
            action: 'ping',
            message: 'health check',
          },
        },
        {
          timeout: RUNPOD_REQUEST_TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${runpodConfig.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
      checks.push({
        name: 'runpod_endpoint_available',
        status: response.status >= 200 && response.status < 300 ? 'PASS' : 'FAIL',
        detail: `status=${response.status}`,
      });
    } catch (error) {
      checks.push({
        name: 'runpod_endpoint_available',
        status: 'FAIL',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }
  } else if (!modelGatewayUrl) {
    checks.push({
      name: 'model_gateway_configured',
      status: 'FAIL',
      detail: 'Neither RunPod endpoint nor MODEL_GATEWAY_URL is configured.',
    });
  } else {
    try {
      const response = await axios.post(
        `${modelGatewayUrl}/api/generate`,
        {
          prompt: 'Respond with OK only.',
        },
        {
          timeout: OLLAMA_MODEL_TIMEOUT_MS,
        },
      );
      const text = String((response.data as { response?: string }).response ?? '').trim();
      const ok = response.status >= 200 && response.status < 300 && text.length > 0;
      checks.push({
        name: 'response_engine_available',
        status: ok ? 'PASS' : 'FAIL',
        detail: ok ? `response=${text.slice(0, 120)}` : 'Model gateway returned empty response.',
      });
    } catch (error) {
      checks.push({
        name: 'response_engine_available',
        status: 'FAIL',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  const passed = checks.filter((check) => check.status === 'PASS').length;
  const failed = checks.length - passed;

  return { checks, passed, failed };
}

function formatPatrolSystemTestMarkdown(result: {
  checks: PatrolSystemCheckResult[];
  passed: number;
  failed: number;
}, manualGuidance: string): string {
  return [
    '## Patrol System Test Report',
    '',
    `Summary: ${result.passed} passed, ${result.failed} failed`,
    '',
    'Checks:',
    ...result.checks.map((check) => `- [${check.status}] ${check.name}: ${check.detail}`),
    '',
    '## Instruction Manual Alignment',
    manualGuidance,
  ].join('\n');
}

function normalizeRoutedBobResponse(rawModelText: string): RoutedBobResponse {
  const parsed = parseJsonObjectFromText(rawModelText);

  if (!parsed) {
    return {
      intentType: 'conversation',
      conversationalReply: rawModelText.trim(),
    };
  }

  const intentType = String(parsed.intentType ?? '').toLowerCase();
  const conversationalReply = typeof parsed.conversationalReply === 'string'
    ? parsed.conversationalReply.trim()
    : '';
  const targetVariable = typeof parsed.targetVariable === 'string'
    ? parsed.targetVariable.trim()
    : '';
  const patchValue = typeof parsed.patchValue === 'string'
    ? parsed.patchValue.trim()
    : '';

  if ((intentType === 'patch' || (targetVariable && patchValue)) && targetVariable && patchValue) {
    return {
      intentType: 'patch',
      targetVariable,
      patchValue,
      conversationalReply,
    };
  }

  return {
    intentType: 'conversation',
    conversationalReply: conversationalReply || rawModelText.trim(),
  };
}

function normalizeConfidenceScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.55;
  }

  if (parsed < 0) {
    return 0;
  }

  if (parsed > 1) {
    return 1;
  }

  return Math.round(parsed * 100) / 100;
}

function normalizeCognitiveReasoningOutput(rawModelText: string, inboundText: string): CognitiveReasoningResult {
  const parsed = parseJsonObjectFromText(rawModelText);
  const fallbackTrace = rawModelText.trim() || 'No model reasoning trace returned.';

  if (!parsed) {
    return {
      reasoningTrace: fallbackTrace,
      intentContext: inboundText.slice(0, 120) || 'MANUAL_USER_INSTRUCTION',
      riskAnalysis: 'Model response was not parseable as JSON; autonomous execution disabled.',
      rewardAnalysis: 'Human review can still act on the recommendation once reformatted.',
      confidenceScore: 0.35,
      isObviousAutonomous: false,
      actionPayload: { mode: 'none', giteaProposePr: null },
      consultativeResponse: fallbackTrace,
    };
  }

  const reasoningTrace = typeof parsed.reasoningTrace === 'string'
    ? parsed.reasoningTrace.trim()
    : fallbackTrace;
  const intentContext = typeof parsed.intentContext === 'string' && parsed.intentContext.trim().length > 0
    ? parsed.intentContext.trim()
    : inboundText.slice(0, 120) || 'MANUAL_USER_INSTRUCTION';
  const riskAnalysis = typeof parsed.riskAnalysis === 'string' && parsed.riskAnalysis.trim().length > 0
    ? parsed.riskAnalysis.trim()
    : 'Risk analysis unavailable.';
  const rewardAnalysis = typeof parsed.rewardAnalysis === 'string' && parsed.rewardAnalysis.trim().length > 0
    ? parsed.rewardAnalysis.trim()
    : 'Reward analysis unavailable.';
  const confidenceScore = normalizeConfidenceScore(parsed.confidenceScore);
  const isObviousAutonomous = Boolean(parsed.isObviousAutonomous);

  const rawActionPayload = parsed.actionPayload;
  let actionPayload: CognitiveActionPayload = { mode: 'none', giteaProposePr: null };
  if (rawActionPayload && typeof rawActionPayload === 'object' && !Array.isArray(rawActionPayload)) {
    const mode = String((rawActionPayload as Record<string, unknown>).mode ?? '').toLowerCase();
    const rawGitea = (rawActionPayload as Record<string, unknown>).giteaProposePr;

    if (mode === 'gitea_propose_pr' && rawGitea && typeof rawGitea === 'object' && !Array.isArray(rawGitea)) {
      actionPayload = {
        mode: 'gitea_propose_pr',
        giteaProposePr: rawGitea as GiteaCreatePrRequest,
      };
    }
  }

  const consultativeResponse = typeof parsed.consultativeResponse === 'string' && parsed.consultativeResponse.trim().length > 0
    ? parsed.consultativeResponse.trim()
    : '';

  return {
    reasoningTrace,
    intentContext,
    riskAnalysis,
    rewardAnalysis,
    confidenceScore,
    isObviousAutonomous,
    actionPayload,
    consultativeResponse,
  };
}

function formatCognitiveRiskRewardMarkdown(reasoning: CognitiveReasoningResult): string {
  return [
    '## Cognitive Risk/Reward Analysis',
    '',
    '| Dimension | Assessment |',
    '| --- | --- |',
    `| Risk | ${reasoning.riskAnalysis.replace(/\n/g, '<br/>')} |`,
    `| Reward | ${reasoning.rewardAnalysis.replace(/\n/g, '<br/>')} |`,
    `| Confidence | ${reasoning.confidenceScore.toFixed(2)} |`,
    `| Autonomous Path | ${reasoning.isObviousAutonomous ? 'Eligible' : 'Consultative Hold'} |`,
    '',
    '### Reasoning Trace',
    reasoning.reasoningTrace || 'No reasoning trace provided.',
  ].join('\n');
}

async function persistAiReasoningLedger(args: {
  sessionId: string;
  reasoning: CognitiveReasoningResult;
  actionTaken: 'RECOMMENDED_ONLY' | 'AGENTIC_EXECUTED';
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase
    .from('ai_reasoning_ledger')
    .insert({
      session_id: args.sessionId,
      intent_context: args.reasoning.intentContext,
      hypothetical_risks: args.reasoning.riskAnalysis,
      projected_rewards: args.reasoning.rewardAnalysis,
      confidence_score: args.reasoning.confidenceScore,
      action_taken: args.actionTaken,
      metadata: args.metadata,
      created_at: new Date().toISOString(),
    } as Record<string, unknown>);

  if (error) {
    console.warn('[/api/heal] Failed to persist ai_reasoning_ledger entry', error);
  }
}

async function appendChatSessionMessage(
  sessionId: string,
  role: ChatSessionMessage['role'],
  content: string,
): Promise<void> {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return;
  }

  const result = await withTimeout(
    Promise.resolve(
      supabase
        .from('chat_sessions')
        .insert({
          session_id: sessionId,
          role,
          content: trimmedContent,
          created_at: new Date().toISOString(),
        }),
    ),
    CHAT_DB_TIMEOUT_MS,
    'chat_sessions insert',
  ).catch((error) => {
    console.warn('[/api/heal] chat_sessions insert timed out/failed', error);
    return { error: null } as { error: unknown };
  });

  const { error } = result;

  if (error) {
    console.warn('[/api/heal] Failed to append chat_sessions message', error);
  }
}

async function loadRecentChatSessionMessages(sessionId: string, limit = 10): Promise<HealChatMessage[]> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('chat_sessions')
        .select('role,content,created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ),
    CHAT_DB_TIMEOUT_MS,
    'chat_sessions select',
  ).catch((timeout) => {
    console.warn('[/api/heal] chat_sessions select timed out/failed', timeout);
    return { data: [], error: null } as { data: Array<{ role: string; content: string }>; error: unknown };
  });

  if (error) {
    console.warn('[/api/heal] Failed to load chat_sessions history', error);
    return [];
  }

  return (data ?? [])
    .slice()
    .reverse()
    .filter((message) => message && typeof message.content === 'string')
    .map((message): HealChatMessage => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: String(message.content),
    }));
}

function normalizeBranchName(input: string, prefix: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/.]+|[-/.]+$/g, '');

  const branch = cleaned || `autofix-${Date.now()}`;
  return branch.startsWith(prefix) ? branch : `${prefix}${branch}`;
}

function sanitizeFilePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '').trim();

  if (!normalized || normalized.includes('..') || normalized.startsWith('.git/')) {
    throw new Error(`Invalid file path: ${input}`);
  }

  return normalized;
}

function encodeRepoPath(pathValue: string): string {
  return pathValue
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function tryParseGiteaPrCommand(input: string): GiteaCreatePrRequest | null {
  const trimmed = input.trim();
  let jsonText = '';

  if (trimmed.toLowerCase().startsWith('/gitea-pr')) {
    jsonText = trimmed.slice('/gitea-pr'.length).trim();
  } else if (trimmed.toUpperCase().startsWith('GITEA_PR:')) {
    jsonText = trimmed.slice('GITEA_PR:'.length).trim();
  } else {
    return null;
  }

  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as GiteaCreatePrRequest;
    return {
      ...parsed,
      // Safety default: manual chat commands run as dry-run unless explicitly set false.
      dryRun: parsed.dryRun === false ? false : true,
    };
  } catch {
    return null;
  }
}

function formatGiteaProposeResultForBob(result: GiteaProposeResult): string {
  const status = String(result.body.status ?? 'UNKNOWN');
  const branchName = String(result.body.branchName ?? 'n/a');
  const repo = `${String(result.body.owner ?? 'n/a')}/${String(result.body.repo ?? 'n/a')}`;
  const fileCount = Number(result.body.fileCount ?? (Array.isArray(result.body.files) ? result.body.files.length : 0));
  const prUrl = result.body.pullRequestUrl ? String(result.body.pullRequestUrl) : null;

  if (status === 'DRY_RUN') {
    return [
      `Gitea proposal dry run passed for ${repo}.`,
      `Branch: ${branchName}`,
      `Files: ${fileCount}`,
      'No branch, commit, or PR was created because dryRun is enabled.',
      'Set "dryRun": false in the command payload to execute live.',
    ].join('\n');
  }

  if (status === 'PR_OPENED') {
    return [
      `Gitea proposal executed for ${repo}.`,
      `Branch: ${branchName}`,
      `Files: ${fileCount}`,
      `PR URL: ${prUrl ?? 'Unavailable'}`,
    ].join('\n');
  }

  return `Gitea proposal returned status ${status}.`;
}

async function executeGiteaProposePr(payload: GiteaCreatePrRequest): Promise<GiteaProposeResult> {
  const defaultRepoPair = optionalAnyEnv(['GITEA_REPOSITORY', 'GITHUB_REPOSITORY']) ?? '';
  const [fallbackOwner, fallbackRepo] = defaultRepoPair.includes('/')
    ? defaultRepoPair.split('/', 2)
    : ['', ''];

  const owner = (payload.owner ?? process.env.GITEA_OWNER ?? fallbackOwner ?? '').trim();
  const repo = (payload.repo ?? process.env.GITEA_REPO ?? fallbackRepo ?? '').trim();
  const baseBranch = (payload.baseBranch ?? process.env.GITEA_BASE_BRANCH ?? 'main').trim();
  const branchPrefix = process.env.GITEA_BRANCH_PREFIX ?? 'bob/';
  const commitMessage = (payload.commitMessage ?? 'chore: bob proposed patch').trim();
  const prTitle = (payload.title ?? 'Bob proposed patch').trim();
  const prBody = (payload.body ?? 'Automated patch proposed by Bob through backend Gitea integration.').trim();
  const dryRun = payload.dryRun === true;

  const files = (payload.files ?? [])
    .filter((item) => item && typeof item.path === 'string' && typeof item.content === 'string')
    .map((item) => ({
      path: sanitizeFilePath(item.path),
      content: item.content,
    }));

  if (!owner || !repo) {
    return {
      statusCode: 400,
      body: { error: 'owner and repo are required (or set GITEA_OWNER and GITEA_REPO).' },
    };
  }

  if (!prTitle) {
    return {
      statusCode: 400,
      body: { error: 'title is required.' },
    };
  }

  if (files.length === 0) {
    return {
      statusCode: 400,
      body: { error: 'At least one file change is required.' },
    };
  }

  if (files.length > 20) {
    return {
      statusCode: 400,
      body: { error: 'Too many files. Maximum is 20 per request.' },
    };
  }

  const totalBytes = files.reduce((sum, item) => sum + Buffer.byteLength(item.content, 'utf8'), 0);
  if (totalBytes > 300_000) {
    return {
      statusCode: 400,
      body: { error: 'Patch payload too large. Maximum total content is 300KB.' },
    };
  }

  const requestedBranch = payload.branchName ?? prTitle;
  const branchName = normalizeBranchName(requestedBranch, branchPrefix);

  if (dryRun) {
    return {
      statusCode: 200,
      body: {
        status: 'DRY_RUN',
        owner,
        repo,
        baseBranch,
        branchName,
        title: prTitle,
        commitMessage,
        fileCount: files.length,
        totalBytes,
        files: files.map((item) => item.path),
      },
    };
  }

  let gitea;
  try {
    gitea = getGiteaClient();
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error instanceof Error ? error.message : 'Invalid Gitea configuration',
      },
    };
  }

  try {
    const encodedBaseBranch = encodeRepoPath(baseBranch);
    let baseSha = '';

    try {
      const baseRefResponse = await gitea.get(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodedBaseBranch}`,
      );
      baseSha = String((baseRefResponse.data as { object?: { sha?: string } }).object?.sha ?? '').trim();
    } catch (error) {
      if (!(axios.isAxiosError(error) && error.response?.status === 404)) {
        throw error;
      }
    }

    if (!baseSha) {
      const branchResponse = await gitea.get(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodedBaseBranch}`,
      );
      const branchData = branchResponse.data as { commit?: { id?: string; sha?: string } };
      baseSha = String(branchData.commit?.id ?? branchData.commit?.sha ?? '').trim();
    }

    if (!baseSha) {
      return {
        statusCode: 422,
        body: { error: 'Unable to resolve base branch SHA from Gitea.' },
      };
    }

    try {
      await gitea.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 422) {
          return {
            statusCode: 409,
            body: { error: `Branch already exists: ${branchName}` },
          };
        }

        // Some Gitea instances disable git/refs writes and only support /branches creation.
        if (status === 404 || status === 405 || status === 501) {
          try {
            await gitea.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, {
              new_branch_name: branchName,
              old_ref_name: baseBranch,
            });
          } catch (fallbackError) {
            if (axios.isAxiosError(fallbackError) && fallbackError.response?.status === 409) {
              return {
                statusCode: 409,
                body: { error: `Branch already exists: ${branchName}` },
              };
            }
            throw fallbackError;
          }
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    for (const fileChange of files) {
      const encodedPath = encodeRepoPath(fileChange.path);

      let existingSha: string | undefined;
      try {
        const existing = await gitea.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
          { params: { ref: branchName } },
        );
        existingSha = String((existing.data as { sha?: string }).sha ?? '').trim() || undefined;
      } catch (error) {
        if (!(axios.isAxiosError(error) && error.response?.status === 404)) {
          throw error;
        }
      }

      await gitea.put(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`, {
        branch: branchName,
        message: commitMessage,
        content: Buffer.from(fileChange.content, 'utf8').toString('base64'),
        sha: existingSha,
      });
    }

    const prResponse = await gitea.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      base: baseBranch,
      head: branchName,
      title: prTitle,
      body: prBody,
    });

    const pull = prResponse.data as { number?: number; html_url?: string; url?: string };

    return {
      statusCode: 201,
      body: {
        status: 'PR_OPENED',
        owner,
        repo,
        baseBranch,
        branchName,
        pullRequestNumber: pull.number ?? null,
        pullRequestUrl: pull.html_url ?? pull.url ?? null,
        files: files.map((item) => item.path),
      },
    };
  } catch (error) {
    const details = axios.isAxiosError(error)
      ? {
          status: error.response?.status,
          data: error.response?.data,
        }
      : undefined;

    console.error('[/api/gitea/propose-pr] Failed to create PR', details ?? error);

    return {
      statusCode: 500,
      body: {
        error: 'Failed to create Gitea branch/commit/PR',
        details,
      },
    };
  }
}

function getGiteaClient() {
  const giteaBase = optionalAnyEnv(['GITEA_BASE_URL', 'GITEA_URL', 'GITEA_API_URL']);
  const giteaToken = optionalAnyEnv(['GITEA_ADMIN_TOKEN', 'GITEA_TOKEN', 'GITEA_API_TOKEN', 'GITEA_ACCESS_TOKEN']);
  const githubToken = optionalAnyEnv(['GITHUB_TOKEN', 'GH_TOKEN', 'BOB_WORKER_GITHUB_TOKEN']);
  const githubApiUrl = optionalAnyEnv(['GITHUB_API_URL']);
  const githubServerUrl = optionalAnyEnv(['GITHUB_SERVER_URL']);

  const usingGitea = Boolean(giteaBase && giteaToken);
  const token = usingGitea ? giteaToken : githubToken;

  let baseURL = '';
  if (usingGitea) {
    const trimmedBaseUrl = String(giteaBase).replace(/\/+$/, '');
    baseURL = trimmedBaseUrl.endsWith('/api/v1') ? trimmedBaseUrl : `${trimmedBaseUrl}/api/v1`;
  } else if (githubApiUrl && githubToken) {
    baseURL = String(githubApiUrl).replace(/\/+$/, '');
  } else if (githubServerUrl && githubToken) {
    const trimmed = String(githubServerUrl).replace(/\/+$/, '');
    baseURL = trimmed.includes('github.com') ? 'https://api.github.com' : `${trimmed}/api/v3`;
  }

  if (!baseURL || !token) {
    throw new Error('Missing repository API configuration. Provide GITEA_BASE_URL/GITEA_TOKEN or GITHUB_API_URL/GITHUB_TOKEN.');
  }

  return axios.create({
    baseURL,
    headers: {
      Authorization: usingGitea ? `token ${token}` : `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

function parseRepoOwnerAndName(repository: string): { owner: string; repo: string } | null {
  const trimmed = String(repository ?? '').trim();
  if (!trimmed.includes('/')) {
    const owner = String(process.env.GITEA_OWNER ?? '').trim();
    const repo = String(process.env.GITEA_REPO ?? '').trim();
    return owner && repo ? { owner, repo } : null;
  }

  const [owner, repo] = trimmed.split('/', 2).map((value) => value.trim());
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function parsePercentValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const normalized = text.endsWith('%') ? text.slice(0, -1) : text;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed > 0 && parsed <= 1) {
    return Math.round(parsed * 10000) / 100;
  }

  return Math.round(parsed * 100) / 100;
}

function isHundredPercentGreen(payload: PlaywrightVerificationWebhookPayload, status: string): boolean {
  if (status !== 'PASSED') {
    return false;
  }

  const passRate = parsePercentValue(payload.passRate);
  if (passRate !== null) {
    return passRate >= 100;
  }

  const greenScore = parsePercentValue(payload.greenScore);
  if (greenScore !== null) {
    return greenScore >= 100;
  }

  const passed = Number(payload.testsPassed);
  const total = Number(payload.testsTotal);
  if (Number.isFinite(passed) && Number.isFinite(total) && total > 0) {
    return passed >= total;
  }

  return false;
}

async function promotePatchBranchToMain(args: {
  repository: string;
  branch: string;
  baseBranch: string;
  commitSha: string;
  verificationTag: string;
}): Promise<{ merged: boolean; pullRequestNumber: number | null; pullRequestUrl: string | null; detail: string }> {
  const repoInfo = parseRepoOwnerAndName(args.repository);
  if (!repoInfo) {
    return {
      merged: false,
      pullRequestNumber: null,
      pullRequestUrl: null,
      detail: 'Repository owner/name is missing. Provide payload.repository as owner/repo or set GITEA_OWNER and GITEA_REPO.',
    };
  }

  const gitea = getGiteaClient();
  const encodedOwner = encodeURIComponent(repoInfo.owner);
  const encodedRepo = encodeURIComponent(repoInfo.repo);

  let pullRequestNumber: number | null = null;
  let pullRequestUrl: string | null = null;

  try {
    const list = await gitea.get(`/repos/${encodedOwner}/${encodedRepo}/pulls`, {
      params: {
        state: 'open',
        head: `${repoInfo.owner}:${args.branch}`,
        base: args.baseBranch,
      },
    });
    const pulls = Array.isArray(list.data) ? list.data : [];
    if (pulls.length > 0) {
      const pr = pulls[0] as { number?: number; html_url?: string; url?: string };
      pullRequestNumber = Number(pr.number ?? NaN);
      pullRequestUrl = String(pr.html_url ?? pr.url ?? '') || null;
    }
  } catch {
    // Fall back to creating the PR if list query fails.
  }

  if (!pullRequestNumber || !Number.isFinite(pullRequestNumber)) {
    const createResponse = await gitea.post(`/repos/${encodedOwner}/${encodedRepo}/pulls`, {
      base: args.baseBranch,
      head: args.branch,
      title: `[AUTO-PROMOTE] ${args.branch} -> ${args.baseBranch}`,
      body: [
        'Automated production promotion after 100% green Playwright validation.',
        '',
        `Verification: ${args.verificationTag}`,
        `Commit: ${args.commitSha}`,
      ].join('\n'),
    });

    const created = createResponse.data as { number?: number; html_url?: string; url?: string };
    pullRequestNumber = Number(created.number ?? NaN);
    pullRequestUrl = String(created.html_url ?? created.url ?? '') || null;
  }

  if (!pullRequestNumber || !Number.isFinite(pullRequestNumber)) {
    return {
      merged: false,
      pullRequestNumber: null,
      pullRequestUrl,
      detail: 'Unable to resolve pull request number for auto-promotion.',
    };
  }

  try {
    await gitea.post(`/repos/${encodedOwner}/${encodedRepo}/pulls/${pullRequestNumber}/merge`, {
      Do: 'merge',
      delete_branch_after_merge: true,
      merge_title_field: `Auto-merge ${args.branch} after green Playwright sweep`,
      merge_message_field: 'Automated production promotion by Bob orchestrator.',
    });
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 405) {
      throw error;
    }

    await gitea.post(`/repos/${encodedOwner}/${encodedRepo}/pulls/${pullRequestNumber}/merge`, {});
  }

  return {
    merged: true,
    pullRequestNumber,
    pullRequestUrl,
    detail: 'Merged patch branch into production branch via automated promotion.',
  };
}

async function applyRailwayPromotionStamp(args: {
  repository: string;
  branch: string;
  commitSha: string;
  verificationTag: string;
  pullRequestNumber: number | null;
}): Promise<{ applied: boolean; detail: string }> {
  const projectId =
    process.env.RAILWAY_PROXY_PROJECT_ID ?? process.env.RAILWAY_PROJECT_ID ?? process.env.RAILWAY_CORE_PROJECT_ID ?? null;
  const environmentId =
    process.env.RAILWAY_ENVIRONMENT_ID ??
    process.env.RAILWAY_PRODUCTION_ENVIRONMENT_ID ??
    process.env.RAILWAY_PROXY_ENVIRONMENT_ID ??
    null;
  const serviceId =
    process.env.RAILWAY_SERVICE_ID ?? process.env.RAILWAY_BACKEND_SERVICE_ID ?? process.env.RAILWAY_PROXY_SERVICE_ID ?? null;

  if (!projectId || !environmentId || !serviceId) {
    return {
      applied: false,
      detail: 'Railway promotion stamp skipped; missing Railway identifiers.',
    };
  }

  try {
    await applyAgentPatch({
      projectId,
      environmentId,
      serviceId,
      variableName: 'BOB_LAST_AUTO_PROMOTION',
      variableValue: JSON.stringify({
        repository: args.repository,
        branch: args.branch,
        commitSha: args.commitSha,
        verificationTag: args.verificationTag,
        pullRequestNumber: args.pullRequestNumber,
        promotedAt: new Date().toISOString(),
      }),
    });

    return {
      applied: true,
      detail: 'Applied Railway promotion stamp.',
    };
  } catch (error) {
    return {
      applied: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
async function streamOllamaResponseToClient(
  res: Response,
  prompt: string,
  model = 'llama3:70b',
): Promise<string> {
  const baseUrl = process.env.OLLAMA_PROXY_URL ?? 'http://ollama:11434'
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  ;(res as any).flushHeaders?.()

  const ollamaResponse = await axios.post(
    `${baseUrl}/api/generate`,
    {
      model,
      prompt,
      stream: true,
    },
    {
      responseType: 'stream',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: OLLAMA_MODEL_TIMEOUT_MS,
    },
  )

  const stream = ollamaResponse.data as NodeJS.ReadableStream
  const decoder = new TextDecoder()
  let buffer = ''
  let collected = ''

  const writeEvent = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const handleChunk = (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      try {
        const parsed = JSON.parse(line) as { response?: string; done?: boolean }
        if (typeof parsed.response === 'string' && parsed.response.length > 0) {
          collected += parsed.response
          writeEvent({ type: 'token', token: parsed.response })
        }
        if (parsed.done) {
          writeEvent({ type: 'final', text: collected })
        }
      } catch (error) {
        console.warn('[/api/heal] Failed to parse Ollama stream chunk', error)
      }
    }
  }

  stream.on('data', handleChunk)

  const finish = async () => {
    if (buffer.trim().length > 0) {
      try {
        const parsed = JSON.parse(buffer.trim()) as { response?: string; done?: boolean }
        if (typeof parsed.response === 'string' && parsed.response.length > 0) {
          collected += parsed.response
          writeEvent({ type: 'token', token: parsed.response })
        }
        if (parsed.done) {
          writeEvent({ type: 'final', text: collected })
        }
      } catch (error) {
        console.warn('[/api/heal] Failed to parse trailing Ollama stream chunk', error)
      }
    }

    writeEvent({ type: 'done', text: collected })
    res.end()
    return collected
  }

  await withTimeout(
    once(stream, 'end') as Promise<[unknown]>,
    OLLAMA_STREAM_TIMEOUT_MS,
    'Ollama stream completion',
  )
  return finish()
}

async function getConsultativeReferenceRunbook(errorMessage: string, agent: string): Promise<string> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('system_documentation_library')
        .select('file_path,content,intent_keywords,priority,allowed_agents'),
    ),
    CHAT_CONTEXT_TIMEOUT_MS,
    'system_documentation_library select',
  ).catch((timeout) => {
    console.warn('[/api/heal] system_documentation_library timed out/failed', timeout);
    return { data: [], error: null } as { data: DocumentationLibraryRow[]; error: unknown };
  });

  if (error) {
    console.warn('[/api/heal] Failed to load system_documentation_library', error);
    return '';
  }

  const tokens = extractIntentTokens(errorMessage);
  const priorityScore: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const matched = ((data ?? []) as DocumentationLibraryRow[])
    .filter((row) => {
      const allowedAgents = row.allowed_agents ?? [];
      return allowedAgents.length === 0 || allowedAgents.includes(agent);
    })
    .map((row) => {
      const keywords = (row.intent_keywords ?? []).map((value) => value.toLowerCase());
      const matches = keywords.filter((keyword) => tokens.has(keyword)).length;
      return {
        ...row,
        matches,
        rank: priorityScore[row.priority ?? 'medium'] ?? 2,
      };
    })
    .filter((row) => row.matches > 0)
    .sort((a, b) => b.matches - a.matches || b.rank - a.rank)
    .slice(0, 2);

  if (matched.length === 0) {
    return 'No Tier B runbook matched the current error intent keywords.';
  }

  return matched
    .map((row, index) => {
      const body = truncateRunbookContent(row.content, 3500);
      return `[Runbook ${index + 1}] ${row.file_path}\n${body}`;
    })
    .join('\n\n');
}

function normalizeAgentRoles(input: unknown): Record<string, string> {
  if (!input) {
    return { ...DEFAULT_AGENT_ROLES };
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      return normalizeAgentRoles(parsed);
    } catch {
      return { ...DEFAULT_AGENT_ROLES };
    }
  }

  if (typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const merged = { ...DEFAULT_AGENT_ROLES };

    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && value.trim()) {
        merged[key] = value.trim();
      }
    }

    return merged;
  }

  return { ...DEFAULT_AGENT_ROLES };
}

function extractFirstUrl(rawText: string): string | null {
  const match = rawText.match(/https?:\/\/[^\s)]+/i);
  if (!match) {
    return null;
  }

  return match[0];
}

function parseInitiativeDecision(raw: string): InitiativeDecision {
  let parsed: InitiativePatchCandidate | null = null;
  try {
    parsed = JSON.parse(raw) as InitiativePatchCandidate;
  } catch {
    parsed = null;
  }

  const explanation = String(parsed?.explanation ?? '').trim();
  const targetFile = sanitizeFilePath(String(parsed?.targetFile ?? '').trim());
  const patchValue = String(parsed?.patchValue ?? '').trim();

  return {
    isObviousAutonomous: parsed?.isObviousAutonomous === true,
    explanation: explanation || 'No explanation provided by initiative engine.',
    targetFile,
    patchValue,
  };
}

function isSafeAutonomousInitiative(decision: InitiativeDecision): boolean {
  if (!decision.isObviousAutonomous) return false;
  if (!decision.targetFile || !decision.patchValue) return false;
  if (decision.patchValue.length > 12000) return false;

  // Restrict autonomous edits to documentation-like files.
  const normalized = decision.targetFile.toLowerCase();
  return (
    normalized.endsWith('.md') &&
    (normalized.startsWith('docs/') ||
      normalized.startsWith('knowledge_base/') ||
      normalized === 'bob_workflow_rules.md' ||
      normalized === 'staging.md' ||
      normalized === 'instruction_manual.md')
  );
}

async function executeAutonomousInitiativeFix(decision: InitiativeDecision): Promise<Record<string, unknown>> {
  const fullPath = path.resolve(REPO_ROOT, decision.targetFile);

  let existing = '';
  try {
    existing = await readFile(fullPath, 'utf8');
  } catch {
    existing = '';
  }

  const nextContent = [existing.trimEnd(), decision.patchValue.trim(), '']
    .filter((chunk) => chunk.length > 0)
    .join('\n\n');

  const branchSuffix = Date.now();
  const result = await executeGiteaProposePr({
    owner: process.env.GITEA_OWNER,
    repo: process.env.GITEA_REPO,
    baseBranch: process.env.GITEA_BASE_BRANCH ?? 'main',
    branchName: `ai-self-heal-initiative-${branchSuffix}`,
    title: `[INITIATIVE] ${decision.explanation.slice(0, 80)}`,
    body: [
      'Autonomous initiative patch proposed by Bob patrol sweep.',
      '',
      `Target file: ${decision.targetFile}`,
      `Reason: ${decision.explanation}`,
      '',
      'Policy: documentation-safe autonomous mode only.',
    ].join('\n'),
    commitMessage: `docs: proactive initiative update (${branchSuffix})`,
    files: [
      {
        path: decision.targetFile,
        content: nextContent,
      },
    ],
    dryRun: false,
  });

  return {
    statusCode: result.statusCode,
    status: result.body.status ?? 'UNKNOWN',
    branchName: result.body.branchName ?? null,
    pullRequestNumber: result.body.pullRequestNumber ?? null,
    pullRequestUrl: result.body.pullRequestUrl ?? null,
    error: result.body.error ?? null,
    targetFile: decision.targetFile,
  };
}

async function logProactiveProposalToLedger(decision: InitiativeDecision): Promise<Record<string, unknown>> {
  const issueTitle = `[PENDING_HUMAN_REVIEW] Proactive initiative proposal: ${decision.targetFile || 'unspecified target'}`;
  const issueBody = [
    'Bob patrol identified an initiative that requires human review.',
    '',
    `isObviousAutonomous: ${String(decision.isObviousAutonomous)}`,
    `targetFile: ${decision.targetFile || 'N/A'}`,
    `explanation: ${decision.explanation}`,
    '',
    'Proposed patch payload:',
    '```',
    decision.patchValue || '(empty)',
    '```',
  ].join('\n');

  const giteaIssueNumber = await createGiteaIssue(issueTitle, issueBody);

  await supabase.from('self_healing_logs').insert({
    status: 'PENDING_HUMAN_REVIEW',
    service_name: 'railway-backend',
    error_message: issueTitle,
    error_payload: {
      route: '/api/cron/patrol',
      proposal: decision,
      giteaIssueNumber,
      createdAt: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  } as Record<string, unknown>);

  return {
    giteaIssueNumber,
    status: 'PENDING_HUMAN_REVIEW',
  };
}

function buildPatrolReasoning(args: {
  decision: InitiativeDecision;
  dryRun: boolean;
  modelUsed: string;
  auth: AdminAuthContext | null;
  mutationAuthorized: boolean;
}): CognitiveReasoningResult {
  const { decision, dryRun, modelUsed, auth, mutationAuthorized } = args;
  const docsSafe = isSafeAutonomousInitiative(decision);
  const authRole = formatAuthRoleForPrompt(auth);
  const targetFile = decision.targetFile || 'unspecified target';
  const consultativeReasons: string[] = [];

  if (dryRun) {
    consultativeReasons.push('Dry-run mode prevented repository mutation.');
  }

  if (!docsSafe) {
    consultativeReasons.push('Candidate change is outside the documentation-safe autonomous boundary.');
  }

  if (docsSafe && !mutationAuthorized) {
    consultativeReasons.push('Repository mutation was blocked because no admin or grand-master bearer context was verified.');
  }

  const actionPayload: CognitiveActionPayload =
    !dryRun && docsSafe && mutationAuthorized
      ? {
          mode: 'gitea_propose_pr',
          giteaProposePr: {
            owner: process.env.GITEA_OWNER,
            repo: process.env.GITEA_REPO,
            baseBranch: process.env.GITEA_BASE_BRANCH ?? 'main',
            branchName: `ai-self-heal-initiative-${Date.now()}`,
            title: `[INITIATIVE] ${decision.explanation.slice(0, 80)}`,
            body: [
              'Autonomous initiative patch proposed by Bob patrol sweep.',
              '',
              `Target file: ${targetFile}`,
              `Reason: ${decision.explanation}`,
              '',
              'Policy: documentation-safe autonomous mode only.',
            ].join('\n'),
            commitMessage: `docs: proactive initiative update (${Date.now()})`,
            files: decision.targetFile && decision.patchValue
              ? [{ path: decision.targetFile, content: decision.patchValue }]
              : [],
            dryRun: false,
          },
        }
      : { mode: 'none', giteaProposePr: null };

  const riskAnalysis = dryRun
    ? 'Dry-run patrol execution intentionally avoided repository mutation; operational review only.'
    : docsSafe
      ? mutationAuthorized
        ? 'Low-risk documentation-scoped change candidate. Repository mutation is permitted only because an admin/grand-master bearer context was verified.'
        : 'Repository mutation is currently blocked. Shared automation token alone is insufficient for Gitea write operations.'
      : 'Candidate requires consultative review because the proposed change is not documentation-safe or lacks a complete mutation payload.';

  const rewardAnalysis = docsSafe
    ? `Patrol identified a narrow improvement path targeting ${targetFile}.`
    : `Patrol captured an improvement proposal for ${targetFile}, but it remains in consultative hold until a human validates scope and safety.`;

  const confidenceScore = dryRun ? 0.2 : docsSafe ? (mutationAuthorized ? 0.82 : 0.58) : 0.46;

  return {
    reasoningTrace: [
      `Patrol explanation: ${decision.explanation}`,
      `Model source: ${modelUsed}`,
      `Auth role: ${authRole}`,
      `Docs-safe autonomous candidate: ${docsSafe ? 'yes' : 'no'}`,
      `Mutation authorized: ${mutationAuthorized ? 'yes' : 'no'}`,
      consultativeReasons.length > 0 ? `Hold reasons: ${consultativeReasons.join(' | ')}` : 'No additional hold reasons.',
    ].join('\n'),
    intentContext: 'AUTONOMOUS_PATROL_SWEEP',
    riskAnalysis,
    rewardAnalysis,
    confidenceScore,
    isObviousAutonomous: decision.isObviousAutonomous && docsSafe && mutationAuthorized,
    actionPayload,
    consultativeResponse:
      consultativeReasons.join(' ') || 'Autonomous documentation-safe proposal is eligible for guarded execution.',
  };
}

async function getTierAKnowledgeContext(): Promise<TierAContext> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('system_knowledge_base')
        .select('schema_payload, system_rules, agent_roles')
        .eq('service_name', 'railway-backend')
        .maybeSingle(),
    ),
    CHAT_CONTEXT_TIMEOUT_MS,
    'system_knowledge_base select',
  ).catch((timeout) => {
    console.warn('[/api/heal] system_knowledge_base timed out/failed', timeout);
    return {
      data: {
        schema_payload: 'Unavailable',
        system_rules: 'Unavailable',
        agent_roles: DEFAULT_AGENT_ROLES,
      },
      error: null,
    } as {
      data: { schema_payload: string; system_rules: string; agent_roles: Record<string, string> };
      error: unknown;
    };
  });

  if (error) {
    console.warn('[/api/heal] Failed to load system_knowledge_base', error);
    return {
      schemaPayload: 'Unavailable',
      systemRules: 'Unavailable',
      agentRoles: { ...DEFAULT_AGENT_ROLES },
    };
  }

  const schemaPayload = String(data?.schema_payload ?? 'Unavailable');
  const systemRulesRaw = data?.system_rules;
  const systemRules =
    typeof systemRulesRaw === 'string'
      ? systemRulesRaw
      : Array.isArray(systemRulesRaw)
        ? systemRulesRaw.join('\n')
        : JSON.stringify(systemRulesRaw ?? 'Unavailable');

  return {
    schemaPayload: truncateRunbookContent(schemaPayload, 12000),
    systemRules: truncateRunbookContent(systemRules, 3000),
    agentRoles: normalizeAgentRoles(data?.agent_roles),
  };
}

async function executeMultiAgentAssemblyLine(args: {
  errorPayload?: unknown;
  errorMessage?: string;
}): Promise<MultiAgentAssemblyResult> {
  const { errorPayload, errorMessage } = args;

  const { data: templates, error: tplError } = await supabase
    .from('system_templates')
    .select('*');

  const { data: rules, error: rulesError } = await supabase
    .from('system_rules')
    .select('*');

  if (tplError || rulesError) {
    throw new Error('Failed to fetch system context from Supabase');
  }

  const contextSummary = JSON.stringify({ templates, rules });
  const errorString =
    errorMessage ??
    (typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload));
  const errorPayloadRecord =
    errorPayload && typeof errorPayload === 'object' ? (errorPayload as Record<string, unknown>) : {};
  const serviceName = String(errorPayloadRecord.route ?? errorPayloadRecord.tag ?? 'fieldops-backend');

  let giteaIssueNumber: number | null = null;
  try {
    const issueTitle = `[Bob Self-Heal] ${serviceName}: ${errorString.slice(0, 100)}`;
    const issueBody = [
      'Automated issue opened by Bob autonomous PM tracker.',
      '',
      `Service: ${serviceName}`,
      `Captured at: ${new Date().toISOString()}`,
      '',
      'Error details:',
      '```',
      errorString,
      '```',
      '',
      'Raw payload:',
      '```json',
      JSON.stringify(errorPayload ?? {}, null, 2),
      '```',
    ].join('\n');

    giteaIssueNumber = await createGiteaIssue(issueTitle, issueBody);
  } catch (error) {
    console.warn('[/api/heal] Failed to create Gitea issue', error);
  }

  const consultativeRunbook = await getConsultativeReferenceRunbook(errorString, 'dr_bob');

  const drBobAnalysis = await promptOllama(
    'Dr. Bob',
    `You are Dr. Bob, a senior adversarial code reviewer.
     Given the following Tier A system context: ${contextSummary}
     Consultative Reference Runbook:\n${consultativeRunbook}
     Identify the root cause of the error, distinguish symptoms from causes, and list the top risks.
     Reject shallow or temporary workaround recommendations.`,
    `Error payload: ${errorString}`
  );

  const bobPatch = await promptOllama(
    'Bob',
    `You are Bob, a senior site-reliability engineer.
     Dr. Bob's analysis: ${drBobAnalysis}
     System context: ${contextSummary}
     Propose a single environment-variable patch as JSON:
     { "variableName": string, "variableValue": string, "justification": string }
     Constraints:
     - The justification must explain the underlying root cause.
     - Do NOT propose temporary workarounds, bypasses, or cheap fixes.
     - Do NOT modify, disable, skip, or weaken tests or test-framework behavior.
     - If a root-cause-safe patch cannot be provided, return a justification saying so explicitly.`,
    `Error payload: ${errorString}`
  );

  let parsedPatch: { variableName: string; variableValue: string; justification: string };
  try {
    parsedPatch = JSON.parse(bobPatch);
  } catch {
    throw new Error(`Bob produced an unparseable patch: ${bobPatch}`);
  }

  const rootCausePolicy = evaluateRootCausePolicy({
    variableName: parsedPatch.variableName,
    variableValue: parsedPatch.variableValue,
    justification: parsedPatch.justification,
  });

  const testIntegrityPolicy = evaluateTestIntegrityPolicy({
    variableName: parsedPatch.variableName,
    variableValue: parsedPatch.variableValue,
    justification: parsedPatch.justification,
  });

  const policyReasons = [...rootCausePolicy.reasons, ...testIntegrityPolicy.reasons];

  if (!rootCausePolicy.ok || !testIntegrityPolicy.ok) {
    const reviewPayload = {
      ...errorPayloadRecord,
      giteaIssueNumber,
      policyGate: {
        gate: 'ROOT_CAUSE_ONLY',
        passed: false,
        reasons: policyReasons,
        checks: {
          rootCauseOnly: rootCausePolicy.ok,
          testIntegrity: testIntegrityPolicy.ok,
        },
      },
      candidatePatch: parsedPatch,
      capturedAt: new Date().toISOString(),
    };

    await persistSelfHealingLog({
      serviceName,
      errorMessage: errorString,
      payload: reviewPayload,
      status: 'BLOCKED_BY_POLICY',
    });

    await supabase.from('heal_patches').insert({
      status: 'BLOCKED_BY_POLICY',
      service_name: serviceName,
      error_message: errorString,
      target_variable: parsedPatch.variableName,
      patch_value: parsedPatch.variableValue,
      error_payload: reviewPayload,
      dr_bob_analysis: `${drBobAnalysis}\n\nPolicy block: ${policyReasons.join(' | ')}`,
      patch: {
        ...parsedPatch,
        giteaIssueNumber,
      },
      created_at: new Date().toISOString(),
    });

    throw new Error(`Patch rejected by root-cause policy gate: ${policyReasons.join(' | ')}`);
  }

  const safe = await runInSandboxEmulator(parsedPatch.variableValue, parsedPatch.variableName);
  const reviewPayload = {
    ...errorPayloadRecord,
    giteaIssueNumber,
    capturedAt: new Date().toISOString(),
  };

  await persistSelfHealingLog({
    serviceName,
    errorMessage: errorString,
    payload: reviewPayload,
    status: safe ? 'PENDING_HUMAN_REVIEW' : 'BLOCKED_BY_SANDBOX',
  });

  const { data: record, error: insertError } = await supabase
    .from('heal_patches')
    .insert({
      status: safe ? 'PENDING_HUMAN_REVIEW' : 'BLOCKED_BY_SANDBOX',
      service_name: serviceName,
      error_message: errorString,
      target_variable: parsedPatch.variableName,
      patch_value: parsedPatch.variableValue,
      error_payload: reviewPayload,
      dr_bob_analysis: drBobAnalysis,
      patch: {
        ...parsedPatch,
        giteaIssueNumber,
      },
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError || !record?.id) {
    throw new Error('Failed to save review record');
  }

  return {
    status: safe ? 'PENDING_HUMAN_REVIEW' : 'BLOCKED_BY_SANDBOX',
    patchId: String(record.id),
    patch: parsedPatch,
    drBobAnalysis,
    issueNumber: giteaIssueNumber,
  };
}

// ── POST /api/heal ───────────────────────────────────────────────────────────
//    Multi-agent assembly line:
//    1. Fetch system templates & rules from Supabase
//    2. Dr. Bob (critic) analyses the error
//    3. Bob (fixer) proposes a patch
//    4. Sandbox emulator validates the patch
//    5. Save PENDING_HUMAN_REVIEW record
app.post('/api/heal', requireUserAuth, async (req: Request, res: Response) => {
  const auth = (res.locals.auth ?? null) as AdminAuthContext | null;

  const { errorPayload, errorMessage } = req.body as {
    errorPayload?: unknown;
    errorMessage?: string;
    stackTrace?: string;
    userPrompt?: string;
    messages?: HealChatMessage[];
    stream?: boolean;
  };

  if (!errorPayload && !errorMessage) {
    res.status(400).json({ error: 'errorPayload or errorMessage is required' });
    return;
  }

  const isManualInstruction = errorMessage === 'MANUAL_USER_INSTRUCTION';
  if (!isManualInstruction && !auth?.isGrandMaster) {
    res.status(403).json({
      error: 'Forbidden. Bob maintenance actions require grand master privileges.',
    });
    return;
  }

  const stackTrace = (req.body as { stackTrace?: string }).stackTrace;
  const userPrompt = (req.body as { userPrompt?: string }).userPrompt;
  const sessionId = normalizeChatSessionId(
    (req.body as { sessionId?: string; session_id?: string }).sessionId ??
      (req.body as { sessionId?: string; session_id?: string }).session_id,
  );

  if (isManualInstruction) {
    const inboundText = (stackTrace ?? userPrompt ?? '').trim();
    const inboundTextLower = inboundText.toLowerCase();
    const requestMessageHistory: HealChatMessage[] = Array.isArray((req.body as { messages?: HealChatMessage[] }).messages)
      ? ((req.body as { messages?: HealChatMessage[] }).messages ?? [])
          .filter((message) => message && typeof message.content === 'string')
          .map((message): HealChatMessage => ({
            role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
            content: message.content,
          }))
      : [];

    if (!inboundText) {
      res.status(400).json({ error: 'stackTrace or userPrompt is required for MANUAL_USER_INSTRUCTION' });
      return;
    }

    await appendChatSessionMessage(sessionId, 'user', inboundText);

    const giteaCommand = tryParseGiteaPrCommand(inboundText);
    if (giteaCommand) {
      const result = await executeGiteaProposePr(giteaCommand);
      const bobResponse = formatGiteaProposeResultForBob(result);

      await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

      res.status(result.statusCode).json({
        bobResponse,
        status: String(result.body.status ?? (result.statusCode < 400 ? 'COMPLETED' : 'FAILED')),
        gitea: result.body,
        sessionId,
      });
      return;
    }

    const isSchemaAuditIntent = /executelivedatabaseschemaaudit|schema\s+audit|index\s+coverage|sorting?\s+hotspot|pg_catalog|pg_stat/i.test(
      inboundText,
    );
    if (isSchemaAuditIntent) {
      try {
        const schemaAudit = await executeLiveDatabaseSchemaAudit();
        const structuredPayload = {
          generatedAt: schemaAudit.generatedAt,
          source: schemaAudit.source,
          indexCoverageCandidates: schemaAudit.indexCoverageCandidates,
          sortHotspots: schemaAudit.sortHotspots,
          riskRewardMatrix: schemaAudit.riskRewardMatrix,
        };
        const bobResponse = JSON.stringify(structuredPayload, null, 2);

        await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

        res.status(200).json({
          bobResponse,
          status: 'SCHEMA_AUDIT_COMPLETE',
          sessionId,
          routeAgent: 'dr_bob',
          schemaAudit: structuredPayload,
          metadata: schemaAudit.metadata,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'schema audit failed';
        const degradedText = `Schema audit execution failed: ${message}`;
        await appendChatSessionMessage(sessionId, 'assistant', degradedText);

        res.status(200).json({
          bobResponse: degradedText,
          status: 'DEGRADED',
          sessionId,
          routeAgent: 'dr_bob',
        });
        return;
      }
    }

    const kb = await getTierAKnowledgeContext();
    const instructionManualText = await loadInstructionManualText();
    const patrolManualGuidance = extractInstructionManualGuidance(instructionManualText, inboundText, 2200);

    const isPatrolTestIntent = /\b(run|execute|perform)\b[\s\S]{0,80}\b(test|tests|check|checks|verification|validate)\b[\s\S]{0,80}\b(patrol|dispatch|route|response)\b/i.test(inboundTextLower)
      || /\bpatrol\s+system\s+tests?\b/i.test(inboundTextLower);
    if (isPatrolTestIntent) {
      const result = await runPatrolSystemChecks();
      const markdown = formatPatrolSystemTestMarkdown(result, patrolManualGuidance);
      const status = result.failed === 0 ? 'PATROL_TESTS_PASSED' : 'PATROL_TESTS_FAILED';

      await appendChatSessionMessage(sessionId, 'assistant', markdown);

      res.status(200).json({
        bobResponse: markdown,
        status,
        sessionId,
        routeAgent: 'research_agent',
        checks: result.checks,
      });
      return;
    }

    const isIntelIntent = /\b(report|alert|crime|noise|stolen|smoke|bylaw|situational|intel|intelligence|patrol|route|traffic|congestion|roadworks|closure|dispatch|deployment|response|incident\s*response)\b/i.test(inboundTextLower);
    if (isIntelIntent) {
      const query = inboundText.replace(/\b(report|alert|crime|noise|stolen|smoke|bylaw|situational|intel|intelligence)\b/gi, '').trim() || inboundText;
      const queryRedaction = redactSensitivePersonalData(query);
      const sanitizedQuery = PRIVACY_REDACTION_ENABLED ? queryRedaction.text : query;
      const allowExternalResearch = !PRIVACY_REDACTION_ENABLED || !queryRedaction.hasSensitiveData;
      const requestedUrl = extractFirstUrl(inboundText);
      const patrolRouteIntent = isPatrolRouteIntent(sanitizedQuery);
      const telemetry: HealProviderTelemetry = {
        routeEngineUsed: patrolRouteIntent ? 'local_deterministic' : 'model_synthesis',
        providersTried: [],
        providerErrors: [],
        externalCallsCount: 0,
        cacheHit: false,
        supportSignalsUsed: false,
      };
      const manualGuidance = extractInstructionManualGuidance(instructionManualText, sanitizedQuery, 2200);

      try {
        let liveWebData = 'External web research was not requested for this intent.';

        if (patrolRouteIntent) {
          const needsTrafficSignals = /\b(traffic|congestion|roadworks|closure|incident|detour|crash)\b/i.test(sanitizedQuery);
          const extractedWaypoints = extractCoordinateWaypoints(sanitizedQuery);
          const baseWaypoints = extractedWaypoints.length >= 2 ? extractedWaypoints : buildDefaultPatrolWaypoints();

          let routeSteps = baseWaypoints.map((point, index) => {
            const suffix = index === 0 ? ' (start)' : '';
            return `Stop ${index + 1}: ${point.label}${suffix} (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
          });
          let routeSource = 'inbuilt-patrol-route-engine';
          let googleSupportUsed = false;

          try {
            const selfHostedRoute = await fetchSelfHostedRoutePlan(baseWaypoints);
            routeSteps = selfHostedRoute.routeSteps;
            routeSource = selfHostedRoute.source;
            googleSupportUsed = selfHostedRoute.googleSupportUsed;
            telemetry.providersTried.push(routeSource);
            if (googleSupportUsed) {
              telemetry.providersTried.push('google_maps_support');
            }
            telemetry.externalCallsCount += 1;
            telemetry.supportSignalsUsed = telemetry.supportSignalsUsed || googleSupportUsed;
          } catch (mappingError) {
            telemetry.providerErrors.push(
              `self_hosted_mapping_failed: ${mappingError instanceof Error ? mappingError.message : 'unknown error'}`,
            );
          }

          if (allowExternalResearch && needsTrafficSignals) {
            try {
              const supportQuery = `${sanitizedQuery} nzta road closures traffic incidents official update`;
              liveWebData = await executeWebSearch(supportQuery);
              telemetry.externalCallsCount += 1;
              telemetry.supportSignalsUsed = Boolean(String(liveWebData ?? '').trim());

              const providerTelemetry = parseProviderTelemetryFromSearchOutput(liveWebData);
              telemetry.providersTried = providerTelemetry.providersTried;
              telemetry.providerErrors = providerTelemetry.providerErrors;
            } catch (searchError) {
              telemetry.providerErrors.push(
                `support_search_failed: ${searchError instanceof Error ? searchError.message : 'unknown error'}`,
              );
            }
          } else if (!allowExternalResearch) {
            telemetry.providerErrors.push('external_research_blocked: sensitive data policy');
          }

          const patrolIntel = buildDeterministicPatrolIntelReport(
            sanitizedQuery,
            liveWebData,
            routeSteps,
            routeSource,
            googleSupportUsed,
            manualGuidance,
          );
          const markdown = [
            formatPatrolRouteReportToMarkdown(patrolIntel, telemetry),
            '',
            '## Instruction Manual Alignment',
            manualGuidance,
          ].join('\n');
          const confidence = normalizeConfidenceValue(patrolIntel.confidence, 0.75);
          const risks = normalizeStringArray(patrolIntel.activeRisks);

          await supabase.from('ai_reasoning_ledger').insert({
            session_id: sessionId || 'SITUATIONAL_ALERT_CLOCK',
            intent_context: 'REGIONAL_RISK_AUDIT',
            hypothetical_risks: risks.join(' | ') || 'No explicit active risks returned.',
            projected_rewards: 'Stable patrol route continuity even during model/provider outages.',
            confidence_score: confidence,
            action_taken: 'RECOMMENDED_ONLY',
            metadata: {
              routeAgent: 'research_agent',
              status: 'INTEL_COMPLETE',
              routeEngineUsed: telemetry.routeEngineUsed,
              providersTried: telemetry.providersTried,
              providerErrors: telemetry.providerErrors,
              externalCallsCount: telemetry.externalCallsCount,
              supportSignalsUsed: telemetry.supportSignalsUsed,
              sensitiveDataDetected: queryRedaction.hasSensitiveData,
              redactedFields: queryRedaction.redactedFields,
            },
            created_at: new Date().toISOString(),
          } as Record<string, unknown>);

          await appendChatSessionMessage(sessionId, 'assistant', markdown);

          res.status(200).json({
            bobResponse: markdown,
            status: 'INTEL_COMPLETE',
            sessionId,
            routeAgent: 'research_agent',
            routeEngineUsed: telemetry.routeEngineUsed,
            intelReport: patrolIntel,
            telemetry,
            privacy: {
              redactionEnabled: PRIVACY_REDACTION_ENABLED,
              sensitiveDataDetected: queryRedaction.hasSensitiveData,
              redactedFields: queryRedaction.redactedFields,
              externalResearchUsed: allowExternalResearch,
            },
          });
          return;
        }

        const telemetryQuery = `${sanitizedQuery} local news police alerts noise control bylaws stolen vehicle registry`;
        if (allowExternalResearch) {
          liveWebData = await executeWebSearch(telemetryQuery);
          telemetry.externalCallsCount += 1;
          const providerTelemetry = parseProviderTelemetryFromSearchOutput(liveWebData);
          telemetry.providersTried = providerTelemetry.providersTried;
          telemetry.providerErrors = providerTelemetry.providerErrors;
          telemetry.supportSignalsUsed = Boolean(String(liveWebData ?? '').trim());
        } else {
          liveWebData = 'External web research skipped due to detected sensitive personal data.';
          telemetry.providerErrors.push('external_research_blocked: sensitive data policy');
        }

        let pageContent = '';
        if (requestedUrl && allowExternalResearch) {
          let hostname = '';
          try {
            hostname = new URL(requestedUrl).hostname;
          } catch {
            hostname = '';
          }

          if (hostname && isTrustedResearchDomain(hostname)) {
            pageContent = await fetchWebpageContent(requestedUrl).catch(() => '');
          }
        }

        const redactedWebData = PRIVACY_REDACTION_ENABLED
          ? redactSensitivePersonalData(liveWebData).text
          : liveWebData;
        const redactedPageContent = PRIVACY_REDACTION_ENABLED
          ? redactSensitivePersonalData(pageContent).text
          : pageContent;

        const intelPrompt = [
          `Role: ${kb.agentRoles.research_agent}`,
          'You are Bob\'s Intel Synthesis Core for field operations situational awareness.',
          `User request: ${sanitizedQuery}`,
          `Tier A system rules: ${kb.systemRules}`,
          `Instruction Manual guidance:\n${manualGuidance}`,
          'Analyze the provided live context and return JSON only with this shape:',
          '{',
          '  "summary": "string",',
          '  "activeRisks": ["string"],',
          '  "recommendedActions": ["string"],',
          '  "sources": ["string"],',
          '  "confidence": 0.0',
          '}',
          'Never include personal identifiers or precise private coordinates.',
          `Research snippets:\n${truncateRunbookContent(redactedWebData, 9000)}`,
          redactedPageContent
            ? `Fetched page content:\n${truncateRunbookContent(redactedPageContent, 5000)}`
            : 'No fetched page content included.',
        ].join('\n\n');

        const intelResult = await generateWithModelFallback('', intelPrompt);
        const parsedIntel = parseJsonObjectFromText(intelResult.responseText) ?? {
          summary: String(intelResult.responseText ?? '').trim() || 'No synthesis text was returned.',
          activeRisks: [],
          recommendedActions: [],
          sources: [],
          confidence: 0.65,
        };

        const markdown = formatIntelReportToMarkdown(parsedIntel);
        const confidence = normalizeConfidenceValue(parsedIntel.confidence, 0.7);
        const risks = normalizeStringArray(parsedIntel.activeRisks);

        await supabase.from('ai_reasoning_ledger').insert({
          session_id: sessionId || 'SITUATIONAL_ALERT_CLOCK',
          intent_context: 'REGIONAL_RISK_AUDIT',
          hypothetical_risks: risks.join(' | ') || 'No explicit active risks returned.',
          projected_rewards: 'Enhanced field situational awareness and safer operational planning.',
          confidence_score: confidence,
          action_taken: 'RECOMMENDED_ONLY',
          metadata: {
            routeAgent: 'research_agent',
            status: 'INTEL_COMPLETE',
            sensitiveDataDetected: queryRedaction.hasSensitiveData,
            redactedFields: queryRedaction.redactedFields,
          },
          created_at: new Date().toISOString(),
        } as Record<string, unknown>);

        await appendChatSessionMessage(sessionId, 'assistant', markdown);

        res.status(200).json({
          bobResponse: markdown,
          status: 'INTEL_COMPLETE',
          sessionId,
          routeAgent: 'research_agent',
          modelUsed: intelResult.modelUsed,
          intelReport: parsedIntel,
          telemetry,
          privacy: {
            redactionEnabled: PRIVACY_REDACTION_ENABLED,
            sensitiveDataDetected: queryRedaction.hasSensitiveData,
            redactedFields: queryRedaction.redactedFields,
            externalResearchUsed: allowExternalResearch,
          },
        });
        return;
      } catch (error) {
        console.error('[/api/heal] Intelligence synthesis route failed', error);
        const degradedText = 'Intelligence synthesis is temporarily unavailable. Retry after verifying research provider connectivity.';
        await appendChatSessionMessage(sessionId, 'assistant', degradedText);
        res.status(200).json({
          bobResponse: degradedText,
          status: 'DEGRADED',
          sessionId,
          routeAgent: 'research_agent',
          telemetry,
        });
        return;
      }
    }

    const isResearchIntent = /(\bsearch\b|\blookup\b|\bresearch\b|\bbreaking\s+changes\b|\brelease\s+notes\b)/i.test(inboundTextLower);
    if (isResearchIntent) {
      const query = inboundText.replace(/\b(search|lookup|research)\b/gi, '').trim() || inboundText;
      const requestedUrl = extractFirstUrl(inboundText);
      const queryRedaction = redactSensitivePersonalData(query);
      const sanitizedQuery = PRIVACY_REDACTION_ENABLED ? queryRedaction.text : query;
      const allowExternalResearch = !PRIVACY_REDACTION_ENABLED || !queryRedaction.hasSensitiveData;

      try {
        const docIntel = await loadDocumentIntelIndex();
        const internalMatches = docIntel.documents
          .filter((row) => {
            const haystack = [
              row.path,
              row.ext,
              row.category,
              row.textPreview,
              (row.topicTags ?? []).join(' '),
              (row.keywords ?? []).map((kw) => kw.keyword).join(' '),
            ]
              .join(' ')
              .toLowerCase();
            return haystack.includes(sanitizedQuery.toLowerCase());
          })
          .slice(0, 8)
          .map((row) => ({
            path: row.path,
            category: row.category,
            topicTags: row.topicTags,
            textPreview: PRIVACY_REDACTION_ENABLED ? redactSensitivePersonalData(row.textPreview).text : row.textPreview,
          }));

        const stagedQueries = buildPrioritizedResearchQueries(sanitizedQuery);

        let stagedSearchOutput = 'External web research skipped due to detected sensitive personal data.';
        if (allowExternalResearch) {
          const stageResponses: string[] = [];
          for (let index = 0; index < stagedQueries.length; index += 1) {
            const stageQuery = stagedQueries[index];
            const stageLabel = index === 0 ? 'Stage 1 (NZ/official local)' : 'Stage 2 (trusted official global docs)';

            try {
              const stageResult = await executeWebSearch(stageQuery);
              stageResponses.push(`${stageLabel}:\n${stageResult || 'No snippets returned.'}`);

              if (stageResult && stageResult.length >= 400) {
                break;
              }
            } catch (error) {
              stageResponses.push(`${stageLabel}: search failed (${error instanceof Error ? error.message : 'unknown error'})`);
            }
          }

          stagedSearchOutput = stageResponses.join('\n\n');
        }

        let pageContent = '';
        let pageFetchPolicyNote = 'No URL fetch requested.';
        if (requestedUrl && allowExternalResearch) {
          let hostname = '';
          try {
            hostname = new URL(requestedUrl).hostname;
          } catch {
            hostname = '';
          }

          if (hostname && !isTrustedResearchDomain(hostname)) {
            pageFetchPolicyNote = `URL fetch skipped: ${hostname} is not in trusted official research domains.`;
          } else {
            try {
              pageContent = await fetchWebpageContent(requestedUrl);
              pageFetchPolicyNote = `Fetched URL: ${requestedUrl}`;
            } catch (error) {
              pageFetchPolicyNote = `URL fetch skipped: ${error instanceof Error ? error.message : 'unknown error'}`;
            }
          }
        } else if (requestedUrl && !allowExternalResearch) {
          pageFetchPolicyNote = 'URL fetch skipped due to detected sensitive personal data in request.';
        }

        const redactedPageContent = PRIVACY_REDACTION_ENABLED
          ? redactSensitivePersonalData(pageContent).text
          : pageContent;

        const researchPrompt = [
          `Role: ${kb.agentRoles.research_agent}`,
          `User request: ${sanitizedQuery}`,
          `Privacy mode: NZ Privacy Act redaction ${PRIVACY_REDACTION_ENABLED ? 'ENABLED' : 'DISABLED'}`,
          `Sensitive data detected in request: ${queryRedaction.hasSensitiveData ? 'yes' : 'no'}`,
          queryRedaction.redactedFields.length > 0
            ? `Redacted fields: ${queryRedaction.redactedFields.join(', ')}`
            : 'Redacted fields: none',
          `Research strategy: NZ-focused trusted sources first, then trusted official global sources if needed.`,
          `Tier A system rules: ${kb.systemRules}`,
          `Internal document intelligence matches:\n${JSON.stringify(internalMatches, null, 2)}`,
          `Search snippets:\n${stagedSearchOutput || 'No search snippets returned.'}`,
          `${pageFetchPolicyNote}`,
          redactedPageContent ? `Fetched page content:\n${truncateRunbookContent(redactedPageContent, 5000)}` : 'No fetched page content included.',
          'Synthesize practical, actionable recommendations for this repository. Include concrete migration risk, exact next steps, and confidence caveats.',
          'Never output personal data. If uncertain, keep identifying details redacted.',
        ].join('\n\n');

        const researchResult = await generateWithModelFallback('', researchPrompt);
        const bobResponse = String(researchResult.responseText ?? '').trim() || 'Research complete, but no model response text was returned.';

        await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

        res.status(200).json({
          bobResponse,
          status: 'RESEARCH_COMPLETE',
          sessionId,
          routeAgent: 'research_agent',
          modelUsed: researchResult.modelUsed,
          privacy: {
            redactionEnabled: PRIVACY_REDACTION_ENABLED,
            sensitiveDataDetected: queryRedaction.hasSensitiveData,
            redactedFields: queryRedaction.redactedFields,
            externalResearchUsed: allowExternalResearch,
          },
        });
        return;
      } catch (error) {
        console.error('[/api/heal] Research agent route failed', error);
        const degradedText = 'Research agent could not complete the request. Check search provider/network settings and retry.';
        await appendChatSessionMessage(sessionId, 'assistant', degradedText);
        res.status(200).json({
          bobResponse: degradedText,
          status: 'DEGRADED',
          sessionId,
          routeAgent: 'research_agent',
        });
        return;
      }
    }

    const isUiIntent = /(\bdesign\b|\bstyle\b|\bcss\b|\bux\b|\bui\b|\btailwind\b|\blayout\b)/i.test(inboundTextLower);
    if (isUiIntent) {
      const uiRunbook = await getConsultativeReferenceRunbook(inboundText, 'ui_ux_agent');
      const uiPrompt = [
        `Role: ${kb.agentRoles.ui_ux_agent}`,
        `Task request: ${inboundText}`,
        `Tier A system rules:\n${kb.systemRules}`,
        `Tier B UI runbook context:\n${uiRunbook}`,
        'Return implementation-ready UI guidance for React/Tailwind with accessibility, responsive behavior, and specific component-level recommendations.',
      ].join('\n\n');

      try {
        const uiResult = await generateWithModelFallback('', uiPrompt);
        const bobResponse = String(uiResult.responseText ?? '').trim() || 'UI/UX analysis completed with no textual response.';
        await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

        res.status(200).json({
          bobResponse,
          status: 'UI_REVIEW_PENDING',
          sessionId,
          routeAgent: 'ui_ux_agent',
          modelUsed: uiResult.modelUsed,
        });
        return;
      } catch (error) {
        console.error('[/api/heal] UI/UX agent route failed', error);
        const degradedText = 'UI/UX agent is temporarily unavailable. Retry in a moment.';
        await appendChatSessionMessage(sessionId, 'assistant', degradedText);
        res.status(200).json({ bobResponse: degradedText, status: 'DEGRADED', sessionId, routeAgent: 'ui_ux_agent' });
        return;
      }
    }

    const isWriterIntent = /(\bdocument\b|\bdocs\b|\bmanual\b|\bstaging\.md\b|\binstruction_manual\.md\b|\brunbook\b)/i.test(inboundTextLower);
    if (isWriterIntent) {
      const writerRunbook = await getConsultativeReferenceRunbook(inboundText, 'writer_agent');
      const writerPrompt = [
        `Role: ${kb.agentRoles.writer_agent}`,
        `Task request: ${inboundText}`,
        `Tier A system rules:\n${kb.systemRules}`,
        `Tier B documentation runbook context:\n${writerRunbook}`,
        'Return a concise documentation delta with headings, exact target files, and proposed text blocks. Keep it production-ready and auditable.',
      ].join('\n\n');

      try {
        const writerResult = await generateWithModelFallback('', writerPrompt);
        const bobResponse = String(writerResult.responseText ?? '').trim() || 'Writer agent completed with no textual output.';
        await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

        res.status(200).json({
          bobResponse,
          status: 'DOC_DRAFT_READY',
          sessionId,
          routeAgent: 'writer_agent',
          modelUsed: writerResult.modelUsed,
        });
        return;
      } catch (error) {
        console.error('[/api/heal] Writer agent route failed', error);
        const degradedText = 'Writer agent is temporarily unavailable. Retry in a moment.';
        await appendChatSessionMessage(sessionId, 'assistant', degradedText);
        res.status(200).json({ bobResponse: degradedText, status: 'DEGRADED', sessionId, routeAgent: 'writer_agent' });
        return;
      }
    }

    console.log(`[CHAT INBOUND] Human user sent direct instruction to Bob: "${inboundText}"`);

    const [consultativeRunbook, persistedHistory] = await Promise.all([
      getConsultativeReferenceRunbook(inboundText, 'dr_bob'),
      loadRecentChatSessionMessages(sessionId, 10),
    ]);
    const historySource = persistedHistory.length > 0 ? persistedHistory : requestMessageHistory;
    const conversationTranscript = buildConversationTranscript(historySource);
    const promptHistoryJson = JSON.stringify(
      historySource.map((message) => ({ role: message.role, content: message.content })),
      null,
      2,
    );

    const cognitivePrompt = `
You are Bob's cognitive reasoning controller for an engineering command center.
The user states: "${inboundText}"

  Authenticated user login context:
  - userId: ${auth?.userId ?? 'unknown'}
  - role: ${formatAuthRoleForPrompt(auth)}

Conversation history:
${conversationTranscript}

Structured recent history array:
${promptHistoryJson}

Reference Blueprints (Tier A): ${kb.schemaPayload}
System Operational Rules: ${kb.systemRules}
Instruction Manual guidance (prioritize patrol, dispatch, route, response when relevant):
${extractInstructionManualGuidance(instructionManualText, inboundText, 1800)}

Consultative Reference Runbook (Tier B):
${consultativeRunbook}

Follow this policy:
1) Audit dependencies and operational impact.
2) Produce explicit risk and reward analysis.
3) Set isObviousAutonomous=true ONLY when risk is effectively zero and user intent is explicit.
4) If autonomous path is selected, provide a safe action payload for gitea propose-pr flow.
5) Use authenticated user login context for protected task execution; do not attempt anonymous or credential-bypass paths.

Return ONLY one JSON object with this schema:
{
  "reasoningTrace": "string",
  "intentContext": "string",
  "riskAnalysis": "string",
  "rewardAnalysis": "string",
  "confidenceScore": 0.00,
  "isObviousAutonomous": false,
  "actionPayload": {
    "mode": "none" | "gitea_propose_pr",
    "giteaProposePr": {
      "title": "string",
      "body": "string",
      "commitMessage": "string",
      "baseBranch": "main",
      "branchName": "patch/ai-self-heal-<slug>",
      "files": [{ "path": "string", "content": "string" }],
      "dryRun": false
    }
  },
  "consultativeResponse": "markdown string for human decision"
}

Strict formatting requirements:
- Output must be raw JSON only (no markdown code fences).
- Escape newline characters inside string values as \\n.
- Do not include trailing commas.
- Do not return plain text outside the JSON object.
`;

    if (shouldForcePerformanceMigrationMaterialization(inboundText, sessionId)) {
      const forcedCandidate: MaterializationCandidate = {
        path: 'supabase/migrations/20260524000004_bob_architect_performance_indices.sql',
        content: buildForcedPerformanceMigrationSql(),
        source: 'sql_fence',
      };
      const forcedResult = materializeCandidatesToDisk([forcedCandidate]);
      const forcedExecutionSummary = {
        mode: 'forced_materialization',
        executed: forcedResult.written.length > 0,
        outcome: forcedResult.written.length > 0 ? 'materialized' : 'skipped',
        materialization: {
          candidateCount: 1,
          writtenFiles: forcedResult.written,
          skipped: forcedResult.skipped,
        },
      };
      const forcedResponse = forcedResult.written.length > 0
        ? [
            '## Materialization',
            '',
            `Written files: ${forcedResult.written.join(', ')}`,
            '',
            'Deterministic fallback was applied before model generation to guarantee migration artifact output.',
          ].join('\n')
        : [
            '## Materialization',
            '',
            'Deterministic fallback attempted, but no files were written.',
          ].join('\n');

      await appendChatSessionMessage(sessionId, 'assistant', forcedResponse);

      res.status(200).json({
        bobResponse: forcedResponse,
        status: forcedResult.written.length > 0 ? 'MATERIALIZED_FALLBACK' : 'CONSULTATIVE_RECOMMENDATION',
        sessionId,
        reasoningTrace: 'FORCED_MATERIALIZATION_PATH: explicit migration target detected in manual instruction.',
        riskAnalysis: 'Low risk: writes one whitelisted migration path only.',
        rewardAnalysis: 'High reward: guarantees required artifact exists for rollout validation.',
        confidenceScore: 0.98,
        isObviousAutonomous: true,
        actionTaken: forcedResult.written.length > 0 ? 'AGENTIC_EXECUTED' : 'RECOMMENDED_ONLY',
        executionSummary: forcedExecutionSummary,
      });
      return;
    }

    let modelText = '';
    let modelUsed = '';
    try {
      const result = await generateWithModelFallback('', cognitivePrompt);
      modelText = result.responseText.trim();
      modelUsed = result.modelUsed;
    } catch (error) {
      console.error('[/api/heal] Cognitive generation failed', error);
      const upstreamMessage = error instanceof Error ? error.message : String(error);
      const degradedText = `Bob is temporarily unavailable (model upstream). ${upstreamMessage.slice(0, 280)}`;
      await appendChatSessionMessage(sessionId, 'assistant', degradedText);

      if (req.body.stream === true) {
        res.write(`data: ${JSON.stringify({ type: 'final', text: degradedText })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', text: degradedText })}\n\n`);
        res.end();
        return;
      }

      res.status(200).json({
        bobResponse: degradedText,
        status: 'DEGRADED',
        sessionId,
        reasoningTrace: `UPSTREAM_FAILURE: ${upstreamMessage.slice(0, 500)}`,
        upstreamError: upstreamMessage.slice(0, 500),
      });
      return;
    }

    console.log(`[/api/heal] Manual cognitive response generated via model ${modelUsed}`);
    const reasoning = normalizeCognitiveReasoningOutput(modelText, inboundText);

    let actionTaken: 'RECOMMENDED_ONLY' | 'AGENTIC_EXECUTED' = 'RECOMMENDED_ONLY';
    let executionSummary: Record<string, unknown> = {
      mode: reasoning.actionPayload.mode,
      executed: false,
      outcome: 'consultative',
    };
    let responseStatus = 'CONSULTATIVE_RECOMMENDATION';
    let bobResponse = formatCognitiveRiskRewardMarkdown(reasoning);

    if (reasoning.isObviousAutonomous && reasoning.actionPayload.mode === 'gitea_propose_pr' && reasoning.actionPayload.giteaProposePr) {
      const requestPayload: GiteaCreatePrRequest = {
        ...reasoning.actionPayload.giteaProposePr,
        branchName:
          reasoning.actionPayload.giteaProposePr.branchName ??
          `patch/ai-self-heal-${Date.now()}`,
        dryRun: false,
      };

      const proposeResult = await executeGiteaProposePr(requestPayload);
      actionTaken = proposeResult.statusCode < 400 ? 'AGENTIC_EXECUTED' : 'RECOMMENDED_ONLY';
      responseStatus = actionTaken === 'AGENTIC_EXECUTED' ? 'AGENTIC_EXECUTED' : 'AUTONOMOUS_ACTION_FAILED';
      executionSummary = {
        mode: 'gitea_propose_pr',
        executed: actionTaken === 'AGENTIC_EXECUTED',
        statusCode: proposeResult.statusCode,
        result: proposeResult.body,
      };

      const executionLine = formatGiteaProposeResultForBob(proposeResult);
      bobResponse = [
        '## Autonomous Execution Result',
        '',
        executionLine,
        '',
        formatCognitiveRiskRewardMarkdown(reasoning),
      ].join('\n');
    } else {
      const consultativeBody = reasoning.consultativeResponse || 'Recommendation held for human review based on risk/reward balance.';
      bobResponse = [
        formatCognitiveRiskRewardMarkdown(reasoning),
        '',
        '## Recommendation',
        consultativeBody,
      ].join('\n');
    }

    const materializationCandidates = extractMaterializationCandidates(modelText);
    let materializationResult = materializeCandidatesToDisk(materializationCandidates);
    if (materializationResult.written.length === 0 && shouldForcePerformanceMigrationMaterialization(inboundText, sessionId)) {
      const forcedCandidate: MaterializationCandidate = {
        path: 'supabase/migrations/20260524000004_bob_architect_performance_indices.sql',
        content: buildForcedPerformanceMigrationSql(),
        source: 'sql_fence',
      };
      const forcedResult = materializeCandidatesToDisk([forcedCandidate]);
      materializationResult = {
        written: [...materializationResult.written, ...forcedResult.written],
        skipped: [...materializationResult.skipped, ...forcedResult.skipped],
      };
    }
    executionSummary = {
      ...executionSummary,
      materialization: {
        candidateCount: materializationCandidates.length,
        writtenFiles: materializationResult.written,
        skipped: materializationResult.skipped,
      },
    };

    if (materializationResult.written.length > 0) {
      bobResponse = [
        bobResponse,
        '',
        '## Materialization',
        `Written files: ${materializationResult.written.join(', ')}`,
      ].join('\n');
    }

    await persistAiReasoningLedger({
      sessionId,
      reasoning,
      actionTaken,
      metadata: {
        modelUsed,
        inboundText,
        executionSummary,
      },
    });

    await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

    if (req.body.stream === true) {
      res.write(`data: ${JSON.stringify({ type: 'final', text: bobResponse })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', text: bobResponse })}\n\n`);
      res.end();
      return;
    }

    res.status(200).json({
      bobResponse,
      status: responseStatus,
      sessionId,
      reasoningTrace: reasoning.reasoningTrace,
      riskAnalysis: reasoning.riskAnalysis,
      rewardAnalysis: reasoning.rewardAnalysis,
      confidenceScore: reasoning.confidenceScore,
      isObviousAutonomous: reasoning.isObviousAutonomous,
      actionTaken,
      executionSummary,
    });
    return;
  }

  try {
    const result = await executeMultiAgentAssemblyLine({
      errorPayload,
      errorMessage,
    });

    res.json({
      status: result.status,
      patchId: result.patchId,
      patch: result.patch,
      drBobAnalysis: result.drBobAnalysis,
      issueNumber: result.issueNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/heal] assembly line failed', message);
    const status = message.includes('root-cause policy gate') ? 422 : 500;
    res.status(status).json({ error: message });
  }
});

// ── POST /api/approve-patch ──────────────────────────────────────────────────
//    Human tester override — applies the approved patch to Railway
app.post('/api/approve-patch', requireGrandMasterAuth, async (req: Request, res: Response) => {
  const { patchId, projectId, environmentId, serviceId } = req.body as {
    patchId: string;
    projectId: string;
    environmentId: string;
    serviceId: string;
  };

  if (!patchId || !projectId || !environmentId || !serviceId) {
    res.status(400).json({ error: 'patchId, projectId, environmentId, and serviceId are required' });
    return;
  }

  // Fetch the stored patch
  const { data: record, error: fetchError } = await supabase
    .from('heal_patches')
    .select('*')
    .eq('id', patchId)
    .eq('status', 'PENDING_HUMAN_REVIEW')
    .single();

  if (fetchError || !record) {
    res.status(404).json({ error: 'Patch not found or not in PENDING_HUMAN_REVIEW state' });
    return;
  }

  const { variableName, variableValue } = record.patch as {
    variableName: string;
    variableValue: string;
  };

  // Re-validate before live deployment
  const safe = await runInSandboxEmulator(variableValue, variableName);
  if (!safe) {
    await supabase
      .from('heal_patches')
      .update({ status: 'BLOCKED_BY_SANDBOX' })
      .eq('id', patchId);

    res.status(422).json({ error: 'Patch failed sandbox re-validation and was blocked' });
    return;
  }

  // Apply to Railway
  await applyAgentPatch({ projectId, environmentId, serviceId, variableName, variableValue });

  await supabase
    .from('heal_patches')
    .update({ status: 'DEPLOYED', deployed_at: new Date().toISOString() })
    .eq('id', patchId);

  const issueNumber =
    extractIssueNumberFromPayload(record.error_payload) ??
    extractIssueNumberFromPayload(record.patch);

  const pmFailures: string[] = [];

  if (issueNumber) {
    try {
      await closeGiteaIssue(issueNumber);
    } catch (error) {
      pmFailures.push(`closeGiteaIssue failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  try {
    await updateMarkdownTodo(`Patch ${patchId} deployment`);
  } catch (error) {
    pmFailures.push(`updateMarkdownTodo failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  res.json({
    status: 'DEPLOYED',
    patchId,
    variableName,
    giteaIssueNumber: issueNumber,
    pmSync: pmFailures.length === 0 ? 'COMPLETED' : 'PARTIAL_FAILURE',
    pmFailures,
  });
});

// ── POST /api/mobile/build-preview ──────────────────────────────────────────
//    Runs an EAS preview APK build from the backend runtime for grand master users.
app.post('/api/mobile/build-preview', requireGrandMasterAuth, async (req: Request, res: Response) => {
  const auth = await resolveAdminAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized. Valid bearer token required.' });
    return;
  }

  try {
    const result = await triggerPreviewApkBuild();

    await persistMobileBuildReviewRecord({
      initiatedBy: auth.userId,
      buildUrl: result.buildUrl,
      qrCodeUrl: result.qrCodeUrl,
      command: result.command,
      output: result.output,
    });

    res.status(202).json({
      status: 'PENDING_HUMAN_REVIEW',
      buildUrl: result.buildUrl,
      qrCodeUrl: result.qrCodeUrl,
      command: result.command,
      output: result.output,
    });
  } catch (error) {
    console.error('[/api/mobile/build-preview] EAS preview build failed', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to trigger EAS preview build',
    });
  }
});

// ── POST /api/mobile/ota-hotfix ────────────────────────────────────────────
//    Runs an EAS OTA hotfix update from the backend runtime for grand master users.
app.post('/api/mobile/ota-hotfix', requireGrandMasterAuth, async (req: Request, res: Response) => {
  const auth = await resolveAdminAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized. Valid bearer token required.' });
    return;
  }

  const message = String((req.body as { message?: unknown } | undefined)?.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const result = await triggerOtaHotfix(message);

    await persistMobileOtaReviewRecord({
      initiatedBy: auth.userId,
      message,
      command: result.command,
      output: result.output,
      buildUrl: result.buildUrl,
      qrCodeUrl: result.qrCodeUrl,
    });

    res.status(202).json({
      status: 'PENDING_HUMAN_REVIEW',
      message,
      command: result.command,
      output: result.output,
      buildUrl: result.buildUrl,
      qrCodeUrl: result.qrCodeUrl,
    });
  } catch (error) {
    console.error('[/api/mobile/ota-hotfix] EAS OTA update failed', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to trigger EAS OTA hotfix',
    });
  }
});

// ── GET /api/bob/audit-trail ───────────────────────────────────────────────
//    Returns recent autonomous self-heal and PM trail records for grand master review.
app.get('/api/bob/audit-trail', requireGrandMasterAuth, async (req: Request, res: Response) => {
  const requested = Number(req.query.limit ?? 25);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 200) : 25;

  const [patchesResult, selfHealingResult] = await Promise.all([
    supabase
      .from('heal_patches')
      .select(
        'id, status, service_name, error_message, target_variable, patch_value, error_payload, patch, dr_bob_analysis, created_at, deployed_at, reviewed_at, reviewed_by',
      )
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('self_healing_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (patchesResult.error || selfHealingResult.error) {
    console.error('[/api/bob/audit-trail] Failed to load audit trail', patchesResult.error ?? selfHealingResult.error);
    res.status(500).json({ error: 'Failed to load Bob audit trail' });
    return;
  }

  const patchRows = (patchesResult.data ?? []) as Array<Record<string, unknown>>;
  const selfHealingRows = (selfHealingResult.data ?? []) as Array<Record<string, unknown>>;

  const normalizedPatches = patchRows.map((row) => {
    const payload = row.error_payload;
    const patch = row.patch;
    return {
      ...row,
      giteaIssueNumber: extractIssueNumberFromPayload(payload) ?? extractIssueNumberFromPayload(patch),
      policyGate: payload && typeof payload === 'object' ? (payload as Record<string, unknown>).policyGate ?? null : null,
    };
  });

  const normalizedSelfHealing = selfHealingRows.map((row) => {
    const payload = row.error_payload;
    return {
      ...row,
      giteaIssueNumber: extractIssueNumberFromPayload(payload),
      policyGate: payload && typeof payload === 'object' ? (payload as Record<string, unknown>).policyGate ?? null : null,
    };
  });

  res.status(200).json({
    status: 'OK',
    limit,
    generatedAt: new Date().toISOString(),
    healPatches: normalizedPatches,
    selfHealingLogs: normalizedSelfHealing,
  });
});

// ── POST /api/gitea/propose-pr ──────────────────────────────────────────────
//    Constrained repo writer:
//    1. Create a branch from base branch
//    2. Write one or more files via Gitea Contents API
//    3. Open a pull request
app.post('/api/gitea/propose-pr', requireAdminAuth, async (req: Request, res: Response) => {
  const payload = (req.body ?? {}) as GiteaCreatePrRequest;
  const result = await executeGiteaProposePr(payload);
  res.status(result.statusCode).json(result.body);
});

// ── POST /api/gitea-webhook ───────────────────────────────────────────────
//    Handles Gitea push/pull_request notifications and asynchronously
//    triggers training sync to refresh Bob context.
app.post('/api/gitea-webhook', (req: Request, res: Response) => {
  const verification = verifyGiteaWebhookSignature(req);
  if (!verification.ok) {
    res.status(401).json({ error: verification.reason });
    return;
  }

  const eventHeader = req.headers['x-gitea-event'];
  const event = String(Array.isArray(eventHeader) ? eventHeader[0] : eventHeader ?? '').toLowerCase();

  if (event !== 'push' && event !== 'pull_request') {
    res.status(202).json({ status: 'ignored', event: event || 'unknown' });
    return;
  }

  const body = (req.body ?? {}) as {
    ref?: string;
    repository?: { full_name?: string };
    pull_request?: { head?: { ref?: string } };
  };

  const repo = String(body.repository?.full_name ?? 'unknown');
  const ref = String(body.ref ?? body.pull_request?.head?.ref ?? '');
  const source = `gitea:${event}:${repo}:${ref}`;

  triggerTrainingSync(source);

  res.status(202).json({ status: 'accepted', event, repo, ref, trigger: source });
});

app.post('/api/automation/telemetry-triage', requireAdminAuth, async (req: Request, res: Response) => {
  const allowedLayers = new Set<TelemetrySourceLayer>([
    'SUPABASE_SCHEMA',
    'API_CONTRACT',
    'CONTAINER_METRICS',
    'CORS_POLICY',
    'ENV_VARS',
  ]);

  const body = (req.body ?? {}) as {
    source_layer?: string;
    sourceLayer?: string;
    error_signature?: string;
    errorSignature?: string;
    payload_snapshot?: unknown;
    payloadSnapshot?: unknown;
    errorMessage?: string;
  };

  const sourceLayer = String(body.source_layer ?? body.sourceLayer ?? '').trim().toUpperCase() as TelemetrySourceLayer;
  const errorSignature = String(body.error_signature ?? body.errorSignature ?? '').trim();
  const payloadSnapshot = body.payload_snapshot ?? body.payloadSnapshot ?? {};
  const errorMessage = String(body.errorMessage ?? '').trim();

  if (!allowedLayers.has(sourceLayer)) {
    res.status(400).json({
      error:
        'Invalid source_layer. Allowed values: SUPABASE_SCHEMA, API_CONTRACT, CONTAINER_METRICS, CORS_POLICY, ENV_VARS.',
    });
    return;
  }

  if (!errorSignature) {
    res.status(400).json({ error: 'error_signature is required.' });
    return;
  }

  const { data: telemetryLog, error: telemetryInsertError } = await supabase
    .from('system_telemetry_logs')
    .insert({
      source_layer: sourceLayer,
      error_signature: errorSignature,
      payload_snapshot: payloadSnapshot,
    })
    .select('id, created_at, source_layer, error_signature')
    .single();

  if (telemetryInsertError || !telemetryLog?.id) {
    console.error('[/api/automation/telemetry-triage] failed to persist telemetry log', telemetryInsertError);
    res.status(500).json({ error: 'Failed to persist telemetry log entry.' });
    return;
  }

  const assemblyPayload = {
    route: '/api/automation/telemetry-triage',
    telemetryLogId: telemetryLog.id,
    sourceLayer,
    errorSignature,
    payloadSnapshot,
  };

  try {
    const assembly = await executeMultiAgentAssemblyLine({
      errorPayload: assemblyPayload,
      errorMessage: errorMessage || `Telemetry triage ${sourceLayer}: ${errorSignature}`,
    });

    res.status(200).json({
      status: 'ACCEPTED_AND_TRIAGED',
      telemetryLog,
      assemblyLine: assembly,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/automation/telemetry-triage] assembly line failed', message);
    res.status(500).json({
      status: 'TELEMETRY_LOGGED_TRIAGE_FAILED',
      telemetryLog,
      error: message,
    });
  }
});

app.post('/api/automation/ux-audit', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  console.log('[UI/UX INITIATIVE] Bob is launching an advanced Cognitive Design review pass...');

  const { sessionSteps, currentScreen, sessionId } = (req.body ?? {}) as {
    sessionSteps?: any[];
    currentScreen?: string;
    sessionId?: string;
  };

  if (!Array.isArray(sessionSteps)) {
    res.status(400).json({ error: 'sessionSteps array is required.' });
    return;
  }

  try {
    const designAnalysis = await evaluateUserJourneyPracticality(sessionSteps, {
      currentScreen,
      sessionId,
    });

    console.log(
      `[UX REASONING LOGGED] Bob completed review for screen: ${designAnalysis.target_screen}. Score: ${designAnalysis.ux_practicality_score}`
    );

    res.status(202).json({
      status: 'Cognitive UI/UX design sweep engaged.',
      analysis: designAnalysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CRITICAL] Bob design audit loop failed:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/automation/deep-system-audit', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  console.log('[DEEP-SYSTEM INITIATIVE] Bob is launching an all-hands structural ecosystem audit...');

  const body = (req.body ?? {}) as { sessionId?: string; session_id?: string };
  const sessionId = normalizeChatSessionId(body.sessionId ?? body.session_id ?? `pre-beta-all-hands-${Date.now()}`);

  res.status(202).json({
    status: 'Deep system master sweep engaged.',
    sessionId,
  });

  void (async () => {
    try {
      const instructionManualText = await loadInstructionManualText();
      const documentationState = extractDeepSystemDocumentationState(instructionManualText);
      const protocolPatch = await upsertUnifiedDeepSystemProtocol();
      const storageSnapshot = await auditSupabaseStorageBuckets();

      const { data: frictionLogs, error: frictionError } = await (supabase as any)
        .from('ui_ux_friction_ledger')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (frictionError) {
        throw new Error(`Failed to load ui_ux_friction_ledger: ${String(frictionError.message || frictionError)}`);
      }

      const reportMarkdown = buildDeepSystemAuditMarkdownReport({
        sessionId,
        protocolPatch,
        documentation: documentationState,
        storageSnapshot,
        frictionLogs: Array.isArray(frictionLogs) ? frictionLogs : [],
      });

      const metadata = {
        source: 'deep-system-audit',
        sessionId,
        protocolPatch,
        storageSnapshot,
        frictionSampleCount: Array.isArray(frictionLogs) ? frictionLogs.length : 0,
        reportMarkdown,
      };

      const { error: ledgerError } = await (supabase as any)
        .from('ai_reasoning_ledger')
        .insert({
          session_id: sessionId,
          intent_context: 'UNIFIED_DEEP_SYSTEM_AUDIT',
          hypothetical_risks: 'Cross-layer anomalies may impact onboarding, media integrity, and field operations UX.',
          projected_rewards: 'Unified diagnostics increase pre-beta confidence while preserving manual governance sign-off.',
          confidence_score: 0.88,
          action_taken: 'PENDING_HUMAN_REVIEW',
          metadata,
          created_at: new Date().toISOString(),
        });

      if (ledgerError) {
        throw new Error(`Failed to persist deep-system report: ${String(ledgerError.message || ledgerError)}`);
      }

      await appendChatSessionMessage(sessionId, 'assistant', reportMarkdown);

      console.log('[DEEP-SYSTEM] Deep-system audit completed and report persisted for review.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CRITICAL] Deep system audit pass dropped:', message);

      await (supabase as any).from('self_healing_logs').insert({
        status: 'PENDING_HUMAN_REVIEW',
        service_name: 'railway-backend',
        error_message: '[DEEP-SYSTEM] Audit execution failed; manual intervention required.',
        error_payload: {
          route: '/api/automation/deep-system-audit',
          sessionId,
          reason: message,
        },
        created_at: new Date().toISOString(),
      }).catch(() => {
        // Keep deep-system failures non-fatal for the async handler.
      });
    }
  })();
});
// ── POST /api/automation/playwright-result ────────────────────────────────
//    Receives webhook-driven Playwright gate outcomes and writes them into
//    self_healing_logs for approval panel visibility.
app.post('/api/automation/playwright-result', async (req: Request, res: Response) => {
  if (!hasAutomationToken(req)) {
    res.status(401).json({ error: 'Unauthorized automation webhook token.' });
    return;
  }

  const payload = (req.body ?? {}) as PlaywrightVerificationWebhookPayload;
  const status = toShortString(payload.status, 'FAILED').toUpperCase();
  let verificationTag = toShortString(payload.verificationTag, 'Playwright Browser Verification: UNKNOWN');
  let managerStatus =
    status === 'PASSED'
      ? 'PENDING_HUMAN_REVIEW'
      : toShortString(payload.managerStatus, 'ORCHESTRATOR_CRASHED').toUpperCase();

  const repository = toShortString(payload.repository, 'unknown');
  const ref = toShortString(payload.ref, 'unknown');
  const branch = toShortString(payload.branch, 'unknown');
  const eventName = toShortString(payload.eventName, 'push');
  const commitSha = toShortString(payload.commitSha, 'unknown');
  const command = toShortString(payload.command, 'MOCK_MODE=true npx playwright test --config playwright.config.ts');
  const output = truncateTail(payload.output, 120000);
  const capturedAt = toShortString(payload.capturedAt, new Date().toISOString());
  const logId = parseLogId(payload.logId);
  const isPatchBranch = branch.startsWith('patch/ai-self-heal-');
  const isPerfectGreen = isHundredPercentGreen(payload, status);
  const autoPromoteEnabled = parseBool(process.env.AUTO_PROMOTE_GREEN_PLAYWRIGHT ?? 'true');
  const promotionBaseBranch = String(process.env.AUTO_PROMOTE_BASE_BRANCH ?? 'main').trim() || 'main';
  const maxRecoveryAttempts = parsePositiveIntOrFallback(process.env.PLAYWRIGHT_RECOVERY_MAX_ATTEMPTS, 3);
  const attemptCount = parsePositiveIntOrFallback(payload.recoveryAttempt ?? payload.retryCount, 1);
  const recoverySummary: {
    attempted: boolean;
    fixturesInjected: boolean;
    rerunTriggered: boolean;
    reason: string | null;
    attemptCount: number;
    maxAttempts: number;
    escalatedToBugReport: boolean;
  } = {
    attempted: false,
    fixturesInjected: false,
    rerunTriggered: false,
    reason: null,
    attemptCount,
    maxAttempts: maxRecoveryAttempts,
    escalatedToBugReport: false,
  };

  let promotionSummary: Record<string, unknown> | null = null;
  if (autoPromoteEnabled && isPatchBranch && isPerfectGreen) {
    try {
      const promoted = await promotePatchBranchToMain({
        repository,
        branch,
        baseBranch: promotionBaseBranch,
        commitSha,
        verificationTag,
      });

      let railwayPromotion: { applied: boolean; detail: string } | null = null;
      if (promoted.merged) {
        managerStatus = 'RESOLVED_AND_DEPLOYED';
        verificationTag = `${verificationTag} | Automated Production Promotion: PASSED via 100% Green Playwright Sweep`;
        railwayPromotion = await applyRailwayPromotionStamp({
          repository,
          branch,
          commitSha,
          verificationTag,
          pullRequestNumber: promoted.pullRequestNumber,
        });
      }

      promotionSummary = {
        enabled: true,
        branchMatched: true,
        perfectGreen: true,
        merged: promoted.merged,
        baseBranch: promotionBaseBranch,
        pullRequestNumber: promoted.pullRequestNumber,
        pullRequestUrl: promoted.pullRequestUrl,
        detail: promoted.detail,
        railwayPromotion,
      };
    } catch (error) {
      managerStatus = 'ORCHESTRATOR_CRASHED';
      const detail = error instanceof Error ? error.message : String(error);
      promotionSummary = {
        enabled: true,
        branchMatched: true,
        perfectGreen: true,
        merged: false,
        baseBranch: promotionBaseBranch,
        detail,
      };
    }
  } else {
    promotionSummary = {
      enabled: autoPromoteEnabled,
      branchMatched: isPatchBranch,
      perfectGreen: isPerfectGreen,
      merged: false,
      baseBranch: promotionBaseBranch,
      detail: 'Auto-promotion not executed for this payload.',
    };
  }

  if (status !== 'PASSED') {
    recoverySummary.attempted = true;

    try {
      const fixturesInjected = await orchestrateMissingTestFixtures(output);
      recoverySummary.fixturesInjected = fixturesInjected;

      if (fixturesInjected) {
        const canRetry = attemptCount < maxRecoveryAttempts;
        const rerunTriggered = canRetry ? triggerPlaywrightRecoveryRerun(branch) : false;
        recoverySummary.rerunTriggered = rerunTriggered;
        managerStatus = rerunTriggered ? 'RECOVERY_RETRY_TRIGGERED' : 'PENDING_HUMAN_REVIEW';
        verificationTag = `${verificationTag} | Fixture Recovery: ${rerunTriggered ? 'INJECTED_AND_RERUN' : 'INJECTED'}`;
        recoverySummary.reason = rerunTriggered
          ? 'Detected missing test fixture context and triggered autonomous playwright rerun.'
          : canRetry
            ? 'Detected missing test fixture context and injected recovery fixtures.'
            : `Maximum recovery attempts reached (${maxRecoveryAttempts}); escalating to bug reports.`;
      } else {
        recoverySummary.reason = 'No recognized missing fixture signatures found in failure output.';
      }
    } catch (error) {
      recoverySummary.reason = `Fixture orchestration failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  let giteaIssueNumber: number | null = null;
  const shouldOpenIssue =
    status !== 'PASSED' && !recoverySummary.fixturesInjected
      ? true
      : managerStatus === 'ORCHESTRATOR_CRASHED';

  if (shouldOpenIssue) {
    const issueTitle = '[ORCHESTRATOR_CRASHED] Playwright browser verification failed';
    const issueBody = [
      'Automated issue opened by the webhook Playwright gate.',
      '',
      `Verification Tag: ${verificationTag}`,
      `Manager Status: ${managerStatus}`,
      `Repository: ${repository}`,
      `Ref: ${ref}`,
      `Branch: ${branch}`,
      `Commit: ${commitSha}`,
      `Event: ${eventName}`,
      `Command: ${command}`,
      `Captured At: ${capturedAt}`,
      `Promotion Summary: ${JSON.stringify(promotionSummary ?? {})}`,
      `Recovery Summary: ${JSON.stringify(recoverySummary)}`,
      '',
      'Raw Playwright output:',
      '```',
      output || '[No output captured]',
      '```',
    ].join('\n');

    try {
      giteaIssueNumber = await createGiteaIssue(issueTitle, issueBody);
    } catch (error) {
      console.warn('[/api/automation/playwright-result] Failed to create Gitea issue', error);
    }
  }

  let bugReportId: string | null = null;
  const shouldEscalateToBugReport =
    status !== 'PASSED' &&
    (!recoverySummary.rerunTriggered || attemptCount >= maxRecoveryAttempts || managerStatus === 'ORCHESTRATOR_CRASHED');

  if (shouldEscalateToBugReport) {
    bugReportId = await upsertPlaywrightFailureBugReport({
      repository,
      branch,
      verificationTag,
      output,
      command,
      managerStatus,
      recoverySummary,
      attemptCount,
    });
    recoverySummary.escalatedToBugReport = Boolean(bugReportId);
  }

  const nowIso = new Date().toISOString();
  const isMissingSelfHealingLogsTable = (error: unknown): boolean => {
    const errorCode = String((error as { code?: unknown } | null)?.code ?? '');
    const errorMessage = String((error as { message?: unknown } | null)?.message ?? '');
    const combined = `${errorCode} ${errorMessage}`.toLowerCase();
    return combined.includes('self_healing_logs') && (combined.includes('schema cache') || errorCode === 'PGRST205');
  };
  const recordPayload = {
    route: '/api/automation/playwright-result',
    gate: 'PLAYWRIGHT_BROWSER_VERIFICATION',
    verificationTag,
    managerStatus,
    eventName,
    repository,
    ref,
    branch,
    commitSha,
    command,
    output,
    passRate: parsePercentValue(payload.passRate),
    greenScore: parsePercentValue(payload.greenScore),
    testsPassed: Number(payload.testsPassed),
    testsTotal: Number(payload.testsTotal),
    autoPromotion: promotionSummary,
    recoverySummary,
    giteaIssueNumber,
    bugReportId,
    capturedAt,
    recordedAt: nowIso,
  };

  if (logId) {
    const { error: updateError } = await supabase
      .from('self_healing_logs')
      .update({
        status: managerStatus,
        service_name: 'webhook-orchestrator',
        error_message: verificationTag,
        error_payload: recordPayload,
      } as Record<string, unknown>)
      .eq('id', logId);

    if (!updateError) {
      res.status(200).json({
        ok: true,
        status: managerStatus,
        verificationTag,
        persistedId: logId,
        giteaIssueNumber,
        bugReportId,
        autoPromotion: promotionSummary,
        persistenceTarget: 'self_healing_logs',
      });
      return;
    }

    console.warn('[/api/automation/playwright-result] Failed to update self_healing_logs by logId, inserting new row', updateError);
  }

  const { data: inserted, error: insertError } = await supabase
    .from('self_healing_logs')
    .insert({
      status: managerStatus,
      service_name: 'webhook-orchestrator',
      error_message: verificationTag,
      error_payload: recordPayload,
      created_at: nowIso,
    } as Record<string, unknown>)
    .select('id')
    .single();

  let persistedId: unknown = inserted?.id ?? null;
  let persistenceTarget = 'self_healing_logs';

  if (insertError) {
    if (!isMissingSelfHealingLogsTable(insertError)) {
      console.error('[/api/automation/playwright-result] Failed to persist Playwright verification result', insertError);
      res.status(500).json({ error: 'Failed to persist Playwright verification result' });
      return;
    }

    const fallbackPayload = {
      source: 'github_actions',
      environment: String(process.env.NODE_ENV ?? process.env.APP_ENV ?? 'production'),
      error_summary: verificationTag,
      error_detail: recordPayload,
      error_fingerprint: `playwright:${repository}:${branch}`,
      triage_tier: status === 'PASSED' ? 1 : 2,
      ai_analysis: 'Webhook Playwright verification ingestion fallback ledger entry.',
      fix_branch: isPatchBranch ? branch : null,
      fix_pr_number: null,
      fix_pr_url: null,
      outcome: managerStatus === 'RESOLVED_AND_DEPLOYED' ? 'merged' : status === 'PASSED' ? 'pending' : 'human_required',
      resolved_at: managerStatus === 'RESOLVED_AND_DEPLOYED' ? nowIso : null,
      rollback_commit: null,
      recurrence_count: 1,
      recurrence_window_minutes: 10,
      org_id: null,
      created_at: nowIso,
    } as Record<string, unknown>;

    const { data: fallbackInserted, error: fallbackError } = await supabase
      .from('self_heal_events')
      .insert(fallbackPayload)
      .select('id')
      .single();

    if (fallbackError) {
      console.error('[/api/automation/playwright-result] Failed to persist Playwright verification result', fallbackError);
      res.status(500).json({ error: 'Failed to persist Playwright verification result' });
      return;
    }

    persistedId = fallbackInserted?.id ?? null;
    persistenceTarget = 'self_heal_events';
  }

  res.status(200).json({
    ok: true,
    status: managerStatus,
    verificationTag,
    persistedId,
    giteaIssueNumber,
    bugReportId,
    autoPromotion: promotionSummary,
    persistenceTarget,
  });
});

// ── POST /api/cron/patrol ───────────────────────────────────────────────────
//    Proactive initiative sweep endpoint intended for scheduler/cron triggers.
app.post('/api/cron/patrol', async (req: Request, res: Response): Promise<void> => {
  if (!hasAutomationToken(req)) {
    res.status(401).json({ error: 'Unauthorized automation webhook token.' });
    return;
  }

  console.log('[INITIATIVE] Bob is launching an autonomous System Patrol sweep...');

  try {
    const requestDryRun = parseBool(String((req.body as { dryRun?: unknown })?.dryRun ?? 'false'));
    const dryRun = requestDryRun || PATROL_DRY_RUN_DEFAULT;
    const auth = await resolveAdminAuth(req);
    const mutationAuthorized = Boolean(auth?.isAdmin || auth?.isGrandMaster);
    const patrolSessionId = `cron-patrol:${Date.now()}`;

    const kb = await getTierAKnowledgeContext();
    const patrolPrompt = [
      'You are Bob, the Serverless Fleet Chief Engineer. Run a proactive repository/system scan.',
      'Follow the AUTONOMY INITIATIVE PROTOCOL and return strict JSON only.',
      'Evaluate the finding through the mandatory risk-vs-reward matrix before any proposed action.',
      '',
      `System rules: ${kb.systemRules}`,
      `Schema payload: ${kb.schemaPayload}`,
      `Authenticated patrol role context: ${formatAuthRoleForPrompt(auth)}`,
      '',
      'Identify one practical improvement and classify it as autonomous or consultative.',
      'Return JSON only using this shape:',
      '{',
      '  "isObviousAutonomous": true|false,',
      '  "explanation": "string",',
      '  "targetFile": "string",',
      '  "patchValue": "string"',
      '}',
    ].join('\n');

    let decision: InitiativeDecision;
    let modelUsed = 'dry-run-mock';

    if (dryRun && PATROL_DRY_RUN_SKIP_MODEL) {
      decision = {
        isObviousAutonomous: true,
        explanation: 'Dry-run patrol mock decision generated without upstream model call.',
        targetFile: 'docs/STAGING.md',
        patchValue: '- [DRY RUN] Patrol simulation completed; no mutation performed.',
      };
    } else {
      const aiResult = await withTimeout(
        generateWithModelFallback('', patrolPrompt),
        PATROL_SCAN_TIMEOUT_MS,
        'initiative patrol scan',
      );
      decision = parseInitiativeDecision(aiResult.responseText);
      modelUsed = aiResult.modelUsed;
    }

    const reasoning = buildPatrolReasoning({
      decision,
      dryRun,
      modelUsed,
      auth,
      mutationAuthorized,
    });

    let actionResult: Record<string, unknown>;
    let actionTaken: 'RECOMMENDED_ONLY' | 'AGENTIC_EXECUTED' = 'RECOMMENDED_ONLY';

    if (dryRun) {
      actionResult = {
        status: 'DRY_RUN',
        detail: 'No repo mutation or issue creation performed.',
        wouldAutoExecute: isSafeAutonomousInitiative(decision),
        mutationAuthorized,
      };
    } else if (isSafeAutonomousInitiative(decision) && mutationAuthorized) {
      actionResult = await executeAutonomousInitiativeFix(decision);
      actionTaken = 'AGENTIC_EXECUTED';
    } else {
      actionResult = await logProactiveProposalToLedger(decision);
    }

    await persistAiReasoningLedger({
      sessionId: patrolSessionId,
      reasoning,
      actionTaken,
      metadata: {
        route: '/api/cron/patrol',
        dryRun,
        modelUsed,
        decision,
        actionResult,
        authContext: auth
          ? {
              userId: auth.userId,
              role: auth.role,
              isAdmin: auth.isAdmin,
              isGrandMaster: auth.isGrandMaster,
            }
          : null,
        mutationAuthorized,
      },
    });

    await supabase.from('self_healing_logs').insert({
      status: 'PENDING_HUMAN_REVIEW',
      service_name: 'railway-backend',
      error_message: 'Autonomous patrol sweep completed.',
      error_payload: {
        route: '/api/cron/patrol',
        decision,
        reasoningTrace: reasoning.reasoningTrace,
        riskAnalysis: reasoning.riskAnalysis,
        rewardAnalysis: reasoning.rewardAnalysis,
        confidenceScore: reasoning.confidenceScore,
        actionResult,
        dryRun,
        modelUsed,
        mutationAuthorized,
        capturedAt: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    } as Record<string, unknown>);

    res.status(202).json({
      status: 'Initiative patrol engine engaged.',
      decision,
      reasoningTrace: reasoning.reasoningTrace,
      riskAnalysis: reasoning.riskAnalysis,
      rewardAnalysis: reasoning.rewardAnalysis,
      confidenceScore: reasoning.confidenceScore,
      actionResult,
      dryRun,
      modelUsed,
      mutationAuthorized,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CRITICAL] Bob initiative loop failed:', message);
    res.status(500).json({
      error: 'Initiative patrol loop failed.',
      detail: message,
    });
  }
});

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
const server = app.listen(PORT, () => {
  console.log(`[FieldOps Backend] Listening on port ${PORT}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error('[FieldOps Backend] Server startup error', {
    message: error.message,
    code: error.code,
    port: PORT,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FieldOps Backend] Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FieldOps Backend] Uncaught exception', error);
  process.exit(1);
});

function shutdown(signal: 'SIGTERM' | 'SIGINT'): void {
  console.log(`[FieldOps Backend] Received ${signal}, shutting down`);
  server.close(() => {
    console.log('[FieldOps Backend] HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[FieldOps Backend] Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
