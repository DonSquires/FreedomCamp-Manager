import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

function safeErrorDetails(error: any) {
  if (!error) return null;
  return {
    name: error?.name,
    message: error?.message,
    status: error?.status,
    code: error?.code,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify caller is an authenticated admin/master — standard Supabase edge function pattern
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Use ANON_KEY + caller's JWT — the officially supported validation pattern
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: callerUser }, error: userError } = await userClient.auth.getUser();
    if (userError || !callerUser?.id) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (callerProfileError || !callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'master' && callerProfile.role !== 'grand_master')) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: admin, master, or grand_master role required' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const {
      email,
      password,
      first_name,
      last_name,
      role,
      organization_id,
      extra_organization_ids,
      employer_organization_id,
      authorized_work_locations,
      portal_access,
      ptt_channel_access,
      phone,
      job_title,
      requires_driver_license,
      permissions,
    } = await req.json();

    if (!email || !role || !password) {
      return new Response(
        JSON.stringify({ error: 'Email, password, and role are required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (String(password).length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const isFieldStyleRole = role === 'officer' || role === 'nzscv_monitor';
    const userFirstName = first_name || (isFieldStyleRole ? normalizedEmail.split('@')[0] : '');
    const userLastName = last_name || (isFieldStyleRole ? 'Officer' : '');
    const normalizedExtraOrganizationIds = Array.isArray(extra_organization_ids)
      ? extra_organization_ids.filter((id: unknown) => typeof id === 'string' && id && id !== organization_id)
      : [];
    const normalizedAuthorizedWorkLocations = dedupe(asStringArray(authorized_work_locations));
    const normalizedPortalAccess = dedupe(asStringArray(portal_access));
    const normalizedPttChannelAccess = dedupe(asStringArray(ptt_channel_access));

    console.log('Creating user:', normalizedEmail, '| Role:', role);

    // Create a confirmed auth user with a set password — no email required
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: String(password),
      email_confirm: true,
    });

    if (createError) {
      console.error('Auth createUser error:', safeErrorDetails(createError));
      if (createError.message?.toLowerCase().includes('already')) {
        return new Response(
          JSON.stringify({ error: 'A user with this email already exists' }),
          { status: 409, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Failed to create auth user: ${createError.message}`);
    }

    if (!authData?.user?.id) {
      throw new Error('Failed to create auth user: no user ID returned');
    }

    console.log('Auth user created:', authData.user.id);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: authData.user.id,
        email: normalizedEmail,
        first_name: userFirstName,
        last_name: userLastName,
        role,
        organization_id: organization_id || null,
        extra_organization_ids: normalizedExtraOrganizationIds,
        employer_organization_id: employer_organization_id || null,
        authorized_work_locations: normalizedAuthorizedWorkLocations,
        portal_access: normalizedPortalAccess,
        ptt_channel_access: normalizedPttChannelAccess,
        phone: phone || null,
        job_title: job_title || null,
        requires_driver_license: Boolean(requires_driver_license),
        permissions: permissions || [],
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new Error(`Failed to create user profile: ${profileError.message}`);
    }

    console.log('User profile created for:', authData.user.id);

    return new Response(
      JSON.stringify({
        data: profile,
        message: 'User created successfully',
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('User creation error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to create user',
        details: safeErrorDetails(error),
      }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
