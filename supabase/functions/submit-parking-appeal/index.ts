/**
 * submit-parking-appeal — Public parking infringement appeal handler (B-15)
 *
 * Unauthenticated (anon) endpoint.
 *
 * POST body:
 *   {
 *     infringement_number: string   — e.g. "PKG-2026-000042"
 *     plate_number:        string   — must match infringement record
 *     appellant_name?:     string
 *     appellant_email?:    string
 *     appellant_phone?:    string
 *     grounds:             string   — minimum 10 chars
 *     evidence_statement?: string
 *   }
 *
 * Actions:
 *   1. Validate infringement_number + plate_number match a real infringement row
 *   2. Check infringement status allows an appeal (not already paid/written_off/court_referred)
 *   3. Insert parking_appeals row
 *   4. Update infringement status to 'disputed'
 *   5. Return { success: true, appeal_id, infringement_number }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { getCorsHeaders } from '../_shared/withCors.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const {
      infringement_number,
      plate_number,
      appellant_name,
      appellant_email,
      appellant_phone,
      grounds,
      evidence_statement,
    } = body as {
      infringement_number: string;
      plate_number:        string;
      appellant_name?:     string;
      appellant_email?:    string;
      appellant_phone?:    string;
      grounds:             string;
      evidence_statement?: string;
    };

    // ── Input validation ──────────────────────────────────────────────────────
    if (!infringement_number?.trim()) {
      return new Response(JSON.stringify({ error: 'infringement_number is required' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    if (!plate_number?.trim()) {
      return new Response(JSON.stringify({ error: 'plate_number is required' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    if (!grounds?.trim() || grounds.trim().length < 10) {
      return new Response(JSON.stringify({ error: 'grounds must be at least 10 characters' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── 1. Lookup infringement ────────────────────────────────────────────────
    const { data: inf, error: infError } = await supabase
      .from('parking_infringements')
      .select('id, organization_id, infringement_number, plate_number, status')
      .eq('infringement_number', infringement_number.trim().toUpperCase())
      .eq('plate_number', plate_number.trim().toUpperCase())
      .single();

    if (infError || !inf) {
      return new Response(
        JSON.stringify({ error: 'No matching infringement found. Check your notice number and plate number.' }),
        { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    // ── 2. Guard: already in a terminal state ─────────────────────────────────
    const BLOCKED_STATUSES = ['paid', 'written_off', 'court_referred', 'withdrawn'];
    if (BLOCKED_STATUSES.includes(inf.status)) {
      return new Response(
        JSON.stringify({
          error: `This infringement cannot be appealed — current status is '${inf.status}'.`,
        }),
        { status: 422, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    // ── 3. Insert appeal ──────────────────────────────────────────────────────
    const { data: appeal, error: appealError } = await supabase
      .from('parking_appeals')
      .insert({
        organization_id:         inf.organization_id,
        parking_infringement_id: inf.id,
        infringement_number:     inf.infringement_number,
        plate_number:            inf.plate_number,
        appellant_name:          appellant_name?.trim()   || null,
        appellant_email:         appellant_email?.trim()  || null,
        appellant_phone:         appellant_phone?.trim()  || null,
        grounds:                 grounds.trim(),
        evidence_statement:      evidence_statement?.trim() || null,
        status:                  'received',
      })
      .select('id')
      .single();

    if (appealError) {
      console.error('[submit-parking-appeal] insert error:', appealError);
      return new Response(
        JSON.stringify({ error: 'Failed to submit appeal. Please try again.' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    // ── 4. Mark infringement as disputed ──────────────────────────────────────
    await supabase
      .from('parking_infringements')
      .update({ status: 'disputed' })
      .eq('id', inf.id)
      .not('status', 'in', '(paid,written_off,court_referred,withdrawn)');

    return new Response(
      JSON.stringify({
        success: true,
        appeal_id:          appeal.id,
        infringement_number: inf.infringement_number,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('[submit-parking-appeal] unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err.message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );
  }
});
