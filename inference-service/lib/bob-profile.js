/**
 * Bob User Profile Resolver
 *
 * Fetches a user's bob_user_profiles row from Supabase REST API (no SDK needed)
 * and exposes helpers to build a persona-aware system prompt suffix and
 * resolve ACL permissions.
 *
 * Tier hierarchy:  captain > commander > officer > ensign > guest
 * Maps to roles:   master  > admin     > admin_officer > officer > (guest)
 */

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Tier definitions ────────────────────────────────────────────────────────

const TIER_RANK = { captain: 5, commander: 4, officer: 3, ensign: 2, guest: 1 };

const TIER_DEFAULTS = {
  captain: {
    tone: 'technical',
    computer_use_enabled: true,
    permissions: {
      computer_use: true,
      view_all_org_data: true,
      modify_bob_rules: true,
      access_financials: true,
      access_officer_welfare: true,
      access_compliance_reports: true,
      access_alpr: true,
    },
  },
  commander: {
    tone: 'professional',
    computer_use_enabled: false,
    permissions: {
      computer_use: false,
      view_all_org_data: true,
      modify_bob_rules: false,
      access_financials: true,
      access_officer_welfare: true,
      access_compliance_reports: true,
      access_alpr: true,
    },
  },
  officer: {
    tone: 'professional',
    computer_use_enabled: false,
    permissions: {
      computer_use: false,
      view_all_org_data: false,
      modify_bob_rules: false,
      access_financials: false,
      access_officer_welfare: true,
      access_compliance_reports: true,
      access_alpr: true,
    },
  },
  ensign: {
    tone: 'professional',
    computer_use_enabled: false,
    permissions: {
      computer_use: false,
      view_all_org_data: false,
      modify_bob_rules: false,
      access_financials: false,
      access_officer_welfare: false,
      access_compliance_reports: false,
      access_alpr: false,
    },
  },
  guest: {
    tone: 'brief',
    computer_use_enabled: false,
    permissions: {},
  },
};

// ─── Tone-to-prompt descriptor ────────────────────────────────────────────────

const TONE_INSTRUCTIONS = {
  professional:
    'Respond professionally, clearly, and directly. Avoid jargon unless the user is clearly familiar with it.',
  technical:
    'Adopt a technical, detailed tone. Include specifics, references to code, database schema, or legislation where relevant.',
  casual:
    'Keep a friendly, informal tone — like a knowledgeable colleague rather than a formal AI assistant.',
  brief:
    'Be extremely concise. Answer in one to three sentences unless asked to elaborate.',
  verbose:
    'Provide thorough, comprehensive answers. Cover edge cases and provide context.',
  sarcastic:
    'You may inject dry wit and light sarcasm into your responses, but never at the expense of accuracy or professionalism.',
};

// ─── Core cache ───────────────────────────────────────────────────────────────

// Map<userId, { profile, fetchedAt }>
const profileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch (or return cached) Bob profile for a given user_id.
 * Falls back to synthesising a sensible default if the row doesn't exist.
 *
 * @param {string|null} userId
 * @param {string|null} orgId
 * @param {string|null} userRole  Application role ('master','admin','admin_officer','officer')
 * @returns {Promise<BobProfile>}
 */
async function resolveBobProfile(userId, orgId, userRole) {
  if (!userId) return buildDefaultProfile(null, orgId, userRole);

  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  const supabaseUrl = SUPABASE_URL;
  const serviceKey = SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return buildDefaultProfile(userId, orgId, userRole);
  }

  try {
    const url = `${supabaseUrl}/rest/v1/bob_user_profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`;
    const resp = await fetch(url, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rows = await resp.json();
    const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    if (!data) {
      const profile = buildDefaultProfile(userId, orgId, userRole);
      profileCache.set(userId, { profile, fetchedAt: Date.now() });
      return profile;
    }

    const profile = normalizeDbProfile(data);
    profileCache.set(userId, { profile, fetchedAt: Date.now() });
    return profile;
  } catch (_err) {
    return buildDefaultProfile(userId, orgId, userRole);
  }
}

/**
 * Invalidate cache entry (call after a profile is updated).
 */
function invalidateBobProfileCache(userId) {
  if (userId) profileCache.delete(userId);
}

// ─── Profile normalisation ────────────────────────────────────────────────────

function normalizeDbProfile(row) {
  const tier = TIER_DEFAULTS[row.bob_tier] ? row.bob_tier : 'ensign';
  const defaults = TIER_DEFAULTS[tier];
  return {
    user_id: row.user_id,
    organization_id: row.organization_id,
    bob_tier: tier,
    tier_rank: TIER_RANK[tier] || 1,
    tone: row.tone || defaults.tone,
    language: row.language || 'en-NZ',
    permissions: { ...defaults.permissions, ...(row.permissions || {}) },
    memory_seeds: row.memory_seeds || {},
    memory_namespace: row.memory_namespace || buildMemoryNamespace(row.organization_id, row.user_id),
    ui_theme: row.ui_theme || 'system',
    computer_use_enabled: row.computer_use_enabled ?? defaults.computer_use_enabled,
    entry_code: row.entry_code || null,
    system_prompt_suffix: row.system_prompt_suffix || null,
  };
}

function buildDefaultProfile(userId, orgId, userRole) {
  const tier = roleToTier(userRole);
  const defaults = TIER_DEFAULTS[tier];
  return {
    user_id: userId,
    organization_id: orgId,
    bob_tier: tier,
    tier_rank: TIER_RANK[tier] || 1,
    tone: defaults.tone,
    language: 'en-NZ',
    permissions: { ...defaults.permissions },
    memory_seeds: {},
    memory_namespace: buildMemoryNamespace(orgId, userId),
    ui_theme: 'system',
    computer_use_enabled: defaults.computer_use_enabled,
    entry_code: null,
    system_prompt_suffix: null,
  };
}

function roleToTier(role) {
  switch (role) {
    case 'master':        return 'captain';
    case 'admin':         return 'commander';
    case 'admin_officer': return 'officer';
    case 'officer':       return 'ensign';
    default:              return 'guest';
  }
}

function buildMemoryNamespace(orgId, userId) {
  const o = orgId ? `org:${orgId}` : 'org:shared';
  const u = userId ? `user:${userId}` : 'user:shared';
  return `${o}/${u}`;
}

// ─── System prompt builder ────────────────────────────────────────────────────

/**
 * Build the user-profile section that gets appended to Bob's system prompt.
 *
 * @param {BobProfile} profile
 * @returns {string}
 */
function buildProfileSystemPromptSection(profile) {
  if (!profile || profile.bob_tier === 'guest') {
    return (
      '\n\n[USER PROFILE]\n' +
      'This user is a GUEST with limited access. ' +
      'Do not reveal any confidential enforcement data, financials, officer welfare records, or ALPR search results. ' +
      'Answer only general public-facing questions about freedom camping rules. ' +
      'If asked about restricted information, politely decline and suggest they contact the organisation.'
    );
  }

  const toneInstruction = TONE_INSTRUCTIONS[profile.tone] || TONE_INSTRUCTIONS.professional;
  const perms = profile.permissions || {};

  const lines = [
    '\n\n[USER PROFILE]',
    `Tier: ${profile.bob_tier.toUpperCase()} (${tierDescription(profile.bob_tier)})`,
    `Tone directive: ${toneInstruction}`,
    `Preferred language/region: ${profile.language}`,
  ];

  // Access grants
  const grants = [];
  if (perms.view_all_org_data) grants.push('full organisation data visibility');
  if (perms.computer_use) grants.push('Computer Use (automation)');
  if (perms.modify_bob_rules) grants.push('Bob core rule modification');
  if (perms.access_financials) grants.push('financial record access');
  if (perms.access_alpr) grants.push('ALPR and vehicle plate data');
  if (perms.access_compliance_reports) grants.push('compliance reports');
  if (perms.access_officer_welfare) grants.push('officer welfare data');

  if (grants.length > 0) {
    lines.push(`Authorised access: ${grants.join(', ')}.`);
  } else {
    lines.push('Authorised access: read-only general queries only.');
  }

  // Restrictions
  const restrictions = [];
  if (!perms.access_financials) restrictions.push('Do NOT reveal financial data.');
  if (!perms.access_alpr) restrictions.push('Do NOT reveal ALPR search results or raw plate data.');
  if (!perms.access_compliance_reports) restrictions.push('Do NOT reveal compliance reports or breach statistics.');
  if (!perms.computer_use) restrictions.push('Do NOT perform Computer Use actions for this user.');
  if (!perms.modify_bob_rules) restrictions.push('Do NOT accept requests to change Bob system rules or configuration.');

  if (restrictions.length > 0) {
    lines.push('Restrictions: ' + restrictions.join(' '));
  }

  // Memory seeds
  const seeds = profile.memory_seeds || {};
  if (Object.keys(seeds).length > 0) {
    lines.push('User context: ' + JSON.stringify(seeds));
  }

  // Custom suffix
  if (profile.system_prompt_suffix) {
    lines.push('Personal note: ' + profile.system_prompt_suffix);
  }

  return lines.join('\n');
}

function tierDescription(tier) {
  switch (tier) {
    case 'captain':  return 'Master — full system access';
    case 'commander': return 'Admin — full data, limited config';
    case 'officer':  return 'Admin-Officer — operational access';
    case 'ensign':   return 'Officer — patrol/query access';
    default:         return 'Guest — public info only';
  }
}

/**
 * Check whether a Bob profile allows a given permission key.
 *
 * @param {BobProfile} profile
 * @param {string} permissionKey
 * @returns {boolean}
 */
function hasPermission(profile, permissionKey) {
  if (!profile) return false;
  return !!(profile.permissions && profile.permissions[permissionKey]);
}

module.exports = {
  resolveBobProfile,
  invalidateBobProfileCache,
  buildProfileSystemPromptSection,
  hasPermission,
  roleToTier,
  TIER_RANK,
  TIER_DEFAULTS,
};
