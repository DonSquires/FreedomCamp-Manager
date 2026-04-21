'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine (Bob)
 *
 * All inference routes through Ollama. No OpenAI, no external AI providers.
 * When Bob/Ollama lack knowledge for a task, they research the web and self-train.
 *
 * Handles actions: ping, chat, assess, translate
 *
 * Required env vars (set in RunPod serverless template):
 *   OLLAMA_BASE_URL    — Ollama endpoint, default http://127.0.0.1:11434
 *   OLLAMA_MODEL       — Model to use, default llama3.1:8b
 *   OLLAMA_TIMEOUT_MS  — Per-request timeout ms, default 120000
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

// ─── Ollama helpers ───────────────────────────────────────────────────────────

const OLLAMA_BASE   = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const OLLAMA_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

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
    if (!content) throw new Error(`Ollama returned empty content`);
    return { content, model: data.model || model || OLLAMA_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

// Web research: fetch a URL and return plain text content (for self-training)
async function fetchWebPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Bob-FieldOps-Research/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip HTML tags for plain text
    return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 8000);
  } catch {
    return null;
  }
}

// Self-research: ask Ollama if it needs web context, fetch it, then re-ask
async function ollamaChatWithResearch({ messages, model, temperature = 0.7 }) {
  // First attempt
  try {
    return await ollamaChat({ messages, model, temperature });
  } catch (err) {
    // If Ollama is down, rethrow immediately
    if (err.message.includes('Ollama error') || err.message.includes('fetch')) throw err;
  }

  // Research phase: ask Ollama what URL(s) to fetch to answer the question
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const researchPrompt = [
    ...messages.slice(0, 1), // keep system prompt
    {
      role: 'user',
      content: `To answer this question accurately: "${lastUserMsg.slice(0, 500)}"
If you need to look something up, reply with ONLY a JSON array of up to 3 URLs to fetch, like: ["https://...","https://..."]
If you already know enough, reply with: SUFFICIENT`,
    },
  ];

  let researchUrls = [];
  try {
    const { content } = await ollamaChat({ messages: researchPrompt, model, temperature: 0.1 });
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) researchUrls = JSON.parse(match[0]).filter(u => /^https?:\/\//.test(u)).slice(0, 3);
  } catch {}

  if (!researchUrls.length) {
    // No research needed or couldn't parse — retry direct answer
    return ollamaChat({ messages, model, temperature });
  }

  // Fetch web pages in parallel
  const pages = await Promise.all(researchUrls.map(fetchWebPage));
  const webContext = pages
    .filter(Boolean)
    .map((text, i) => `[Source ${i + 1}: ${researchUrls[i]}]\n${text}`)
    .join('\n\n---\n\n');

  if (!webContext) return ollamaChat({ messages, model, temperature });

  // Re-ask with web context injected
  const augmentedMessages = [
    ...messages.slice(0, 1),
    {
      role: 'system',
      content: `You have researched the web and found the following information to help answer the user's question:\n\n${webContext}\n\nUse this information in your response where relevant.`,
    },
    ...messages.slice(1),
  ];

  return ollamaChat({ messages: augmentedMessages, model, temperature });
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

When you don't know something, research it from trusted NZ government and legal sources.
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

  const { content, model: usedModel } = await ollamaChatWithResearch({ messages, model, temperature });
  return {
    success: true,
    response: content,
    message: content,
    model: usedModel,
    provider: 'ollama',
  };
}

async function handleAssess(input) {
  const { type, symptom, description, image_description, context } = input;

  const systemPrompts = {
    smoke:        'You are an expert in smoke and air quality assessment for NZ environmental compliance. Analyse the evidence and return a JSON assessment: { risk_level, description, recommended_action, legal_basis }',
    biosecurity:  'You are an expert in NZ biosecurity compliance. Analyse the evidence and return a JSON assessment: { risk_level, species_identified, threat_level, recommended_action, legal_basis }',
    noise:        'You are an expert in NZ noise control compliance. Analyse the evidence and return a JSON assessment: { risk_level, estimated_db, exceeds_limit, recommended_action, legal_basis }',
    ptt:          'You are a PTT (Push-to-Talk) system expert for FieldOps Manager. Diagnose the issue and return a JSON: { diagnosis, probable_cause, resolution_steps, severity }',
    platform:     'You are a DevOps expert for FieldOps Manager (Supabase + RunPod + Vercel). Diagnose the issue and return a JSON: { diagnosis, probable_cause, resolution_steps, severity }',
    default:      'You are Bob, an AI assistant for FieldOps Manager. Return a JSON assessment: { assessment, risk_level, recommended_action }',
  };

  const systemPrompt = systemPrompts[type] || systemPrompts.default;
  const userContent = [
    symptom && `Symptom: ${symptom}`,
    description && `Description: ${description}`,
    image_description && `Evidence: ${image_description}`,
    context && `Context: ${typeof context === 'string' ? context : JSON.stringify(context)}`,
  ].filter(Boolean).join('\n');

  if (!userContent) return { success: false, error: 'No assessment input provided' };

  const { content, model: usedModel } = await ollamaChatWithResearch({
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

  return {
    success: true,
    type,
    assessment: structured || content,
    raw_response: content,
    model: usedModel,
    provider: 'ollama',
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

  const { content, model: usedModel } = await ollamaChat({
    messages: [
      { role: 'system', content: `Translate the following text${fromClause} to ${targetName}. Return only the translated text, no explanation.` },
      { role: 'user', content: text },
    ],
    model: input.model,
    temperature: 0.1,
  });

  return {
    success: true,
    translation: content,
    translated_text: content,
    target_language,
    model: usedModel,
    provider: 'ollama',
  };
}

// ─── Job handler ──────────────────────────────────────────────────────────────

async function handler(input) {
  if (!input) return { success: false, error: 'No input provided' };

  const action = input.action || 'chat';

  if (action === 'ping') {
    return { success: true, message: 'AI Engine is online and ready!', model: OLLAMA_MODEL, provider: 'ollama' };
  }

  if (action === 'chat')      return handleChat(input);
  if (action === 'assess')    return handleAssess(input);
  if (action === 'translate') return handleTranslate(input);

  return { success: false, error: `Unknown action: ${action}. Supported: ping, chat, assess, translate` };
}

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


