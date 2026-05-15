function cleanScopeId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120) || null;
}

function collectAllowedOrgIds(profile) {
  const ids = new Set();
  const push = (value) => {
    const cleaned = cleanScopeId(value);
    if (cleaned) ids.add(cleaned);
  };

  push(profile?.organization_id);
  push(profile?.employer_organization_id);
  for (const id of Array.isArray(profile?.authorized_work_locations) ? profile.authorized_work_locations : []) {
    push(id);
  }
  for (const id of Array.isArray(profile?.extra_organization_ids) ? profile.extra_organization_ids : []) {
    push(id);
  }

  return ids;
}

async function lookupUserProfileForGuard(userId) {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey || !userId) return null;

  const params = new URLSearchParams({
    select: 'id,organization_id,employer_organization_id,authorized_work_locations,extra_organization_ids',
    id: `eq.${userId}`,
    limit: '1',
  });

  const res = await fetch(`${supabaseUrl}/rest/v1/user_profiles?${params.toString()}`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`multi-tenant profile lookup failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return Array.isArray(data) ? (data[0] || null) : null;
}

async function enforceMultiTenantGuard(req, { requestingUserId, activeOrganizationId }) {
  const auth = req?.inferenceAuth || {};
  const authUserId = cleanScopeId(auth.sub || null);
  const requestedUserId = cleanScopeId(requestingUserId || null);
  const requestedOrgId = cleanScopeId(activeOrganizationId || null);
  const authOrgId = cleanScopeId(auth.organization_id || null);

  if (!requestedUserId) {
    return { ok: false, status: 400, message: 'user_id is required for tenant guard' };
  }

  if (authUserId && requestedUserId !== authUserId) {
    return { ok: false, status: 403, message: 'Access Denied: user scope mismatch.' };
  }

  if (auth.method === 'supabase_jwt' && requestedOrgId && authOrgId && requestedOrgId !== authOrgId) {
    return { ok: false, status: 403, message: 'Access Denied: Cross-tenant operation detected.' };
  }

  if (!requestedOrgId) {
    return { ok: true, verifiedOrgId: authOrgId || null };
  }

  const profile = await lookupUserProfileForGuard(requestedUserId);
  if (!profile) {
    return { ok: false, status: 403, message: 'Access Denied: membership not found.' };
  }

  const allowedOrgIds = collectAllowedOrgIds(profile);
  if (!allowedOrgIds.has(requestedOrgId)) {
    return { ok: false, status: 403, message: 'Access Denied: Cross-tenant operation detected.' };
  }

  return { ok: true, verifiedOrgId: requestedOrgId };
}

module.exports = {
  cleanScopeId,
  collectAllowedOrgIds,
  lookupUserProfileForGuard,
  enforceMultiTenantGuard,
};