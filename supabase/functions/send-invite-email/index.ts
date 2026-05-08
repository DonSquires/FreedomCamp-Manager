import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordCommunicationAudit } from '../_shared/communicationsAudit.ts';

const safeErrorText = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInviteEmail(params: { firstName?: string; inviteUrl: string }) {
  const safeFirstName = params.firstName ? escapeHtml(params.firstName) : '';
  const safeInviteUrl = encodeURI(params.inviteUrl);
  const safeInviteUrlDisplay = escapeHtml(params.inviteUrl);
  const greeting = safeFirstName ? `Hi ${safeFirstName},` : 'Hi,';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;">
            <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">FieldOps Manager</h1>
            <p style="color:#93c5fd;margin:4px 0 0;font-size:13px;">Iron Eagle Security / OnSpace AI</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#374151;margin:0 0 16px;">${greeting}</p>
            <p style="font-size:15px;color:#374151;margin:0 0 16px;">
              You have been invited to join <strong>FieldOps Manager</strong>. Click below to set your password and access the platform.
            </p>
            <p style="text-align:center;margin:32px 0;">
              <a href="${safeInviteUrl}" style="background:#1e3a5f;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;display:inline-block;">
                Accept Invitation &amp; Set Password
              </a>
            </p>
            <p style="font-size:13px;color:#6b7280;margin:0 0 8px;">If the button does not work, copy and paste this link:</p>
            <p style="font-size:12px;color:#374151;word-break:break-all;background:#f9fafb;padding:12px;border-radius:4px;margin:0 0 24px;">${safeInviteUrlDisplay}</p>
            <p style="font-size:13px;color:#ef4444;margin:0 0 24px;">This link expires in <strong>24 hours</strong>.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${greeting}\n\nYou have been invited to FieldOps Manager.\n\nAccept your invitation and set your password:\n${safeInviteUrl}\n\nThis link expires in 24 hours.`;

  return { html, text };
}

async function sendInviteDirectSmtp(params: { email: string; firstName?: string; inviteUrl: string }) {
  const smtpHost = Deno.env.get('SMTP_HOST');
  const smtpPort = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10);
  const smtpUser = Deno.env.get('SMTP_USERNAME');
  const smtpPass = Deno.env.get('SMTP_PASSWORD');
  const smtpFrom = Deno.env.get('SMTP_FROM_EMAIL');
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'FieldOps Manager';

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error('DIRECT_SMTP_NOT_CONFIGURED');
  }

  const { html, text } = buildInviteEmail({
    firstName: params.firstName,
    inviteUrl: params.inviteUrl,
  });

  const client = new SMTPClient({
    connection: {
      hostname: smtpHost,
      port: smtpPort,
      tls: smtpPort === 465,
      auth: {
        username: smtpUser,
        password: smtpPass,
      },
    },
  });

  try {
    await client.send({
      from: `${smtpFromName} <${smtpFrom}>`,
      to: params.email,
      subject: "You've been invited to FieldOps Manager",
      html,
      content: text,
    });
  } finally {
    await client.close();
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  let proxyBaseUrl: string | undefined;
  let supabaseAdmin: any = null;
  let inviteAuditContext: {
    organizationId?: string;
    email?: string;
    firstName?: string;
  } = {};

  try {
    supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    proxyBaseUrl =
      Deno.env.get('PROXY_BASE_URL') ||
      Deno.env.get('RAILWAY_PROXY_URL') ||
      Deno.env.get('NZSCV_PROXY_URL');
    const proxySecret = Deno.env.get('PROXY_SECRET') || Deno.env.get('NZSCV_PROXY_SECRET');

    const { email, first_name, invite_url, organization_id } = await req.json();
    inviteAuditContext = { organizationId: organization_id, email, firstName: first_name };

    if (!email || !invite_url) {
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: organization_id,
        channel: 'email',
        provider: 'invite_validation',
        status: 'failed',
        subject: "You've been invited to FieldOps Manager",
        toEmails: email ? [email] : undefined,
        errorMessage: 'INVALID_PAYLOAD',
        mergeData: { first_name },
      });
      return new Response(
        JSON.stringify({ error: 'email and invite_url are required', code: 'INVALID_PAYLOAD' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Prefer proxy relay when configured; if relay SMTP is missing, fallback to
    // direct SMTP from Supabase secrets so invites can still be sent.
    if (proxyBaseUrl && proxySecret) {
      const relayBase = /^https?:\/\//i.test(proxyBaseUrl) ? proxyBaseUrl : `https://${proxyBaseUrl}`;
      const relayUrl = `${relayBase.replace(/\/$/, '')}/api/email/send-invite`;

      let relayResponse: Response;
      try {
        relayResponse = await fetch(relayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-proxy-secret': proxySecret,
          },
          body: JSON.stringify({ email, first_name, invite_url }),
        });
      } catch (_relayNetworkError) {
        await sendInviteDirectSmtp({
          email,
          firstName: first_name,
          inviteUrl: invite_url,
        });
        await recordCommunicationAudit(supabaseAdmin, {
          organizationId: organization_id,
          channel: 'email',
          provider: 'direct_smtp',
          status: 'delivered',
          subject: "You've been invited to FieldOps Manager",
          toEmails: [email],
          retryCount: 1,
          errorMessage: 'proxy_relay_unreachable',
          mergeData: { first_name },
        });
        return new Response(
          JSON.stringify({ message: 'Invite email sent' }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      if (!relayResponse.ok) {
        let relayPayload: any = null;
        try {
          relayPayload = await relayResponse.json();
        } catch {
          relayPayload = null;
        }

        const relayCode = relayPayload?.code || 'INVITE_RELAY_FAILED';
        if (relayCode === 'SMTP_NOT_CONFIGURED') {
          await sendInviteDirectSmtp({
            email,
            firstName: first_name,
            inviteUrl: invite_url,
          });
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'direct_smtp',
            status: 'delivered',
            subject: "You've been invited to FieldOps Manager",
            toEmails: [email],
            retryCount: 1,
            errorMessage: 'SMTP_NOT_CONFIGURED',
            mergeData: { first_name, relay_code: relayCode },
          });
          return new Response(
            JSON.stringify({ message: 'Invite email sent' }),
            { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        try {
          await sendInviteDirectSmtp({
            email,
            firstName: first_name,
            inviteUrl: invite_url,
          });
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'direct_smtp',
            status: 'delivered',
            subject: "You've been invited to FieldOps Manager",
            toEmails: [email],
            retryCount: 1,
            errorMessage: relayCode,
            mergeData: { first_name, relay_status: relayResponse.status },
          });
          return new Response(
            JSON.stringify({ message: 'Invite email sent' }),
            { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        } catch {
          // Keep original relay error details if direct SMTP fallback is unavailable.
        }

        const fallback = `Invite relay failed with HTTP ${relayResponse.status}`;
        const relayMessage = relayPayload?.message || relayPayload?.error || fallback;

        console.error('send-invite-email relay error:', {
          relayUrl,
          status: relayResponse.status,
          code: relayCode,
          message: safeErrorText(relayMessage),
        });
        await recordCommunicationAudit(supabaseAdmin, {
          organizationId: organization_id,
          channel: 'email',
          provider: 'proxy_relay',
          status: 'failed',
          subject: "You've been invited to FieldOps Manager",
          toEmails: [email],
          errorMessage: relayMessage,
          mergeData: { first_name, relay_status: relayResponse.status, relay_code: relayCode },
        });

        return new Response(
          JSON.stringify({
            error: relayMessage,
            code: relayCode,
            relayStatus: relayResponse.status,
            relayHost: proxyBaseUrl,
          }),
          { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Invite email relayed successfully for ${email}`);
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: organization_id,
        channel: 'email',
        provider: 'proxy_relay',
        status: 'delivered',
        subject: "You've been invited to FieldOps Manager",
        toEmails: [email],
        mergeData: { first_name },
      });
      return new Response(
        JSON.stringify({ message: 'Invite email sent' }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    await sendInviteDirectSmtp({ email, firstName: first_name, inviteUrl: invite_url });

    console.log(`Invite email sent directly for ${email}`);
    await recordCommunicationAudit(supabaseAdmin, {
      organizationId: organization_id,
      channel: 'email',
      provider: 'direct_smtp',
      status: 'delivered',
      subject: "You've been invited to FieldOps Manager",
      toEmails: [email],
      mergeData: { first_name },
    });
    return new Response(
      JSON.stringify({ message: 'Invite email sent' }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    const rawMessage = safeErrorText(error?.message || error);
    const isNetwork = /(failed to fetch|network|timed out|timeout|connection refused)/i.test(rawMessage);
    const code = isNetwork ? 'INVITE_RELAY_UNREACHABLE' : 'INVITE_RELAY_ERROR';
    const message = isNetwork
      ? 'Could not reach invite relay service. Check PROXY_BASE_URL/RAILWAY_PROXY_URL/NZSCV_PROXY_URL and Railway availability.'
      : 'Failed to send invite email via relay service.';

    console.error('send-invite-email unexpected error:', {
      code,
      message,
      raw: rawMessage,
      stack: safeErrorText(error?.stack),
    });
    if (supabaseAdmin) {
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: inviteAuditContext.organizationId,
        channel: 'email',
        provider: 'invite_delivery',
        status: 'failed',
        subject: "You've been invited to FieldOps Manager",
        toEmails: inviteAuditContext.email ? [inviteAuditContext.email] : undefined,
        errorMessage: rawMessage,
        mergeData: { first_name: inviteAuditContext.firstName, code },
      });
    }

    return new Response(
      JSON.stringify({ error: message, code, relayHost: proxyBaseUrl ?? 'missing' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
