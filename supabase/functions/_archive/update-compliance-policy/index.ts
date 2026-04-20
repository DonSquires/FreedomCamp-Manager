import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { requireAuth } from '../_shared/requireAuth.ts';

interface VehicleRecord {
  id: string;
  plate_number: string;
  zone_id: string;
  recorded_at: string;
  notes: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    // Authenticate request — only logged-in users may trigger policy recalculation.
    const authResult = await requireAuth(req);
    if (!authResult.user) {
      return new Response(
        JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔄 Starting compliance policy update for all records...');

    // Get all vehicle observations
    const { data: observations, error: observationsError } = await supabaseAdmin
      .from('observations')
      .select('*')
      .order('recorded_at', { ascending: true });

    if (observationsError) throw observationsError;

    if (!observations || observations.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No observations to process' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📊 Processing ${observations.length} vehicle observations...`);

    let updatedCount = 0;
    let overnightDetected = 0;
    let eveningWarnings = 0;

    // Process each observation
    for (const observation of observations) {
      try {
        const observationId = (observation as any).observation_id ?? (observation as any).id;
        const observationKey = (observation as any).observation_id ? 'observation_id' : 'id';
        // Convert recorded_at to NZ timezone
        const recordedDate = new Date(observation.recorded_at);
        const nzTime = new Date(recordedDate.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
        const recordHour = nzTime.getHours();

        let updateNote = '';
        let needsUpdate = false;

        // Check if recorded during overnight hours (20:00 - 05:00)
        if (recordHour >= 20 || recordHour < 5) {
          updateNote = `\n\n🌙 OVERNIGHT STAY DETECTED (Retroactive Policy Update)\nRecorded at ${nzTime.toLocaleString('en-NZ', {
            timeZone: 'Pacific/Auckland',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })} NZ time - Vehicle confirmed staying overnight based on recording time.`;
          needsUpdate = true;
          overnightDetected++;
        }
        // Check if recorded during evening warning window (15:00 - 20:00)
        else if (recordHour >= 15 && recordHour < 20) {
          updateNote = `\n\n⚠️ EVENING RECORDING (Retroactive Policy Update)\nRecorded at ${nzTime.toLocaleString('en-NZ', {
            timeZone: 'Pacific/Auckland',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })} NZ time - Vehicle recorded during evening hours (possible overnight stay).`;
          needsUpdate = true;
          eveningWarnings++;
        }

        // Update observation if needed
        if (needsUpdate) {
          const existingNotes = observation.officer_notes || '';
          
          // Only add note if it doesn't already contain the retroactive policy marker
          if (!existingNotes.includes('Retroactive Policy Update')) {
            const updatedNotes = existingNotes + updateNote;

            const { error: updateError } = await supabaseAdmin
              .from('observations')
              .update({ officer_notes: updatedNotes })
              .eq(observationKey, observationId);

            if (updateError) {
              console.error(`Failed to update observation ${observationId}:`, updateError);
            } else {
              updatedCount++;
            }
          }
        }
      } catch (err) {
        console.error(`Error processing observation ${(observation as any).observation_id ?? (observation as any).id}:`, err);
      }
    }

    console.log(`✅ Compliance policy update complete:`);
    console.log(`   - Total observations processed: ${observations.length}`);
    console.log(`   - Observations updated: ${updatedCount}`);
    console.log(`   - Overnight stays detected: ${overnightDetected}`);
    console.log(`   - Evening warnings added: ${eveningWarnings}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Compliance policy update completed successfully',
        stats: {
          totalObservations: observations.length,
          observationsUpdated: updatedCount,
          overnightDetected,
          eveningWarnings
        }
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Compliance policy update failed:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Unknown error',
        details: error.toString()
      }),
      { 
        status: 500,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      }
    );
  }
});
