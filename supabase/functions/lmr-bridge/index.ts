/**
 * lmr-bridge -- B-35 LMR / Radio Bridge scaffold
 *
 * Zello Gateway webhook receiver for LMR (Land Mobile Radio) bridging.
 *
 * The Zello Gateway calls this endpoint when:
 *   1. A radio unit starts transmitting on the bridged channel (lmr_to_ptt)
 *   2. A radio unit ends transmitting (close the session row)
 *   3. A PTT app user starts transmitting towards LMR (ptt_to_lmr) --
 *      outbound direction is triggered by the PTT front-end via this endpoint
 *
 * Security:
 *   - Incoming Zello Gateway webhook requests must include a shared secret
 *     in the Authorization header: "Bearer <ZELLO_GATEWAY_SECRET>"
 *   - Inserts use the service-role Supabase client so they bypass RLS
 *     (the org/config resolution provides the tenant boundary).
 *
 * Payload (POST JSON):
 *   event: 'session_start' | 'session_end' | 'ptt_start' | 'ptt_end'
 *   config_id: string (uuid of lmr_bridge_config row)
 *   radio_unit_id?: string
 *   radio_unit_alias?: string
 *   channel_id: string
 *   direction: 'lmr_to_ptt' | 'ptt_to_lmr'
 *   ptt_speaker_id?: string
 *   ptt_speaker_name?: string
 *   audio_url?: string
 *   transcript?: string
 *   is_emergency?: boolean
 *   session_id?: string  -- for session_end / ptt_end events
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const GATEWAY_SECRET = Deno.env.get('ZELLO_GATEWAY_SECRET') ?? ''

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Verify gateway shared secret
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (GATEWAY_SECRET && token !== GATEWAY_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const {
      event,
      config_id,
      radio_unit_id,
      radio_unit_alias,
      channel_id,
      direction,
      ptt_speaker_id,
      ptt_speaker_name,
      audio_url,
      transcript,
      is_emergency,
      session_id,
    } = body

    if (!event || !config_id) {
      return new Response(JSON.stringify({ error: 'event and config_id are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Service-role client -- bypasses RLS for logging
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Resolve org from config
    const { data: config, error: configErr } = await supabase
      .from('lmr_bridge_config')
      .select('id, organization_id, is_active')
      .eq('id', config_id)
      .single()

    if (configErr || !config) {
      return new Response(JSON.stringify({ error: 'Bridge config not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!config.is_active) {
      return new Response(JSON.stringify({ error: 'Bridge config is inactive' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (event === 'session_start' || event === 'ptt_start') {
      const { data: newSession, error: insertErr } = await supabase
        .from('lmr_bridge_sessions')
        .insert({
          organization_id: config.organization_id,
          config_id,
          direction: direction ?? 'lmr_to_ptt',
          radio_unit_id: radio_unit_id ?? null,
          radio_unit_alias: radio_unit_alias ?? null,
          ptt_speaker_id: ptt_speaker_id ?? null,
          ptt_speaker_name: ptt_speaker_name ?? null,
          channel_id: channel_id ?? '',
          is_emergency: is_emergency ?? false,
          metadata: { event },
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error('lmr-bridge session insert error:', insertErr)
        return new Response(JSON.stringify({ error: 'Failed to create session' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(
        JSON.stringify({ ok: true, session_id: newSession?.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (event === 'session_end' || event === 'ptt_end') {
      if (!session_id) {
        return new Response(JSON.stringify({ error: 'session_id required for session_end' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const updates: Record<string, unknown> = { ended_at: new Date().toISOString() }
      if (audio_url)  updates.audio_url  = audio_url
      if (transcript) updates.transcript = transcript

      const { error: updateErr } = await supabase
        .from('lmr_bridge_sessions')
        .update(updates)
        .eq('id', session_id)
        .eq('organization_id', config.organization_id)

      if (updateErr) {
        console.error('lmr-bridge session update error:', updateErr)
        return new Response(JSON.stringify({ error: 'Failed to close session' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({ error: `Unknown event: ${event}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
