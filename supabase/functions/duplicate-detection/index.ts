/**
 * DUPLICATE DETECTION - BATCH PROCESSOR
 * 
 * Processes up to 300 observations at a time
 * Finds duplicates by date/time + location (zone):
 * - same zone
 * - same NZ calendar date
 * - recorded within a configurable time window (default 5 minutes)
 * Keeps newest observation, deletes older duplicates
 * Frontend handles pagination and progress tracking
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_DUPLICATE_TIME_WINDOW_MINUTES = 5;

function nzDateKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function nzHour(value: string): number {
  return Number(new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(value)));
}

function nzDuplicateWindow(value: string): 'evening' | 'morning' | null {
  const h = nzHour(value);
  if (h >= 16 && h < 24) return 'evening';
  if (h >= 0 && h < 10) return 'morning';
  return null;
}

function isWithinTimeWindowMinutes(current: string, previous: string, minutes: number): boolean {
  const currentMs = new Date(current).getTime();
  const previousMs = new Date(previous).getTime();
  if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs)) return false;

  return Math.abs(currentMs - previousMs) <= minutes * 60 * 1000;
}

function isDuplicateByRule(current: any, previous: any, timeWindowMinutes: number): boolean {
  if (current.zone_id !== previous.zone_id) return false;

  const currentWindow = nzDuplicateWindow(current.recorded_at);
  const previousWindow = nzDuplicateWindow(previous.recorded_at);
  if (!currentWindow || currentWindow !== previousWindow) return false;
  if (nzDateKey(current.recorded_at) !== nzDateKey(previous.recorded_at)) return false;

  return isWithinTimeWindowMinutes(current.recorded_at, previous.recorded_at, timeWindowMinutes);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing Supabase environment configuration',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({
        error: 'Missing login token. Please sign in again.',
        auth_error: 'MISSING_AUTHORIZATION_HEADER',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch?.[1]) {
    return new Response(
      JSON.stringify({
        error: 'Invalid login token format. Please sign in again.',
        auth_error: 'MALFORMED_AUTHORIZATION_HEADER',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const jwt = bearerMatch[1].trim();

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  const supabaseUserScoped = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
  if (authError || !authData?.user) {
    return new Response(
      JSON.stringify({
        error: 'Session expired or invalid. Please sign in again.',
        auth_error: 'INVALID_AUTH_SESSION',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return new Response(
      JSON.stringify({
        error: 'User profile not found. Please contact support.',
        auth_error: 'PROFILE_NOT_FOUND',
      }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (profile.role !== 'master' && profile.role !== 'grand_master') {
    return new Response(
      JSON.stringify({
        error: 'Only master or grand_master users can run duplicate cleanup.',
        auth_error: 'INSUFFICIENT_ROLE',
        required_role: 'master',
        allowed_roles: ['master', 'grand_master'],
      }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('✅ Authenticated duplicate detection user:', authData.user.id);

  try {
    const {
      zoneIds,
      dateRangeStart,
      dateRangeEnd,
      offset = 0,
      batch_size = 50,
      get_total = false,
      time_window_minutes = DEFAULT_DUPLICATE_TIME_WINDOW_MINUTES,
    } = await req.json();

    const parsedTimeWindowMinutes = Number(time_window_minutes);
    const timeWindowMinutes = Number.isFinite(parsedTimeWindowMinutes) && parsedTimeWindowMinutes > 0
      ? parsedTimeWindowMinutes
      : DEFAULT_DUPLICATE_TIME_WINDOW_MINUTES;

    console.log('🔍 Duplicate Detection Request:', {
      zoneIds,
      dateRangeStart,
      dateRangeEnd,
      offset,
      batch_size,
      get_total,
      time_window_minutes: timeWindowMinutes,
    });

    // Build base query
    let query = supabaseAdmin
      .from('observations')
      .select('observation_id,id,plate_number,zone_id,recorded_at', { count: 'exact' });

    // Apply filters
    if (zoneIds && zoneIds.length > 0) {
      query = query.in('zone_id', zoneIds);
    }
    if (dateRangeStart) {
      query = query.gte('recorded_at', dateRangeStart);
    }
    if (dateRangeEnd) {
      query = query.lte('recorded_at', dateRangeEnd);
    }

    // If just getting total, return count
    if (get_total) {
      const { count, error: countError } = await query;
      if (countError) throw countError;
      
      console.log(`📊 Total observations: ${count}`);
      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get batch
    query = query.range(offset, offset + batch_size - 1).order('recorded_at', { ascending: false });
    
    const { data: observations, error: obsError } = await query;
    if (obsError) throw obsError;

    if (!observations || observations.length === 0) {
      console.log('⚠️ No observations in this batch');
      return new Response(
        JSON.stringify({ processed: 0, removed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Processing ${observations.length} observations...`);

    // Group by plate number
    const plateGroups = new Map<string, typeof observations>();
    for (const obs of observations) {
      const existing = plateGroups.get(obs.plate_number) || [];
      existing.push(obs);
      plateGroups.set(obs.plate_number, existing);
    }

    const duplicatesToDelete: string[] = [];
    const hasObservationId = observations.some((obs) => (obs as any).observation_id != null);
    const deleteKeyColumn: 'id' | 'observation_id' = hasObservationId ? 'observation_id' : 'id';

    // Find duplicates in each group
    for (const [plateNumber, plateObs] of plateGroups.entries()) {
      if (plateObs.length <= 1) continue;

      // Sort by recorded_at ascending (oldest first)
      plateObs.sort((a, b) => 
        new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      );

      // Keep first (oldest), check others
      for (let i = 1; i < plateObs.length; i++) {
        const current = plateObs[i];
        
        

        // Check against previous observations (earlier ones)
        for (let j = 0; j < i; j++) {
          const previous = plateObs[j];
          
          if (isDuplicateByRule(current, previous, timeWindowMinutes)) {
            const currentId = (current as any).observation_id ?? (current as any).id;
            if (!duplicatesToDelete.includes(currentId)) {
              duplicatesToDelete.push(currentId);
              console.log(`🗑️ Duplicate: ${plateNumber} (same zone/date/window + <=${timeWindowMinutes}m)`);
            }
            break;
          }
        }
      }
    }

    // Delete duplicates
    if (duplicatesToDelete.length > 0) {
      console.log(`🗑️ Deleting ${duplicatesToDelete.length} duplicates...`);
      
      // Delete as the authenticated master user so auth.uid() is available to
      // deletion-audit trigger logic that requires deleted_by.
      const { error: deleteError } = await supabaseUserScoped
        .from('observations')
        .delete()
        .in(deleteKeyColumn, duplicatesToDelete);

      if (deleteError) {
        console.error('❌ Delete failed:', deleteError.message);
        throw deleteError;
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${duplicatesToDelete.length} removed`);

    return new Response(
      JSON.stringify({
        processed: observations.length,
        removed: duplicatesToDelete.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Duplicate detection failed:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
