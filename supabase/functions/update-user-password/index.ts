import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify the requesting user is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || !['master', 'admin'].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get request body
    const { userId, newPassword } = await req.json();

    if (!userId || !newPassword) {
      throw new Error('Missing userId or newPassword');
    }

    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, organization_id')
      .eq('id', userId)
      .single();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: 'Target user profile not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (callerProfile.role !== 'master' && callerProfile.role !== 'grand_master') {
      const sameOrg = callerProfile.organization_id && callerProfile.organization_id === targetProfile.organization_id;
      if (!sameOrg) {
        return new Response(
          JSON.stringify({ error: 'Admins can only update users in their organization' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (targetProfile.role === 'master') {
        return new Response(
          JSON.stringify({ error: 'Admins cannot update master accounts' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    console.log(`🔑 Updating password for user: ${userId}`);

    // Update user password using admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError) {
      throw updateError;
    }

    console.log(`✅ Password updated successfully for user: ${userId}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Password updated successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: any) {
    console.error('❌ Password update failed:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Unknown error',
        details: error.toString()
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
