import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
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

function generateTempPassword(): string {
  // Generates a 24-character random password
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array).map((b) => chars[b % chars.length]).join('');
}

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

    const body = await req.json();
    const rows: ProfileRow[] = body?.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Request body must include a non-empty "rows" array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Emails that must be skipped during migration (already exist in the system)
    const SKIP_EMAILS = new Set(['squires.don@live.com']);

    const results: { email: string; status: string; auth_id?: string; error?: string }[] = [];

    for (const row of rows) {
      const email = (row.email ?? '').trim();

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
        summary: { total: rows.length, created, profile_updated: updated, skipped, errors },
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
