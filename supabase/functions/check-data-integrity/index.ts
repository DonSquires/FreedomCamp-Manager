import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * SIMPLE DATA INTEGRITY CHECK
 * 
 * Query v2 → Delete duplicates + Mark invalid plates → Process 80 at a time
 */

// NZ plate patterns
const NZ_PLATE_PATTERNS = [
  /^[A-Z]{3}\d{3}$/,      // ABC123
  /^[A-Z]{2}\d{4}$/,      // AB1234
  /^[A-Z]{6}$/,           // ABCDEF
  /^[A-Z]{3}\d{2}$/,      // ABC12
  /^[A-Z]{1,3}\d{1,4}$/,  // A1 to ABC1234
];

function isValidNZPlate(plate: string): boolean {
  if (!plate || typeof plate !== 'string') return false;
  const cleaned = plate.toUpperCase().replace(/[\s-]/g, '');
  return NZ_PLATE_PATTERNS.some(pattern => pattern.test(cleaned));
}

interface IntegrityIssue {
  table: string;
  issue_type: 'duplicate' | 'orphaned' | 'invalid_plate';
  severity: 'critical' | 'warning';
  record_id: string;
  plate_number?: string;
  description: string;
  action_taken?: 'deleted' | 'marked' | 'none';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization');
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const params = await req.json();
    const { get_total, offset = 0, batch_size = 80 } = params;

    console.log('📥 Request:', { get_total, offset, batch_size });

    // Build query on observations (new primary table)
    let query = supabaseAdmin
      .from('observations')
      .select('*', { count: 'exact' });

    // GET TOTAL MODE
    if (get_total) {
      const { count, error } = await query.select('*', { count: 'exact', head: true });
      if (error) throw error;

      console.log(`📊 Total observations: ${count}`);

      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PROCESS BATCH MODE
    const { data: observations, error: obsError } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (obsError) throw obsError;

    console.log(`📦 Processing ${observations?.length || 0} observations`);

    if (!observations || observations.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, duplicates_deleted: 0, invalid_plates_marked: 0, issues: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const issues: IntegrityIssue[] = [];
    let duplicatesDeleted = 0;
    let invalidPlatesMarked = 0;

    // TEST 1: Check for duplicates (same plate + zone + date) and DELETE them
    const seen = new Map<string, { obs_id: string; plate: string }>();
    
    for (const obs of observations) {
      const obsId = (obs as any).observation_id ?? (obs as any).id;
      const date = obs.recorded_at.split('T')[0];
      const key = `${obs.plate_number}_${obs.zone_id}_${date}`;
      
      if (seen.has(key)) {
        // DELETE duplicate observation (keep first one)
        const { error: deleteError } = await supabaseAdmin
          .from('observations')
          .delete()
          .eq((obs as any).observation_id ? 'observation_id' : 'id', obsId);

        if (!deleteError) {
          duplicatesDeleted++;
          issues.push({
            table: 'observations',
            issue_type: 'duplicate',
            severity: 'critical',
            record_id: obsId,
            plate_number: obs.plate_number,
            description: `Duplicate observation for ${obs.plate_number} on ${date} - DELETED`,
            action_taken: 'deleted',
          });
        } else {
          console.error('Failed to delete duplicate:', obsId, deleteError);
          issues.push({
            table: 'observations',
            issue_type: 'duplicate',
            severity: 'critical',
            record_id: obsId,
            plate_number: obs.plate_number,
            description: `Duplicate observation for ${obs.plate_number} on ${date} - FAILED TO DELETE`,
            action_taken: 'none',
          });
        }
      } else {
        seen.set(key, { obs_id: (obs as any).observation_id ?? (obs as any).id, plate: obs.plate_number });
      }
    }

    // TEST 2: Check for orphaned records (plate not in canonical)
    const plates = [...new Set(observations.map(o => o.plate_number))];
    
    const { data: validPlates, error: platesError } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('plate_number')
      .in('plate_number', plates);

    if (!platesError) {
      const validPlateSet = new Set(validPlates?.map(v => v.plate_number) || []);
      
      for (const obs of observations) {
        if (!validPlateSet.has(obs.plate_number)) {
          issues.push({
            table: 'observations',
            issue_type: 'orphaned',
            severity: 'critical',
            record_id: (obs as any).observation_id ?? (obs as any).id,
            plate_number: obs.plate_number,
            description: `Orphaned observation - plate ${obs.plate_number} not in canonical_vehicles`,
            action_taken: 'none',
          });
        }
      }
    }

    // TEST 3: Check for invalid NZ plate formats and MARK them
    const invalidPlatesProcessed = new Set<string>();
    
    for (const obs of observations) {
      if (!isValidNZPlate(obs.plate_number) && !invalidPlatesProcessed.has(obs.plate_number)) {
        invalidPlatesProcessed.add(obs.plate_number);

        // Check if already marked in canonical_vehicles
        const { data: canonicalData } = await supabaseAdmin
          .from('canonical_vehicles')
          .select('plate_number, homeless_notes')
          .eq('plate_number', obs.plate_number)
          .single();

        if (canonicalData) {
          const existingNotes = canonicalData.homeless_notes || '';
          const markerText = '[POSSIBLE INVALID PLATE - Pending NZ Registry Verification]';
          
          // Only add marker if not already present
          if (!existingNotes.includes(markerText)) {
            const updatedNotes = existingNotes 
              ? `${markerText}\n\n${existingNotes}`
              : markerText;

            const { error: updateError } = await supabaseAdmin
              .from('canonical_vehicles')
              .update({ homeless_notes: updatedNotes })
              .eq('plate_number', obs.plate_number);

            if (!updateError) {
              invalidPlatesMarked++;
              issues.push({
                table: 'canonical_vehicles',
                issue_type: 'invalid_plate',
                severity: 'warning',
                record_id: obs.plate_number,
                plate_number: obs.plate_number,
                description: `Marked as possible invalid plate format: ${obs.plate_number}`,
                action_taken: 'marked',
              });
            } else {
              console.error('Failed to mark invalid plate:', obs.plate_number, updateError);
              issues.push({
                table: 'canonical_vehicles',
                issue_type: 'invalid_plate',
                severity: 'warning',
                record_id: obs.plate_number,
                plate_number: obs.plate_number,
                description: `Invalid NZ plate format: ${obs.plate_number} - FAILED TO MARK`,
                action_taken: 'none',
              });
            }
          } else {
            // Already marked
            issues.push({
              table: 'canonical_vehicles',
              issue_type: 'invalid_plate',
              severity: 'warning',
              record_id: obs.plate_number,
              plate_number: obs.plate_number,
              description: `Invalid plate (already marked): ${obs.plate_number}`,
              action_taken: 'none',
            });
          }
        }
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${duplicatesDeleted} deleted, ${invalidPlatesMarked} marked`);

    return new Response(
      JSON.stringify({ 
        processed: observations.length, 
        duplicates_deleted: duplicatesDeleted,
        invalid_plates_marked: invalidPlatesMarked,
        issues 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
