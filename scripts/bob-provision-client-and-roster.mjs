#!/usr/bin/env node

/**
 * Bob operational provisioning script.
 *
 * Creates/ensures:
 * - organization
 * - LOI
 * - active client site linked to LOI
 * - invited officer profile
 * - patrol route
 * - 3 nightly roster slots for each day of week
 *
 * Requires environment:
 * - VITE_SUPABASE_URL or PLAYWRIGHT_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY or PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY
 */

const argv = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, ...rest] = arg.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : 'true'];
  })
);

const config = {
  actorEmail: argv.actorEmail || 'squires.don@live.com',
  orgName: argv.orgName || 'testing Bob',
  orgAddress: argv.orgAddress || '15 Forest road Nelson,izationgro',
  siteName: argv.siteName || 'izationgro',
  siteAddress: argv.siteAddress || '15 Forest road Nelson,izationgro',
  siteCode: argv.siteCode || 'IZATIONGRO',
  city: argv.city || 'Nelson',
  country: argv.country || 'New Zealand',
  countryCode: argv.countryCode || 'NZ',
  siteLat: Number(argv.siteLat ?? -41.2710849),
  siteLng: Number(argv.siteLng ?? 173.2836756),
  geofenceRadiusMetres: Number(argv.geofenceRadiusMetres ?? 150),
  inviteEmail: argv.inviteEmail || 'adonijah.squires@firstsecurity.co.nz',
  inviteFirstName: argv.inviteFirstName || 'Adonijah',
  inviteLastName: argv.inviteLastName || 'Squires',
  routeCode: argv.routeCode || '584',
  routeName: argv.routeName || `Patrol Route ${argv.routeCode || '584'}`,
};

const baseUrl = (process.env.VITE_SUPABASE_URL || process.env.PLAYWRIGHT_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) {
  throw new Error('Missing Supabase URL or service key. Set VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or PLAYWRIGHT_* variants).');
}

const baseHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...baseHeaders, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function selectOne(path, notFoundMessage) {
  const rows = await api(path);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(notFoundMessage);
  return rows[0];
}

async function getActor() {
  return selectOne(
    `/rest/v1/user_profiles?select=id,email,role&email=eq.${encodeURIComponent(config.actorEmail)}&limit=1`,
    `Actor profile not found for ${config.actorEmail}`
  );
}

async function ensureOrganization() {
  const existing = await api(`/rest/v1/organizations?select=id,name,address,organization_type&name=ilike.${encodeURIComponent(config.orgName)}&limit=1`);
  if (Array.isArray(existing) && existing.length > 0) return { org: existing[0], created: false };

  await api('/rest/v1/organizations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      name: config.orgName,
      address: config.orgAddress,
      organization_type: 'client',
      contact_email: config.actorEmail,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

  const org = await selectOne(
    `/rest/v1/organizations?select=id,name,address,organization_type&name=ilike.${encodeURIComponent(config.orgName)}&order=created_at.desc&limit=1`,
    'Failed to re-read created organization'
  );
  return { org, created: true };
}

async function ensureLoi(orgId, createdById) {
  const loiName = `${config.siteName} LOI`;
  const existing = await api(
    `/rest/v1/locations_of_interest?select=id,name,organization_id,address_full,gps_lat,gps_lng&organization_id=eq.${orgId}&name=ilike.${encodeURIComponent(loiName)}&limit=1`
  );
  if (Array.isArray(existing) && existing.length > 0) return { loi: existing[0], created: false };

  await api('/rest/v1/locations_of_interest', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      organization_id: orgId,
      name: loiName,
      loi_kind: 'address',
      address_full: config.siteAddress,
      city: config.city,
      country: config.country,
      country_code: config.countryCode,
      gps_lat: config.siteLat,
      gps_lng: config.siteLng,
      is_canonical: true,
      is_active: true,
      geofence_radius_meters: config.geofenceRadiusMetres,
      is_verified: true,
      geocode_source: 'manual',
      geocoder_source: 'manual',
      created_by: createdById,
    },
  });

  const loi = await selectOne(
    `/rest/v1/locations_of_interest?select=id,name,organization_id,address_full,gps_lat,gps_lng&organization_id=eq.${orgId}&name=ilike.${encodeURIComponent(loiName)}&order=created_at.desc&limit=1`,
    'Failed to re-read created LOI'
  );
  return { loi, created: true };
}

async function ensureSite(orgId, createdById, loiId) {
  const existing = await api(
    `/rest/v1/client_sites?select=id,name,organization_id,address,site_code,gps_lat,gps_lng,loi_id,is_active&organization_id=eq.${orgId}&name=ilike.${encodeURIComponent(config.siteName)}&limit=1`
  );
  if (Array.isArray(existing) && existing.length > 0) return { site: existing[0], created: false };

  await api('/rest/v1/client_sites', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      organization_id: orgId,
      name: config.siteName,
      site_code: config.siteCode,
      site_type: 'general',
      address: config.siteAddress,
      city: config.city,
      gps_lat: config.siteLat,
      gps_lng: config.siteLng,
      geofence_radius_metres: config.geofenceRadiusMetres,
      loi_id: loiId,
      notes: 'Created by Bob automation from user request.',
      created_by: createdById,
      is_active: true,
    },
  });

  const site = await selectOne(
    `/rest/v1/client_sites?select=id,name,organization_id,address,site_code,gps_lat,gps_lng,loi_id,is_active&organization_id=eq.${orgId}&name=ilike.${encodeURIComponent(config.siteName)}&order=created_at.desc&limit=1`,
    'Failed to re-read created site'
  );
  return { site, created: true };
}

async function inviteAndEnsureProfile(orgId) {
  let inviteResult = null;
  try {
    inviteResult = await api('/auth/v1/invite', {
      method: 'POST',
      body: {
        email: config.inviteEmail,
        data: {
          first_name: config.inviteFirstName,
          last_name: config.inviteLastName,
          role: 'officer',
          organization_id: orgId,
        },
      },
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes('email_exists')) throw error;
  }

  let adminUserId = null;
  const adminUsers = await api(`/auth/v1/admin/users?email=${encodeURIComponent(config.inviteEmail)}`);
  if (Array.isArray(adminUsers?.users)) {
    const exact = adminUsers.users.find((u) => u?.email?.toLowerCase() === config.inviteEmail.toLowerCase());
    adminUserId = exact?.id || null;
  }

  const profileRows = await api(`/rest/v1/user_profiles?select=id,email,role,organization_id,first_name,last_name&email=eq.${encodeURIComponent(config.inviteEmail)}&limit=1`);
  const existingProfile = Array.isArray(profileRows) && profileRows.length > 0 ? profileRows[0] : null;
  const userId = inviteResult?.id || adminUserId || existingProfile?.id;
  if (!userId) throw new Error('Invite attempted but user profile ID could not be resolved.');

  await api('/rest/v1/user_profiles?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: {
      id: userId,
      email: config.inviteEmail,
      first_name: config.inviteFirstName,
      last_name: config.inviteLastName,
      role: 'officer',
      organization_id: orgId,
      employer_organization_id: orgId,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
  });

  const profile = await selectOne(
    `/rest/v1/user_profiles?select=id,email,role,organization_id,first_name,last_name&id=eq.${userId}&limit=1`,
    'Failed to re-read invited user profile'
  );
  return { inviteResult, profile };
}

async function ensureRoute(orgId, actorId) {
  const existing = await api(
    `/rest/v1/patrol_routes?select=id,organization_id,route_name,route_code&organization_id=eq.${orgId}&route_code=eq.${encodeURIComponent(config.routeCode)}&limit=1`
  );
  if (Array.isArray(existing) && existing.length > 0) return { route: existing[0], created: false };

  await api('/rest/v1/patrol_routes', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      organization_id: orgId,
      route_name: config.routeName,
      route_code: config.routeCode,
      description: 'Created by Bob automation from user request.',
      route_type: 'regular',
      default_shift: 'night',
      default_start_time: '18:00:00',
      default_end_time: '02:00:00',
      active_days: [1, 2, 3, 4, 5, 6, 7],
      is_active: true,
      created_by: actorId,
      min_checkpoints_required: 1,
    },
  });

  const route = await selectOne(
    `/rest/v1/patrol_routes?select=id,organization_id,route_name,route_code&organization_id=eq.${orgId}&route_code=eq.${encodeURIComponent(config.routeCode)}&limit=1`,
    'Failed to re-read patrol route'
  );
  return { route, created: true };
}

async function ensureRosterAssignments({ organizationId, officerId, routeId, actorId }) {
  const slots = [
    { start: '18:00:00', end: '20:40:00' },
    { start: '20:40:00', end: '23:20:00' },
    { start: '23:20:00', end: '02:00:00' },
  ];

  let created = 0;
  let existing = 0;

  for (let day = 1; day <= 7; day += 1) {
    for (const slot of slots) {
      const found = await api(
        `/rest/v1/roster_assignments?select=id&organization_id=eq.${organizationId}&officer_id=eq.${officerId}&patrol_route_id=eq.${routeId}&day_of_week=eq.${day}&shift=eq.night&start_time=eq.${slot.start}&end_time=eq.${slot.end}&specific_date=is.null&limit=1`
      );
      if (Array.isArray(found) && found.length > 0) {
        existing += 1;
        continue;
      }

      await api('/rest/v1/roster_assignments', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: {
          organization_id: organizationId,
          officer_id: officerId,
          patrol_route_id: routeId,
          day_of_week: day,
          shift: 'night',
          start_time: slot.start,
          end_time: slot.end,
          assignment_status: 'scheduled',
          created_by: actorId,
        },
      });
      created += 1;
    }
  }

  return { created, existing, totalTarget: 21 };
}

const actor = await getActor();
const orgResult = await ensureOrganization();
const loiResult = await ensureLoi(orgResult.org.id, actor.id);
const siteResult = await ensureSite(orgResult.org.id, actor.id, loiResult.loi.id);
const inviteResult = await inviteAndEnsureProfile(orgResult.org.id);
const routeResult = await ensureRoute(orgResult.org.id, actor.id);
const rosterResult = await ensureRosterAssignments({
  organizationId: routeResult.route.organization_id || orgResult.org.id,
  officerId: inviteResult.profile.id,
  routeId: routeResult.route.id,
  actorId: actor.id,
});

console.log(
  JSON.stringify(
    {
      actor: { id: actor.id, email: actor.email, role: actor.role },
      organization: { id: orgResult.org.id, name: orgResult.org.name, created: orgResult.created },
      loi: { id: loiResult.loi.id, name: loiResult.loi.name, created: loiResult.created },
      site: { id: siteResult.site.id, name: siteResult.site.name, created: siteResult.created, loi_id: siteResult.site.loi_id },
      invitedUser: {
        email: config.inviteEmail,
        authUserId: inviteResult.inviteResult?.id,
        profileId: inviteResult.profile.id,
        role: inviteResult.profile.role,
        organization_id: inviteResult.profile.organization_id,
      },
      route: {
        id: routeResult.route.id,
        route_code: routeResult.route.route_code,
        route_name: routeResult.route.route_name,
        organization_id: routeResult.route.organization_id,
        created: routeResult.created,
      },
      roster: rosterResult,
    },
    null,
    2
  )
);
