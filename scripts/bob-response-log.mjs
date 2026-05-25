#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

export const BOB_RESPONSE_LOG_PATH = path.join(
  workspaceRoot,
  'data',
  'bob-response-scores.jsonl'
);

const SYSTEM_STATE_PATH = path.join(workspaceRoot, 'system_state.json');
const MODULE_ROOT = path.join(workspaceRoot, 'src', 'modules');
const MODULE_REF_PATTERN = /src\/modules\/([A-Za-z0-9_-]+)/g;

function normalizeText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

function firstNonEmptyEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function toLearningLessonKey(entry) {
  const reasons = Array.isArray(entry?.failureReasons) ? entry.failureReasons : [];
  if (reasons.some((reason) => String(reason).includes('hallucinated_modules:'))) {
    return 'hallucination_invented_file';
  }
  if (reasons.includes('quality_gate_failed')) {
    return 'incomplete_solution';
  }
  if (reasons.includes('delivery_failed') || reasons.includes('fallback_applied')) {
    return 'self_healed';
  }
  if (Number(entry?.score || 0) >= 9) {
    return 'correct_first_time';
  }
  return 'needs_manual_review';
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function toStableHash(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16);
}

async function maybePersistLearningLog({ entry, input }) {
  const enabled = String(process.env.BOB_PERSIST_LEARNING_LOG || '').trim().toLowerCase();
  if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes' && enabled !== 'on') {
    return;
  }

  const supabaseUrl = firstNonEmptyEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceRoleKey = firstNonEmptyEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;

  const orgId =
    String(input?.metadata?.organizationId || '').trim() ||
    firstNonEmptyEnv('BOB_ORG_ID', 'ORG_ID', 'DEFAULT_ORG_ID');
  const userId =
    String(input?.metadata?.userId || '').trim() ||
    firstNonEmptyEnv('BOB_USER_ID', 'SYNTHETIC_MONITOR_USER_ID', 'USER_ID');
  if (!orgId || !userId) return;

  const lessonKey = toLearningLessonKey(entry);
  const responseText = normalizeText(input?.response || '').trim();
  const promptHash = toStableHash(normalizeText(input?.prompt || '').trim());
  const responseHash = toStableHash(responseText || normalizeText(entry?.responsePreview || '').trim());

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  let conversationId = String(input?.metadata?.conversationId || '').trim() || firstNonEmptyEnv('BOB_CONVERSATION_ID');
  let messageId = String(input?.metadata?.messageId || '').trim() || firstNonEmptyEnv('BOB_MESSAGE_ID');

  if (!conversationId) {
    const { data: latestConversation } = await (supabase.from('bob_conversations'))
      .select('conversation_id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestConversation?.conversation_id) {
      conversationId = String(latestConversation.conversation_id);
    }
  }

  if (!conversationId) {
    const { data: createdConversation } = await (supabase.from('bob_conversations'))
      .insert({
        user_id: userId,
        organization_id: orgId,
        title: 'Dr Bob Review Session',
        summary: 'Automated review score persisted from bob-response-log',
        tags: ['dr-bob-review', 'learning-loop'],
      })
      .select('conversation_id')
      .single();

    if (!createdConversation?.conversation_id) return;
    conversationId = String(createdConversation.conversation_id);
  }

  // Dedupe guard: skip repeated score inserts for identical prompt/response hash in recent window.
  const dedupeCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existingEntry } = await (supabase.from('bob_learning_log'))
    .select('entry_id')
    .eq('organization_id', orgId)
    .eq('lesson_key', lessonKey)
    .eq('lesson_detail->>prompt_hash', promptHash)
    .eq('lesson_detail->>response_hash', responseHash)
    .gte('created_at', dedupeCutoffIso)
    .limit(1)
    .maybeSingle();

  if (existingEntry?.entry_id) {
    return;
  }

  if (!messageId) {
    const messageContent = responseText.slice(0, 8000) || 'Dr Bob response unavailable';
    const { data: createdMessage } = await (supabase.from('bob_messages'))
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: messageContent,
        organization_id: orgId,
        user_id: userId,
        metadata: {
          source: 'bob-response-log',
          channel: entry.channel,
          target: entry.target,
          disposition: entry.disposition,
          source_file: entry?.metadata?.sourceFile || null,
        },
      })
      .select('message_id')
      .single();

    if (!createdMessage?.message_id) return;
    messageId = String(createdMessage.message_id);
  }

  const score01 = clamp01(Number(entry.score || 0) / 10);
  const feedbackText = Array.isArray(entry.failureReasons) && entry.failureReasons.length > 0
    ? entry.failureReasons.join('; ')
    : Array.isArray(entry.positiveSignals) && entry.positiveSignals.length > 0
      ? `positive_signals:${entry.positiveSignals.join(',')}`
      : null;

  await (supabase.from('bob_learning_log')).insert({
    conversation_id: conversationId,
    message_id: messageId,
    score: score01,
    feedback: feedbackText,
    lesson_key: lessonKey,
    lesson_detail: {
      disposition: entry.disposition,
      failure_reasons: entry.failureReasons,
      positive_signals: entry.positiveSignals,
      channel: entry.channel,
      target: entry.target,
      source_file: entry?.metadata?.sourceFile || null,
      prompt_hash: promptHash,
      response_hash: responseHash,
    },
    organization_id: orgId,
  });
}

async function readJsonIfPresent(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadKnownModules() {
  const modules = new Set();

  const systemState = await readJsonIfPresent(SYSTEM_STATE_PATH);
  for (const moduleName of systemState?.modules || []) {
    if (moduleName) modules.add(String(moduleName));
  }

  try {
    const entries = await fs.readdir(MODULE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) modules.add(entry.name);
    }
  } catch {
    // Missing src/modules is meaningful; it just means there are no local modules to trust.
  }

  return modules;
}

function extractModuleRefs(text) {
  const refs = new Set();
  for (const match of normalizeText(text).matchAll(MODULE_REF_PATTERN)) {
    refs.add(match[1]);
  }
  return [...refs].sort();
}

export async function scoreBobResponse({
  target,
  channel,
  prompt,
  response,
  delivery,
  metadata = {},
}) {
  const promptText = normalizeText(prompt).trim();
  const responseText = normalizeText(response).trim();
  const knownModules = await loadKnownModules();
  const mentionedModules = extractModuleRefs(responseText);
  const hallucinatedModules = mentionedModules.filter(
    (moduleName) => !knownModules.has(moduleName)
  );

  let score = 10;
  const positiveSignals = [];
  const failureReasons = [];

  if (delivery?.sent === false) {
    score = 0;
    failureReasons.push(delivery.reason || 'delivery_failed');
  }

  if (!responseText) {
    score = 0;
    failureReasons.push('empty_response');
  }

  if (hallucinatedModules.length > 0) {
    score = 0;
    failureReasons.push(
      `hallucinated_modules:${hallucinatedModules.join(',')}`
    );
  }

  if (metadata.qualityGateFailed || metadata.fallbackApplied) {
    score = Math.min(score, metadata.qualityGateFailed ? 0 : 3);
    failureReasons.push(
      metadata.qualityGateFailed ? 'quality_gate_failed' : 'fallback_applied'
    );
  }

  if (/system_state\.json/i.test(responseText)) {
    positiveSignals.push('checked_system_state');
  }

  if (/\b(spec\.md|plan\.md)\b/i.test(responseText)) {
    positiveSignals.push('spec_driven_language');
  }

  if (/(not enough information|cannot verify|can't verify|i don't know|unclear from the repo)/i.test(responseText)) {
    positiveSignals.push('truthful_uncertainty');
  }

  return {
    timestamp: new Date().toISOString(),
    target: target || 'Bob',
    channel: channel || delivery?.channel || 'unknown',
    score,
    disposition: score >= 9 ? 'reward' : score <= 3 ? 'penalize' : 'review',
    failureReasons,
    positiveSignals,
    mentionedModules,
    hallucinatedModules,
    promptPreview: promptText.slice(0, 220),
    responsePreview: responseText.slice(0, 220),
    metadata: {
      reason: delivery?.reason || metadata.reason || null,
      status: delivery?.status ?? metadata.status ?? null,
      provider: metadata.provider || null,
      fallback: metadata.fallback || false,
      reviewDecision: metadata.reviewDecision || null,
      sourceFile: metadata.sourceFile || null,
    },
  };
}

export async function recordScoredResponse(input) {
  const entry = await scoreBobResponse(input);
  await fs.mkdir(path.dirname(BOB_RESPONSE_LOG_PATH), { recursive: true });
  await fs.appendFile(BOB_RESPONSE_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  try {
    await maybePersistLearningLog({ entry, input });
  } catch {
    // Keep score logging resilient even when Supabase persistence is unavailable.
  }
  return entry;
}