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
  const smtpFromName = Deno.env.get('SMTP_FROM_NAME') || 'FieldOps Manager'

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
    await client.send({
      from: `${smtpFromName} <${smtpFromEmail}>`,
      to: params.toEmail,
      subject: params.subject,
      content: `${params.message}\n\nOrganization: ${params.organizationName}`,
      html: `<p>${params.message}</p><p><strong>Organization:</strong> ${params.organizationName}</p>`,
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
