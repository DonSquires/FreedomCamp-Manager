/**
 * Code Tasks — Bob's code-writing queue
 *
 * Enables Bob to accept coding tasks, generate initial plans with Ollama,
 * and hand work off to the ops-bob-code-task GitHub Actions workflow which:
 *   1. Reads the task from GET /code/tasks/pending
 *   2. Uses GitHub Models API (gpt-4o) with FieldOps context to generate code
 *   3. Applies file operations (create / edit) to the repo
 *   4. Runs bun run build + bun run lint to validate
 *   5. Commits to a branch, creates a PR
 *   6. Reports back via POST /code/tasks/:id/result
 *
 * Task lifecycle:
 *   pending → in_progress (workflow picked it up)
 *   in_progress → completed (PR created)
 *   in_progress → failed (build/lint/parse failed)
 *   pending → skipped (manually skipped)
 *   pending → expired (not picked up within TTL_DAYS)
 *
 * Persistence: data/code-tasks.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TASKS = 200;
const TTL_DAYS = 30;
const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'code-tasks.json');

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
    counts: { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0, skipped: 0, expired: 0 },
    tasks: [],
  };
}

function readState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return defaultState();
    parsed.counts = parsed.counts || defaultState().counts;
    parsed.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
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
// Code Task Store
// ---------------------------------------------------------------------------

function createCodeTaskStore(statePath = DEFAULT_PATH) {
  let state = readState(statePath);

  function save() {
    state.updated_at = new Date().toISOString();
    writeState(statePath, state);
  }

  function rebuildCounts() {
    const counts = { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0, skipped: 0, expired: 0 };
    for (const t of state.tasks) {
      counts.total++;
      const s = t.status;
      if (counts[s] !== undefined) counts[s]++;
    }
    state.counts = counts;
  }

  function expireOldTasks() {
    const now = Date.now();
    const cutoff = TTL_DAYS * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const t of state.tasks) {
      if (t.status === 'pending' && now - new Date(t.created_at).getTime() > cutoff) {
        t.status = 'expired';
        t.expired_at = new Date().toISOString();
        changed = true;
      }
    }
    return changed;
  }

  function pruneToLimit() {
    if (state.tasks.length <= MAX_TASKS) return;
    const terminal = state.tasks.filter(t => t.status !== 'pending' && t.status !== 'in_progress');
    const active = state.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    terminal.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    state.tasks = [...active, ...terminal].slice(-MAX_TASKS);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Queue a new code task.
   *
   * @param {object} task
   *   task (string, required)           — what to build / fix
   *   context (string, optional)        — additional context or constraints
   *   target_files (string[], optional) — existing file paths to read when generating code
   *   priority ('normal'|'high')        — default 'normal'
   *   requested_by (string, optional)   — email or user id of requester
   *   bob_plan (string, optional)       — initial Ollama-generated plan
   *
   * @returns the created task object
   */
  function queueTask(options = {}) {
    const task = String(options.task || '').trim();
    if (!task) throw new Error('task must be a non-empty string describing what to build or fix');
    if (task.length > 4000) throw new Error('task must be 4000 characters or fewer');

    expireOldTasks();
    pruneToLimit();

    const id = crypto.randomUUID();
    const shortId = id.slice(0, 8);

    const entry = {
      id,
      short_id: shortId,
      task,
      context: options.context ? String(options.context).slice(0, 2000) : null,
      target_files: Array.isArray(options.target_files)
        ? options.target_files.map(f => String(f).slice(0, 500)).slice(0, 20)
        : [],
      priority: options.priority === 'high' ? 'high' : 'normal',
      requested_by: options.requested_by ? String(options.requested_by).slice(0, 200) : null,
      bob_plan: options.bob_plan ? String(options.bob_plan).slice(0, 8000) : null,
      plan_source: options.plan_source ? String(options.plan_source).slice(0, 100) : 'none',
      quality_gate: options.quality_gate && typeof options.quality_gate === 'object'
        ? {
            status: String(options.quality_gate.status || 'unknown').slice(0, 50),
            failed_gates: Array.isArray(options.quality_gate.failed_gates)
              ? options.quality_gate.failed_gates.map((item) => String(item).slice(0, 100)).slice(0, 20)
              : [],
            missing_sections: Array.isArray(options.quality_gate.missing_sections)
              ? options.quality_gate.missing_sections.map((item) => String(item).slice(0, 200)).slice(0, 20)
              : [],
            hallucinated_modules: Array.isArray(options.quality_gate.hallucinated_modules)
              ? options.quality_gate.hallucinated_modules.map((item) => String(item).slice(0, 100)).slice(0, 50)
              : [],
            fallback_applied: options.quality_gate.fallback_applied === true,
            fallback_source: options.quality_gate.fallback_source
              ? String(options.quality_gate.fallback_source).slice(0, 300)
              : null,
          }
        : null,
      status: 'pending',
      branch: `bob/task-${shortId}`,
      pr_url: null,
      pr_number: null,
      files_changed: null,
      build_passed: null,
      error: null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      failed_at: null,
    };

    state.tasks.push(entry);
    rebuildCounts();
    save();

    console.log(`📋 Code task queued [${shortId}]: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}`);
    return entry;
  }

  /**
   * Mark a task as in_progress (workflow has picked it up).
   */
  function startTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) throw new Error(`Code task not found: ${id}`);
    if (task.status !== 'pending') throw new Error(`Task ${id} is not pending (status: ${task.status})`);
    task.status = 'in_progress';
    task.started_at = new Date().toISOString();
    rebuildCounts();
    save();
    return task;
  }

  /**
   * Record a successful result (PR created).
   *
   * @param {string} id
   * @param {object} result
   *   pr_url (string)            — URL of the created PR
   *   pr_number (number)         — PR number
   *   files_changed (string[])   — list of file paths that were created/modified
   *   build_passed (boolean)     — whether bun run build succeeded
   *   branch (string, optional)  — branch name (overrides default)
   */
  function completeTask(id, result = {}) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) throw new Error(`Code task not found: ${id}`);

    task.status = 'completed';
    task.pr_url = result.pr_url ? String(result.pr_url).slice(0, 500) : null;
    task.pr_number = result.pr_number ? Number(result.pr_number) : null;
    task.files_changed = Array.isArray(result.files_changed) ? result.files_changed : null;
    task.build_passed = result.build_passed === true;
    task.completed_at = new Date().toISOString();
    if (result.branch) task.branch = String(result.branch).slice(0, 200);

    rebuildCounts();
    save();

    console.log(`✅ Code task completed [${task.short_id}] → PR: ${task.pr_url}`);
    return task;
  }

  /**
   * Record a failure (build failed, parse error, etc.).
   */
  function failTask(id, error) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) throw new Error(`Code task not found: ${id}`);
    task.status = 'failed';
    task.error = error ? String(error).slice(0, 1000) : 'Unknown error';
    task.failed_at = new Date().toISOString();
    rebuildCounts();
    save();
    return task;
  }

  /**
   * Skip a pending task (manually cancelled).
   */
  function skipTask(id, reason) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) throw new Error(`Code task not found: ${id}`);
    if (task.status !== 'pending') throw new Error(`Task ${id} is not pending (status: ${task.status})`);
    task.status = 'skipped';
    task.error = reason ? String(reason).slice(0, 500) : 'Manually skipped';
    task.failed_at = new Date().toISOString();
    rebuildCounts();
    save();
    return task;
  }

  /**
   * Delete a task by ID.
   */
  function deleteTask(id) {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter(t => t.id !== id);
    if (state.tasks.length === before) throw new Error(`Code task not found: ${id}`);
    rebuildCounts();
    save();
  }

  /**
   * Get a single task by ID.
   */
  function getTask(id) {
    return state.tasks.find(t => t.id === id) || null;
  }

  /**
   * List tasks with optional filters.
   */
  function listTasks(filter = {}) {
    expireOldTasks();
    let results = [...state.tasks];

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter(t => statuses.includes(t.status));
    }
    if (filter.priority) {
      results = results.filter(t => t.priority === filter.priority);
    }

    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const limit = Math.min(Number(filter.limit) || 50, 100);
    return results.slice(0, limit);
  }

  /**
   * List pending tasks only (for GH workflow polling).
   * High-priority tasks are returned first.
   */
  function listPending(limit = 10) {
    expireOldTasks();
    const pending = state.tasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        // High priority first, then oldest first (FIFO within same priority)
        if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
        return new Date(a.created_at) - new Date(b.created_at);
      })
      .slice(0, Math.min(limit, 20));
    return pending;
  }

  /**
   * Get summary state for /health.
   */
  function getState() {
    expireOldTasks();
    rebuildCounts();
    return {
      version: state.version,
      updated_at: state.updated_at,
      counts: { ...state.counts },
      ttl_days: TTL_DAYS,
      max_tasks: MAX_TASKS,
    };
  }

  return {
    queueTask,
    startTask,
    completeTask,
    failTask,
    skipTask,
    deleteTask,
    getTask,
    listTasks,
    listPending,
    getState,
  };
}

module.exports = { createCodeTaskStore };
