import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

interface ExportRequest {
  type: 'observations' | 'breaches' | 'notices'
  format?: 'json' | 'csv'
  organizationId: string
  from?: string
  to?: string
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const header = keys.join(',')
  const body = rows.map((row) => keys.map((k) => csvEscape(row[k])).join(',')).join('\n')
  return `${header}\n${body}\n`
}

function getTimeRange(from?: string, to?: string) {
  const start = from ? (from.includes('T') ? from : `${from}T00:00:00Z`) : undefined
  const end = to ? (to.includes('T') ? to : `${to}T23:59:59Z`) : undefined
  return { start, end }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as ExportRequest
    if (!body.type || !body.organizationId) {
      return new Response(JSON.stringify({ error: 'type and organizationId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    const allowed = profile && (
      profile.role === 'grand_master' ||
      profile.role === 'master' ||
      profile.organization_id === body.organizationId
    )

    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden for requested organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { start, end } = getTimeRange(body.from, body.to)
    const format = body.format ?? 'json'

    if (body.type === 'observations') {
      let q = adminClient
        .from('observations')
        .select('observation_id,plate_number,recorded_at,zone_id,is_compliant,breach_type')
        .eq('organization_id', body.organizationId)
        .order('recorded_at', { ascending: false })
        .limit(50000)
      if (start) q = q.gte('recorded_at', start)
      if (end) q = q.lte('recorded_at', end)
      const { data, error } = await q
      if (error) throw error
      if (format === 'csv') {
        const csv = toCsv(data ?? [])
        return new Response(csv, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="observations_export.csv"',
          },
        })
      }
      return new Response(JSON.stringify({ data: data ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.type === 'breaches') {
      let q = adminClient
        .from('breach_alerts')
        .select('id,plate_number,breach_type,status,created_at,resolved_at')
        .eq('organization_id', body.organizationId)
        .order('created_at', { ascending: false })
        .limit(50000)
      if (start) q = q.gte('created_at', start)
      if (end) q = q.lte('created_at', end)
      const { data, error } = await q
      if (error) throw error
      if (format === 'csv') {
        const csv = toCsv(data ?? [])
        return new Response(csv, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="breaches_export.csv"',
          },
        })
      }
      return new Response(JSON.stringify({ data: data ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let q = adminClient
      .from('infringement_notices')
      .select('id,notice_number,plate_number,issued_at,status,amount_cents')
      .eq('organization_id', body.organizationId)
      .order('issued_at', { ascending: false })
      .limit(50000)
    if (start) q = q.gte('issued_at', start)
    if (end) q = q.lte('issued_at', end)
    const { data, error } = await q
    if (error) throw error
    if (format === 'csv') {
      const csv = toCsv(data ?? [])
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="notices_export.csv"',
        },
      })
    }
    return new Response(JSON.stringify({ data: data ?? [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
