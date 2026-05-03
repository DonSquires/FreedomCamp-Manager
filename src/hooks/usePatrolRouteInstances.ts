import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

export const FIELD_OFFICER_ROUTE_TEST_OVERRIDE_KEY = 'fieldOfficerRouteTestOverride.v1'
export const FIELD_OFFICER_ROUTE_TEST_OVERRIDE_EVENT = 'copilot:test-route-override-updated'
export const PATROL_ROUTE_STOP_STATUS_EVENT = 'copilot:patrol-route-stop-status'

type RouteStopUpdateSource = 'manual' | 'zone_enter_auto' | 'zone_exit_auto'

interface PatrolRouteStopStatusEventDetail {
  routeInstanceId: string
  stopId: string
  status: 'arrived' | 'completed'
  previousStatus: PatrolRouteInstanceStop['visit_status'] | null
  source: RouteStopUpdateSource
  planStatus: 'in_progress' | 'completed'
  recordedAt: string
  mode: 'test_override' | 'database'
}

export interface PatrolRouteInstance {
  id: string
  organization_id: string
  roster_shift_id: string | null
  patrol_id: string | null
  patrol_route_id: string
  patrol_route_name?: string | null
  officer_id: string | null
  planning_mode: 'baseline' | 'randomized' | 'dispatch_replan'
  plan_status: 'planned' | 'in_progress' | 'paused' | 'completed' | 'cancelled' | 'superseded'
  planned_start_time: string | null
  planned_end_time: string | null
  predicted_duration_minutes: number | null
  created_at: string
  updated_at: string
}

export interface PatrolRouteInstanceStop {
  id: string
  route_instance_id: string
  checkpoint_id: string | null
  zone_id: string | null
  stop_name: string
  is_mandatory: boolean
  sequence_no: number
  planned_arrival_window_start: string | null
  planned_arrival_window_end: string | null
  planned_dwell_minutes: number | null
  actual_arrival_at: string | null
  actual_departure_at: string | null
  visit_status: 'pending' | 'arrived' | 'completed' | 'skipped' | 'failed'
}

export interface FieldOfficerRouteTestOverride {
  activeRouteInstance?: PatrolRouteInstance | null
  activeRouteStops?: PatrolRouteInstanceStop[]
  currentPatrolZone?: string | null
  disableGeofenceMonitoring?: boolean
  forceOperationalView?: boolean
}

function canUseWindowStorage() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

export function readFieldOfficerRouteTestOverride(): FieldOfficerRouteTestOverride | null {
  if (!canUseWindowStorage()) return null

  try {
    const raw = window.sessionStorage.getItem(FIELD_OFFICER_ROUTE_TEST_OVERRIDE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as FieldOfficerRouteTestOverride
  } catch {
    return null
  }
}

function writeFieldOfficerRouteTestOverride(override: FieldOfficerRouteTestOverride) {
  if (!canUseWindowStorage()) return

  window.sessionStorage.setItem(FIELD_OFFICER_ROUTE_TEST_OVERRIDE_KEY, JSON.stringify(override))
  window.dispatchEvent(new CustomEvent(FIELD_OFFICER_ROUTE_TEST_OVERRIDE_EVENT))
}

function emitRouteStopStatusEvent(detail: PatrolRouteStopStatusEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PATROL_ROUTE_STOP_STATUS_EVENT, { detail }))
}

function useFieldOfficerRouteTestOverrideVersion() {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!canUseWindowStorage()) return

    const bump = () => setVersion((value) => value + 1)
    window.addEventListener(FIELD_OFFICER_ROUTE_TEST_OVERRIDE_EVENT, bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener(FIELD_OFFICER_ROUTE_TEST_OVERRIDE_EVENT, bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  return version
}

export function useFieldOfficerRouteTestOverride() {
  useFieldOfficerRouteTestOverrideVersion()
  return readFieldOfficerRouteTestOverride()
}

export function usePatrolRouteInstances(filters?: { rosterShiftId?: string; patrolId?: string }) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-route-instances', user?.organization_id, filters],
    queryFn: async () => {
      if (!user?.organization_id) return []

      let query = (supabase as any)
        .from('patrol_route_instances')
        .select('id, organization_id, roster_shift_id, patrol_id, patrol_route_id, officer_id, planning_mode, plan_status, planned_start_time, planned_end_time, predicted_duration_minutes, created_at, updated_at')
        .eq('organization_id', user.organization_id)
        .order('created_at', { ascending: false })

      if (filters?.rosterShiftId) query = query.eq('roster_shift_id', filters.rosterShiftId)
      if (filters?.patrolId) query = query.eq('patrol_id', filters.patrolId)

      const { data, error } = await query
      if (error) throw error
      return (data || []) as PatrolRouteInstance[]
    },
    enabled: !!user?.organization_id,
  })
}

export function usePatrolRouteInstanceStops(routeInstanceId?: string) {
  const overrideVersion = useFieldOfficerRouteTestOverrideVersion()

  return useQuery({
    queryKey: ['patrol-route-instance-stops', routeInstanceId, overrideVersion],
    queryFn: async () => {
      if (!routeInstanceId) return []

      const testOverride = readFieldOfficerRouteTestOverride()
      if (testOverride?.activeRouteInstance?.id === routeInstanceId && testOverride.activeRouteStops) {
        return testOverride.activeRouteStops
      }

      const { data, error } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .select('id, route_instance_id, checkpoint_id, zone_id, stop_name, is_mandatory, sequence_no, planned_arrival_window_start, planned_arrival_window_end, planned_dwell_minutes, actual_arrival_at, actual_departure_at, visit_status')
        .eq('route_instance_id', routeInstanceId)
        .order('sequence_no')
      if (error) throw error
      return (data || []) as PatrolRouteInstanceStop[]
    },
    enabled: !!routeInstanceId,
  })
}

export function useOfficerActiveRouteInstance() {
  const { user } = useAuthStore()
  const overrideVersion = useFieldOfficerRouteTestOverrideVersion()

  return useQuery({
    queryKey: ['officer-active-patrol-route-instance', user?.id, user?.organization_id, overrideVersion],
    queryFn: async () => {
      if (!user?.id || !user?.organization_id) return null

      const testOverride = readFieldOfficerRouteTestOverride()
      if (testOverride?.activeRouteInstance !== undefined) {
        return testOverride.activeRouteInstance
      }

      const { data, error } = await (supabase as any)
        .from('patrol_route_instances')
        .select(`
          id,
          organization_id,
          roster_shift_id,
          patrol_id,
          patrol_route_id,
          officer_id,
          planning_mode,
          plan_status,
          planned_start_time,
          planned_end_time,
          predicted_duration_minutes,
          created_at,
          updated_at,
          patrol_routes(route_name)
        `)
        .eq('organization_id', user.organization_id)
        .eq('officer_id', user.id)
        .in('plan_status', ['planned', 'in_progress', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error

      const row = (data?.[0] ?? null) as any
      if (!row) return null

      return {
        id: row.id,
        organization_id: row.organization_id,
        roster_shift_id: row.roster_shift_id,
        patrol_id: row.patrol_id,
        patrol_route_id: row.patrol_route_id,
        patrol_route_name: row.patrol_routes?.route_name ?? null,
        officer_id: row.officer_id,
        planning_mode: row.planning_mode,
        plan_status: row.plan_status,
        planned_start_time: row.planned_start_time,
        planned_end_time: row.planned_end_time,
        predicted_duration_minutes: row.predicted_duration_minutes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } as PatrolRouteInstance
    },
    enabled: !!user?.id && !!user?.organization_id,
    refetchInterval: 30_000,
  })
}

export function useUpdatePatrolRouteStopStatus() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({
      stopId,
      routeInstanceId,
      status,
      source = 'manual',
    }: {
      stopId: string
      routeInstanceId: string
      status: 'arrived' | 'completed'
      source?: RouteStopUpdateSource
    }) => {
      const now = new Date().toISOString()
      const testOverride = readFieldOfficerRouteTestOverride()

      if (testOverride?.activeRouteInstance?.id === routeInstanceId && testOverride.activeRouteStops) {
        const previousStop = testOverride.activeRouteStops.find((stop) => stop.id === stopId)
        const nextStops = testOverride.activeRouteStops.map((stop) => {
          if (stop.id !== stopId) return stop

          return {
            ...stop,
            visit_status: status,
            actual_arrival_at: status === 'arrived' ? now : (stop.actual_arrival_at ?? now),
            actual_departure_at: status === 'completed' ? now : stop.actual_departure_at,
          }
        })

        const hasOpenStops = nextStops.some((row) => ['pending', 'arrived'].includes(row.visit_status))
        const nextPlanStatus = hasOpenStops ? 'in_progress' : 'completed'
        writeFieldOfficerRouteTestOverride({
          ...testOverride,
          activeRouteInstance: testOverride.activeRouteInstance
            ? {
                ...testOverride.activeRouteInstance,
                plan_status: nextPlanStatus,
                updated_at: now,
              }
            : testOverride.activeRouteInstance,
          activeRouteStops: nextStops,
        })

        emitRouteStopStatusEvent({
          routeInstanceId,
          stopId,
          status,
          previousStatus: previousStop?.visit_status ?? null,
          source,
          planStatus: nextPlanStatus,
          recordedAt: now,
          mode: 'test_override',
        })

        return { status, source }
      }

      const updatePayload: Record<string, unknown> = { visit_status: status }

      const { data: stopRow, error: fetchStopError } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .select('id, route_instance_id, zone_id, checkpoint_id, stop_name, sequence_no, visit_status, actual_arrival_at, actual_departure_at, planned_dwell_minutes, organization_id')
        .eq('id', stopId)
        .eq('route_instance_id', routeInstanceId)
        .maybeSingle()

      if (fetchStopError) throw fetchStopError
      if (!stopRow) throw new Error('Patrol route stop not found')

      if (status === 'arrived') {
        updatePayload.actual_arrival_at = now
      }
      if (status === 'completed') {
        updatePayload.actual_arrival_at = stopRow.actual_arrival_at ?? now
        updatePayload.actual_departure_at = now
      }

      const { error: updateStopError } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .update(updatePayload)
        .eq('id', stopId)
        .eq('route_instance_id', routeInstanceId)

      if (updateStopError) throw updateStopError

      const auditPayload = {
        action: `patrol_route_stop_${status}`,
        entity_type: 'operational_route_stop',
        entity_id: stopId,
        performed_by: user?.id ?? null,
        organization_id: user?.organization_id ?? stopRow.organization_id ?? null,
        new_values: {
          route_instance_id: routeInstanceId,
          stop_id: stopId,
          stop_name: stopRow.stop_name,
          sequence_no: stopRow.sequence_no,
          zone_id: stopRow.zone_id,
          checkpoint_id: stopRow.checkpoint_id,
          previous_status: stopRow.visit_status,
          current_status: status,
          automation_source: source,
          operational_surface: stopRow.zone_id ? 'zone' : 'checkpoint_or_site',
          planned_dwell_minutes: stopRow.planned_dwell_minutes,
          actual_arrival_at: status === 'arrived' ? now : (stopRow.actual_arrival_at ?? now),
          actual_departure_at: status === 'completed' ? now : stopRow.actual_departure_at,
          recorded_at: now,
        },
      }

      const { error: auditError } = await (supabase as any)
        .from('audit_log')
        .insert({
          ...auditPayload,
          organization_id: auditPayload.organization_id,
        })

      if (auditError) throw auditError

      const { data: stops, error: fetchStopsError } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .select('visit_status')
        .eq('route_instance_id', routeInstanceId)

      if (fetchStopsError) throw fetchStopsError

      const stopRows = (stops ?? []) as Array<{ visit_status: string }>
      const hasOpenStops = stopRows.some((row) => ['pending', 'arrived'].includes(row.visit_status))
      const nextPlanStatus = hasOpenStops ? 'in_progress' : 'completed'

      if (hasOpenStops) {
        const { error: progressError } = await (supabase as any)
          .from('patrol_route_instances')
          .update({ plan_status: nextPlanStatus })
          .eq('id', routeInstanceId)
          .in('plan_status', ['planned', 'paused', 'in_progress'])

        if (progressError) throw progressError
      } else {
        const { error: completeError } = await (supabase as any)
          .from('patrol_route_instances')
          .update({
            plan_status: 'completed',
            actual_end_time: now,
          })
          .eq('id', routeInstanceId)

        if (completeError) throw completeError
      }

      emitRouteStopStatusEvent({
        routeInstanceId,
        stopId,
        status,
        previousStatus: stopRow.visit_status,
        source,
        planStatus: nextPlanStatus,
        recordedAt: now,
        mode: 'database',
      })

      return { status, source }
    },
    onSuccess: ({ status, source }) => {
      queryClient.invalidateQueries({ queryKey: ['officer-active-patrol-route-instance'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instances'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instance-stops'] })
      if (source === 'zone_enter_auto') {
        toast.success('Stop auto-marked as arrived from zone entry')
        return
      }
      if (source === 'zone_exit_auto') {
        toast.success('Stop auto-completed after zone exit and dwell')
        return
      }
      toast.success(status === 'arrived' ? 'Stop marked as arrived' : 'Stop completed')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update stop status')
    },
  })
}

export function useGeneratePatrolRouteInstance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ rosterShiftId, forceRegenerate = false }: { rosterShiftId: string; forceRegenerate?: boolean }) => {
      const { data, error } = await (supabase as any)
        .rpc('generate_patrol_route_instance', {
          p_roster_shift_id: rosterShiftId,
          p_force_regenerate: forceRegenerate,
          p_created_by: null,
        })

      if (error) throw error
      return data as { status: string; route_instance_id: string; stops_created?: number }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instances'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instance-stops'] })
      toast.success('Patrol route plan generated')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to generate patrol route plan')
    },
  })
}
