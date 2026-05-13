import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

export type OrgScopedProfile = {
  role?: string | null
  organization_id?: string | null
  employer_organization_id?: string | null
  extra_organization_ids?: string[] | null
  authorized_work_locations?: string[] | null
}

function pushIfUuid(set: Set<string>, value: unknown) {
  const v = String(value ?? '').trim()
  if (!v) return
  set.add(v)
}

export function collectDirectOrgIds(profile: OrgScopedProfile): Set<string> {
  const out = new Set<string>()
  pushIfUuid(out, profile.organization_id)
  pushIfUuid(out, profile.employer_organization_id)

  if (Array.isArray(profile.extra_organization_ids)) {
    for (const id of profile.extra_organization_ids) pushIfUuid(out, id)
  }

  if (Array.isArray(profile.authorized_work_locations)) {
    for (const id of profile.authorized_work_locations) pushIfUuid(out, id)
  }

  return out
}

async function fetchDescendantsForOrg(
  supabaseAdmin: SupabaseClient,
  orgId: string,
): Promise<string[]> {
  try {
    const { data, error } = await (supabaseAdmin as any)
      .rpc('get_descendant_organizations', { p_org_id: orgId })

    if (error || !Array.isArray(data)) return []
    return data.map((id: unknown) => String(id ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

export async function buildAccessibleOrgIds(
  supabaseAdmin: SupabaseClient,
  profile: OrgScopedProfile,
): Promise<Set<string>> {
  const direct = collectDirectOrgIds(profile)
  const role = String(profile.role ?? '').trim()

  if (!direct.size) return direct

  // Keep edge behavior compatible with existing org hierarchy semantics.
  if (role === 'admin' || role === 'admin_officer' || role === 'master' || role === 'grand_master') {
    const seeds = Array.from(direct)
    for (const seed of seeds) {
      const descendants = await fetchDescendantsForOrg(supabaseAdmin, seed)
      for (const id of descendants) direct.add(id)
    }
  }

  return direct
}

export function orgAccessDenied(
  allowedOrgIds: Set<string>,
  requestedOrgId: string | null | undefined,
): boolean {
  const target = String(requestedOrgId ?? '').trim()
  if (!target) return true
  return !allowedOrgIds.has(target)
}
