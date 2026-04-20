'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine (Bob)
 *
 * Handles actions: ping, chat, assess
 *
 * Required env vars (set in RunPod serverless template):
 *   OPENAI_API_KEY     — OpenAI or compatible API key
 *   OPENAI_BASE_URL    — Optional; default https://api.openai.com (strip trailing slash)
 *   OPENAI_MODEL       — Optional; default gpt-4o
 *
 * RunPod injects:
 *   RUNPOD_WEBHOOK_GET_JOB       — GET this URL to dequeue a job
 *   RUNPOD_WEBHOOK_POST_OUTPUT   — POST {id, output} here to complete a job
 */

console.log('[worker] RunPod AI Worker starting');
console.log(`[worker] Node.js ${process.version}`);

const GET_JOB_URL   = process.env.RUNPOD_WEBHOOK_GET_JOB;
const POST_OUT_URL  = process.env.RUNPOD_WEBHOOK_POST_OUTPUT;
const API_KEY       = process.env.RUNPOD_AI_API_KEY;
const POLL_MS       = 250;
const ERR_RETRY_MS  = 2000;

if (!GET_JOB_URL || !POST_OUT_URL) {
  console.error('[worker] Missing RUNPOD_WEBHOOK_GET_JOB or RUNPOD_WEBHOOK_POST_OUTPUT — are we running inside RunPod serverless?');
  process.exit(1);
}

const AUTH_HEADERS = API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {};
console.log('[worker] GET_JOB_URL:', GET_JOB_URL);
console.log('[worker] POST_OUT_URL:', POST_OUT_URL);
console.log('[worker] Auth header present:', !!API_KEY);

// ─── OpenAI helpers ───────────────────────────────────────────────────────────

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
const OPENAI_MODEL    = process.env.OPENAI_MODEL || 'gpt-4o';

async function openaiChat({ messages, model, temperature = 0.7, maxTokens = 2048 }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured on RunPod worker');

  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || OPENAI_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 300)}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`OpenAI non-JSON response: ${text.slice(0, 200)}`); }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`OpenAI returned empty content: ${JSON.stringify(data).slice(0, 200)}`);
  return { content, model: data.model || model || OPENAI_MODEL };
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
  const {
    message,
    history = [],
    system_prompt,
    model,
    temperature = 0.7,
    context,
  } = input;

  if (!message && !Array.isArray(input.messages)) {
    return { success: false, error: 'message or messages array is required' };
  }

  const systemContent = system_prompt || BOB_SYSTEM_PROMPT;
  let messages;

  if (Array.isArray(input.messages) && input.messages.length > 0) {
    // Full messages array provided
    messages = input.messages[0]?.role === 'system'
      ? input.messages
      : [{ role: 'system', content: systemContent }, ...input.messages];
  } else {
    // Single message + history
    const userContent = context
      ? `${message}\n\nContext:\n${typeof context === 'string' ? context : JSON.stringify(context)}`
      : message;
    messages = [
      { role: 'system', content: systemContent },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent },
    ];
  }

  const { content, model: usedModel } = await openaiChat({ messages, model, temperature });
  return {
    success: true,
    response: content,
    message: content,   // legacy alias
    model: usedModel,
    provider: 'openai',
  };
}

async function handleAssess(input) {
  const { type, symptom, description, image_description, context } = input;

  const systemPrompts = {
    smoke:        'You are an expert in smoke and air quality assessment for NZ environmental compliance. Analyse the evidence provided and return a structured JSON assessment with keys: risk_level (low/medium/high/critical), description, recommended_action, legal_basis.',
    biosecurity:  'You are an expert in NZ biosecurity compliance. Analyse the evidence and return a structured JSON assessment with keys: risk_level, species_identified (array), threat_level, recommended_action, legal_basis.',
    noise:        'You are an expert in NZ noise control compliance. Analyse the evidence and return a structured JSON assessment with keys: risk_level, estimated_db, exceeds_limit (bool), recommended_action, legal_basis.',
    ptt:          'You are a PTT (Push-to-Talk) system expert for FieldOps Manager. Diagnose the described issue and return a structured JSON with keys: diagnosis, probable_cause, resolution_steps (array), severity (low/medium/high).',
    platform:     'You are a DevOps expert for FieldOps Manager (Supabase + RunPod + Railway + Vercel). Diagnose the described issue and return a structured JSON with keys: diagnosis, probable_cause, resolution_steps (array), severity.',
    default:      'You are Bob, an AI assistant for FieldOps Manager. Analyse the situation and provide a structured JSON assessment with keys: assessment, risk_level, recommended_action.',
  };

  const systemPrompt = systemPrompts[type] || systemPrompts.default;

  const userContent = [
    symptom && `Symptom: ${symptom}`,
    description && `Description: ${description}`,
    image_description && `Evidence description: ${image_description}`,
    context && `Context: ${typeof context === 'string' ? context : JSON.stringify(context)}`,
  ].filter(Boolean).join('\n');

  if (!userContent) return { success: false, error: 'No assessment input provided (symptom, description, or context required)' };

  const { content, model: usedModel } = await openaiChat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    model: input.model,
    temperature: 0.3,
    maxTokens: 1024,
  });

  // Try to parse as JSON for structured response
  let structured = null;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) structured = JSON.parse(match[0]);
  } catch {}

  return {
    success: true,
    type,
    assessment: structured || content,
    raw_response: content,
    model: usedModel,
    provider: 'openai',
  };
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

  const { content, model: usedModel } = await openaiChat({
    messages: [
      { role: 'system', content: `Translate the following text${fromClause} to ${targetName}. Return only the translated text, no explanation.` },
      { role: 'user', content: text },
    ],
    model: input.model,
    temperature: 0.1,
    maxTokens: 2048,
  });

  return {
    success: true,
    translation: content,
    translated_text: content,  // alias
    target_language,
    model: usedModel,
    provider: 'openai',
  };
}

// ─── Job handler ──────────────────────────────────────────────────────────────

async function handler(input) {
  if (!input) return { success: false, error: 'No input provided' };

  const action = input.action || 'chat';

  if (action === 'ping') {
    return { success: true, message: 'AI Engine is online and ready!', model: OPENAI_MODEL };
  }

  if (action === 'chat') return handleChat(input);
  if (action === 'assess') return handleAssess(input);
  if (action === 'translate') return handleTranslate(input);

  return { success: false, error: `Unknown action: ${action}. Supported: ping, chat, assess, translate` };
}

// ─── RunPod polling loop ──────────────────────────────────────────────────────

async function takeJob() {
  const res = await fetch(GET_JOB_URL, { headers: AUTH_HEADERS });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`get_job HTTP ${res.status}`);
  return res.json();
}

async function completeJob(jobId, output) {
  const resolvedPostUrl = POST_OUT_URL
    .replace('$ID', encodeURIComponent(jobId))
    .replace('${ID}', encodeURIComponent(jobId));

  const res = await fetch(resolvedPostUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body:    JSON.stringify({ id: jobId, output }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`job_done HTTP ${res.status}: ${body}`);
  }
}

async function workerLoop() {
  console.log('[worker] Polling for jobs...');
  while (true) {
    let job = null;
    try {
      job = await takeJob();
    } catch (err) {
      console.error('[worker] Failed to take job:', err.message);
      await sleep(ERR_RETRY_MS);
      continue;
    }

    if (!job) { await sleep(POLL_MS); continue; }

    console.log(`[worker] Processing job ${job.id}`);
    let output;
    try {
      output = await handler(job.input);
    } catch (err) {
      console.error(`[worker] Handler error for ${job.id}:`, err.message);
      output = { error: err.message };
    }

    try {
      await completeJob(job.id, output);
      console.log(`[worker] Completed job ${job.id}`);
    } catch (err) {
      console.error(`[worker] Failed to complete job ${job.id}:`, err.message);
      await sleep(ERR_RETRY_MS);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

process.on('uncaughtException',  err => { console.error('[worker] Uncaught:', err); process.exit(1); });
process.on('unhandledRejection', err => { console.error('[worker] Rejection:', err); process.exit(1); });

workerLoop().catch(err => { console.error('[worker] Fatal:', err); process.exit(1); });

