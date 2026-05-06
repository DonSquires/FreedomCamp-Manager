/**
 * initiate-parking-payment — B-29 Pay-by-Plate Integration
 *
 * Scaffolded PayByPhone NZ / T2 Systems parking payment integration.
 *
 * Validates the plate + zone combination, looks up the applicable fee,
 * creates a pending parking_payments row, and (when PAYBYPHONE_API_KEY is
 * configured) calls the PayByPhone NZ API to create a payment session.
 * When the key is absent the function returns a mock payment_url so the
 * UI render path works without blocking deployment.
 *
 * POST body (application/json):
 * {
 *   plate_number:   string  — vehicle plate (normalised to uppercase)
 *   zone_id:        string  — UUID of the parking zone
 *   duration_mins:  number  — requested parking duration in minutes
 *   contact_email?: string  — receipt destination
 *   contact_phone?: string  — phone for PayByPhone lookup
 * }
 *
 * Response:
 * { payment_id: string, payment_url: string, amount_nzd: number, provider: string }
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 * Optional env (function degrades gracefully when absent):
 *   PAYBYPHONE_API_KEY
 *   PAYBYPHONE_API_BASE_URL  (default: https://api.paybyphone.com)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const DEFAULT_HOURLY_RATE_NZD = 2.00  // fallback when zone fee not set

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const { plate_number, zone_id, duration_mins, contact_email, contact_phone } = body as {
      plate_number?: string
      zone_id?: string
      duration_mins?: number
      contact_email?: string
      contact_phone?: string
    }

    if (!plate_number || typeof plate_number !== 'string') {
      return new Response(JSON.stringify({ error: 'plate_number is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!zone_id || typeof zone_id !== 'string') {
      return new Response(JSON.stringify({ error: 'zone_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!duration_mins || duration_mins < 15 || duration_mins > 1440) {
      return new Response(JSON.stringify({ error: 'duration_mins must be between 15 and 1440' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const normalisedPlate = plate_number.toUpperCase().replace(/\s+/g, '')

    // Look up zone for organisation_id and fee
    const { data: zone, error: zoneErr } = await supabase
      .from('zones')
      .select('id, organization_id, name, fee_nzd')
      .eq('id', zone_id)
      .eq('is_active', true)
      .single()

    if (zoneErr || !zone) {
      return new Response(JSON.stringify({ error: 'Zone not found or inactive' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Calculate fee — use dynamic pricing if available, fall back to zone flat rate
    let hourlyRate = (zone.fee_nzd as number | null) ?? DEFAULT_HOURLY_RATE_NZD
    let appliedRuleLabel: string | null = null
    try {
      const priceResp = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/calculate-dynamic-price`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({ zone_id, datetime_iso: new Date().toISOString() }),
        }
      )
      if (priceResp.ok) {
        const priceData = await priceResp.json()
        if (typeof priceData.effective_fee_nzd === 'number') {
          hourlyRate = priceData.effective_fee_nzd
          appliedRuleLabel = priceData.applied_rule_label ?? null
        }
      }
    } catch {
      // Non-blocking — use base fee
    }
    const amount_nzd = Math.round((hourlyRate * duration_mins / 60) * 100) / 100

    // Insert pending payment row
    const { data: payment, error: insertErr } = await supabase
      .from('parking_payments')
      .insert({
        organization_id: zone.organization_id,
        plate_number: normalisedPlate,
        zone_id,
        amount_nzd,
        payment_provider: 'paybyphone',
        status: 'pending',
        contact_email: contact_email ?? null,
        contact_phone: contact_phone ?? null,
        metadata: { duration_mins, zone_name: zone.name, applied_rule_label: appliedRuleLabel },
      })
      .select('id')
      .single()

    if (insertErr || !payment) {
      console.error('parking_payments insert error:', insertErr)
      return new Response(JSON.stringify({ error: 'Failed to create payment record' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const paymentId = payment.id

    const pbpKey = Deno.env.get('PAYBYPHONE_API_KEY')
    const pbpBase = Deno.env.get('PAYBYPHONE_API_BASE_URL') ?? 'https://api.paybyphone.com'

    // --- Live PayByPhone NZ integration ---
    if (pbpKey) {
      try {
        const pbpRes = await fetch(`${pbpBase}/v1/sessions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${pbpKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            licencePlate: normalisedPlate,
            locationId: zone_id,
            durationMinutes: duration_mins,
            rateOption: { optionId: 'standard' },
            paymentMethod: { paymentMethodId: 'redirect' },
            notificationInfo: contact_email ? { phonenumber: contact_phone, email: contact_email } : undefined,
          }),
        })

        if (pbpRes.ok) {
          const pbpData = await pbpRes.json() as { sessionId?: string; redirectUrl?: string }
          const provider_reference = pbpData.sessionId ?? null
          const payment_url = pbpData.redirectUrl ?? `${pbpBase}/pay?session=${provider_reference}`

          // Update payment row with provider reference
          await supabase
            .from('parking_payments')
            .update({ provider_reference, status: 'pending' })
            .eq('id', paymentId)

          return new Response(JSON.stringify({ payment_id: paymentId, payment_url, amount_nzd, provider: 'paybyphone' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        } else {
          console.error('PayByPhone API error:', pbpRes.status, await pbpRes.text())
          // Fall through to mock response if PBP unavailable
        }
      } catch (pbpErr) {
        console.error('PayByPhone fetch error:', pbpErr)
        // Fall through to mock response
      }
    }

    // --- Degraded / mock mode ---
    const mockPaymentUrl = `https://pay.fieldops.nz/parking?payment_id=${paymentId}&amount=${amount_nzd}`

    return new Response(JSON.stringify({ payment_id: paymentId, payment_url: mockPaymentUrl, amount_nzd, provider: 'mock' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('initiate-parking-payment error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
