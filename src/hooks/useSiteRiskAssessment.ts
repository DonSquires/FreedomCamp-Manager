import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SiteRiskAssessment {
  id: string
  organization_id: string
  case_id?: string | null
  zone_id: string | null
  assessed_by: string | null
  job_reference: string | null
  request_type: 'adhoc' | 'organisation_request' | 'service_provider_request'
  site_name: string
  site_address: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  assessment_date: string
  overall_risk_level: 'low' | 'medium' | 'high' | 'critical'

  // NZ WorkSafe hazard categories
  hazard_slips_trips_falls: boolean
  hazard_working_at_height: boolean
  hazard_manual_handling: boolean
  hazard_vehicles_traffic: boolean
  hazard_electrical: boolean
  hazard_fire: boolean
  hazard_hazardous_substances: boolean
  hazard_confined_spaces: boolean
  hazard_noise: boolean
  hazard_weather_exposure: boolean
  hazard_biological: boolean
  hazard_lone_working: boolean
  hazard_aggressive_persons: boolean
  hazard_animals: boolean
  hazard_water_drowning: boolean
  hazard_poor_lighting: boolean
  hazard_uneven_terrain: boolean
  hazard_other: boolean
  hazard_other_description: string | null

  controls_in_place: string | null
  additional_controls: string | null
  ppe_required: string[]

  emergency_plan_sighted: boolean
  first_aid_available: boolean
  communication_coverage: boolean
  safe_parking_available: boolean
  site_access_clear: boolean
  signage_adequate: boolean

  photos: string[]
  assessor_signature: string | null
  notes: string | null
  status: 'draft' | 'submitted' | 'reviewed' | 'archived'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  assessor?: { first_name: string; last_name: string } | null
  zone?: { name: string } | null
  reviewer?: { first_name: string; last_name: string } | null
}

/** NZ WorkSafe hazard categories for checklist UI */
export const HAZARD_CATEGORIES = [
  { key: 'hazard_slips_trips_falls', label: 'Slips, Trips & Falls', icon: '⚠️' },
  { key: 'hazard_working_at_height', label: 'Working at Height', icon: '🪜' },
  { key: 'hazard_manual_handling', label: 'Manual Handling / Lifting', icon: '📦' },
  { key: 'hazard_vehicles_traffic', label: 'Vehicles & Traffic', icon: '🚗' },
  { key: 'hazard_electrical', label: 'Electrical Hazards', icon: '⚡' },
  { key: 'hazard_fire', label: 'Fire Risk', icon: '🔥' },
  { key: 'hazard_hazardous_substances', label: 'Hazardous Substances', icon: '☣️' },
  { key: 'hazard_confined_spaces', label: 'Confined Spaces', icon: '🚧' },
  { key: 'hazard_noise', label: 'Noise Exposure', icon: '🔊' },
  { key: 'hazard_weather_exposure', label: 'Weather / UV Exposure', icon: '☀️' },
  { key: 'hazard_biological', label: 'Biological Hazards', icon: '🦠' },
  { key: 'hazard_lone_working', label: 'Lone / Isolated Working', icon: '🧍' },
  { key: 'hazard_aggressive_persons', label: 'Aggressive Persons', icon: '🚨' },
  { key: 'hazard_animals', label: 'Animals / Wildlife', icon: '🐕' },
  { key: 'hazard_water_drowning', label: 'Water / Drowning Risk', icon: '🌊' },
  { key: 'hazard_poor_lighting', label: 'Poor Lighting', icon: '🌑' },
  { key: 'hazard_uneven_terrain', label: 'Uneven Terrain', icon: '⛰️' },
  { key: 'hazard_other', label: 'Other Hazard', icon: '📝' },
] as const

export const PPE_OPTIONS = [
  'Hi-Vis Vest',
  'Safety Boots',
  'Hard Hat',
  'Safety Glasses',
  'Gloves',
  'Hearing Protection',
  'Sun Protection',
  'Wet Weather Gear',
  'Torch / Head Lamp',
  'First Aid Kit',
  'Communication Device',
] as const

export const CHECKLIST_ITEMS = [
  { key: 'emergency_plan_sighted', label: 'Emergency plan sighted / known' },
  { key: 'first_aid_available', label: 'First aid available on site' },
  { key: 'communication_coverage', label: 'Phone / radio coverage confirmed' },
  { key: 'safe_parking_available', label: 'Safe parking available' },
  { key: 'site_access_clear', label: 'Site access clear and safe' },
  { key: 'signage_adequate', label: 'Signage adequate' },
] as const

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSiteRiskAssessments(options?: {
  zoneId?: string
  status?: string
  riskLevel?: string
}) {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['site-risk-assessments', orgId, options?.zoneId, options?.status, options?.riskLevel],
    queryFn: async () => {
      let q = supabase
        .from('site_risk_assessments')
        .select('*, assessor:assessed_by(first_name, last_name), zone:zone_id(name), reviewer:reviewed_by(first_name, last_name)')
        .order('assessment_date', { ascending: false })

      if (orgId) q = q.eq('organization_id', orgId)
      if (options?.zoneId) q = q.eq('zone_id', options.zoneId)
      if (options?.status) q = q.eq('status', options.status)
      if (options?.riskLevel) q = q.eq('overall_risk_level', options.riskLevel)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as SiteRiskAssessment[]
    },
    enabled: !!orgId,
  })

  const createAssessment = useMutation({
    mutationFn: async (input: Partial<SiteRiskAssessment>) => {
      if (!orgId || !user?.id) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('site_risk_assessments')
        .insert({
          ...input,
          organization_id: orgId,
          assessed_by: user.id,
        } as any)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-risk-assessments'] })
      toast.success('Risk assessment saved')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save assessment'),
  })

  const updateAssessment = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SiteRiskAssessment> & { id: string }) => {
      if (!orgId) throw new Error('Not authenticated')
      const { zone: _zone, assessor: _assessor, reviewer: _reviewer, ...dbUpdates } = updates
      const { data, error } = await supabase
        .from('site_risk_assessments')
        .update(dbUpdates as any)
        .eq('id', id)
        .eq('organization_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-risk-assessments'] })
      toast.success('Assessment updated')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update assessment'),
  })

  const submitAssessment = useMutation({
    mutationFn: async (id: string) => {
      if (!orgId) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('site_risk_assessments')
        .update({ status: 'submitted' })
        .eq('id', id)
        .eq('organization_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-risk-assessments'] })
      toast.success('Assessment submitted for review')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to submit assessment'),
  })

  const reviewAssessment = useMutation({
    mutationFn: async (id: string) => {
      if (!orgId || !user?.id) throw new Error('Not authenticated')
      const { data, error } = await supabase
        .from('site_risk_assessments')
        .update({ status: 'reviewed', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-risk-assessments'] })
      toast.success('Assessment reviewed')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to review assessment'),
  })

  return {
    ...query,
    assessments: query.data ?? [],
    createAssessment,
    updateAssessment,
    submitAssessment,
    reviewAssessment,
  }
}
