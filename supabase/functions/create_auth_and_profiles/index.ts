import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

interface ProfileRow {
  id?: string;
  organization_id?: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  phone?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  permissions?: string[];
  employer_organization_id?: string | null;
  authorized_work_locations?: string[];
}

/**
 * Normalise a raw row from an external export so that it matches the
 * ProfileRow shape expected by this function.
 *
 * Handles:
 * - Columns with slightly different names (e.g. `firstname`, `surname`,
 *   `email_address`, `mobile`, `active`, `organisation_id`, …)
 * - Missing columns (sensible defaults are applied)
 * - Extra/unknown columns (silently ignored)
 * - Mixed-case header names
 * - Boolean strings ("true", "1", "yes", "active" → true)
 * - Role aliases ("administrator" → "admin", "supervisor" → "admin_officer")
 */
function normalizeRow(raw: Record<string, any>): ProfileRow {
  // Build a lookup keyed by lowercased, whitespace/hyphen-collapsed name so
  // that "First Name", "first-name" and "first_name" all resolve the same way.
  const lc: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    lc[k.toLowerCase().replace(/[\s\-]+/g, '_')] = v;
  }

  // Return first defined, non-null, non-empty-string value from the alias list.
  function pick(...keys: string[]): any {
    for (const k of keys) {
      const v = lc[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  function toBool(val: any, def: boolean): boolean {
    if (val === undefined || val === null) return def;
    if (typeof val === 'boolean') return val;
    const s = String(val).toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'active') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'inactive') return false;
    return def;
  }

  function normalizeRole(val: any): string {
    if (!val) return 'officer';
    const s = String(val).toLowerCase().trim();
    // Canonical values pass straight through
    if (['master', 'admin', 'officer', 'admin_officer'].includes(s)) return s;
    // Common aliases
    if (s === 'administrator') return 'admin';
    if (['supervisor', 'manager', 'team_leader', 'teamleader'].includes(s)) return 'admin_officer';
    if (['field_officer', 'fieldofficer', 'field officer', 'patrol_officer', 'patrolofficer'].includes(s)) return 'officer';
    // Unknown role — log a warning so operators can manually review, then default to safest value
    console.warn(`[normalizeRow] Unrecognised role value "${val}" — defaulting to "officer". Please review this user manually.`);
    return 'officer';
  }

  function toArray(val: any): any[] {
    if (Array.isArray(val)) return val;
    if (!val) return [];
    // Some exports serialise arrays as JSON strings
    if (typeof val === 'string') {
      try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; }
      catch (err) {
        console.warn(`[normalizeRow] Could not parse array field from string value "${val}":`, err);
        return [];
      }
    }
    return [];
  }

  return {
    id: pick('id', 'user_id', 'userid') ?? undefined,
    organization_id: pick('organization_id', 'organisation_id', 'org_id', 'organization', 'organisation') ?? null,
    first_name: String(pick('first_name', 'firstname', 'given_name', 'forename', 'fname') ?? ''),
    last_name: String(pick('last_name', 'lastname', 'surname', 'family_name', 'lname') ?? ''),
    email: String(pick('email', 'email_address', 'emailaddress', 'user_email', 'e_mail') ?? '').trim(),
    role: normalizeRole(pick('role', 'user_role', 'access_level', 'type', 'user_type')),
    phone: pick('phone', 'phone_number', 'mobile', 'mobile_number', 'contact_number', 'cell', 'cell_number') ?? null,
    is_active: toBool(pick('is_active', 'isactive', 'active', 'status', 'enabled'), true),
    created_at: pick('created_at', 'createdat', 'date_created', 'date_joined') ?? undefined,
    permissions: toArray(pick('permissions', 'user_permissions')),
    employer_organization_id: pick('employer_organization_id', 'employer_organisation_id', 'employer_org_id', 'employer_id') ?? null,
    authorized_work_locations: toArray(pick('authorized_work_locations', 'authorised_work_locations', 'work_locations', 'locations', 'authorized_locations')),
  };
}

function generateTempPassword(): string {
  // Generates a 24-character random password
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array).map((b) => chars[b % chars.length]).join('');
}

// Emails that must be skipped during migration (already exist in the system)
const SKIP_EMAILS = new Set(['squires.don@live.com']);

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // --- Authorization: require valid admin/master caller ---
    const authHeader =
      req.headers.get('Authorization') || req.headers.get('authorization');

    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const accessToken = authHeader.slice(7).trim();

    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'Missing access token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !authData?.user) {
      console.error('create_auth_and_profiles auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired access token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const user = authData.user;
    const roleFromAppMetadata = user?.app_metadata?.role;
    const roleFromUserMetadata = user?.user_metadata?.role;
    const callerRole = roleFromAppMetadata ?? roleFromUserMetadata;

    if (callerRole !== 'admin' && callerRole !== 'master') {
      return new Response(
        JSON.stringify({ error: 'Forbidden: insufficient permissions' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    // --- End authorization checks ---

    const body = await req.json();
    const rawRows: Record<string, any>[] = body?.rows;

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Request body must include a non-empty "rows" array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalise each row to the canonical ProfileRow shape so that exports
    // with slightly different column names (or missing/extra columns) are
    // handled gracefully before any further processing.
    const rows: ProfileRow[] = rawRows.map(normalizeRow);

    // Fetch all existing auth users (paginated) to build a lookup map
    const existingAuthMap = new Map<string, string>();
    let page = 1;
    while (true) {
      const { data: pageData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      const users = pageData?.users ?? [];
      for (const u of users) {
        if (u.email) existingAuthMap.set(u.email.toLowerCase(), u.id);
      }
      if (users.length < 1000) break;
      page++;
    }

    const results: { email: string; status: string; auth_id?: string; error?: string }[] = [];

    for (const row of rows) {
      const email = row.email;

      if (!email) {
        results.push({ email: '', status: 'error', error: 'Missing email' });
        continue;
      }

      // Skip users that are already in the system and must not be overwritten
      if (SKIP_EMAILS.has(email.toLowerCase())) {
        console.log(`Skipping ${email}: user already in system`);
        results.push({ email, status: 'skipped' });
        continue;
      }

      // Check if a user with this email already exists in auth
      const existingAuthId = existingAuthMap.get(email.toLowerCase());
      const existingAuthUser = existingAuthId !== undefined;

      let authUserId: string;

      if (existingAuthUser) {
        // Auth user already exists — reuse their ID
        authUserId = existingAuthId!;
        console.log(`Auth user already exists for ${email}: ${authUserId}`);
      } else {
        // Create a new auth user with a random temporary password
        // email_confirm: false means Supabase sends a confirmation email
        const tempPassword = generateTempPassword();
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: false,
          user_metadata: {
            first_name: row.first_name,
            last_name: row.last_name,
          },
        });

        if (authError || !authData?.user) {
          console.error(`Auth creation failed for ${email}:`, authError);
          results.push({
            email,
            status: 'error',
            error: authError?.message ?? 'Failed to create auth user',
          });
          continue;
        }

        authUserId = authData.user.id;
        console.log(`Auth user created for ${email}: ${authUserId}`);
      }

      // Upsert the profile using the real auth user ID (ignoring the row's provided id)
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .upsert(
          {
            id: authUserId,
            email,
            first_name: row.first_name,
            last_name: row.last_name,
            role: row.role,
            organization_id: row.organization_id ?? null,
            employer_organization_id: row.employer_organization_id ?? null,
            authorized_work_locations: row.authorized_work_locations ?? [],
            phone: row.phone ?? null,
            permissions: row.permissions ?? [],
            is_active: row.is_active ?? true,
            created_at: row.created_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id', ignoreDuplicates: false }
        );

      if (profileError) {
        console.error(`Profile upsert failed for ${email}:`, profileError);
        results.push({
          email,
          status: 'error',
          auth_id: authUserId,
          error: `Profile upsert failed: ${profileError.message}`,
        });
        continue;
      }

      results.push({
        email,
        status: existingAuthUser ? 'profile_updated' : 'created',
        auth_id: authUserId,
      });
    }

    const created = results.filter((r) => r.status === 'created').length;
    const updated = results.filter((r) => r.status === 'profile_updated').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errors = results.filter((r) => r.status === 'error').length;

    return new Response(
      JSON.stringify({
        summary: { total: rawRows.length, created, profile_updated: updated, skipped, errors },
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('create_auth_and_profiles error:', error);
    return new Response(
      JSON.stringify({ error: error.message ?? 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
