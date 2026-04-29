/**
 * Knowledge Requests — Bob's bidirectional learning channel
 *
 * When Bob encounters a question he cannot answer from his built-in knowledge,
 * he queues it here. The ops-bob-ask-copilot GitHub Actions workflow polls
 * GET /ask-copilot/pending, researches answers via GitHub Copilot / GitHub
 * Models API, and sends the answer back via POST /ask-copilot/:id/answer.
 *
 * The answer is then ingested into Bob's intel feed so all future queries
 * benefit from the new knowledge.
 *
 * Persistence: data/knowledge-requests.json (same pattern as intel-state.json)
 *
 * Request lifecycle:
 *   pending → answered (normal path)
 *   pending → skipped  (Copilot couldn't find an answer)
 *   pending → expired  (not answered within TTL_DAYS)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_REQUESTS = 500;   // Maximum stored requests (oldest answered/expired purged first)
const TTL_DAYS = 14;         // Pending requests expire after this many days
const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'knowledge-requests.json');

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultState() {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    counts: { total: 0, pending: 0, answered: 0, skipped: 0, expired: 0 },
    requests: [],
  };
}

function readState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return defaultState();
    parsed.counts = parsed.counts || defaultState().counts;
    parsed.requests = Array.isArray(parsed.requests) ? parsed.requests : [];
    return parsed;
  } catch {
    return defaultState();
  }
}

function writeState(filePath, state) {
  ensureDirFor(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Request creation helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ['supabase', 'railway', 'github', 'vercel', 'expo', 'domain', 'email', 'ptt', 'patrol', 'legal', 'ui', 'general'];

function normalizeCategory(category) {
  const v = String(category || '').toLowerCase();
  return VALID_CATEGORIES.includes(v) ? v : 'general';
}

function inferCategory(question) {
  const q = question.toLowerCase();
  if (q.includes('supabase') || q.includes('edge function') || q.includes('rls') || q.includes('migration') || q.includes('postgres')) return 'supabase';
  if (q.includes('railway') || q.includes('docker') || q.includes('deploy') || q.includes('container')) return 'railway';
  if (q.includes('github') || q.includes('action') || q.includes('workflow') || q.includes('codespace') || q.includes('copilot')) return 'github';
  if (q.includes('vercel') || q.includes('frontend') || q.includes('vite') || q.includes('react')) return 'vercel';
  if (q.includes('expo') || q.includes('mobile') || q.includes('android') || q.includes('ios') || q.includes('eas')) return 'expo';
  if (q.includes('domain') || q.includes('dns') || q.includes('ssl') || q.includes('certificate') || q.includes('cors')) return 'domain';
  if (q.includes('email') || q.includes('smtp') || q.includes('mail') || q.includes('zoho') || q.includes('resend')) return 'email';
  if (q.includes('ptt') || q.includes('push to talk') || q.includes('voice') || q.includes('walkie') || q.includes('webrtc')) return 'ptt';
  if (q.includes('patrol') || q.includes('officer') || q.includes('breach') || q.includes('zone') || q.includes('enforcement')) return 'patrol';
  if (q.includes('legal') || q.includes('law') || q.includes('privacy') || q.includes('act')) return 'legal';
  if (q.includes('ui') || q.includes('component') || q.includes('button') || q.includes('form') || q.includes('design')) return 'ui';
  return 'general';
}

function normalizeScopePart(value, fallback = 'unknown') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  return text.replace(/[^a-z0-9_-]/g, '_').slice(0, 120) || fallback;
}

function normalizeScope(scope = {}) {
  const orgId = scope.org_id ? String(scope.org_id).trim() : null;
  const userId = scope.user_id ? String(scope.user_id).trim() : null;
  const scopeKey = `${normalizeScopePart(orgId || 'org-shared', 'org-shared')}::${normalizeScopePart(userId || 'user-shared', 'user-shared')}`;
  return {
    org_id: orgId,
    user_id: userId,
    scope_key: scopeKey,
  };
}

function requestInScope(request, scope) {
  if (!scope) return true;
  const normalized = normalizeScope(scope);
  const requestScopeKey = String(request?.scope_key || normalizeScope({ org_id: request?.org_id || null, user_id: request?.user_id || null }).scope_key);
  return requestScopeKey === normalized.scope_key;
}

function buildPendingIndexKey(scopeKey, question) {
  return `${scopeKey}::${String(question || '').toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Knowledge Request Store
// ---------------------------------------------------------------------------

function createKnowledgeRequestStore(statePath = DEFAULT_PATH) {
  let state = readState(statePath);

  // O(1) dedup index: maps scope_key + normalized question text → request id for pending requests
  const pendingIndex = new Map(
    state.requests
      .filter(r => r.status === 'pending')
      .map((r) => {
        const scope = normalizeScope({ org_id: r.org_id || null, user_id: r.user_id || null });
        return [buildPendingIndexKey(scope.scope_key, r.question), r.id];
      })
  );

  function save() {
    state.updated_at = new Date().toISOString();
    writeState(statePath, state);
  }

  function rebuildCounts() {
    const counts = { total: 0, pending: 0, answered: 0, skipped: 0, expired: 0 };
    for (const r of state.requests) {
      counts.total++;
      if (r.status === 'pending') counts.pending++;
      else if (r.status === 'answered') counts.answered++;
      else if (r.status === 'skipped') counts.skipped++;
      else if (r.status === 'expired') counts.expired++;
    }
    state.counts = counts;
  }

  function expireOldRequests() {
    const now = Date.now();
    const cutoff = TTL_DAYS * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const r of state.requests) {
      if (r.status === 'pending' && now - new Date(r.asked_at).getTime() > cutoff) {
        r.status = 'expired';
        r.expired_at = new Date().toISOString();
        const expiredScope = normalizeScope({ org_id: r.org_id || null, user_id: r.user_id || null });
        pendingIndex.delete(buildPendingIndexKey(expiredScope.scope_key, r.question));
        changed = true;
      }
    }
    return changed;
  }

  function pruneToLimit() {
    if (state.requests.length <= MAX_REQUESTS) return false;
    // Remove oldest answered/expired/skipped first, then oldest pending
    const terminal = state.requests.filter(r => r.status !== 'pending');
    const pending = state.requests.filter(r => r.status === 'pending');
    terminal.sort((a, b) => new Date(a.asked_at) - new Date(b.asked_at));
    const keep = [...pending, ...terminal].slice(-MAX_REQUESTS);
    state.requests = keep;
    return true;
  }

  /**
   * Queue a new knowledge request.
   * Returns the created request object.
   */
  function queueRequest(question, options = {}) {
    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new Error('question must be a non-empty string');
    }

    const trimmed = question.trim().slice(0, 2000);
    const scope = normalizeScope(options.scope || {});
    const dedupKey = buildPendingIndexKey(scope.scope_key, trimmed);

    // O(1) dedup: if an identical pending question already exists in the same scope, return it
    const existingId = pendingIndex.get(dedupKey);
    if (existingId) {
      const existing = state.requests.find(r => r.id === existingId);
      if (existing) return existing;
    }

    expireOldRequests();

    const request = {
      id: crypto.randomUUID(),
      question: trimmed,
      category: options.category ? normalizeCategory(options.category) : inferCategory(trimmed),
      context: options.context ? String(options.context).slice(0, 500) : null,
      source: options.source ? String(options.source).slice(0, 100) : 'manual',
      priority: options.priority === 'high' ? 'high' : 'normal',
      org_id: scope.org_id,
      user_id: scope.user_id,
      scope_key: scope.scope_key,
      status: 'pending',
      asked_at: new Date().toISOString(),
      answered_at: null,
      answer: null,
      answer_source: null,
      github_issue_url: null,
    };

    pendingIndex.set(dedupKey, request.id);
    state.requests.push(request);
    pruneToLimit();
    rebuildCounts();
    save();

    console.log(`🧠 Knowledge request queued [${request.id.slice(0, 8)}] (${request.category}): ${trimmed.slice(0, 80)}...`);
    return request;
  }

  /**
   * Record an answer to a pending request.
   * Returns the updated request.
   */
  function answerRequest(id, answer, options = {}) {
    const request = state.requests.find(r => r.id === id);
    if (!request || !requestInScope(request, options.scope)) throw new Error(`Knowledge request not found: ${id}`);
    if (request.status === 'answered') return request; // idempotent

    const trimmedAnswer = String(answer || '').trim().slice(0, 10000);
    if (!trimmedAnswer) throw new Error('answer must be a non-empty string');

    pendingIndex.delete(buildPendingIndexKey(String(request.scope_key || normalizeScope({ org_id: request.org_id || null, user_id: request.user_id || null }).scope_key), request.question));
    request.status = 'answered';
    request.answer = trimmedAnswer;
    request.answer_source = options.source ? String(options.source).slice(0, 100) : 'copilot';
    request.answered_at = new Date().toISOString();
    if (options.github_issue_url) {
      request.github_issue_url = String(options.github_issue_url).slice(0, 500);
    }

    rebuildCounts();
    save();

    console.log(`✅ Knowledge request answered [${request.id.slice(0, 8)}] via ${request.answer_source}`);
    return request;
  }

  /**
   * Mark a request as skipped (Copilot could not research an answer).
   */
  function skipRequest(id, reason, options = {}) {
    const request = state.requests.find(r => r.id === id);
    if (!request || !requestInScope(request, options.scope)) throw new Error(`Knowledge request not found: ${id}`);
    if (request.status !== 'pending') return request;

    pendingIndex.delete(buildPendingIndexKey(String(request.scope_key || normalizeScope({ org_id: request.org_id || null, user_id: request.user_id || null }).scope_key), request.question));
    request.status = 'skipped';
    request.skip_reason = reason ? String(reason).slice(0, 500) : 'No answer available';
    request.skipped_at = new Date().toISOString();

    rebuildCounts();
    save();
    return request;
  }

  /**
   * Delete a request by ID.
   */
  function deleteRequest(id, options = {}) {
    const before = state.requests.length;
    state.requests = state.requests.filter(r => !(r.id === id && requestInScope(r, options.scope)));
    if (state.requests.length === before) throw new Error(`Knowledge request not found: ${id}`);
    rebuildCounts();
    save();
  }

  /**
   * List requests, optionally filtered by status.
   */
  function listRequests(filter = {}) {
    expireOldRequests();
    let results = [...state.requests];

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter(r => statuses.includes(r.status));
    }
    if (filter.category) {
      results = results.filter(r => r.category === filter.category);
    }
    if (filter.priority) {
      results = results.filter(r => r.priority === filter.priority);
    }
    if (filter.scope) {
      const scope = normalizeScope(filter.scope);
      results = results.filter((r) => String(r.scope_key || normalizeScope({ org_id: r.org_id || null, user_id: r.user_id || null }).scope_key) === scope.scope_key);
    }
    if (filter.org_id) {
      results = results.filter((r) => (r.org_id || null) === String(filter.org_id));
    }
    if (filter.user_id) {
      results = results.filter((r) => (r.user_id || null) === String(filter.user_id));
    }

    // Most recently asked first
    results.sort((a, b) => new Date(b.asked_at) - new Date(a.asked_at));

    const limit = Math.min(Number(filter.limit) || 100, MAX_REQUESTS);
    return results.slice(0, limit);
  }

  /**
   * Get a single request by ID.
   */
  function getRequest(id, options = {}) {
    return state.requests.find((r) => r.id === id && requestInScope(r, options.scope)) || null;
  }

  /**
   * Get summary counts.
   */
  function getCounts() {
    expireOldRequests();
    rebuildCounts();
    return { ...state.counts };
  }

  /**
   * Get full state snapshot (for health/debug endpoints).
   */
  function getState() {
    expireOldRequests();
    rebuildCounts();
    return {
      version: state.version,
      updated_at: state.updated_at,
      counts: { ...state.counts },
      ttl_days: TTL_DAYS,
      max_requests: MAX_REQUESTS,
    };
  }

  // Expose store
  return {
    queueRequest,
    answerRequest,
    skipRequest,
    deleteRequest,
    listRequests,
    getRequest,
    getCounts,
    getState,
    VALID_CATEGORIES,
  };
}

module.exports = { createKnowledgeRequestStore };
