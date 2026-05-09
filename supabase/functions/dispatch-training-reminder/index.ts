import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

type ReminderDispatchPayload = {
  reminder_id: string
  organization_id: string
  assignment_id: string
  officer_id: string
  channel: 'email' | 'sms' | 'escalation' | 'in_app'
  message: string
  sent_by?: string | null
  sent_at?: string
}

function sanitizeError(error: unknown): string {
  return String(error || 'unknown_error').replace(/[\r\n]+/g, ' ').slice(0, 500)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildReminderEmailHtml(params: {
  subject: string
  message: string
  organizationName: string
}) {
  const safeSubject = escapeHtml(params.subject)
  const safeOrganizationName = escapeHtml(params.organizationName)
  const safeMessage = escapeHtml(params.message).replace(/\n/g, '<br />')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,0.12);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#2563eb 100%);padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="https://fcmanager.co.nz/iron-eagle-security-logo.jpg" alt="Iron Eagle Security Limited" style="height:56px;width:auto;display:block;border-radius:12px;background:#ffffff;padding:8px;" />
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <div style="color:#bfdbfe;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;">Owner / Developer</div>
                    <div style="color:#ffffff;font-size:15px;font-weight:700;margin-top:6px;">Iron Eagle Security Limited</div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:24px;color:#ffffff;font-size:28px;font-weight:700;line-height:1.2;">Field Compliance Manager</div>
              <div style="margin-top:8px;color:#cbd5e1;font-size:15px;line-height:1.5;">Training and operational reminders for field teams.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 32px 18px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#2563eb;">Reminder</div>
              <h1 style="margin:10px 0 16px;font-size:26px;line-height:1.25;color:#0f172a;">${safeSubject}</h1>
              <div style="font-size:15px;line-height:1.75;color:#334155;">${safeMessage}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #dbeafe;border-radius:14px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#2563eb;">Organization</div>
                    <div style="margin-top:8px;font-size:15px;font-weight:600;color:#0f172a;">${safeOrganizationName}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;padding-top:20px;">
                <tr>
                  <td style="font-size:12px;line-height:1.7;color:#64748b;">
                    This email was sent by <strong>Field Compliance Manager</strong>, owned and developed by <strong>Iron Eagle Security Limited</strong>.<br />
                    Support site: <a href="https://fcmanager.co.nz" style="color:#2563eb;text-decoration:none;">fcmanager.co.nz</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

async function sendEmailReminder(params: {
  toEmail: string
  subject: string
  message: string
  organizationName: string
}) {
  const smtpHost = Deno.env.get('SMTP_HOST')
  const smtpPort = Number(Deno.env.get('SMTP_PORT') || 587)
  const smtpUsername = Deno.env.get('SMTP_USERNAME')
  const smtpPassword = Deno.env.get('SMTP_PASSWORD')
  const smtpFromEmail = Deno.env.get('SMTP_FROM_EMAIL')
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') || 'Field Compliance Manager'

  if (!smtpHost || !smtpUsername || !smtpPassword || !smtpFromEmail) {
    throw new Error('SMTP_NOT_CONFIGURED')
  }

  const client = new SMTPClient({
    connection: {
      hostname: smtpHost,
      port: smtpPort,
      tls: smtpPort === 465,
      auth: {
        username: smtpUsername,
        password: smtpPassword,
      },
    },
  })

  try {
    const html = buildReminderEmailHtml({
      subject: params.subject,
      message: params.message,
      organizationName: params.organizationName,
    })

    await client.send({
      from: `${smtpFromName} <${smtpFromEmail}>`,
      to: params.toEmail,
      subject: params.subject,
      content: `${params.message}\n\nOrganization: ${params.organizationName}`,
      html,
    })
  } finally {
    await client.close()
  }
}

async function sendSmsReminder(params: {
  toPhone: string
  message: string
  organizationId: string
  reminderId: string
}) {
  const smsWebhookUrl = String(Deno.env.get('SMS_WEBHOOK_URL') || '').trim()
  const smsWebhookSecret = String(Deno.env.get('SMS_WEBHOOK_SECRET') || '').trim()

  if (!smsWebhookUrl) {
    throw new Error('SMS_WEBHOOK_NOT_CONFIGURED')
  }

  const response = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(smsWebhookSecret ? { 'x-sms-secret': smsWebhookSecret } : {}),
    },
    body: JSON.stringify({
      to: params.toPhone,
      message: params.message,
      organization_id: params.organizationId,
      reminder_id: params.reminderId,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`SMS_WEBHOOK_FAILED:${response.status}:${text.slice(0, 240)}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim()
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Supabase service role configuration missing' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  let payload: ReminderDispatchPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!payload?.reminder_id || !payload?.organization_id || !payload?.officer_id || !payload?.channel) {
    return new Response(JSON.stringify({ error: 'Missing required reminder dispatch fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { data: officer, error: officerError } = await (supabase as any)
      .from('user_profiles')
      .select('id, first_name, last_name, email, phone')
      .eq('id', payload.officer_id)
      .maybeSingle()

    if (officerError || !officer) {
      throw new Error('OFFICER_NOT_FOUND')
    }

    const { data: organization } = await (supabase as any)
      .from('organizations')
      .select('id, name')
      .eq('id', payload.organization_id)
      .maybeSingle()

    const officerName = [officer.first_name, officer.last_name].filter(Boolean).join(' ').trim() || 'Officer'
    const organizationName = String(organization?.name || payload.organization_id)

    if (payload.channel === 'email' || payload.channel === 'escalation') {
      if (!officer.email) {
        throw new Error('OFFICER_EMAIL_MISSING')
      }

      await sendEmailReminder({
        toEmail: officer.email,
        subject: `Training Reminder - ${officerName}`,
        message: payload.message,
        organizationName,
      })
    }

    if (payload.channel === 'sms' || payload.channel === 'escalation') {
      if (!officer.phone) {
        throw new Error('OFFICER_PHONE_MISSING')
      }

      await sendSmsReminder({
        toPhone: officer.phone,
        message: payload.message,
        organizationId: payload.organization_id,
        reminderId: payload.reminder_id,
      })
    }

    await (supabase as any)
      .from('training_assignment_reminders')
      .update({
        delivery_status: 'sent',
        delivered_at: new Date().toISOString(),
        delivery_response: {
          dispatched_channels: payload.channel === 'escalation' ? ['email', 'sms'] : [payload.channel],
        },
      })
      .eq('id', payload.reminder_id)
      .eq('organization_id', payload.organization_id)

    return new Response(JSON.stringify({ success: true, reminder_id: payload.reminder_id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = sanitizeError(error)

    await (supabase as any)
      .from('training_assignment_reminders')
      .update({
        delivery_status: 'failed',
        delivery_error: message,
      })
      .eq('id', payload.reminder_id)
      .eq('organization_id', payload.organization_id)

    return new Response(JSON.stringify({ error: message, reminder_id: payload.reminder_id }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
