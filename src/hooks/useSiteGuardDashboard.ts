/**
 * useSiteGuardDashboard
 *
 * Hook for a static guard or guarding-rostered officer at a client site.
 *
 * Features:
 *   - Loads site details including geofence centre and radius
 *   - Tracks officer GPS against the site geofence
 *   - Returns site-scoped POI records (only when inside geofence)
 *   - Returns today's site incidents
 *   - Provides createIncident + linkPoiToIncident mutations
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { calculateDistance } from '@/lib/geofence'
import { nzNow } from '@/lib/timezone'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteDetails {
  id: string
  name: string
  site_type: string
  address: string | null
  gps_lat: number | null
  gps_lng: number | null
  geofence_radius_metres: number
  access_instructions: string | null
  hazards: string | null
  special_instructions: string | null
  contact_name: string | null
  contact_phone: string | null
  emergency_contact_phone: string | null
}

export interface SitePOI {
  id: string
  full_name: string
  description: string | null
  status: string
  photos: string[]
  distinguishing_features: string | null
  trespass_expiry: string | null
  reason: string | null
  client_site_id: string | null
  site_specific: boolean
  active: boolean
  expires_at: string | null
}

export interface SiteIncident {
  id: string
  incident_type: string
  severity: string
  description: string
  subject_name: string | null
  subject_photos: string[]
  police_notified: boolean
  police_event_number: string | null
  camera_review_requested: boolean
  camera_review_status: string
  status: string
  created_at: string
  poi_id: string | null
  poi: { full_name: string } | null
}

export interface NewIncidentData {
  client_site_id: string
  incident_type: string
  severity: string
  description: string
  action_taken: string
  subject_name: string
  subject_description: string
  subject_photos: string[]
  police_notified: boolean
  police_notified_at: string | null
  police_event_number: string
  police_officer_name: string
  police_station: string
  police_notes: string
  camera_review_requested: boolean
  camera_review_notes: string
  gps_lat: number | null
  gps_lng: number | null
  location_description: string
  poi_id: string | null
  officer_shift_id: string | null
  roster_shift_id: string | null
}

export interface UseSiteGuardDashboardResult {
  site: SiteDetails | null
  siteLoading: boolean
  /** Distance in metres from officer's current GPS to site centre */
  distanceToSite: number | null
  /** Whether officer is considered inside the site geofence */
  isInsideFence: boolean
  /** POI records for this site — only populated when inside the geofence */
  sitePOI: SitePOI[]
  poiLoading: boolean
  /** All POI (org-wide + site-specific) for search — no geofence restriction */
  allSitePOI: SitePOI[]
  /** Today's incidents at this site */
  incidents: SiteIncident[]
  incidentsLoading: boolean
  createIncident: (data: NewIncidentData) => Promise<void>
  createLoading: boolean
  linkPoiToIncident: (incidentId: string, poiId: string) => Promise<void>
  triggerEmergencyAssist: (input?: {
    assistType?: 'emergency' | 'medical' | 'aggressive_person' | 'supervisor_required' | 'police_required'
    severity?: 'medium' | 'high' | 'critical'
    description?: string
    gpsLat?: number | null
    gpsLng?: number | null
  }) => Promise<void>
  emergencyAssistLoading: boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSiteGuardDashboard(
  clientSiteId: string | null
): UseSiteGuardDashboardResult {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const today = format(nzNow(), 'yyyy-MM-dd')

  // ── GPS position ────────────────────────────────────────────────────────────

  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // ── Site details ────────────────────────────────────────────────────────────

  const { data: site = null, isLoading: siteLoading } = useQuery<SiteDetails | null>({
    queryKey: ['site_guard_site', clientSiteId],
    queryFn: async () => {
      if (!clientSiteId || !user?.organization_id) return null
      const { data, error } = await supabase
        .from('client_sites')
        .select(`
          id, name, site_type, address, gps_lat, gps_lng,
          geofence_radius_metres, access_instructions, hazards,
          special_instructions, contact_name, contact_phone,
          emergency_contact_phone
        `)
        .eq('id', clientSiteId)
        .eq('organization_id', user.organization_id)
        .maybeSingle()
      if (error || !data) return null
      return data as SiteDetails
    },
    enabled: !!clientSiteId && !!user?.organization_id,
  })

  // ── Geofence check ──────────────────────────────────────────────────────────

  const distanceToSite: number | null =
    position && site?.gps_lat && site?.gps_lng
      ? calculateDistance(position.lat, position.lng, site.gps_lat, site.gps_lng)
      : null

  const isInsideFence =
    distanceToSite !== null
      ? distanceToSite <= (site?.geofence_radius_metres ?? 150)
      : false

  // ── Site-scoped POI (geofence-gated for site_specific; always show org POI) ─

  const { data: sitePOI = [], isLoading: poiLoading } = useQuery<SitePOI[]>({
    queryKey: ['site_guard_poi', clientSiteId, isInsideFence, user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id || !clientSiteId) return []

      // Always load org-wide + site-specific POI.
      // The frontend gates site_specific visibility with isInsideFence.
      const { data, error } = await supabase
        .from('persons_of_interest')
        .select(`
          id, full_name, description, status, photos,
          distinguishing_features, reason, client_site_id,
          site_specific, active, expires_at
        `)
        .eq('organization_id', user.organization_id)
        .eq('active', true)
        .or(`client_site_id.eq.${clientSiteId},client_site_id.is.null`)
        .order('full_name')

      if (error) return []
      const all = (data ?? []) as SitePOI[]

      // Filter: show org-wide POI always; show site_specific only inside fence
      return all.filter((p) =>
        !p.site_specific || p.client_site_id === clientSiteId ? isInsideFence : true
      )
    },
    enabled: !!clientSiteId && !!user?.organization_id,
    refetchInterval: isInsideFence ? 60_000 : 300_000,
  })

  // All POI for search (used by incident form to link POI without fence restriction)
  const { data: allSitePOI = [] } = useQuery<SitePOI[]>({
    queryKey: ['site_all_poi', clientSiteId, user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id || !clientSiteId) return []
      const { data } = await supabase
        .from('persons_of_interest')
        .select('id, full_name, description, status, photos, distinguishing_features, reason, client_site_id, site_specific, active, expires_at')
        .eq('organization_id', user.organization_id)
        .eq('active', true)
        .or(`client_site_id.eq.${clientSiteId},client_site_id.is.null`)
        .order('full_name')
      return (data ?? []) as SitePOI[]
    },
    enabled: !!clientSiteId && !!user?.organization_id,
  })

  // ── Today's site incidents ──────────────────────────────────────────────────

  const { data: incidents = [], isLoading: incidentsLoading } = useQuery<SiteIncident[]>({
    queryKey: ['site_incidents', clientSiteId, today],
    queryFn: async () => {
      if (!clientSiteId || !user?.organization_id) return []
      const { data, error } = await supabase
        .from('site_incidents')
        .select(`
          id, incident_type, severity, description,
          subject_name, subject_photos, police_notified, police_event_number,
          camera_review_requested, camera_review_status, status, created_at,
          poi_id,
          poi:persons_of_interest!poi_id(full_name)
        `)
        .eq('client_site_id', clientSiteId)
        .eq('organization_id', user.organization_id)
        .gte('created_at', `${today}T00:00:00`)
        .order('created_at', { ascending: false })
      if (error) return []
      return (data ?? []).map((i: any) => ({
        ...i,
        poi: Array.isArray(i.poi) ? i.poi[0] ?? null : i.poi,
      })) as SiteIncident[]
    },
    enabled: !!clientSiteId && !!user?.organization_id,
    refetchInterval: 30_000,
  })

  // ── Mutations ───────────────────────────────────────────────────────────────

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['site_incidents', clientSiteId] })
  }, [queryClient, clientSiteId])

  const resolveActiveSiteGuardCaseId = useCallback(async (siteId: string) => {
    if (!user?.id || !user?.organization_id) return null
    const { data: activeShift } = await (supabase as any)
      .from('site_guard_shifts')
      .select('case_id')
      .eq('organization_id', user.organization_id)
      .eq('officer_id', user.id)
      .eq('client_site_id', siteId)
      .eq('status', 'active')
      .order('shift_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    return activeShift?.case_id ? String(activeShift.case_id) : null
  }, [user?.id, user?.organization_id])

  const { mutateAsync: createIncident, isPending: createLoading } = useMutation({
    mutationFn: async (data: NewIncidentData) => {
      if (!user?.id || !user?.organization_id) throw new Error('Not authenticated')

      // C1 case-backbone bridge: if officer has an active site-guard shift for
      // this site, attach the incident to that shared operational case.
      let activeCaseId: string | null = null
      activeCaseId = await resolveActiveSiteGuardCaseId(data.client_site_id)

      const { error } = await supabase.from('site_incidents').insert({
        ...data,
        organization_id: user.organization_id,
        case_id: activeCaseId,
        officer_id: user.id,
        subject_name:   data.subject_name   || null,
        police_event_number: data.police_event_number || null,
        police_officer_name: data.police_officer_name || null,
        police_station:      data.police_station || null,
        police_notes:        data.police_notes || null,
        camera_review_notes: data.camera_review_notes || null,
        location_description: data.location_description || null,
        status: 'submitted',
      })
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['siteGuardCaseTimeline'] })
    },
  })

  const { mutateAsync: linkPoiToIncident } = useMutation({
    mutationFn: async ({ incidentId, poiId }: { incidentId: string; poiId: string }) => {
      if (!user?.organization_id) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('site_incidents')
        .update({ poi_id: poiId })
        .eq('id', incidentId)
        .eq('organization_id', user.organization_id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: triggerEmergencyAssist, isPending: emergencyAssistLoading } = useMutation({
    mutationFn: async (input?: {
      assistType?: 'emergency' | 'medical' | 'aggressive_person' | 'supervisor_required' | 'police_required'
      severity?: 'medium' | 'high' | 'critical'
      description?: string
      gpsLat?: number | null
      gpsLng?: number | null
    }) => {
      if (!user?.id || !user?.organization_id || !clientSiteId) {
        throw new Error('Not authenticated')
      }

      const caseId = await resolveActiveSiteGuardCaseId(clientSiteId)
      if (!caseId) {
        throw new Error('No active Site Guard case found for this site')
      }

      const { error } = await (supabase as any)
        .from('emergency_assist_events')
        .insert({
          organization_id: user.organization_id,
          case_id: caseId,
          officer_id: user.id,
          client_site_id: clientSiteId,
          assist_type: input?.assistType ?? 'emergency',
          severity: input?.severity ?? 'critical',
          description: input?.description ?? null,
          gps_lat: input?.gpsLat ?? null,
          gps_lng: input?.gpsLng ?? null,
          status: 'active',
          triggered_at: new Date().toISOString(),
        })

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['siteGuardCaseTimeline', caseId] })
      queryClient.invalidateQueries({ queryKey: ['emergencyAssists', user.organization_id] })
    },
  })

  return {
    site,
    siteLoading,
    distanceToSite,
    isInsideFence,
    sitePOI,
    poiLoading,
    allSitePOI,
    incidents,
    incidentsLoading,
    createIncident,
    createLoading,
    linkPoiToIncident: (incidentId, poiId) =>
      linkPoiToIncident({ incidentId, poiId }),
    triggerEmergencyAssist,
    emergencyAssistLoading,
  }
}
