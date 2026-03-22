import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

function safeErrorDetails(error: any) {
  if (!error) return null;
  return {
    name: error?.name,
    message: error?.message,
    status: error?.status,
    code: error?.code,
  };
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

    // Verify caller is an authenticated admin/master.
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = authHeader.slice(7).trim();
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'Missing access token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: callerAuthData, error: callerAuthError } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerAuthError || !callerAuthData?.user?.id) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired access token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', callerAuthData.user.id)
      .single();

    if (callerProfileError || !callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'master')) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { 
      email, 
      first_name, 
      last_name, 
      role, 
      organization_id, 
      employer_organization_id,
      authorized_work_locations,
      phone,
      permissions
    } = await req.json();

    // Validation
    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: 'Email and role are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Admin/Master needs full details
    if ((role === 'admin' || role === 'master') && (!first_name || !last_name)) {
      return new Response(
        JSON.stringify({ error: 'First name and last name required for admin/master users' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const isInvitationFlow = true;

    console.log('Creating auth user:', normalizedEmail, '| Role:', role, '| Invitation:', isInvitationFlow);

    // Generate default names for field staff
    const isFieldStyleRole = role === 'officer' || role === 'nzscv_monitor';
    const userFirstName = isFieldStyleRole ? (first_name || email.split('@')[0]) : first_name;
    const userLastName = isFieldStyleRole ? (last_name || 'Officer') : last_name;

    // Step 1: Create auth user via Supabase invite flow.
    let authData: any = null;
    let authError: any = null;

    // Use Supabase Auth invite flow with dashboard-managed defaults.
    // Do not force redirectTo from request origin: mismatches against
    // Auth URL allow-list can cause invite failures.
    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail);
    authData = { user: invited.data?.user };
    authError = invited.error;

    if (authError) {
      console.error('Auth user creation error:', {
        error: safeErrorDetails(authError),
        normalizedEmail,
      });
      if (authError.message?.toLowerCase().includes('already')) {
        return new Response(
          JSON.stringify({ error: 'A user with this email already exists' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(authError?.message || 'Invite failed');
    }

    if (!authData.user) {
      throw new Error('Failed to create auth user');
    }

    console.log('Auth user created:', authData.user.id);

    // Step 2: Create user profile directly (bypassing disabled trigger)
    // The on_auth_user_created trigger is disabled on auth.users (Supabase-managed)
    // So we must manually insert the user profile
    console.log('Creating user profile directly (trigger is disabled)...');

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: authData.user.id,
        email: normalizedEmail,
        first_name: userFirstName,
        last_name: userLastName,
        role,
        organization_id: organization_id || null,
        employer_organization_id: employer_organization_id || null,
        authorized_work_locations: authorized_work_locations || [],
        phone: phone || null,
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
      console.error('Error details:', {
        code: profileError.code,
        message: profileError.message,
        details: profileError.details,
        hint: profileError.hint,
      });
      // Cleanup: delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new Error(`Failed to create user profile: ${profileError.message}`);
    }

    console.log('User profile updated successfully');

    return new Response(
      JSON.stringify({ 
        data: profile,
        message: isInvitationFlow ? 'User invitation sent successfully' : 'User created successfully',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('User creation error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to create user',
        details: safeErrorDetails(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
