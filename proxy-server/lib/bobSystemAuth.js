const { createClient } = require('@supabase/supabase-js');

function ensureWebSocketSupport() {
  if (typeof globalThis.WebSocket === 'function') return;

  try {
    const ws = require('ws');
    if (typeof ws === 'function') {
      globalThis.WebSocket = ws;
    } else if (ws && typeof ws.WebSocket === 'function') {
      globalThis.WebSocket = ws.WebSocket;
    }
  } catch (error) {
    throw new Error('Node.js runtime is missing WebSocket support. Install "ws" package or upgrade Node.js.');
  }

  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('Node.js runtime does not provide a usable WebSocket implementation.');
  }
}

const state = {
  configured: false,
  ready: false,
  inFlight: false,
  accessToken: null,
  refreshToken: null,
  expiresAtMs: 0,
  userId: null,
  email: null,
  timer: null,
  lastError: null,
  lastFailureKind: null,
  lastFailureAt: null,
  lastRefreshAt: null,
  refreshFailures: 0,
};

let supabase = null;

function getConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const email = String(process.env.BOB_SYSTEM_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BOB_SYSTEM_PASSWORD || '').trim();
  const refreshBufferSeconds = Math.max(30, Number(process.env.BOB_SYSTEM_REFRESH_BUFFER_SECONDS || 120));

  return {
    supabaseUrl,
    supabaseKey,
    email,
    password,
    refreshBufferSeconds,
    configured: Boolean(supabaseUrl && supabaseKey && email && password),
  };
}

function clearTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function scheduleRefresh() {
  clearTimer();

  if (!state.expiresAtMs) return;

  const cfg = getConfig();
  const refreshAt = state.expiresAtMs - cfg.refreshBufferSeconds * 1000;
  const delayMs = Math.max(30_000, refreshAt - Date.now());

  state.timer = setTimeout(() => {
    rotateSession().catch((error) => {
      console.error('[bob-system-auth] Scheduled rotation failed:', error.message || error);
    });
  }, delayMs);
}

function applySession(session, email) {
  const accessToken = String(session?.access_token || '').trim();
  const refreshToken = String(session?.refresh_token || '').trim();

  if (!accessToken || !refreshToken) {
    throw new Error('Supabase auth session is missing access/refresh token.');
  }

  const expiresAtSeconds = Number(session?.expires_at || 0);
  const expiresInSeconds = Number(session?.expires_in || 0);
  const expiresAtMs = Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
    ? expiresAtSeconds * 1000
    : Date.now() + Math.max(60, expiresInSeconds || 3600) * 1000;

  state.accessToken = accessToken;
  state.refreshToken = refreshToken;
  state.expiresAtMs = expiresAtMs;
  state.userId = String(session?.user?.id || state.userId || '').trim() || null;
  state.email = email;
  state.ready = true;
  state.lastError = null;
  state.lastFailureKind = null;
  state.lastFailureAt = null;
  state.lastRefreshAt = new Date().toISOString();
  scheduleRefresh();
}

function classifyFailure(error) {
  const message = String(error?.message || error || '').toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'credentials';
  }

  if (message.includes('missing supabase/bob system login env variables')) {
    return 'configuration';
  }

  if (message.includes('websocket support') || message.includes('node.js runtime')) {
    return 'runtime';
  }

  return 'unknown';
}

function recordFailure(error) {
  state.ready = false;
  state.lastError = String(error?.message || error || 'Unknown Bob auth failure');
  state.lastFailureKind = classifyFailure(error);
  state.lastFailureAt = new Date().toISOString();
}

async function signInWithPassword() {
  const cfg = getConfig();
  if (!cfg.configured) {
    throw new Error('Missing Supabase/Bob system login env variables.');
  }

  ensureWebSocketSupport();

  if (!supabase) {
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cfg.email,
    password: cfg.password,
  });

  if (error) {
    throw new Error(`signInWithPassword failed: ${error.message}`);
  }

  if (!data?.session) {
    throw new Error('Supabase sign-in succeeded but no session was returned.');
  }

  applySession(data.session, cfg.email);
  state.refreshFailures = 0;
  return data.session;
}

async function rotateSession() {
  if (state.inFlight) return;
  state.inFlight = true;

  try {
    if (!supabase || !state.refreshToken) {
      await signInWithPassword();
      return;
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: state.refreshToken,
    });

    if (error || !data?.session) {
      await signInWithPassword();
      return;
    }

    applySession(data.session, state.email || getConfig().email || null);
    state.refreshFailures = 0;
  } catch (error) {
    recordFailure(error);
    state.refreshFailures += 1;
    throw error;
  } finally {
    state.inFlight = false;
  }
}

async function initBobSystemAuth() {
  const cfg = getConfig();
  state.configured = cfg.configured;

  if (!cfg.configured) {
    state.ready = false;
    state.lastError = 'BOB_SYSTEM_EMAIL/BOB_SYSTEM_PASSWORD not configured.';
    return false;
  }

  try {
    await signInWithPassword();
    return true;
  } catch (error) {
    recordFailure(error);
    throw error;
  }
}

function stopBobSystemAuth() {
  clearTimer();
}

function getBobSystemAccessToken() {
  if (!state.accessToken) {
    throw new Error('Bob system session token is not ready.');
  }
  return state.accessToken;
}

function getBobSystemAuthStatus() {
  return {
    configured: state.configured,
    ready: state.ready,
    email: state.email,
    user_id: state.userId,
    expires_at: state.expiresAtMs ? new Date(state.expiresAtMs).toISOString() : null,
    last_refresh_at: state.lastRefreshAt,
    refresh_failures: state.refreshFailures,
    last_error: state.lastError,
    last_failure_kind: state.lastFailureKind,
    last_failure_at: state.lastFailureAt,
    self_heal_hint: state.lastFailureKind === 'credentials'
      ? 'Rotate or correct BOB_SYSTEM_EMAIL / BOB_SYSTEM_PASSWORD, then restart the proxy so Bob can re-authenticate.'
      : state.lastFailureKind === 'configuration'
        ? 'Set BOB_SYSTEM_EMAIL and BOB_SYSTEM_PASSWORD before restarting the proxy.'
        : null,
  };
}

module.exports = {
  initBobSystemAuth,
  stopBobSystemAuth,
  getBobSystemAccessToken,
  getBobSystemAuthStatus,
};
