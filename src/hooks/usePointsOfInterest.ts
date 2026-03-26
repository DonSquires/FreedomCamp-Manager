import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonOfInterest {
  id: string
  organization_id: string
  created_by: string | null
  full_name: string
  date_of_birth: string | null
  description: string | null
  gender: string | null
  ethnicity: string | null
  height_cm: number | null
  weight_kg: number | null
  distinguishing_features: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  status: 'poi' | 'banned' | 'trespassed'
  reason: string | null
  photos: string[]
  notes: string | null
  privacy_notice_given: boolean
  privacy_lawful_purpose: string | null
  active: boolean
  expires_at: string | null
  created_at: string
  updated_at: string
  creator?: { first_name: string; last_name: string } | null
}

export interface VehicleOfInterest {
  id: string
  organization_id: string
  created_by: string | null
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_color: string | null
  vehicle_year: number | null
  description: string | null
  status: 'voi' | 'banned' | 'trespassed'
  reason: string | null
  photos: string[]
  notes: string | null
  linked_person_id: string | null
  active: boolean
  expires_at: string | null
  created_at: string
  updated_at: string
  creator?: { first_name: string; last_name: string } | null
  linked_person?: { full_name: string } | null
}

export interface TrespassNotice {
  id: string
  organization_id: string
  person_id: string | null
  vehicle_id: string | null
  issued_by: string | null
  zone_id: string | null
  reference_number: string | null
  notice_type: 'verbal' | 'written' | 'permanent'
  status: 'active' | 'expired' | 'withdrawn' | 'appealed'
  trespass_from: string | null
  trespass_reason: string
  legal_basis: string | null
  duration_days: number
  issued_at: string
  expires_at: string | null
  served_method: string | null
  witness_name: string | null
  witness_present: boolean
  photos: string[]
  notice_html: string | null
  notes: string | null
  privacy_notice_given: boolean
  created_at: string
  updated_at: string
  person?: { full_name: string } | null
  vehicle?: { plate_number: string } | null
  zone?: { name: string } | null
  issuer?: { first_name: string; last_name: string } | null
}

// ── Persons of Interest ──────────────────────────────────────────────────────

export function usePersonsOfInterest(options?: {
  status?: string
  search?: string
  activeOnly?: boolean
}) {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['persons-of-interest', orgId, options?.status, options?.search, options?.activeOnly],
    queryFn: async () => {
      let q = (supabase as any)
        .from('persons_of_interest')
        .select('*, creator:created_by(first_name, last_name)')
        .order('created_at', { ascending: false })

      if (orgId) q = q.eq('organization_id', orgId)
      if (options?.status) q = q.eq('status', options.status)
      if (options?.activeOnly !== false) q = q.eq('active', true)
      if (options?.search) q = q.ilike('full_name', `%${options.search}%`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as PersonOfInterest[]
    },
    enabled: !!orgId,
  })

  const createPerson = useMutation({
    mutationFn: async (input: Partial<PersonOfInterest>) => {
      const { data, error } = await (supabase as any)
        .from('persons_of_interest')
        .insert({ ...input, organization_id: orgId!, created_by: user!.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons-of-interest'] })
      toast.success('Person of interest added')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add person'),
  })

  const updatePerson = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PersonOfInterest> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from('persons_of_interest')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons-of-interest'] })
      toast.success('Person updated')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update person'),
  })

  const deletePerson = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('persons_of_interest').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons-of-interest'] })
      toast.success('Person removed')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to remove person'),
  })

  return { ...query, persons: query.data ?? [], createPerson, updatePerson, deletePerson }
}

// ── Vehicles of Interest ─────────────────────────────────────────────────────

export function useVehiclesOfInterest(options?: {
  status?: string
  search?: string
  activeOnly?: boolean
}) {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['vehicles-of-interest', orgId, options?.status, options?.search, options?.activeOnly],
    queryFn: async () => {
      let q = (supabase as any)
        .from('vehicles_of_interest')
        .select('*, creator:created_by(first_name, last_name), linked_person:linked_person_id(full_name)')
        .order('created_at', { ascending: false })

      if (orgId) q = q.eq('organization_id', orgId)
      if (options?.status) q = q.eq('status', options.status)
      if (options?.activeOnly !== false) q = q.eq('active', true)
      if (options?.search) q = q.ilike('plate_number', `%${options.search}%`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as VehicleOfInterest[]
    },
    enabled: !!orgId,
  })

  const createVehicle = useMutation({
    mutationFn: async (input: Partial<VehicleOfInterest>) => {
      const { data, error } = await (supabase as any)
        .from('vehicles_of_interest')
        .insert({ ...input, organization_id: orgId!, created_by: user!.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles-of-interest'] })
      toast.success('Vehicle of interest added')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add vehicle'),
  })

  const updateVehicle = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<VehicleOfInterest> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from('vehicles_of_interest')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles-of-interest'] })
      toast.success('Vehicle updated')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update vehicle'),
  })

  const deleteVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('vehicles_of_interest').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles-of-interest'] })
      toast.success('Vehicle removed')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to remove vehicle'),
  })

  return { ...query, vehicles: query.data ?? [], createVehicle, updateVehicle, deleteVehicle }
}

// ── Trespass Notices ─────────────────────────────────────────────────────────

export function useTrespassNotices(options?: {
  status?: string
  personId?: string
  vehicleId?: string
}) {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['trespass-notices', orgId, options?.status, options?.personId, options?.vehicleId],
    queryFn: async () => {
      let q = (supabase as any)
        .from('trespass_notices')
        .select('*, person:person_id(full_name), vehicle:vehicle_id(plate_number), zone:zone_id(name), issuer:issued_by(first_name, last_name)')
        .order('issued_at', { ascending: false })

      if (orgId) q = q.eq('organization_id', orgId)
      if (options?.status) q = q.eq('status', options.status)
      if (options?.personId) q = q.eq('person_id', options.personId)
      if (options?.vehicleId) q = q.eq('vehicle_id', options.vehicleId)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as TrespassNotice[]
    },
    enabled: !!orgId,
  })

  const createNotice = useMutation({
    mutationFn: async (input: Partial<TrespassNotice>) => {
      const expiresAt = input.duration_days
        ? new Date(Date.now() + (input.duration_days * 24 * 60 * 60 * 1000)).toISOString()
        : null
      const { data, error } = await (supabase as any)
        .from('trespass_notices')
        .insert({
          ...input,
          organization_id: orgId!,
          issued_by: user!.id,
          expires_at: expiresAt,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trespass-notices'] })
      toast.success('Trespass notice issued')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to issue trespass notice'),
  })

  const updateNotice = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TrespassNotice> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from('trespass_notices')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trespass-notices'] })
      toast.success('Trespass notice updated')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update notice'),
  })

  return { ...query, notices: query.data ?? [], createNotice, updateNotice }
}
