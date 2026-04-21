'use strict';

/**
 * RunPod Serverless Worker — FieldOps AI Engine (Bob)
 *
 * Standard RunPod Node.js worker: HTTP polling via RUNPOD_ env vars injected at runtime.
 *   RUNPOD_WEBHOOK_GET_JOB       — long-poll URL for next job
 *   RUNPOD_WEBHOOK_POST_OUTPUT   — URL to POST results (replace $ID with job id)
 */

const http  = require('http');
const https = require('https');

console.log('[worker] RunPod AI Worker starting');
console.log(`[worker] Node.js ${process.version}`);

const OLLAMA_BASE    = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const OLLAMA_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

console.log('[worker] OLLAMA_BASE:', OLLAMA_BASE);
console.log('[worker] OLLAMA_MODEL:', OLLAMA_MODEL);

function httpRequest(urlStr, options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    var url   = new URL(urlStr);
    var lib   = url.protocol === 'https:' ? https : http;
    var body  = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
    var reqOpts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   options.method || (body ? 'POST' : 'GET'),
      headers:  Object.assign({
        'Content-Type': 'application/json',
      }, body ? { 'Content-Length': body.length } : {}, options.headers || {}),
    };

    var req = lib.request(reqOpts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch(e) { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('error', reject);
    if (options.timeout) req.setTimeout(options.timeout, function() { req.destroy(new Error('timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

async function ollamaChat(messages, model, temperature) {
  temperature = temperature || 0.7;
  var res = await httpRequest(OLLAMA_BASE + '/api/chat', {
    body: { model: model || OLLAMA_MODEL, messages: messages, stream: false, options: { temperature: temperature } },
    timeout: OLLAMA_TIMEOUT,
  });
  if (res.status !== 200) throw new Error('Ollama error ' + res.status + ': ' + JSON.stringify(res.body).slice(0, 200));
  var content = res.body && res.body.message && res.body.message.content;
  if (!content) throw new Error('Ollama returned empty content');
  return { content: content, model: (res.body && res.body.model) || model || OLLAMA_MODEL };
}

var BOB_SYSTEM = 'You are Bob, the AI assistant for FieldOps Manager — a freedom camping enforcement platform in New Zealand. Be concise and actionable.';

async function processJob(input) {
  if (!input) return { success: false, error: 'No input provided' };
  var action = input.action || 'chat';
  console.log('[worker] action=' + action);

  if (action === 'ping') {
    return { success: true, message: 'AI Engine online', model: OLLAMA_MODEL, provider: 'ollama' };
  }

  if (action === 'chat') {
    var message = input.message;
    if (!message) return { success: false, error: 'message is required' };
    var messages = [
      { role: 'system', content: input.system_prompt || BOB_SYSTEM },
      ...(input.history || []),
      { role: 'user', content: message },
    ];
    var result = await ollamaChat(messages, input.model, input.temperature);
    return { success: true, response: result.content, message: result.content, model: result.model, provider: 'ollama' };
  }

  if (action === 'assess') {
    var text = input.symptom || input.description || input.imageDescription;
    if (!text) return { success: false, error: 'symptom or description required' };
    var typeMap = {
      smoke: 'Assess for biosecurity risk.',
      biosecurity: 'Assess for biosecurity risk.',
      noise: 'Assess noise complaint severity and recommended action.',
      ptt: 'Diagnose PTT radio issue with troubleshooting steps.',
      platform: 'Assess system health symptom and recommend resolution.',
    };
    var sysMsg = typeMap[input.type] || 'Assess the following and provide structured response.';
    var assess = await ollamaChat([
      { role: 'system', content: sysMsg },
      { role: 'user', content: text + '\n\nRespond in JSON: { severity, summary, recommendation, actions }' },
    ], input.model, 0.3);
    var structured = null;
    try { var m = assess.content.match(/\{[\s\S]*\}/); if (m) structured = JSON.parse(m[0]); } catch(e) {}
    return { success: true, type: input.type, assessment: structured || assess.content, raw_response: assess.content, model: assess.model, provider: 'ollama' };
  }

  if (action === 'translate') {
    if (!input.text) return { success: false, error: 'text is required' };
    var langNames = { zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', mi: 'Te Reo Maori', fr: 'French', de: 'German', es: 'Spanish' };
    var targetName = langNames[input.target_language] || input.target_language || 'English';
    var trans = await ollamaChat([
      { role: 'system', content: 'Translate to ' + targetName + '. Return only the translated text.' },
      { role: 'user', content: input.text },
    ], input.model, 0.1);
    return { success: true, translation: trans.content, translated_text: trans.content, target_language: input.target_language, model: trans.model, provider: 'ollama' };
  }

  return { success: false, error: 'Unknown action: ' + action };
}

// ─── RunPod polling loop ──────────────────────────────────────────────────────

var GET_JOB_URL  = process.env.RUNPOD_WEBHOOK_GET_JOB;
var POST_OUT_URL = process.env.RUNPOD_WEBHOOK_POST_OUTPUT;

if (!GET_JOB_URL || !POST_OUT_URL) {
  console.error('[worker] FATAL: RUNPOD_WEBHOOK_GET_JOB or RUNPOD_WEBHOOK_POST_OUTPUT not set');
  console.error('[worker] RUNPOD env keys:', Object.keys(process.env).filter(function(k) { return k.startsWith('RUNPOD'); }));
  process.exit(1);
}

console.log('[worker] Polling for jobs...');

async function poll() {
  for (;;) {
    try {
      var jobRes = await httpRequest(GET_JOB_URL, { method: 'GET', timeout: 300000 });

      if (!jobRes.body || !jobRes.body.id) {
        await new Promise(function(r) { setTimeout(r, 200); });
        continue;
      }

      var jobId = jobRes.body.id;
      var input = jobRes.body.input;
      console.log('[worker] Got job: ' + jobId);

      var output;
      try {
        output = await processJob(input);
      } catch(err) {
        console.error('[worker] Job ' + jobId + ' error:', err);
        output = { success: false, error: err.message || String(err) };
      }

      var postUrl = POST_OUT_URL.replace('${ID}', jobId).replace('$ID', jobId).replace(':id', jobId);
      await httpRequest(postUrl, { body: output, timeout: 30000 });
      console.log('[worker] Job ' + jobId + ' done');

    } catch(err) {
      console.error('[worker] Poll error:', err.message || err);
      await new Promise(function(r) { setTimeout(r, 1000); });
    }
  }
}

process.on('uncaughtException',  function(err) { console.error('[worker] Uncaught:', err); process.exit(1); });
process.on('unhandledRejection', function(err) { console.error('[worker] Rejection:', err); process.exit(1); });

poll();
