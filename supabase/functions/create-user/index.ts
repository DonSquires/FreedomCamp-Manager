import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

async function sendInvitationEmail(params: {
  toEmail: string;
  recipientName: string;
  inviterName: string;
  organizationName: string;
  inviteLink: string;
}) {
  const SMTP_STEP_TIMEOUT_MS = parseInt(Deno.env.get('SMTP_STEP_TIMEOUT_MS') ?? '12000', 10);
  const SMTP_TOTAL_TIMEOUT_MS = parseInt(Deno.env.get('SMTP_TOTAL_TIMEOUT_MS') ?? '30000', 10);
  const smtpHost = Deno.env.get('SMTP_HOST');
  const smtpPort = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10);
  const smtpUser = Deno.env.get('SMTP_USERNAME');
  const smtpPass = Deno.env.get('SMTP_PASSWORD');
  const smtpFrom = Deno.env.get('SMTP_FROM_EMAIL');
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'FreedomCamp Manager - Iron Eagle Security';

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    return {
      ok: false,
      error: 'Email service not configured. Missing SMTP secrets (SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM_EMAIL).',
    };
  }

  const subject = `You're invited to FreedomCamp Manager (${params.organizationName})`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 12px;background:#f1f5f9;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#0f172a;padding:24px;text-align:center;">
              <img src="https://www.ironeaglesecurity.co.nz/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:56px;object-fit:contain;display:block;margin:0 auto 12px;" />
              <div style="font-size:22px;line-height:1.2;font-weight:800;color:#ffffff;">FreedomCamp Manager</div>
              <div style="margin-top:6px;font-size:13px;color:#cbd5e1;">Iron Eagle Security / OnSpace AI</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 12px;">
              <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">You're invited</h1>
              <p style="margin:0 0 10px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(params.recipientName)},</p>
              <p style="margin:0 0 10px;font-size:15px;line-height:1.6;"><strong>${escapeHtml(params.inviterName)}</strong> has invited you to join <strong>FreedomCamp Manager</strong> for <strong>${escapeHtml(params.organizationName)}</strong>.</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">Use the button below to set your password and activate your account.</p>
              <div style="text-align:center;margin:0 0 20px;">
                <a href="${escapeHtml(params.inviteLink)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Accept Invitation</a>
              </div>
              <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.5;">If the button does not work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 14px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(params.inviteLink)}" style="color:#1d4ed8;">${escapeHtml(params.inviteLink)}</a></p>
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">If you weren't expecting this invitation, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${params.recipientName},`,
    '',
    `${params.inviterName} has invited you to join FreedomCamp Manager for ${params.organizationName}.`,
    'Use this link to accept your invitation and set your password:',
    params.inviteLink,
    '',
    'If you were not expecting this invite, you can ignore this email.',
  ].join('\n');

  const client = new SMTPClient();
  const useTls = smtpPort === 465;

  await withTimeout(
    (async () => {
      if (useTls) {
        await withTimeout(
          client.connectTLS({
            hostname: smtpHost,
            port: smtpPort,
            username: smtpUser,
            password: smtpPass,
          }),
          SMTP_STEP_TIMEOUT_MS,
          'Timed out connecting to SMTP server (TLS).',
        );
      } else {
        await withTimeout(
          client.connect({
            hostname: smtpHost,
            port: smtpPort,
            username: smtpUser,
            password: smtpPass,
          }),
          SMTP_STEP_TIMEOUT_MS,
          'Timed out connecting to SMTP server.',
        );
      }

      try {
        await withTimeout(
          client.send({
            from: `${smtpFromName} <${smtpFrom}>`,
            to: params.toEmail,
            subject,
            html,
            content: text,
          }),
          SMTP_STEP_TIMEOUT_MS,
          'Timed out sending invitation email via SMTP.',
        );
      } finally {
        await Promise.race([
          client.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
    })(),
    SMTP_TOTAL_TIMEOUT_MS,
    'Invitation email operation timed out. Check SMTP host/port/firewall settings.',
  );

  return { ok: true as const };
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

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    let inviterName = 'An administrator';
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.getUser(token);
        if (!authUserError && authUserData?.user?.id) {
          const { data: inviterProfile } = await supabaseAdmin
            .from('user_profiles')
            .select('first_name, last_name, email')
            .eq('id', authUserData.user.id)
            .single();

          const fullName = [inviterProfile?.first_name, inviterProfile?.last_name]
            .filter(Boolean)
            .join(' ')
            .trim();

          inviterName = fullName || inviterProfile?.email || authUserData.user.email || inviterName;
        }
      }
    }

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
    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: 'Email and role are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password && password.length < 6) {
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

    const normalizedEmail = String(email).trim().toLowerCase();
    const isInvitationFlow = !password;

    console.log('Creating auth user:', normalizedEmail, '| Role:', role, '| Invitation:', isInvitationFlow);

    // Generate default names for field staff
    const isFieldStyleRole = role === 'officer' || role === 'nzscv_monitor';
    const userFirstName = isFieldStyleRole ? (first_name || email.split('@')[0]) : first_name;
    const userLastName = isFieldStyleRole ? (last_name || 'Officer') : last_name;
    const recipientName = [userFirstName, userLastName].filter(Boolean).join(' ').trim() || normalizedEmail;

    const redirectOrigin = req.headers.get('origin') || Deno.env.get('SITE_URL') || 'https://www.ironeaglesecurity.co.nz';
    const redirectTo = `${redirectOrigin}/login`;

    const invitingOrganizationId = organization_id || employer_organization_id || null;
    let invitingOrganizationName = 'your organization';
    if (invitingOrganizationId) {
      const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', invitingOrganizationId)
        .single();
      if (orgData?.name) invitingOrganizationName = orgData.name;
    }

    // Step 1: Create auth user (invite flow by default, password flow optional)
    let authData: any = null;
    let authError: any = null;
    let inviteLink: string | null = null;

    if (isInvitationFlow) {
      const generated = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email: normalizedEmail,
        options: {
          redirectTo,
          data: {
            first_name: userFirstName,
            last_name: userLastName,
          },
        },
      });
      authData = { user: generated.data?.user };
      authError = generated.error;
      inviteLink = generated.data?.properties?.action_link || null;
    } else {
      const created = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: false,
        user_metadata: {
          first_name: userFirstName,
          last_name: userLastName,
        },
      });
      authData = created.data;
      authError = created.error;
    }

    if (authError) {
      console.error('Auth user creation error:', authError);
      if (authError.message?.toLowerCase().includes('already')) {
        return new Response(
          JSON.stringify({ error: 'A user with this email already exists' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw authError;
    }

    if (!authData.user) {
      throw new Error('Failed to create auth user');
    }

    if (isInvitationFlow) {
      if (!inviteLink) {
        throw new Error('Failed to generate invite link');
      }
      const inviteEmailResult = await sendInvitationEmail({
        toEmail: normalizedEmail,
        recipientName,
        inviterName,
        organizationName: invitingOrganizationName,
        inviteLink,
      });
      if (!inviteEmailResult.ok) {
        // Cleanup auth user so we do not leave an account with no invitation email
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        throw new Error(inviteEmailResult.error);
      }
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
      JSON.stringify({ error: error.message || 'Failed to create user' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
