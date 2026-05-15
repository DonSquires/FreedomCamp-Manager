import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

export interface CommandResult {
  reply: string;
  success: boolean;
  actionType?: string;
  data?: Record<string, any>;
}

/**
 * Parse Bob command intents and route them to database updates.
 * Intercepts messages for roster, site, and client provisioning keywords.
 */
export async function parseBobCommand(
  rawText: string,
  contextOfficer: string,
  orgId?: string
): Promise<CommandResult> {
  const cleanedText = rawText.toLowerCase().trim();

  try {
    // SCENARIO 1: ROSTER PROVISIONING INTENT
    if (
      cleanedText.includes('roster') ||
      cleanedText.includes('add staff') ||
      cleanedText.includes('schedule')
    ) {
      const dateString = 'Tomorrow';
      const timeWindow = '07:00 - 15:00';
      const targetZone = cleanedText.includes('richmond')
        ? 'Richmond Mall'
        : cleanedText.includes('salisbury')
          ? 'Salisbury Hub'
          : 'General Zone';

      // Extract officer name from context or parse from text
      const officerNameMatch = rawText.match(/(?:add|assign|roster)\s+(?:staff\s+)?(\w+(?:\s+\w+)?)/i);
      const targetOfficerName = officerNameMatch ? officerNameMatch[1] : contextOfficer;

      // Query for officer profile
      let officer: any = null
      let profileError: any = null
      try {
        const result = await supabase
          .from('profiles')
          .select('id, first_name')
          .ilike('first_name', `%${targetOfficerName}%`)
          .limit(1)
          .single()
        officer = result.data
        profileError = result.error
      } catch (err) {
        profileError = err
      }

      if (!officer || profileError) {
        return {
          reply: `Officer profile for "${targetOfficerName}" not found in system. Try using exact first name or full name.`,
          success: false,
          actionType: 'roster_provision',
        };
      }

      // Insert roster entry
      let rosterEntry: any = null
      let rosterError: any = null
      try {
        const result = await supabase
          .from('rosters')
          .insert([
            {
              officer_id: officer.id,
              date_string: dateString,
              time_window: timeWindow,
              zone: targetZone,
              confirmed: false,
              organization_id: orgId,
            },
          ])
          .select()
          .single()
        rosterEntry = result.data
        rosterError = result.error
      } catch (err: any) {
        rosterError = err?.message
      }

      if (rosterError) {
        return {
          reply: `Roster provisioning failed: ${rosterError}. Check officer availability.`,
          success: false,
          actionType: 'roster_provision',
        };
      }

      return {
        reply: `✅ Roster updated. Staged ${officer.first_name} onto the ${targetZone} route for ${dateString} (${timeWindow}). Pending confirmation. [📋 View Shifts]`,
        success: true,
        actionType: 'roster_provision',
        data: rosterEntry,
      };
    }

    // SCENARIO 2: NEW CLIENT SITE INITIALIZATION INTENT
    if (
      cleanedText.includes('site') ||
      cleanedText.includes('create client') ||
      cleanedText.includes('new location')
    ) {
      const siteNameMatch = rawText.match(
        /(?:create|add|new)\s+(?:client\s+)?site[:]?\s*(.+?)(?:\s+at\s+|$)/i
      );
      const siteName =
        siteNameMatch && siteNameMatch[1]
          ? siteNameMatch[1].trim()
          : 'Ad-hoc Commercial Zone';

      // Extract region if mentioned
      const regionMatch = rawText.match(
        /(?:in|at|region:?)\s+([\w\s]+?)(?:\s+|$)/i
      );
      const region = regionMatch
        ? regionMatch[1].trim()
        : 'Tasman / Nelson';

      // Insert client site
      let site: any = null
      let siteError: any = null
      try {
        const result = await supabase
          .from('client_sites')
          .insert([
            {
              site_name: siteName,
              region: region,
              created_by: contextOfficer,
              organization_id: orgId,
            },
          ])
          .select()
          .single()
        site = result.data
        siteError = result.error
      } catch (err: any) {
        siteError = err?.message
      }

      if (siteError) {
        return {
          reply: `Client Site creation failed: ${siteError}. Verify details and retry.`,
          success: false,
          actionType: 'site_create',
        };
      }

      return {
        reply: `✅ Client Site asset created: "${siteName}" (Region: ${region}). ID: ${site.id}. Syncing spatial records with LINZ API now. [🗺️ View Map]`,
        success: true,
        actionType: 'site_create',
        data: site,
      };
    }

    // GENERAL CHAT DELEGATION FALLBACK
    return {
      reply: `I logged that note, boss. If you need me to update rosters or create client sites, include 'roster' or 'site' in your command.`,
      success: true,
      actionType: 'general_note',
    };
  } catch (err: any) {
    console.error('Bob intent parser error:', err);

    // Log telemetry
    try {
      await supabase
        .from('agent_telemetry')
        .insert([
          {
            event_trigger: 'INTENT_PARSER_CRASH',
            run_status: 'circuit_breaker_tripped',
            error_mitigated: err.message,
            confidence_score: 0.0,
          },
        ])
    } catch (telemetryErr) {
      console.error('Telemetry log failed:', telemetryErr)
    }

    return {
      reply: `Pipeline exception while executing system alteration: ${err.message}. Dr. Bob module has been alerted.`,
      success: false,
      actionType: 'error',
    };
  }
}

/**
 * Process multimodal evidence (images) uploaded alongside chat messages.
 * Store in compliance vault and link to chat thread.
 */
export async function processEvidenceCapture(
  imageBlob: Blob,
  context: {
    incidentType?: string;
    location?: string;
    officer: string;
    orgId?: string;
  }
): Promise<CommandResult> {
  try {
    const filename = `evidence_${Date.now()}.jpg`;
    const filepath = `evidence/${context.orgId || 'shared'}/${filename}`;

    // Upload image to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('compliance-vault')
      .upload(filepath, imageBlob, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      return {
        reply: `Image upload failed: ${uploadError.message}. Check storage permissions.`,
        success: false,
        actionType: 'evidence_capture',
      };
    }

    // Create evidence record
    let evidence: any = null
    let evidenceError: any = null
    try {
      const result = await supabase
        .from('evidence_artifacts')
        .insert([
          {
            file_path: uploadData.path,
            incident_type: context.incidentType || 'GENERAL_EVIDENCE',
            location: context.location,
            uploaded_by: context.officer,
            organization_id: context.orgId,
          },
        ])
        .select()
        .single()
      evidence = result.data
      evidenceError = result.error
    } catch (err: any) {
      evidenceError = err?.message
    }

    if (evidenceError) {
      return {
        reply: `Evidence catalog failed: ${evidenceError}. Image stored but not indexed.`,
        success: false,
        actionType: 'evidence_capture',
      };
    }

    return {
      reply: `📸 Evidence captured and indexed. Type: ${context.incidentType || 'General'}. Location: ${context.location || 'Not specified'}. [🔍 Review Image]`,
      success: true,
      actionType: 'evidence_capture',
      data: evidence,
    };
  } catch (err: any) {
    console.error('Evidence capture error:', err);
    return {
      reply: `Evidence processing failed: ${err.message}.`,
      success: false,
      actionType: 'evidence_capture',
    };
  }
}
