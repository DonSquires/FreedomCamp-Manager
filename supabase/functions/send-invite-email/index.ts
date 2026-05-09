import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordCommunicationAudit } from '../_shared/communicationsAudit.ts';

const safeErrorText = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);
const BRAND_SITE_URL = 'https://fcmanager.co.nz';
const BRAND_LOGO_URL = `${BRAND_SITE_URL}/iron-eagle-security-logo.jpg`;

function getAllowedInviteHostPatterns(): string[] {
  const configuredValues = [
    Deno.env.get('SITE_URL'),
    Deno.env.get('PUBLIC_SITE_URL'),
    Deno.env.get('APP_URL'),
    Deno.env.get('URI_ALLOW_LIST'),
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','));

  const fallbackValues = [
    BRAND_SITE_URL,
    'https://www.fcmanager.co.nz',
    'https://freedomcampmanager.onspace.build',
    'https://*.onspace.build/**',
    'https://*.vercel.app/**',
    'http://localhost:5173',
  ];

  return [...configuredValues, ...fallbackValues]
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/^https?:\/\//, ''))
    .map((value) => value.replace(/\/.*$/, ''))
    .map((value) => value.replace(/:\d+$/, ''));
}

function isAllowedInviteHost(hostname: string, allowedPatterns: string[]): boolean {
  return allowedPatterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }
    return hostname === pattern;
  });
}

function normalizeInviteUrl(rawValue: string): string {
  let inviteUrl: URL;

  try {
    inviteUrl = new URL(String(rawValue).trim());
  } catch {
    throw new Error('INVALID_INVITE_URL');
  }

  const hostname = inviteUrl.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (!['https:', 'http:'].includes(inviteUrl.protocol)) {
    throw new Error('INVALID_INVITE_URL_PROTOCOL');
  }

  if (inviteUrl.protocol !== 'https:' && !isLocalhost) {
    throw new Error('INVITE_URL_REQUIRES_HTTPS');
  }

  if (!isAllowedInviteHost(hostname, getAllowedInviteHostPatterns())) {
    throw new Error('INVITE_URL_HOST_NOT_ALLOWED');
  }

  inviteUrl.username = '';
  inviteUrl.password = '';
  return inviteUrl.toString();
}

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
  const inviteHost = escapeHtml(new URL(params.inviteUrl).hostname);
  const greeting = safeFirstName ? `Hi ${safeFirstName},` : 'Hi,';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#2563eb 100%);padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="${BRAND_LOGO_URL}" alt="Iron Eagle Security Limited" style="height:56px;width:auto;display:block;border-radius:12px;background:#ffffff;padding:8px;" />
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <div style="color:#bfdbfe;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;">Owner / Developer</div>
                  <div style="color:#ffffff;font-size:15px;font-weight:700;margin-top:6px;">Iron Eagle Security Limited</div>
                </td>
              </tr>
            </table>
            <div style="margin-top:24px;color:#ffffff;font-size:30px;font-weight:700;line-height:1.2;">Field Compliance Manager</div>
            <div style="margin-top:8px;color:#cbd5e1;font-size:15px;line-height:1.5;">Secure compliance operations, reporting, and enforcement workflows for field teams.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px 20px;">
            <p style="font-size:18px;color:#0f172a;margin:0 0 16px;font-weight:600;">${greeting}</p>
            <p style="font-size:15px;color:#334155;margin:0 0 16px;line-height:1.7;">
              You have been invited to join <strong>Field Compliance Manager</strong>. Use the secure link below to set your password and access the platform.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;background:#f8fafc;border:1px solid #dbeafe;border-radius:16px;">
              <tr>
                <td style="padding:20px 22px;">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#2563eb;">Security Check</div>
                  <div style="margin-top:8px;font-size:14px;line-height:1.6;color:#334155;">Open this link only if it uses <strong>HTTPS</strong> and the approved Field Compliance Manager domain <strong>${inviteHost}</strong>.</div>
                </td>
              </tr>
            </table>
            <p style="text-align:center;margin:28px 0;">
              <a href="${safeInviteUrl}" style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:#ffffff;text-decoration:none;padding:16px 30px;border-radius:999px;font-size:15px;font-weight:700;display:inline-block;box-shadow:0 12px 24px rgba(37,99,235,0.24);">
                Accept Invitation &amp; Set Password
              </a>
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fff7ed;border:1px solid #fdba74;border-radius:14px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-size:14px;font-weight:700;color:#9a3412;">Link expiry</div>
                  <div style="margin-top:6px;font-size:14px;line-height:1.6;color:#9a3412;">This invitation expires in <strong>24 hours</strong>. If you were not expecting it, contact your administrator before proceeding.</div>
                </td>
              </tr>
            </table>
            <p style="font-size:13px;color:#64748b;margin:0 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
            <p style="font-size:12px;color:#0f172a;word-break:break-all;background:#f8fafc;border:1px solid #e2e8f0;padding:14px;border-radius:12px;margin:0 0 12px;">${safeInviteUrlDisplay}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;padding-top:20px;">
              <tr>
                <td style="font-size:12px;line-height:1.7;color:#64748b;">
                  This email was sent by <strong>Field Compliance Manager</strong>, owned and developed by <strong>Iron Eagle Security Limited</strong>.<br />
                  Support site: <a href="${BRAND_SITE_URL}" style="color:#2563eb;text-decoration:none;">${BRAND_SITE_URL.replace(/^https?:\/\//, '')}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${greeting}\n\nYou have been invited to Field Compliance Manager.\n\nAccept your invitation and set your password:\n${safeInviteUrl}\n\nThis link expires in 24 hours.`;

  return { html, text };
}

async function sendInviteDirectSmtp(params: { email: string; firstName?: string; inviteUrl: string }) {
  const smtpHost = Deno.env.get('SMTP_HOST');
  const smtpPort = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10);
  const smtpUser = Deno.env.get('SMTP_USERNAME');
  const smtpPass = Deno.env.get('SMTP_PASSWORD');
  const smtpFrom = Deno.env.get('SMTP_FROM_EMAIL');
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'Field Compliance Manager';

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
      subject: "You've been invited to Field Compliance Manager",
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
  let supabaseAdmin: ReturnType<typeof createClient> | null = null;
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
        subject: "You've been invited to Field Compliance Manager",
        toEmails: email ? [email] : undefined,
        errorMessage: 'INVALID_PAYLOAD',
        mergeData: { first_name },
      });
      return new Response(
        JSON.stringify({ error: 'email and invite_url are required', code: 'INVALID_PAYLOAD' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    let normalizedInviteUrl: string;
    try {
      normalizedInviteUrl = normalizeInviteUrl(invite_url);
    } catch (urlError) {
      const errorCode = safeErrorText((urlError as Error)?.message || 'INVALID_INVITE_URL');
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: organization_id,
        channel: 'email',
        provider: 'invite_validation',
        status: 'failed',
        subject: "You've been invited to Field Compliance Manager",
        toEmails: email ? [email] : undefined,
        errorMessage: errorCode,
        mergeData: { first_name, invite_url },
      });
      return new Response(
        JSON.stringify({ error: 'invite_url must use HTTPS and an approved Field Compliance Manager domain', code: errorCode }),
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
          body: JSON.stringify({ email, first_name, invite_url: normalizedInviteUrl }),
        });
      } catch (_relayNetworkError) {
        await sendInviteDirectSmtp({
          email,
          firstName: first_name,
          inviteUrl: normalizedInviteUrl,
        });
        await recordCommunicationAudit(supabaseAdmin, {
          organizationId: organization_id,
          channel: 'email',
          provider: 'direct_smtp',
          status: 'delivered',
          subject: "You've been invited to Field Compliance Manager",
          toEmails: [email],
          retryCount: 1,
          mergeData: { first_name, fallback_reason: 'proxy_relay_unreachable' },
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
            inviteUrl: normalizedInviteUrl,
          });
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'direct_smtp',
            status: 'delivered',
            subject: "You've been invited to Field Compliance Manager",
            toEmails: [email],
            retryCount: 1,
            mergeData: { first_name, relay_code: relayCode, fallback_reason: 'SMTP_NOT_CONFIGURED' },
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
            inviteUrl: normalizedInviteUrl,
          });
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'direct_smtp',
            status: 'delivered',
            subject: "You've been invited to Field Compliance Manager",
            toEmails: [email],
            retryCount: 1,
            mergeData: { first_name, relay_status: relayResponse.status, relay_code: relayCode, fallback_reason: relayCode },
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
          subject: "You've been invited to Field Compliance Manager",
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
        subject: "You've been invited to Field Compliance Manager",
        toEmails: [email],
        mergeData: { first_name },
      });
      return new Response(
        JSON.stringify({ message: 'Invite email sent' }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    await sendInviteDirectSmtp({ email, firstName: first_name, inviteUrl: normalizedInviteUrl });

    console.log(`Invite email sent directly for ${email}`);
    await recordCommunicationAudit(supabaseAdmin, {
      organizationId: organization_id,
      channel: 'email',
      provider: 'direct_smtp',
      status: 'delivered',
      subject: "You've been invited to Field Compliance Manager",
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
        subject: "You've been invited to Field Compliance Manager",
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
