'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine (Bob)
 *
 * Uses runpod-sdk serverless.start() — the correct modern RunPod pattern.
 * All inference goes through Ollama (co-located at 127.0.0.1:11434).
 *
 * Required env vars (set in RunPod template):
 *   OLLAMA_BASE_URL    — default http://127.0.0.1:11434
 *   OLLAMA_MODEL       — default llama3.1:8b
 *   OLLAMA_TIMEOUT_MS  — per-request timeout ms, default 120000
 */

const runpod = require('runpod-sdk');

console.log('[worker] RunPod AI Worker starting (SDK mode)');
console.log(`[worker] Node.js ${process.version}`);

const OLLAMA_BASE    = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const OLLAMA_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

console.log('[worker] OLLAMA_BASE:', OLLAMA_BASE);
console.log('[worker] OLLAMA_MODEL:', OLLAMA_MODEL);

// ─── Ollama helpers ───────────────────────────────────────────────────────────

async function ollamaChat({ messages, model, temperature = 0.7 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || OLLAMA_MODEL,
        messages,
        stream: false,
        options: { temperature },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${text.slice(0, 300)}`);

    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Ollama non-JSON: ${text.slice(0, 200)}`); }

    const content = data?.message?.content;
    if (!content) throw new Error('Ollama returned empty content');
    return { content, model: data.model || model || OLLAMA_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Bob system prompt ────────────────────────────────────────────────────────

const BOB_SYSTEM_PROMPT = `You are Bob, the AI assistant embedded in FieldOps Manager — a freedom camping enforcement platform used by councils and security contractors in New Zealand.

You assist officers, supervisors, and administrators with:
- NZ freedom camping law: Freedom Camping Act 2011, Local Government Act 2002, RMA 1991, Privacy Act 2020
- Compliance analysis: breach trends, stay-night calculations, zone rule interpretation
- Patrol operations: shift planning, route guidance, officer welfare checks
- Enforcement actions: Notice to Vacate, Warning Notice, Infringement Notice, Noise Notice
- Vehicle and plate workflows: ALPR results, SCV certification via NZSCV register
- Incident and evidence management and investigation notes

Be concise — field officers need fast actionable answers. Never fabricate data or plate numbers. All guidance is operational, not formal legal advice.`;

// ─── Action handlers ──────────────────────────────────────────────────────────

async function handleChat(input) {
  const { message, history = [], system_prompt, model, temperature = 0.7, context } = input;

  if (!message && !Array.isArray(input.messages)) {
    return { success: false, error: 'message or messages array is required' };
  }

  const systemContent = system_prompt || BOB_SYSTEM_PROMPT;
  let messages;

  if (Array.isArray(input.messages) && input.messages.length > 0) {
    messages = input.messages[0]?.role === 'system'
      ? input.messages
      : [{ role: 'system', content: systemContent }, ...input.messages];
  } else {
    const userContent = context
      ? `${message}\n\nContext:\n${typeof context === 'string' ? context : JSON.stringify(context)}`
      : message;
    messages = [
      { role: 'system', content: systemContent },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent },
    ];
  }

  const { content, model: usedModel } = await ollamaChat({ messages, model, temperature });
  return { success: true, response: content, message: content, model: usedModel, provider: 'ollama' };
}

async function handleAssess(input) {
  const { type, symptom, description, image_description, context } = input;

  const systemPrompts = {
    smoke:       'You are an expert in smoke and air quality assessment for NZ environmental compliance. Analyse the evidence and return a JSON assessment: { risk_level, description, recommended_action, legal_basis }',
    biosecurity: 'You are an expert in NZ biosecurity compliance. Analyse the evidence and return a JSON assessment: { risk_level, species_identified, threat_level, recommended_action, legal_basis }',
    noise:       'You are an expert in NZ noise control compliance. Analyse the evidence and return a JSON assessment: { risk_level, estimated_db, exceeds_limit, recommended_action, legal_basis }',
    ptt:         'You are a PTT system expert for FieldOps Manager. Diagnose the issue and return a JSON: { diagnosis, probable_cause, resolution_steps, severity }',
    platform:    'You are a DevOps expert for FieldOps Manager. Diagnose the issue and return a JSON: { diagnosis, probable_cause, resolution_steps, severity }',
    default:     'You are Bob, an AI assistant for FieldOps Manager. Return a JSON assessment: { assessment, risk_level, recommended_action }',
  };

  const systemPrompt = systemPrompts[type] || systemPrompts.default;
  const userContent = [
    symptom && `Symptom: ${symptom}`,
    description && `Description: ${description}`,
    image_description && `Evidence: ${image_description}`,
    context && `Context: ${typeof context === 'string' ? context : JSON.stringify(context)}`,
  ].filter(Boolean).join('\n');

  if (!userContent) return { success: false, error: 'No assessment input provided' };

  const { content, model: usedModel } = await ollamaChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    model: input.model,
    temperature: 0.3,
  });

  let structured = null;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) structured = JSON.parse(match[0]);
  } catch {}

  return { success: true, type, assessment: structured || content, raw_response: content, model: usedModel, provider: 'ollama' };
}

async function handleTranslate(input) {
  const { text, target_language = 'en', source_language } = input;
  if (!text) return { success: false, error: 'text is required' };

  const langNames = {
    zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean',
    mi: 'Te Reo Māori', de: 'German', fr: 'French', es: 'Spanish',
    pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  };
  const targetName = langNames[target_language] || target_language;
  const fromClause = source_language ? ` from ${langNames[source_language] || source_language}` : '';

  const { content, model: usedModel } = await ollamaChat({
    messages: [
      { role: 'system', content: `Translate the following text${fromClause} to ${targetName}. Return only the translated text, no explanation.` },
      { role: 'user', content: text },
    ],
    model: input.model,
    temperature: 0.1,
  });

  return { success: true, translation: content, translated_text: content, target_language, model: usedModel, provider: 'ollama' };
}

// ─── Main SDK handler ─────────────────────────────────────────────────────────

async function handler({ input }) {
  if (!input) return { success: false, error: 'No input provided' };

  const action = input.action || 'chat';
  console.log(`[worker] action=${action}`);

  if (action === 'ping')      return { success: true, message: 'AI Engine is online and ready!', model: OLLAMA_MODEL, provider: 'ollama' };
  if (action === 'chat')      return handleChat(input);
  if (action === 'assess')    return handleAssess(input);
  if (action === 'translate') return handleTranslate(input);

  return { success: false, error: `Unknown action: ${action}. Supported: ping, chat, assess, translate` };
}

process.on('uncaughtException',  err => { console.error('[worker] Uncaught:', err); process.exit(1); });
process.on('unhandledRejection', err => { console.error('[worker] Rejection:', err); process.exit(1); });

runpod.serverless.start({ handler });
