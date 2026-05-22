import 'dotenv/config';
import express, { Request, Response } from 'express';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { applyAgentPatch } from './agentTools.js';
import { runInSandboxEmulator } from './validator.js';

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

const CHAT_DB_TIMEOUT_MS = Number(process.env.CHAT_DB_TIMEOUT_MS ?? 2500);
const CHAT_CONTEXT_TIMEOUT_MS = Number(process.env.CHAT_CONTEXT_TIMEOUT_MS ?? 3500);
const OLLAMA_MODEL_TIMEOUT_MS = Number(process.env.OLLAMA_MODEL_TIMEOUT_MS ?? 7000);
const OLLAMA_TOTAL_TIMEOUT_MS = Number(process.env.OLLAMA_TOTAL_TIMEOUT_MS ?? 18000);
const OLLAMA_STREAM_TIMEOUT_MS = Number(process.env.OLLAMA_STREAM_TIMEOUT_MS ?? 25000);
const OLLAMA_MAX_CANDIDATES = Math.max(1, Number(process.env.OLLAMA_MAX_CANDIDATES ?? 3));

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

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : undefined);
const SUPABASE_SERVICE_ROLE_KEY = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY']);

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

function triggerTrainingSync(source: string): void {
  const child = spawn('npx', ['ts-node', '--esm', 'scripts/sync-training.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, TRAINING_TRIGGER_SOURCE: source },
  });
  child.unref();
}

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: 'fieldops-backend' });
});

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

async function getTierAKnowledgeContext(): Promise<{ schemaPayload: string; systemRules: string }> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('system_knowledge_base')
        .select('schema_payload, system_rules')
        .eq('service_name', 'railway-backend')
        .maybeSingle(),
    ),
    CHAT_CONTEXT_TIMEOUT_MS,
    'system_knowledge_base select',
  ).catch((timeout) => {
    console.warn('[/api/heal] system_knowledge_base timed out/failed', timeout);
    return {
      data: { schema_payload: 'Unavailable', system_rules: 'Unavailable' },
      error: null,
    } as { data: { schema_payload: string; system_rules: string }; error: unknown };
  });

  if (error) {
    console.warn('[/api/heal] Failed to load system_knowledge_base', error);
    return {
      schemaPayload: 'Unavailable',
      systemRules: 'Unavailable',
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
  };
}

// ── POST /api/heal ───────────────────────────────────────────────────────────
//    Multi-agent assembly line:
//    1. Fetch system templates & rules from Supabase
//    2. Dr. Bob (critic) analyses the error
//    3. Bob (fixer) proposes a patch
//    4. Sandbox emulator validates the patch
//    5. Save PENDING_HUMAN_REVIEW record
app.post('/api/heal', async (req: Request, res: Response) => {
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

  const stackTrace = (req.body as { stackTrace?: string }).stackTrace;
  const userPrompt = (req.body as { userPrompt?: string }).userPrompt;
  const sessionId = normalizeChatSessionId(
    (req.body as { sessionId?: string; session_id?: string }).sessionId ??
      (req.body as { sessionId?: string; session_id?: string }).session_id,
  );

  if (errorMessage === 'MANUAL_USER_INSTRUCTION') {
    const inboundText = (stackTrace ?? userPrompt ?? '').trim();
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

    console.log(`[CHAT INBOUND] Human user sent direct instruction to Bob: "${inboundText}"`);

    const [kb, consultativeRunbook, persistedHistory] = await Promise.all([
      getTierAKnowledgeContext(),
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

    const chatPrompt = `
You are interacting live with a human engineer through a command center UI.
The user states: "${inboundText}"

  Conversation history:
  ${conversationTranscript}

Structured recent history array:
${promptHistoryJson}

Reference Blueprints (Tier A): ${kb.schemaPayload}
System Operational Rules: ${kb.systemRules}

Consultative Reference Runbook (Tier B):
${consultativeRunbook}

Return ONLY one JSON object with this routing contract:
- If the user is chatting, asking a question, or requesting a status update, respond with:
  {"intentType":"conversation","conversationalReply":"<markdown response>"}
- If the user is explicitly asking for a system patch or config mutation, respond with:
  {"intentType":"patch","targetVariable":"<name>","patchValue":"<value>","conversationalReply":"<optional markdown summary>"}

Do not return plain text outside the JSON object.
`;

    if (req.body.stream === true) {
      const primaryModel = getOllamaModelCandidates()[0] ?? 'llama3.2:3b';
      let streamedModelOutput = '';
      try {
        streamedModelOutput = await streamOllamaResponseToClient(res, chatPrompt, primaryModel)
      } catch (error) {
        console.error('[/api/heal] Stream generation failed', error);
        const degradedText = 'Bob is temporarily unavailable (model upstream). Please retry in a moment.';
        res.write(`data: ${JSON.stringify({ type: 'final', text: degradedText })}\n\n`)
        res.write(`data: ${JSON.stringify({ type: 'done', text: degradedText })}\n\n`)
        res.end()
        await appendChatSessionMessage(sessionId, 'assistant', degradedText);
        return
      }

      const routed = normalizeRoutedBobResponse(streamedModelOutput);
      const assistantText = routed.intentType === 'patch'
        ? JSON.stringify({ targetVariable: routed.targetVariable, patchValue: routed.patchValue })
        : String(routed.conversationalReply ?? streamedModelOutput ?? '').trim();
      await appendChatSessionMessage(sessionId, 'assistant', assistantText);
      return
    }

    let modelText = '';
    let modelUsed = '';
    try {
      const result = await generateWithModelFallback('', chatPrompt);
      modelText = result.responseText.trim();
      modelUsed = result.modelUsed;
    } catch (error) {
      console.error('[/api/heal] Non-stream generation failed', error);
      const degradedText = 'Bob is temporarily unavailable (model upstream). Please retry in a moment.';
      await appendChatSessionMessage(sessionId, 'assistant', degradedText);

      res.status(200).json({
        bobResponse: degradedText,
        status: 'DEGRADED',
        sessionId,
        intentType: 'conversation',
        conversationalReply: degradedText,
      });
      return;
    }

    console.log(`[/api/heal] Manual instruction generated via model ${modelUsed}`);
    const routed = normalizeRoutedBobResponse(modelText);
    const bobResponse = routed.intentType === 'patch'
      ? JSON.stringify({ targetVariable: routed.targetVariable, patchValue: routed.patchValue })
      : String(routed.conversationalReply ?? modelText).trim();

    await appendChatSessionMessage(sessionId, 'assistant', bobResponse);

    res.status(200).json({
      bobResponse,
      status: 'COMPLETED',
      sessionId,
      conversationalReply: routed.conversationalReply,
      targetVariable: routed.targetVariable,
      patchValue: routed.patchValue,
      intentType: routed.intentType,
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
  const consultativeRunbook = await getConsultativeReferenceRunbook(errorString, 'dr_bob');

  // 2 ── Dr. Bob: critic agent
  const drBobAnalysis = await promptOllama(
    'Dr. Bob',
    `You are Dr. Bob, a senior adversarial code reviewer. 
     Given the following Tier A system context: ${contextSummary}
     Consultative Reference Runbook:\n${consultativeRunbook}
     Identify the root cause of the error and list the top risks.`,
    `Error payload: ${errorString}`
  );

  // 3 ── Bob: fixer agent
  const bobPatch = await promptOllama(
    'Bob',
    `You are Bob, a senior site-reliability engineer.
     Dr. Bob's analysis: ${drBobAnalysis}
     System context: ${contextSummary}
     Propose a single environment-variable patch as JSON: 
     { "variableName": string, "variableValue": string, "justification": string }`,
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

  const safe = await runInSandboxEmulator(parsedPatch.variableValue, parsedPatch.variableName);

  // 5 ── Save review record
  const { data: record, error: insertError } = await supabase
    .from('heal_patches')
    .insert({
      status: safe ? 'PENDING_HUMAN_REVIEW' : 'BLOCKED_BY_SANDBOX',
      error_payload: errorPayload,
      dr_bob_analysis: drBobAnalysis,
      patch: parsedPatch,
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
app.post('/api/approve-patch', async (req: Request, res: Response) => {
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

  res.json({ status: 'DEPLOYED', patchId, variableName });
});

// ── POST /api/gitea/propose-pr ──────────────────────────────────────────────
//    Constrained repo writer:
//    1. Create a branch from base branch
//    2. Write one or more files via Gitea Contents API
//    3. Open a pull request
app.post('/api/gitea/propose-pr', async (req: Request, res: Response) => {
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

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[FieldOps Backend] Listening on port ${PORT}`);
});
