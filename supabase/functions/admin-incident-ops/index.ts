/**
 * Admin Incident Operations Edge Function
 * 
 * Handles administrative actions on incidents:
 * - set_legal_hold: Toggle retention hold and set retention_until date
 * - bulk_update: Batch operations on multiple incidents
 * 
 * Authorization: Admin role required (user_role = 'admin' or 'master')
 * 
 * Usage:
 * POST /admin-incident-ops
 * {
 *   "action": "set_legal_hold",
 *   "incident_id": "uuid",
 *   "retention_hold": true,
 *   "retention_until": "2026-12-31T00:00:00Z"
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts';

Deno.serve(withCors(async (req) => {
  // Validate auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Missing authorization header', req, 401);
  }

  const jwt = authHeader.replace('Bearer ', '');

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(jwt);
  if (userError || !user) {
    return errorResponse('Unauthorized', req, 401);
  }

  // Parse request
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return errorResponse('Invalid JSON body', req, 400);
  }

  const { action, incident_id, retention_hold, retention_until, notes } = body;

  if (!action) {
    return errorResponse('Missing required field: action', req, 400);
  }

  // Create service role client (bypasses RLS for admin operations)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const { data: callerProfile } = await supabase
    .from('user_profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!callerProfile || !['admin', 'master'].includes(callerProfile.role)) {
    return errorResponse('Forbidden: Admin role required', req, 403);
  }

  // ============================================================================
  // Action: Set Legal Hold
  // ============================================================================
  if (action === 'set_legal_hold') {
    if (!incident_id) {
      return errorResponse('Missing required field: incident_id', req, 400);
    }

    // Verify incident exists and user has access
    const { data: incident, error: fetchError } = await supabase
      .from('incidents')
      .select('id, organization_id, status, retention_hold')
      .eq('id', incident_id)
      .single();

    if (fetchError || !incident) {
      return errorResponse('Incident not found', req, 404);
    }

    // Prepare update payload
    const updateData: any = {
      retention_hold: retention_hold ?? false,
      updated_at: new Date().toISOString(),
    };

    // Set retention_until if provided (optional)
    if (retention_until) {
      updateData.retention_until = retention_until;
    } else if (retention_hold === false) {
      // Clearing hold also clears retention_until
      updateData.retention_until = null;
    }

    // Add retention notes if provided
    if (notes) {
      updateData.retention_notes = notes;
    }

    // Update incident
    const { error: updateError } = await supabase
      .from('incidents')
      .update(updateData)
      .eq('id', incident_id);

    if (updateError) {
      console.error('Legal hold update error:', updateError);
      return errorResponse(
        `Failed to update legal hold: ${updateError.message}`,
        req,
        500
      );
    }

    console.log(`✅ Legal hold ${retention_hold ? 'enabled' : 'disabled'} for incident ${incident_id} by ${user.id}`);

    return jsonResponse(
      {
        success: true,
        incident_id,
        retention_hold: updateData.retention_hold,
        retention_until: updateData.retention_until,
        message: retention_hold 
          ? 'Legal hold enabled - incident exempt from 30-day purge' 
          : 'Legal hold disabled - 30-day purge applies',
      },
      req
    );
  }

  // ============================================================================
  // Action: Bulk Update (future extension)
  // ============================================================================
  if (action === 'bulk_update') {
    const { incident_ids, updates } = body;
    
    if (!incident_ids || !Array.isArray(incident_ids) || incident_ids.length === 0) {
      return errorResponse('Missing or invalid field: incident_ids (array)', req, 400);
    }

    if (!updates || typeof updates !== 'object') {
      return errorResponse('Missing or invalid field: updates (object)', req, 400);
    }

    // Apply bulk update
    const { error: bulkError } = await supabase
      .from('incidents')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .in('id', incident_ids);

    if (bulkError) {
      console.error('Bulk update error:', bulkError);
      return errorResponse(`Bulk update failed: ${bulkError.message}`, req, 500);
    }

    console.log(`✅ Bulk updated ${incident_ids.length} incidents by ${user.id}`);

    return jsonResponse(
      {
        success: true,
        count: incident_ids.length,
        message: `Updated ${incident_ids.length} incidents`,
      },
      req
    );
  }

  // ============================================================================
  // Unknown Action
  // ============================================================================
  return errorResponse(
    `Invalid action: ${action}. Supported: set_legal_hold, bulk_update`,
    req,
    400
  );
}));
