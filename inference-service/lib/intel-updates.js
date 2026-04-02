const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultState() {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    counts: {
      law: 0,
      security: 0,
      jurisdiction: 0,
      system: 0,
      other: 0,
    },
    bulletins: [],
  };
}

function readState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return defaultState();
    parsed.counts = parsed.counts || defaultState().counts;
    parsed.bulletins = Array.isArray(parsed.bulletins) ? parsed.bulletins.slice(-200) : [];
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

function normalizeType(type) {
  const value = String(type || '').toLowerCase();
  if (['law', 'security', 'jurisdiction', 'system'].includes(value)) return value;
  return 'other';
}

function createIntelStore(options = {}) {
  const statePath = options.statePath || path.join(process.cwd(), 'data', 'intel-state.json');
  const hmacKey = String(options.hmacKey || '');
  let state = readState(statePath);

  writeState(statePath, state);

  function verifySignature(rawBody, signature) {
    if (!hmacKey) return true;
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', hmacKey).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature).trim()));
  }

  function ingestBulletin(bulletin) {
    const now = new Date().toISOString();
    const type = normalizeType(bulletin?.type);
    const record = {
      id: crypto.randomUUID(),
      at: now,
      type,
      title: String(bulletin?.title || '').trim().slice(0, 300),
      summary: String(bulletin?.summary || '').trim().slice(0, 2000),
      source: String(bulletin?.source || 'manual-feed').trim().slice(0, 300),
      effective_date: bulletin?.effective_date || null,
      metadata: bulletin?.metadata && typeof bulletin.metadata === 'object' ? bulletin.metadata : {},
    };

    if (!record.title || !record.summary) {
      throw new Error('bulletin title and summary are required');
    }

    state.updated_at = now;
    state.bulletins.push(record);
    state.bulletins = state.bulletins.slice(-200);
    state.counts[type] = Number(state.counts[type] || 0) + 1;
    writeState(statePath, state);
    return record;
  }

  function getState() {
    return {
      ...state,
      state_path: statePath,
      signing_required: Boolean(hmacKey),
    };
  }

  return {
    verifySignature,
    ingestBulletin,
    getState,
  };
}

module.exports = { createIntelStore };
