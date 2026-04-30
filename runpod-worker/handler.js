'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine (Bob)
 *
 * Protocol from runpod-python source:
 *   GET  RUNPOD_WEBHOOK_GET_JOB       ($ID=RUNPOD_POD_ID, append &job_in_progress=0|1)
 *   POST RUNPOD_WEBHOOK_POST_OUTPUT   ($RUNPOD_POD_ID=podId at startup, $ID=jobId per job)
 *        Content-Type: application/x-www-form-urlencoded
 *        Body: JSON-stringified result (sent as form data string)
 */

const http  = require('http');
const https = require('https');

console.log('[worker] RunPod AI Worker starting');
console.log(`[worker] Node.js ${process.version}`);

const WORKER_ID      = process.env.RUNPOD_POD_ID || process.env.RUNPOD_WORKER_ID || 'local';
const OLLAMA_BASE    = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);
const BOB_ATTITUDE_PROFILE = String(process.env.BOB_ATTITUDE_PROFILE || 'operational').trim().toLowerCase();
const BOB_ATTITUDE_INSTRUCTIONS = String(process.env.BOB_ATTITUDE_INSTRUCTIONS || '').trim();

const GET_JOB_URL_TEMPLATE  = process.env.RUNPOD_WEBHOOK_GET_JOB;
const POST_OUT_URL_TEMPLATE = process.env.RUNPOD_WEBHOOK_POST_OUTPUT;

console.log('[worker] WORKER_ID:', WORKER_ID);
console.log('[worker] OLLAMA_BASE:', OLLAMA_BASE);
console.log('[worker] OLLAMA_MODEL:', OLLAMA_MODEL);
console.log('[worker] BOB_ATTITUDE_PROFILE:', BOB_ATTITUDE_PROFILE);
console.log('[worker] GET_JOB_URL_TEMPLATE:', GET_JOB_URL_TEMPLATE);
console.log('[worker] POST_OUT_URL_TEMPLATE:', POST_OUT_URL_TEMPLATE ? '***set***' : 'NOT SET');

if (!GET_JOB_URL_TEMPLATE || !POST_OUT_URL_TEMPLATE) {
  console.error('[worker] FATAL: missing RUNPOD_WEBHOOK_GET_JOB or RUNPOD_WEBHOOK_POST_OUTPUT');
  const runpodKeys = Object.keys(process.env).filter(k => k.startsWith('RUNPOD'));
  console.error('[worker] All RUNPOD_ env keys:', runpodKeys);
  process.exit(1);
}

// Replace pod ID once at startup
const GET_JOB_URL    = GET_JOB_URL_TEMPLATE.replace('$ID', WORKER_ID);
const POST_OUT_BASE  = POST_OUT_URL_TEMPLATE.replace('$RUNPOD_POD_ID', WORKER_ID);

console.log('[worker] GET_JOB_URL:', GET_JOB_URL);

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpReq(urlStr, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    var url  = new URL(urlStr);
    var lib  = url.protocol === 'https:' ? https : http;
    var body = null;

    if (opts.form) {
      // application/x-www-form-urlencoded — body is the raw string
      body = Buffer.from(typeof opts.form === 'string' ? opts.form : JSON.stringify(opts.form));
    } else if (opts.json !== undefined) {
      body = Buffer.from(JSON.stringify(opts.json));
    }

    var headers = Object.assign({
      'Content-Type': opts.form !== undefined ? 'application/x-www-form-urlencoded' : 'application/json',
    }, body ? { 'Content-Length': body.length } : {}, opts.headers || {});

    var req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   opts.method || (body ? 'POST' : 'GET'),
      headers:  headers,
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString();
        var parsed;
        try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
        resolve({ status: res.statusCode, body: parsed, text: text });
      });
    });

    req.on('error', reject);
    if (opts.timeout) req.setTimeout(opts.timeout, function() { req.destroy(new Error('timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ─── Ollama helper ────────────────────────────────────────────────────────────

function messagesToPrompt(messages) {
  var lines = [];
  (Array.isArray(messages) ? messages : []).forEach(function(m) {
    var role = String((m && m.role) || 'user').toUpperCase();
    var content = String((m && m.content) || '').trim();
    if (content) lines.push(role + ': ' + content);
  });
  lines.push('ASSISTANT:');
  return lines.join('\n\n');
}

async function ollamaChat(messages, model, temperature) {
  var resolvedModel = model || OLLAMA_MODEL;
  var resolvedTemp = temperature || 0.7;

  // Prefer /api/chat, but support older Ollama with /api/generate.
  var res = await httpReq(OLLAMA_BASE + '/api/chat', {
    json: { model: resolvedModel, messages: messages, stream: false, options: { temperature: resolvedTemp } },
    timeout: OLLAMA_TIMEOUT,
  });

  if (res.status === 404) {
    var gen = await httpReq(OLLAMA_BASE + '/api/generate', {
      json: { model: resolvedModel, prompt: messagesToPrompt(messages), stream: false, options: { temperature: resolvedTemp } },
      timeout: OLLAMA_TIMEOUT,
    });
    if (gen.status !== 200) throw new Error('Ollama /api/generate ' + gen.status + ': ' + String(gen.text).slice(0, 200));
    var genContent = gen.body && gen.body.response;
    if (!genContent) throw new Error('Ollama /api/generate empty response');
    return { content: genContent, model: (gen.body && gen.body.model) || resolvedModel };
  }

  if (res.status !== 200) throw new Error('Ollama ' + res.status + ': ' + String(res.text).slice(0, 200));
  var content = res.body && res.body.message && res.body.message.content;
  if (!content) throw new Error('Ollama empty response');
  return { content: content, model: (res.body && res.body.model) || resolvedModel };
}

// ─── Bob system prompt ────────────────────────────────────────────────────────

var ATTITUDE_PRESETS = {
  operational: 'Tone: calm, decisive, and practical. Prioritize concise operational steps and clear outcomes.',
  supportive: 'Tone: warm, reassuring, and respectful. Reduce stress while still giving direct, actionable guidance.',
  strict: 'Tone: compliance-first, firm, and unambiguous. Highlight policy and safety constraints early.',
  coach: 'Tone: instructive and developmental. Explain brief reasoning and teach the user the next best action.',
};

function buildBobSystemPrompt() {
  var attitude = ATTITUDE_PRESETS[BOB_ATTITUDE_PROFILE] || ATTITUDE_PRESETS.operational;
  var parts = [
    'You are Bob, the AI assistant for FieldOps Manager — a freedom camping enforcement platform in New Zealand. Be concise and actionable.',
    'Attitude profile: ' + attitude,
  ];
  if (BOB_ATTITUDE_INSTRUCTIONS) {
    parts.push('Attitude override: ' + BOB_ATTITUDE_INSTRUCTIONS);
  }
  return parts.join('\n\n');
}

var BOB_SYSTEM = buildBobSystemPrompt();

// ─── Action handlers ──────────────────────────────────────────────────────────

async function processJob(input) {
  if (!input) return { success: false, error: 'No input' };
  var action = input.action || 'chat';
  console.log('[worker] action=' + action);

  if (action === 'ping') {
    return { success: true, message: 'AI Engine online', model: OLLAMA_MODEL, provider: 'ollama' };
  }

  if (action === 'chat') {
    if (!input.message) return { success: false, error: 'message required' };
    var msgs = [
      { role: 'system', content: input.system_prompt || BOB_SYSTEM },
      ...(Array.isArray(input.history) ? input.history : []),
      { role: 'user', content: input.message },
    ];
    var r = await ollamaChat(msgs, input.model, input.temperature);
    return { success: true, response: r.content, message: r.content, model: r.model, provider: 'ollama' };
  }

  if (action === 'assess') {
    var text = input.symptom || input.description || input.imageDescription;
    if (!text) return { success: false, error: 'symptom/description required' };
    var sysMap = {
      smoke: 'Assess for biosecurity risk.',
      biosecurity: 'Assess for biosecurity risk.',
      noise: 'Assess noise complaint severity and recommended action.',
      ptt: 'Diagnose PTT radio issue with troubleshooting steps.',
      platform: 'Assess system health symptom and recommend resolution.',
    };
    var a = await ollamaChat([
      { role: 'system', content: sysMap[input.type] || 'Provide a structured assessment.' },
      { role: 'user', content: text + '\n\nRespond in JSON: { severity, summary, recommendation, actions }' },
    ], input.model, 0.3);
    var structured = null;
    try { var m = a.content.match(/\{[\s\S]*\}/); if (m) structured = JSON.parse(m[0]); } catch(e) {}
    return { success: true, type: input.type, assessment: structured || a.content, raw_response: a.content, model: a.model, provider: 'ollama' };
  }

  if (action === 'translate') {
    if (!input.text) return { success: false, error: 'text required' };
    var langs = { zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', mi: 'Te Reo Maori', fr: 'French', de: 'German', es: 'Spanish' };
    var t = await ollamaChat([
      { role: 'system', content: 'Translate to ' + (langs[input.target_language] || input.target_language || 'English') + '. Return only the translation.' },
      { role: 'user', content: input.text },
    ], input.model, 0.1);
    return { success: true, translation: t.content, translated_text: t.content, target_language: input.target_language, model: t.model, provider: 'ollama' };
  }

  return { success: false, error: 'Unknown action: ' + action };
}

// ─── RunPod polling loop ──────────────────────────────────────────────────────

var jobsInProgress = 0;

async function poll() {
  for (;;) {
    try {
      var getUrl = GET_JOB_URL + '&job_in_progress=' + (jobsInProgress > 0 ? '1' : '0');
      var jobRes = await httpReq(getUrl, { method: 'GET', timeout: 90000 });

      if (jobRes.status === 204 || !jobRes.body || !jobRes.body.id) {
        // No job — short pause then retry
        await new Promise(function(r) { setTimeout(r, 200); });
        continue;
      }

      var jobId = jobRes.body.id;
      var input = jobRes.body.input;
      console.log('[worker] Got job: ' + jobId);
      jobsInProgress++;

      // Process asynchronously so we can continue polling (concurrency)
      (async function() {
        var output;
        try {
          output = await processJob(input);
        } catch(err) {
          console.error('[worker] Job ' + jobId + ' error:', err.message || err);
          output = { success: false, error: err.message || String(err) };
        }

        try {
          // POST result: replace $ID with jobId, add isStream=false
          var postUrl = POST_OUT_BASE.replace('$ID', jobId) + '&isStream=false';
          await httpReq(postUrl, {
            form: JSON.stringify({ output: output }),
            timeout: 30000,
          });
          console.log('[worker] Job ' + jobId + ' done');
        } catch(err) {
          console.error('[worker] Failed to post result for ' + jobId + ':', err.message || err);
        }
        jobsInProgress--;
      })();

    } catch(err) {
      if (err.message !== 'timed out') {
        console.error('[worker] Poll error:', err.message || err);
        await new Promise(function(r) { setTimeout(r, 1000); });
      }
    }
  }
}

process.on('uncaughtException',  function(e) { console.error('[worker] Uncaught:', e); process.exit(1); });
process.on('unhandledRejection', function(e) { console.error('[worker] Rejection:', e); process.exit(1); });

poll();
