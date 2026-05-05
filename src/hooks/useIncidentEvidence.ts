/**
 * useIncidentEvidence (B-08)
 *
 * Fetches a single incident with its associated evidence:
 *   - Incident row (photos, notes, GPS, metadata)
 *   - Enforcement events linked to the incident's case (photo_urls, evidence_notes)
 *
 * The hook is intentionally lightweight — evidence photo arrays are extracted
 * directly from the incident row and any linked enforcement_events.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface EvidenceItem {
  label: string
  url: string
}

export interface IncidentEvidenceData {
  id: string
  incident_type: string | null
  description: string | null
  notes: string | null
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  created_at: string | null
  severity: string | null
  status: string | null
  plate_number: string | null
  /** All photos collected from primary_evidence_url + metadata.photos */
  photos: EvidenceItem[]
  /** Evidence notes from linked enforcement_events */
  enforcement_notes: string[]
  /** Photo arrays from linked enforcement_events */
  enforcement_photos: EvidenceItem[]
}

export function useIncidentEvidence(incidentId: string | null | undefined) {
  return useQuery<IncidentEvidenceData | null>({
    queryKey: ['incident-evidence', incidentId],
    queryFn: async () => {
      if (!incidentId) return null

      // Fetch incident row — cast to any to bypass supabase generated type restrictions
      const { data: incident, error } = await (supabase as any)
        .from('incidents')
        .select(
          'id, incident_type, description, notes, location_address, location_lat, ' +
          'location_lng, created_at, severity, status, plate_number, ' +
          'primary_evidence_url, evidence_count, metadata',
        )
        .eq('id', incidentId)
        .single()

      if (error) throw error
      if (!incident) return null

      // Build primary photos list
      const photos: EvidenceItem[] = []
      if (incident.primary_evidence_url) {
        photos.push({ label: 'Primary Photo', url: incident.primary_evidence_url })
      }
      // metadata.photos is an optional string[] of additional photo URLs
      const meta = incident.metadata as Record<string, unknown> | null
      if (Array.isArray(meta?.photos)) {
        ;(meta.photos as string[]).forEach((url, i) => {
          photos.push({ label: `Photo ${i + 1}`, url })
        })
      }

      // Fetch enforcement_events for this incident (via operational_cases back-ref is complex;
      // enforcement_events don't have a direct incident_id — query by case_id if case exists
      // in metadata, otherwise skip gracefully).
      const caseId =
        typeof meta?.case_id === 'string' ? (meta.case_id as string) : null

      const enforcementNotes: string[] = []
      const enforcementPhotos: EvidenceItem[] = []

      if (caseId) {
        const { data: events } = await (supabase as any)
          .from('enforcement_events')
          .select('evidence_notes, photo_urls')
          .eq('case_id', caseId)

        for (const ev of events ?? []) {
          if (ev.evidence_notes) enforcementNotes.push(ev.evidence_notes)
          if (Array.isArray(ev.photo_urls)) {
            ev.photo_urls.forEach((url: string, i: number) => {
              enforcementPhotos.push({ label: `Enforcement Photo ${i + 1}`, url })
            })
          }
        }
      }

      return {
        id: incident.id,
        incident_type: incident.incident_type,
        description: incident.description,
        notes: incident.notes,
        location_address: incident.location_address,
        location_lat: incident.location_lat,
        location_lng: incident.location_lng,
        created_at: incident.created_at,
        severity: incident.severity,
        status: incident.status,
        plate_number: incident.plate_number,
        photos,
        enforcement_notes: enforcementNotes,
        enforcement_photos: enforcementPhotos,
      } as IncidentEvidenceData
    },
    enabled: !!incidentId,
    staleTime: 60_000,
  })
}
