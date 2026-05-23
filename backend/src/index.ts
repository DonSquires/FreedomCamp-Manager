import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import jwt, { JwtPayload } from 'jsonwebtoken';
import ws from 'ws';
import { readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAgentPatch } from './agentTools.js';
import { runInSandboxEmulator } from './validator.js';
import { triggerOtaHotfix, triggerPreviewApkBuild } from './easTools.js';
import { closeGiteaIssue, createGiteaIssue, updateMarkdownTodo } from './pmTools.js';
import {
  buildPrioritizedResearchQueries,
  executeWebSearch,
  fetchWebpageContent,
  isTrustedResearchDomain,
} from './researchTool.js';

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

const DEFAULT_AGENT_ROLES: Record<string, string> = {
  dr_bob:
    'Chief Medical Officer of Code. Diagnose root cause, identify risk, and constrain remediation to verified repo and schema facts.',
  bob:
    'Realignment Architect. Convert diagnosis into safe, minimal, parseable operational fixes aligned to platform constraints.',
  emulator:
    'Guardrail Sandbox. Validate safety and reject insecure or non-deterministic changes before approval.',
  ui_ux_agent:
    'Visual and Interaction Architect. Specialize in React, Tailwind, accessibility, responsiveness, and visual coherence.',
  writer_agent:
    'Technical Documentation Specialist. Generate concise, accurate updates for STAGING.md and INSTRUCTION_MANUAL.md grounded in live code changes.',
  research_agent:
    'Deep Web Search and Retrieval Core. Gather external release notes and docs updates, then synthesize actionable guidance for this stack.',
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
const DOC_INTEL_DEFAULT_LIMIT = Math.max(1, Number(process.env.DOC_INTEL_DEFAULT_LIMIT ?? 20));
const DOC_INTEL_MAX_LIMIT = Math.max(1, Number(process.env.DOC_INTEL_MAX_LIMIT ?? 100));
const PRIVACY_REDACTION_ENABLED = parseBool(process.env.PRIVACY_REDACTION_ENABLED ?? 'true');

const CURRENT_FILE = fileURLToPath(import.meta.url);
const BACKEND_DIR = path.dirname(CURRENT_FILE);
const REPO_ROOT = path.resolve(BACKEND_DIR, '..', '..');
const DOC_INTEL_INDEX_FILE = path.resolve(
  process.env.DOC_INTEL_INDEX_PATH ?? path.join(REPO_ROOT, 'data/internal-research/document-intelligence-index.json'),
);

let docIntelCache: {
  mtimeMs: number;
  payload: DocumentIntelPayload;
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

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : undefined);
const SUPABASE_SERVICE_ROLE_KEY = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY']);
const SUPABASE_JWT_SECRET = optionalAnyEnv(['SUPABASE_JWT_SECRET']);

if (!SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL. Set SUPABASE_URL, VITE_SUPABASE_URL, or SUPABASE_PROJECT_REF');
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

// ── Supabase (service role — backend only, never expose to client) ──────────
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
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

  // Fallback for environments where SUPABASE_JWT_SECRET is not configured.
  const { data, error } = await supabase.auth.getUser(token);
  if (error) {
    return null;
  }

  const remoteSubject = String(data?.user?.id ?? '').trim();
  return remoteSubject || null;
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
  res.status(200).json({ ok: true, service: 'fieldops-backend' });
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

async function generateWithModelFallback(systemPrompt: string, userMessage: string): Promise<{ responseText: string; modelUsed: string }> {
  const baseUrl = process.env.OLLAMA_PROXY_URL ?? 'http://ollama:11434';
  const models = getOllamaModelCandidates().slice(0, OLLAMA_MAX_CANDIDATES);
  let lastError: unknown = null;
  const startedAt = Date.now();

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
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No Ollama model candidates succeeded');
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
  const owner = (payload.owner ?? process.env.GITEA_OWNER ?? '').trim();
  const repo = (payload.repo ?? process.env.GITEA_REPO ?? '').trim();
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
  const baseUrl = optionalAnyEnv(['GITEA_BASE_URL', 'GITEA_URL']);
  const token = optionalAnyEnv(['GITEA_TOKEN', 'GITEA_API_TOKEN']);

  if (!baseUrl || !token) {
    throw new Error('Missing Gitea configuration. Set GITEA_BASE_URL and GITEA_TOKEN.');
  }

  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  return axios.create({
    baseURL: `${trimmedBaseUrl}/api/v1`,
    headers: {
      Authorization: `token ${token}`,
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

    const kb = await getTierAKnowledgeContext();

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

Conversation history:
${conversationTranscript}

Structured recent history array:
${promptHistoryJson}

Reference Blueprints (Tier A): ${kb.schemaPayload}
System Operational Rules: ${kb.systemRules}

Consultative Reference Runbook (Tier B):
${consultativeRunbook}

Follow this policy:
1) Audit dependencies and operational impact.
2) Produce explicit risk and reward analysis.
3) Set isObviousAutonomous=true ONLY when risk is effectively zero and user intent is explicit.
4) If autonomous path is selected, provide a safe action payload for gitea propose-pr flow.

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

Do not return plain text outside the JSON object.
`;

    let modelText = '';
    let modelUsed = '';
    try {
      const result = await generateWithModelFallback('', cognitivePrompt);
      modelText = result.responseText.trim();
      modelUsed = result.modelUsed;
    } catch (error) {
      console.error('[/api/heal] Cognitive generation failed', error);
      const degradedText = 'Bob is temporarily unavailable (model upstream). Please retry in a moment.';
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

  // 1 ── Fetch system context from Supabase
  const { data: templates, error: tplError } = await supabase
    .from('system_templates')
    .select('*');

  const { data: rules, error: rulesError } = await supabase
    .from('system_rules')
    .select('*');

  if (tplError || rulesError) {
    console.error('[/api/heal] Supabase fetch error', tplError ?? rulesError);
    res.status(500).json({ error: 'Failed to fetch system context from Supabase' });
    return;
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

  // 2 ── Dr. Bob: critic agent
  const drBobAnalysis = await promptOllama(
    'Dr. Bob',
    `You are Dr. Bob, a senior adversarial code reviewer. 
     Given the following Tier A system context: ${contextSummary}
     Consultative Reference Runbook:\n${consultativeRunbook}
     Identify the root cause of the error, distinguish symptoms from causes, and list the top risks.
     Reject shallow or temporary workaround recommendations.`,
    `Error payload: ${errorString}`
  );

  // 3 ── Bob: fixer agent
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

  // 4 ── Sandbox emulator validates the patch
  let parsedPatch: { variableName: string; variableValue: string; justification: string };
  try {
    parsedPatch = JSON.parse(bobPatch);
  } catch {
    res.status(422).json({ error: 'Bob produced an unparseable patch', raw: bobPatch });
    return;
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

    res.status(422).json({
      error: 'Patch rejected by root-cause policy gate',
      reasons: policyReasons,
      issueNumber: giteaIssueNumber,
    });
    return;
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

  // 5 ── Save review record
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

  if (insertError) {
    console.error('[/api/heal] Failed to persist review record', insertError);
    res.status(500).json({ error: 'Failed to save review record' });
    return;
  }

  res.json({
    status: safe ? 'PENDING_HUMAN_REVIEW' : 'BLOCKED_BY_SANDBOX',
    patchId: record.id,
    patch: parsedPatch,
    drBobAnalysis,
  });
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

      if (promoted.merged) {
        managerStatus = 'RESOLVED_AND_DEPLOYED';
        verificationTag = `${verificationTag} | Automated Production Promotion: PASSED via 100% Green Playwright Sweep`;
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

  let giteaIssueNumber: number | null = null;
  if (status !== 'PASSED' || managerStatus === 'ORCHESTRATOR_CRASHED') {
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

  const nowIso = new Date().toISOString();
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
    giteaIssueNumber,
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
        logId,
        giteaIssueNumber,
        autoPromotion: promotionSummary,
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

  if (insertError) {
    console.error('[/api/automation/playwright-result] Failed to persist Playwright verification result', insertError);
    res.status(500).json({ error: 'Failed to persist Playwright verification result' });
    return;
  }

  res.status(200).json({
    ok: true,
    status: managerStatus,
    verificationTag,
    logId: inserted?.id ?? null,
    giteaIssueNumber,
    autoPromotion: promotionSummary,
  });
});

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[FieldOps Backend] Listening on port ${PORT}`);
});
