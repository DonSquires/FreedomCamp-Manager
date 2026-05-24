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

function firstNonEmptyEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function firstResolvedEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) {
      return { value, source: name };
    }
  }

  return { value: '', source: null };
}

function getConfig() {
  const supabaseUrl = firstNonEmptyEnv([
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'SUPABASE_PROJECT_URL',
  ]).replace(/\/+$/, '');

  const supabaseKey = firstNonEmptyEnv([
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SERVICE_ROLE_KEY',
    'SB_SERVICE_KEY',
  ]);

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowLegacyAliases = !isProduction || String(process.env.BOB_SYSTEM_ALLOW_LEGACY_ALIASES || '').trim() === '1';

  const canonicalEmail = firstResolvedEnv(['BOB_SYSTEM_EMAIL']);
  const canonicalPassword = firstResolvedEnv(['BOB_SYSTEM_PASSWORD']);

  const legacyEmail = allowLegacyAliases
    ? firstResolvedEnv([
      'BOB_LOGIN_EMAIL',
      'PLAYWRIGHT_MASTER_EMAIL',
      'TEST_OWNER_EMAIL',
      'API_TEST_EMAIL',
    ])
    : { value: '', source: null };

  const legacyPassword = allowLegacyAliases
    ? firstResolvedEnv([
      'BOB_LOGIN_PASSWORD',
      'PLAYWRIGHT_MASTER_PASSWORD',
      'TEST_OWNER_PASSWORD',
      'API_TEST_PASSWORD',
    ])
    : { value: '', source: null };

  const selectedEmail = canonicalEmail.value ? canonicalEmail : legacyEmail;
  const selectedPassword = canonicalPassword.value ? canonicalPassword : legacyPassword;

  const email = selectedEmail.value.toLowerCase();
  const password = selectedPassword.value;

  const refreshBufferSeconds = Math.max(30, Number(process.env.BOB_SYSTEM_REFRESH_BUFFER_SECONDS || 120));

  return {
    supabaseUrl,
    supabaseKey,
    email,
    emailSource: selectedEmail.source,
    password,
    passwordSource: selectedPassword.source,
    isProduction,
    allowLegacyAliases,
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
    throw new Error(
      'Missing Supabase/Bob system login env variables. Required: SUPABASE_URL + key and Bob credentials (BOB_SYSTEM_EMAIL + BOB_SYSTEM_PASSWORD; legacy aliases require BOB_SYSTEM_ALLOW_LEGACY_ALIASES=1 in production).'
    );
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
    const sourceHint = [cfg.emailSource, cfg.passwordSource].filter(Boolean).join(' / ') || 'unknown env source';
    throw new Error(`signInWithPassword failed: ${error.message} (credential source: ${sourceHint})`);
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
    state.lastError = 'Bob system credentials are not configured (BOB_SYSTEM_* or fallback aliases).';
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
    credentials_source: {
      email: getConfig().emailSource,
      password: getConfig().passwordSource,
      allow_legacy_aliases: getConfig().allowLegacyAliases,
      node_env: getConfig().isProduction ? 'production' : (process.env.NODE_ENV || 'development'),
    },
    user_id: state.userId,
    expires_at: state.expiresAtMs ? new Date(state.expiresAtMs).toISOString() : null,
    last_refresh_at: state.lastRefreshAt,
    refresh_failures: state.refreshFailures,
    last_error: state.lastError,
    last_failure_kind: state.lastFailureKind,
    last_failure_at: state.lastFailureAt,
    self_heal_hint: state.lastFailureKind === 'credentials'
      ? 'Rotate or correct Bob auth credentials (BOB_SYSTEM_* preferred), then restart the proxy so Bob can re-authenticate.'
      : state.lastFailureKind === 'configuration'
        ? 'Set Bob auth credentials before restarting the proxy. Preferred: BOB_SYSTEM_EMAIL + BOB_SYSTEM_PASSWORD.'
        : null,
  };
}

module.exports = {
  initBobSystemAuth,
  stopBobSystemAuth,
  getBobSystemAccessToken,
  getBobSystemAuthStatus,
};
