import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

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

    const { 
      email, 
      password, 
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
    if (!email || !password || !role) {
      return new Response(
        JSON.stringify({ error: 'Email, password, and role are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 6 characters' }),
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

    console.log('Creating auth user:', email, '| Role:', role);

    // Generate default names for field staff
    const userFirstName = role === 'officer' ? (first_name || email.split('@')[0]) : first_name;
    const userLastName = role === 'officer' ? (last_name || 'Officer') : last_name;

    // Step 1: Create auth user with password
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // ✅ SEND VERIFICATION EMAIL - User must confirm email before login
      user_metadata: {
        first_name: userFirstName,
        last_name: userLastName,
      },
    });

    if (authError) {
      console.error('Auth user creation error:', authError);
      throw authError;
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
        email,
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
        message: 'User created successfully',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('User creation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create user' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
