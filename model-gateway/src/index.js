import process from 'node:process';
import express from 'express';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3000);
const REQUEST_TIMEOUT_MS = Number(process.env.MODEL_GATEWAY_TIMEOUT_MS || 90000);

function resolveRunpodInvokeUrl() {
  const explicit = String(process.env.RUNPOD_ENDPOINT_URL || process.env.RUNPOD_RUNSYNC_URL || '').trim().replace(/\/+$/, '');
  if (explicit) {
    if (explicit.endsWith('/runsync')) return explicit;
    if (explicit.endsWith('/run-sync')) return `${explicit.slice(0, -9)}/runsync`;
    if (explicit.endsWith('/run')) return `${explicit.slice(0, -4)}/runsync`;
    if (/\/v2\/[^/]+$/i.test(explicit)) return `${explicit}/runsync`;
    return explicit;
  }

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  if (!endpointId) {
    return '';
  }
  return `https://api.runpod.ai/v2/${endpointId}/runsync`;
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function extractModelText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const direct = [
    payload.response,
    payload.text,
    payload.output_text,
    payload.output,
    payload.generated_text,
    payload.message,
  ];

  for (const candidate of direct) {
    const text = asText(candidate).trim();
    if (text) return text;
  }

  const nested = payload.output?.text || payload.output?.response || payload.output?.message;
  const nestedText = asText(nested).trim();
  if (nestedText) return nestedText;

  if (Array.isArray(payload.output)) {
    const chunks = payload.output
      .map((item) => asText(item?.text || item?.content || item?.response).trim())
      .filter(Boolean);
    if (chunks.length > 0) return chunks.join('\n');
  }

  return '';
}

function buildPrompt(systemPrompt, userPrompt) {
  const system = asText(systemPrompt).trim();
  const user = asText(userPrompt).trim();
  if (system && user) {
    return `${system}\n\n${user}`;
  }
  return system || user;
}

async function callRunpod(prompt, model) {
  const invokeUrl = resolveRunpodInvokeUrl();
  const apiKey = String(
    process.env.RUNPOD_ENDPOINT_API_KEY || process.env.RUNPOD_API_KEY || process.env.DR_BOB_API || '',
  ).trim();

  if (!invokeUrl || !apiKey) {
    throw new Error('RunPod endpoint is not configured (RUNPOD_ENDPOINT_URL/RUNPOD_ENDPOINT_ID + API key required).');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt,
          model: model || undefined,
        },
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`RunPod HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
    }

    const output = payload.output || payload;
    const modelText = extractModelText(output || payload);
    if (!modelText) {
      throw new Error('RunPod returned no usable text output.');
    }

    return {
      modelText,
      provider: 'runpod',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOllamaFallback(prompt, model) {
  const fallbackUrl = String(process.env.OLLAMA_FALLBACK_URL || '').trim().replace(/\/+$/, '');
  if (!fallbackUrl) {
    throw new Error('OLLAMA_FALLBACK_URL is not configured.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${fallbackUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:7b',
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`Ollama fallback HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
    }

    const modelText = asText(payload.response).trim();
    if (!modelText) {
      throw new Error('Ollama fallback returned no text output.');
    }

    return {
      modelText,
      provider: 'ollama_fallback',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get('/health', async (_req, res) => {
  const runpodConfigured = Boolean(resolveRunpodInvokeUrl());
  const ollamaFallbackConfigured = Boolean(String(process.env.OLLAMA_FALLBACK_URL || '').trim());

  res.status(200).json({
    status: 'ok',
    service: 'fieldops-model-gateway',
    providers: {
      runpodConfigured,
      ollamaFallbackConfigured,
    },
  });
});

app.post('/api/generate', async (req, res) => {
  const model = asText(req.body?.model).trim();
  const prompt = buildPrompt(req.body?.system, req.body?.prompt);

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const errors = [];

  try {
    const runpod = await callRunpod(prompt, model);
    res.status(200).json({
      response: runpod.modelText,
      model: model || process.env.RUNPOD_MODEL || 'runpod-default',
      provider: runpod.provider,
    });
    return;
  } catch (error) {
    errors.push(`runpod: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const ollama = await callOllamaFallback(prompt, model);
    res.status(200).json({
      response: ollama.modelText,
      model: model || process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:7b',
      provider: ollama.provider,
      providerErrors: errors,
    });
    return;
  } catch (error) {
    errors.push(`ollama_fallback: ${error instanceof Error ? error.message : String(error)}`);
  }

  res.status(502).json({
    error: 'No model providers succeeded.',
    providerErrors: errors,
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const model = asText(req.body?.model).trim();
  const prompt = messages
    .map((message) => `${asText(message?.role) || 'user'}: ${asText(message?.content).trim()}`)
    .join('\n')
    .trim();

  if (!prompt) {
    res.status(400).json({ error: 'messages are required' });
    return;
  }

  const errors = [];
  try {
    const runpod = await callRunpod(prompt, model);
    res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || process.env.RUNPOD_MODEL || 'runpod-default',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: runpod.modelText },
          finish_reason: 'stop',
        },
      ],
    });
    return;
  } catch (error) {
    errors.push(`runpod: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const ollama = await callOllamaFallback(prompt, model);
    res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:7b',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: ollama.modelText },
          finish_reason: 'stop',
        },
      ],
      providerErrors: errors,
    });
    return;
  } catch (error) {
    errors.push(`ollama_fallback: ${error instanceof Error ? error.message : String(error)}`);
  }

  res.status(502).json({
    error: 'No model providers succeeded.',
    providerErrors: errors,
  });
});

app.listen(PORT, () => {
  console.log(`[model-gateway] listening on :${PORT}`);
});
