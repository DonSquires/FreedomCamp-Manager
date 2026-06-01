/**
 * OperationsMap — Full-screen layered operations map for admin situational awareness.
 *
 * Layers (each independently toggleable):
 *   🔵 Freedom Camping       — breach/observation heat circles by zone
 *   🟠 Noise Control         — active noise jobs with priority colour
 *   🌿 Biosecurity (CNG)     — biosecurity infestation jobs
 *   💨 Smoke Complaints      — smoke OOH complaint jobs
 *   🔴 Breach Alerts         — open compliance breaches
 *   🟡 Incidents             — incident/evidence records
 *   🚨 Alarm Activations     — dispatch jobs of type alarm_response
 *   🚗 Vehicle of Interest   — vehicle_records flagged as VOI
 *   👤 Person of Interest    — person_records with last-seen location
 *   🟢 Live Officers         — officer positions from GPS, welfare status
 *   💛 Welfare Alerts        — pending/acknowledged officer welfare alerts
 *   🟣 Geofences / Zones     — zone boundaries (circles from location_lat/lng)
 *
 * Map tools:
 *   • Date range filter (NZ timezone)
 *   • Organisation filter (master role)
 *   • Click any marker to see details + action links
 *   • Auto-refresh toggle (30s interval)
 *   • Fullscreen toggle
 *
 * Built on react-leaflet + react-leaflet-cluster (existing dependencies).
 * No new npm packages required.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Heart,
  Layers,
  MapPin,
  Navigation,
  RefreshCw,
  Shield,
  Siren,
  Tent,
  User,
  Volume2,
  Wind,
  Leaf,
  Zap,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import {
  PRIMARY_MAP_TILE_ATTRIBUTION,
  PRIMARY_MAP_TILE_URL,
} from '@/lib/inhouseMapping'
import { LiveNavigationOverlay } from '@/components/features/LiveNavigationOverlay'
import 'leaflet/dist/leaflet.css'

// ─── NZ default centre (Nelson) ──────────────────────────────────────────────
const NZ_CENTRE: [number, number] = [-41.2706, 173.2840]
const DEFAULT_ZOOM = 12

// ─── Layer definitions ────────────────────────────────────────────────────────

interface LayerDef {
  id: string
  label: string
  icon: React.ElementType
  colour: string        // Leaflet/CSS colour string
  defaultOn: boolean
  description: string
}

const LAYERS: LayerDef[] = [
  { id: 'zones',         label: 'Geofences',          icon: MapPin,      colour: '#7c3aed', defaultOn: true,  description: 'Zone boundaries' },
  { id: 'officers',      label: 'Live Officers',       icon: Navigation,  colour: '#16a34a', defaultOn: true,  description: 'Officer GPS positions' },
  { id: 'welfare',       label: 'Welfare Alerts',      icon: Heart,       colour: '#ef4444', defaultOn: true,  description: 'Officer welfare alerts' },
  { id: 'camping',       label: 'Freedom Camping',     icon: Tent,        colour: '#2563eb', defaultOn: true,  description: 'Camping observation hotspots' },
  { id: 'breaches',      label: 'Breach Alerts',       icon: AlertTriangle, colour: '#dc2626', defaultOn: true, description: 'Open compliance breaches' },
  { id: 'noise',         label: 'Noise Control',       icon: Volume2,     colour: '#ea580c', defaultOn: true,  description: 'Noise jobs' },
  { id: 'biosecurity',   label: 'Biosecurity (CNG)',    icon: Leaf,        colour: '#059669', defaultOn: false, description: 'Biosecurity infestation sites' },
  { id: 'smoke',         label: 'Smoke Complaints',     icon: Wind,        colour: '#d97706', defaultOn: false, description: 'Smoke OOH complaint jobs' },
  { id: 'alarms',        label: 'Alarm Activations',   icon: Siren,       colour: '#b91c1c', defaultOn: true,  description: 'Alarm response jobs' },
  { id: 'incidents',     label: 'Incidents',           icon: Shield,      colour: '#4f46e5', defaultOn: false, description: 'Incident records' },
  { id: 'voi',           label: 'Vehicle of Interest', icon: Car,         colour: '#ca8a04', defaultOn: false, description: 'Flagged vehicles with last scan location' },
  { id: 'poi',           label: 'Person of Interest',  icon: User,        colour: '#db2777', defaultOn: false, description: 'Persons of interest with last known location' },
  { id: 'traffic',       label: 'Traffic Overlay',     icon: Zap,         colour: '#f59e0b', defaultOn: false, description: 'Road traffic conditions (in-house/HERE with fallback support)' },
]

// ─── HERE Maps / traffic tile configuration (B-34) ───────────────────────────
// When VITE_HERE_MAPS_API_KEY is set, the HERE traffic flow tile layer is used.
// Without it, the OSM-based Thunderforest Transport tile layer is used as a
// lightweight visual alternative (shows road classes with colour coding).
// The overlay TileLayer is rendered on top of the base OSM layer when the
// 'traffic' layer toggle is on.
const HERE_API_KEY = import.meta.env.VITE_HERE_MAPS_API_KEY as string | undefined

// HERE Maps traffic flow tile URL template
const HERE_TRAFFIC_URL = HERE_API_KEY
  ? `https://traffic.maps.ls.hereapi.com/maptile/2.1/traffictile/newest/normal.day/{z}/{x}/{y}/256/png8?apiKey=${HERE_API_KEY}`
  : PRIMARY_MAP_TILE_URL

const HERE_TRAFFIC_ATTRIBUTION = HERE_API_KEY
  ? '&copy; <a href="https://www.here.com">HERE Maps</a> traffic data'
  : PRIMARY_MAP_TILE_ATTRIBUTION

// ─── Helpers ──────────────────────────────────────────────────────────────────
// haversineKm imported from @/lib/geo

function timeSince(ts: string | null): string {
  if (!ts) return '—'
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function priorityColour(priority: string): string {
  if (priority === 'urgent') return '#dc2626'
  if (priority === 'high')   return '#ea580c'
  if (priority === 'normal') return '#2563eb'
  return '#6b7280'
}

// ─── Map auto-fit component ───────────────────────────────────────────────────

function AutoFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], DEFAULT_ZOOM, { animate: true })
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14, animate: true })
  }, [map, points]) // re-fit whenever points or map instance changes
  return null
}

// ─── Circular zone overlay ───────────────────────────────────────────────────

function ZoneCircle({ zone }: { zone: any }) {
  if (!zone.location_lat || !zone.location_lng) return null
  return (
    <CircleMarker
      center={[zone.location_lat, zone.location_lng]}
      radius={18}
      pathOptions={{ color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.12, weight: 2, dashArray: '6 4' }}
    >
      <Popup>
        <div className="text-sm space-y-1 min-w-[160px]">
          <p className="font-semibold flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-purple-600 inline-block" />
            {zone.name}
          </p>
          {zone.zone_type && <p className="text-xs text-gray-500 capitalize">{zone.zone_type.replace(/_/g, ' ')}</p>}
          {zone.nights_per_month && <p className="text-xs text-gray-500">Max {zone.nights_per_month} nights/month</p>}
        </div>
      </Popup>
    </CircleMarker>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OperationsMap() {
  const { user } = useAuthStore()
  const { organizationId: filterOrg, dateFrom, dateTo } = useGlobalFiltersStore()
  const effectiveOrgId = (user?.role === 'master' || user?.role === 'grand_master') ? filterOrg || null : user?.organization_id || null

  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYERS.map(l => [l.id, l.defaultOn]))
  )
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [tick, setTick] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [historyMode, setHistoryMode] = useState(false)
  const [emergencyPulse, setEmergencyPulse] = useState(false)
  const [dismissedNavigationKey, setDismissedNavigationKey] = useState<string | null>(null)

  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate   = dateTo   ? nzDateToUTCEnd(dateTo)   : null

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [autoRefresh])

  const toggle = useCallback((id: string) => {
    setVisibleLayers(v => ({ ...v, [id]: !v[id] }))
  }, [])

  // ── Data queries ─────────────────────────────────────────────────────────────

  // Zones / geofences
  const { data: zones = [] } = useQuery({
    queryKey: ['ops-map-zones', effectiveOrgId, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('zones')
        .select('id, name, zone_type, location_lat, location_lng, nights_per_month, geometry')
        .eq('is_active', true)
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      const { data } = await q.limit(200)
      return (data ?? []).filter((z: any) => z.location_lat && z.location_lng)
    },
    enabled: visibleLayers.zones,
    staleTime: 60_000,
  })

  // Live officers
  const { data: officers = [] } = useQuery({
    queryKey: ['ops-map-officers', effectiveOrgId, tick],
    queryFn: async () => {
      const applyOfficerScope = (baseQuery: any) => {
        let scoped = baseQuery
          .in('role', ['officer', 'admin_officer'])
          .eq('is_active', true)

        if (effectiveOrgId) scoped = scoped.eq('organization_id', effectiveOrgId)
        return scoped
      }

      let { data: profileData } = await applyOfficerScope(
        (supabase as any)
          .from('user_profiles')
          .select('id, first_name, last_name, role, last_gps_latitude, last_gps_longitude, last_gps_update, welfare_status, recent_scans, last_scan_zone'),
      ).order('first_name', { ascending: true })

      if (!profileData) {
        const fallback = await applyOfficerScope(
          (supabase as any)
            .from('user_profiles')
            .select('id, first_name, last_name, role, last_gps_latitude, last_gps_longitude, last_gps_update, welfare_status'),
        ).order('first_name', { ascending: true })

        profileData = (fallback.data || []).map((row: any) => ({
          ...row,
          recent_scans: 0,
          last_scan_zone: null,
        }))
      }

      // Phase 4 spec calls out user_locations as the tactical map source. Where
      // present, merge those coordinates as a higher-priority location feed.
      let locationRows: any[] = []
      const ids = (profileData ?? []).map((p: any) => p.id).filter(Boolean)
      if (ids.length > 0) {
        const locationsQ = (supabase as any)
          .from('user_locations')
          .select('user_id, latitude, longitude, recorded_at')
          .in('user_id', ids)

        const { data: locationData } = await locationsQ
        locationRows = locationData ?? []
      }

      const latestByUser = new Map<string, any>()
      for (const row of locationRows) {
        const current = latestByUser.get(row.user_id)
        if (!current || new Date(row.recorded_at).getTime() > new Date(current.recorded_at).getTime()) {
          latestByUser.set(row.user_id, row)
        }
      }

      return (profileData ?? [])
        .map((o: any) => {
          const loc = latestByUser.get(o.id)
          return {
            ...o,
            last_gps_latitude: loc?.latitude ?? o.last_gps_latitude,
            last_gps_longitude: loc?.longitude ?? o.last_gps_longitude,
            last_gps_update: loc?.recorded_at ?? o.last_gps_update,
          }
        })
        .filter((o: any) => o.last_gps_latitude && o.last_gps_longitude)
    },
    enabled: visibleLayers.officers || visibleLayers.welfare,
    refetchInterval: autoRefresh ? 30_000 : false,
  })

  // Welfare alerts
  const { data: welfareAlerts = [], refetch: refetchWelfareAlerts } = useQuery({
    queryKey: ['ops-map-welfare', effectiveOrgId, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('officer_welfare_alerts')
        .select('id, officer_name, officer_phone, alert_type, status, gps_latitude, gps_longitude, alert_sent_at, escalation_level')
        .in('status', ['pending', 'acknowledged'])
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      const { data } = await q.order('alert_sent_at', { ascending: false }).limit(50)
      return (data ?? []).filter((w: any) => w.gps_latitude && w.gps_longitude)
    },
    enabled: true,
    refetchInterval: autoRefresh ? 30_000 : false,
  })

  useEffect(() => {
    // Route-change query cancellation can abort the first map fetch; refetch after mount
    // so emergency escalation state is populated deterministically.
    void refetchWelfareAlerts()
  }, [refetchWelfareAlerts, effectiveOrgId, tick])

  const activeEmergencyAlert = useMemo(() => {
    return welfareAlerts.find((w: any) => {
      const type = String(w.alert_type || '').toLowerCase()
      return type.includes('sos') || type.includes('armed') || type.includes('danger') || type.includes('panic')
    }) || null
  }, [welfareAlerts])

  useEffect(() => {
    if (!activeEmergencyAlert) {
      setEmergencyPulse(false)
      return
    }
    setEmergencyPulse(true)
    const timer = setInterval(() => setEmergencyPulse(v => !v), 700)
    return () => clearInterval(timer)
  }, [activeEmergencyAlert])

  // Freedom camping observations (zone-level aggregated hotspots)
  const { data: campingHotspots = [] } = useQuery({
    queryKey: ['ops-map-camping', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select('zone_id, gps_latitude, gps_longitude, is_compliant, zones(name, location_lat, location_lng)')
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate)   q = q.lte('recorded_at', endDate)
      const { data } = await q.limit(5000)
      // Aggregate by zone
      const byZone: Record<string, any> = {}
      for (const obs of data ?? []) {
        if (!obs.zone_id) continue
        if (!byZone[obs.zone_id]) {
          const zone = obs.zones as any
          byZone[obs.zone_id] = {
            zone_id: obs.zone_id,
            zone_name: zone?.name ?? 'Unknown',
            total: 0, breaches: 0,
            lat: zone?.location_lat ?? obs.gps_latitude,
            lng: zone?.location_lng ?? obs.gps_longitude,
          }
        }
        byZone[obs.zone_id].total++
        if (!obs.is_compliant) byZone[obs.zone_id].breaches++
      }
      return Object.values(byZone).filter((z: any) => z.lat && z.lng)
    },
    enabled: visibleLayers.camping,
    staleTime: 60_000,
  })

  // Breach alerts
  const { data: breachAlerts = [] } = useQuery({
    queryKey: ['ops-map-breaches', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('breach_alerts')
        .select('id, breach_type, status, created_at, plate_number, zone:zones(name, location_lat, location_lng)')
        .in('status', historyMode ? ['resolved', 'dismissed'] : ['pending', 'acknowledged', 'enforcement_started'])
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)
      const { data } = await q.order('created_at', { ascending: false }).limit(200)
      return (data ?? [])
        .map((b: any) => ({
          ...b,
          gps_latitude: b.zone?.location_lat ?? null,
          gps_longitude: b.zone?.location_lng ?? null,
        }))
        .filter((b: any) => b.gps_latitude && b.gps_longitude)
    },
    enabled: visibleLayers.breaches,
    staleTime: 30_000,
  })

  // Noise control jobs
  const { data: noiseJobs = [] } = useQuery({
    queryKey: ['ops-map-noise', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('noise_jobs')
        .select('id, job_number, title, address, priority, status, gps_lat, gps_lng, noise_type, created_at, assigned_to')
        .in('status', historyMode ? ['completed', 'cancelled'] : ['pending', 'assigned', 'en_route', 'on_scene'])
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)
      const { data } = await q.order('created_at', { ascending: false }).limit(100)
      return (data ?? []).filter((n: any) => n.gps_lat && n.gps_lng)
    },
    enabled: visibleLayers.noise,
    staleTime: 30_000,
  })

  // Biosecurity infestation jobs
  const { data: biosecurityJobs = [] } = useQuery({
    queryKey: ['ops-map-biosecurity', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('biosecurity_jobs')
        .select('id, job_number, title, address, priority, status, gps_lat, gps_lng, inspection_type, created_at, assigned_to')
        .in('status', historyMode ? ['completed', 'cancelled', 'referred'] : ['pending', 'assigned', 'en_route', 'on_scene'])
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)
      const { data } = await q.order('created_at', { ascending: false }).limit(100)
      return (data ?? []).filter((n: any) => n.gps_lat && n.gps_lng)
    },
    enabled: visibleLayers.biosecurity,
    staleTime: 30_000,
  })

  // Smoke complaint OOH jobs
  const { data: smokeJobs = [] } = useQuery({
    queryKey: ['ops-map-smoke', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('smoke_jobs')
        .select('id, job_number, title, address, priority, status, gps_lat, gps_lng, is_out_of_hours, complaint_time, created_at, assigned_to')
        .in('status', historyMode ? ['completed', 'cancelled'] : ['pending', 'assigned', 'en_route', 'on_scene'])
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)
      const { data } = await q.order('created_at', { ascending: false }).limit(100)
      return (data ?? []).filter((n: any) => n.gps_lat && n.gps_lng)
    },
    enabled: visibleLayers.smoke,
    staleTime: 30_000,
  })

  // Alarm activations (dispatch_jobs of type alarm_response)
  const { data: alarmJobs = [] } = useQuery({
    queryKey: ['ops-map-alarms', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('dispatch_jobs')
        .select('id, job_number, title, address, priority, status, gps_lat, gps_lng, job_type, created_at, assigned_officer:user_profiles!assigned_to(first_name, last_name)')
        .in('job_type', ['alarm_response', 'first_line_one_guard', 'first_line_two_guard', 'second_line_response'])
        .in('status', historyMode ? ['completed', 'cancelled'] : ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene'])
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)
      const { data } = await q.order('created_at', { ascending: false }).limit(100)
      return (data ?? []).filter((j: any) => j.gps_lat && j.gps_lng)
    },
    enabled: visibleLayers.alarms,
    staleTime: 30_000,
  })

  const navigationDestination = useMemo(() => {
    if (activeEmergencyAlert?.gps_latitude && activeEmergencyAlert?.gps_longitude) {
      return {
        key: `welfare:${activeEmergencyAlert.id}`,
        destination: {
          lat: Number(activeEmergencyAlert.gps_latitude),
          lng: Number(activeEmergencyAlert.gps_longitude),
          label: `Emergency welfare alert · ${activeEmergencyAlert.officer_name ?? 'Officer'}`,
        },
      }
    }

    const liveAlarm = alarmJobs.find((alarm: any) => alarm.gps_lat && alarm.gps_lng)
    if (liveAlarm) {
      return {
        key: `alarm:${liveAlarm.id}`,
        destination: {
          lat: Number(liveAlarm.gps_lat),
          lng: Number(liveAlarm.gps_lng),
          label: `Alarm response · ${liveAlarm.job_number ?? 'Active alarm'}`,
        },
      }
    }

    return null
  }, [activeEmergencyAlert, alarmJobs])

  useEffect(() => {
    if (!navigationDestination) {
      setDismissedNavigationKey(null)
      return
    }

    if (dismissedNavigationKey && dismissedNavigationKey !== navigationDestination.key) {
      setDismissedNavigationKey(null)
    }
  }, [dismissedNavigationKey, navigationDestination])

  // Incidents
  const { data: incidents = [] } = useQuery({
    queryKey: ['ops-map-incidents', effectiveOrgId, startDate, endDate, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('incidents')
        .select('id, status, plate_number, location_lat, location_lng, location_address, created_at')
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)
      const { data } = await q.order('created_at', { ascending: false }).limit(200)
      return (data ?? []).filter((i: any) => i.location_lat && i.location_lng)
    },
    enabled: visibleLayers.incidents,
    staleTime: 60_000,
  })

  // Vehicle of interest — last scan location
  const { data: voiVehicles = [] } = useQuery({
    queryKey: ['ops-map-voi', effectiveOrgId, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('vehicle_records')
        .select('id, plate_number, make, model, colour, risk_level, gps_latitude, gps_longitude, last_seen_at')
        .eq('is_of_interest', true)
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      const { data } = await q.limit(100)
      return (data ?? []).filter((v: any) => v.gps_latitude && v.gps_longitude)
    },
    enabled: visibleLayers.voi,
    staleTime: 60_000,
  })

  // Person of interest — last known location (via latest observation linked to person)
  const { data: poiPersons = [] } = useQuery({
    queryKey: ['ops-map-poi', effectiveOrgId, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('person_records')
        .select('id, full_name, risk_level, last_seen_at, last_seen_location, last_seen_lat, last_seen_lng')
        .eq('is_of_interest', true)
      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      const { data } = await q.limit(100)
      return (data ?? []).filter((p: any) => p.last_seen_lat && p.last_seen_lng)
    },
    enabled: visibleLayers.poi,
    staleTime: 60_000,
  })

  // ── All points for auto-fit ─────────────────────────────────────────────────
  const allPoints = useMemo((): [number, number][] => {
    const pts: [number, number][] = []
    if (visibleLayers.zones)    zones.forEach((z: any)      => pts.push([z.location_lat, z.location_lng]))
    if (visibleLayers.officers) officers.forEach((o: any)   => pts.push([o.last_gps_latitude, o.last_gps_longitude]))
    if (visibleLayers.camping)  campingHotspots.forEach((c: any) => pts.push([c.lat, c.lng]))
    if (visibleLayers.breaches) breachAlerts.forEach((b: any) => pts.push([b.gps_latitude, b.gps_longitude]))
    if (visibleLayers.noise)        noiseJobs.forEach((n: any)        => pts.push([n.gps_lat, n.gps_lng]))
    if (visibleLayers.biosecurity)  biosecurityJobs.forEach((b: any)  => pts.push([b.gps_lat, b.gps_lng]))
    if (visibleLayers.smoke)        smokeJobs.forEach((s: any)        => pts.push([s.gps_lat, s.gps_lng]))
    if (visibleLayers.alarms)       alarmJobs.forEach((a: any)        => pts.push([a.gps_lat, a.gps_lng]))
    return pts.filter(([lat, lng]) => lat && lng && isFinite(lat) && isFinite(lng))
  }, [zones, officers, campingHotspots, breachAlerts, noiseJobs, biosecurityJobs, smokeJobs, alarmJobs, visibleLayers])

  // ── Total counts for legend ─────────────────────────────────────────────────
  const layerCounts: Record<string, number> = {
    zones:       zones.length,
    officers:    officers.length,
    welfare:     welfareAlerts.length,
    camping:     campingHotspots.length,
    breaches:    breachAlerts.length,
    noise:       noiseJobs.length,
    biosecurity: biosecurityJobs.length,
    smoke:       smokeJobs.length,
    alarms:      alarmJobs.length,
    incidents:   incidents.length,
    voi:         voiVehicles.length,
    poi:         poiPersons.length,
  }

  return (
    <AppLayout title="Operations Map" description="Live layered situational awareness">
      <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Operations Map
            </span>
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {/* History mode toggle */}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">History</Label>
              <Switch
                checked={historyMode}
                onCheckedChange={setHistoryMode}
              />
            </div>
            {/* Auto-refresh */}
            <div className="flex items-center gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? 'text-green-500 animate-spin' : 'text-gray-400'}`} />
              <Label className="text-xs">Auto</Label>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setTick(n => n + 1)}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Main area ─────────────────────────────────────────────────────── */}
        <div className="flex flex-1 gap-2 min-h-0">

          {/* Sidebar */}
          <div className={`transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-8'} shrink-0 flex flex-col gap-0`}>
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="flex items-center justify-between w-full rounded-t-lg bg-gray-100 dark:bg-[#1E1E1E] px-2 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors"
            >
              {sidebarOpen ? (
                <>
                  <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Layers</span>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </>
              ) : (
                <ChevronRight className="h-3.5 w-3.5 mx-auto" />
              )}
            </button>

            {sidebarOpen && (
              <div className="flex-1 overflow-y-auto rounded-b-lg bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#9E9E9E]/20 divide-y divide-gray-100 dark:divide-gray-800">
                {LAYERS.map(layer => {
                  const Icon = layer.icon
                  const count = layerCounts[layer.id] ?? 0
                  const on = visibleLayers[layer.id]
                  return (
                    <button
                      key={layer.id}
                      onClick={() => toggle(layer.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#2A2A2A]/50 ${
                        !on ? 'opacity-40' : ''
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: layer.colour }}
                      />
                      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                      <span className="text-xs font-medium flex-1 truncate text-gray-700 dark:text-gray-300">
                        {layer.label}
                      </span>
                      {count > 0 && (
                        <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none"
                          style={{ backgroundColor: layer.colour + '22', color: layer.colour }}>
                          {count}
                        </span>
                      )}
                      {on ? <Eye className="h-3 w-3 text-gray-400 shrink-0" /> : <EyeOff className="h-3 w-3 text-gray-300 shrink-0" />}
                    </button>
                  )
                })}

                {/* B-34: Traffic overlay notice when active without HERE key */}
                {visibleLayers.traffic && !HERE_API_KEY && (
                  <div className="px-2.5 py-2 bg-amber-50 dark:bg-amber-950/20">
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Set <span className="font-mono">VITE_HERE_MAPS_API_KEY</span> to enable live traffic data.
                    </p>
                  </div>
                )}

                {/* Welfare alert summary */}
                {welfareAlerts.length > 0 && visibleLayers.welfare && (
                  <div className="px-2.5 py-2 bg-red-50 dark:bg-red-950/20">
                    <p className="text-[11px] font-semibold text-red-700 dark:text-red-400 flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {welfareAlerts.length} welfare alert{welfareAlerts.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Map */}
          <div className={`relative flex-1 rounded-xl overflow-hidden border shadow-sm min-h-0 ${
            activeEmergencyAlert
              ? emergencyPulse
                ? 'border-red-600'
                : 'border-red-300'
              : 'border-gray-200 dark:border-[#9E9E9E]/20'
          }`}>
            <MapContainer
              center={NZ_CENTRE}
              zoom={DEFAULT_ZOOM}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
            >
              <TileLayer
                url={PRIMARY_MAP_TILE_URL}
                attribution={PRIMARY_MAP_TILE_ATTRIBUTION}
              />

              {/* B-34: Traffic overlay TileLayer (HERE Maps when API key present) */}
              {visibleLayers.traffic && (
                <TileLayer
                  url={HERE_TRAFFIC_URL}
                  attribution={HERE_TRAFFIC_ATTRIBUTION}
                  opacity={HERE_API_KEY ? 0.7 : 0.0}
                  zIndex={10}
                />
              )}

              {/* Auto-fit when data arrives */}
              {allPoints.length > 0 && <AutoFitBounds points={allPoints} />}

              {/* ── Zones / Geofences ─────────────────────────────────────── */}
              {visibleLayers.zones && zones.map((zone: any) => (
                <ZoneCircle key={zone.id} zone={zone} />
              ))}

              {/* ── Live Officers ─────────────────────────────────────────── */}
              {visibleLayers.officers && officers.map((o: any) => (
                <CircleMarker
                  key={o.user_id}
                  center={[o.last_gps_latitude, o.last_gps_longitude]}
                  radius={10}
                  pathOptions={{
                    color: o.welfare_status === 'alert' ? '#ef4444' : '#16a34a',
                    fillColor: o.welfare_status === 'alert' ? '#ef4444' : '#16a34a',
                    fillOpacity: 0.85,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold">{o.first_name} {o.last_name}</p>
                      <p className="text-xs text-gray-500 capitalize">{o.role?.replace(/_/g, ' ')}</p>
                      <p className="text-xs">{o.last_scan_zone ?? '—'}</p>
                      <p className="text-xs text-gray-500">GPS updated {timeSince(o.last_gps_update)}</p>
                      {o.recent_scans > 0 && (
                        <p className="text-xs">Scans today: <strong>{o.recent_scans}</strong></p>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Welfare Alerts ────────────────────────────────────────── */}
              {visibleLayers.welfare && welfareAlerts.map((w: any) => (
                <CircleMarker
                  key={w.id}
                  center={[w.gps_latitude, w.gps_longitude]}
                  radius={14}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 3 }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold text-red-700">⚠ Welfare Alert</p>
                      <p className="font-medium">{w.officer_name}</p>
                      {w.officer_phone && <p className="text-xs">{w.officer_phone}</p>}
                      <p className="text-xs capitalize">{w.alert_type?.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-gray-500">{timeSince(w.alert_sent_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Freedom Camping Hotspots ───────────────────────────────── */}
              {visibleLayers.camping && campingHotspots.map((c: any) => {
                const breachRate = c.total > 0 ? c.breaches / c.total : 0
                const radius = Math.min(28, Math.max(8, Math.sqrt(c.total) * 2.5))
                const fillColour = breachRate > 0.3 ? '#dc2626' : breachRate > 0.1 ? '#ea580c' : '#2563eb'
                return (
                  <CircleMarker
                    key={c.zone_id}
                    center={[c.lat, c.lng]}
                    radius={radius}
                    pathOptions={{ color: fillColour, fillColor: fillColour, fillOpacity: 0.45, weight: 1.5 }}
                  >
                    <Popup>
                      <div className="text-sm space-y-1 min-w-[180px]">
                        <p className="font-semibold flex items-center gap-1">
                          <span>🏕</span> {c.zone_name}
                        </p>
                        <p className="text-xs">Observations: <strong>{c.total}</strong></p>
                        <p className="text-xs">Breaches: <strong className="text-red-600">{c.breaches}</strong></p>
                        <p className="text-xs">Breach rate: {(breachRate * 100).toFixed(0)}%</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                )
              })}

              {/* ── Breach Alerts ─────────────────────────────────────────── */}
              {visibleLayers.breaches && (
                <>
                  {breachAlerts.map((b: any) => (
                    <CircleMarker
                      key={b.id}
                      center={[b.gps_latitude, b.gps_longitude]}
                      radius={9}
                      pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.8, weight: 2 }}
                    >
                      <Popup>
                        <div className="text-sm space-y-1 min-w-[180px]">
                          <p className="font-semibold text-red-700">Breach Alert</p>
                          {b.plate_number && <p className="text-xs font-mono">{b.plate_number}</p>}
                          <p className="text-xs capitalize">{b.breach_type?.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-gray-500">{timeSince(b.created_at)}</p>
                          {b.zone?.name && <p className="text-xs">{b.zone.name}</p>}
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </>
              )}

              {/* ── Noise Control Jobs ────────────────────────────────────── */}
              {visibleLayers.noise && noiseJobs.map((n: any) => (
                <CircleMarker
                  key={n.id}
                  center={[n.gps_lat, n.gps_lng]}
                  radius={9}
                  pathOptions={{
                    color: priorityColour(n.priority),
                    fillColor: priorityColour(n.priority),
                    fillOpacity: 0.8,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold">🔊 {n.job_number}</p>
                      <p className="text-xs font-medium">{n.title}</p>
                      {n.address && <p className="text-xs text-gray-500">{n.address}</p>}
                      <p className="text-xs capitalize">{n.noise_type?.replace(/_/g, ' ')}</p>
                      <p className="text-xs">{timeSince(n.created_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Biosecurity Infestation Sites ────────────────────────── */}
              {visibleLayers.biosecurity && biosecurityJobs.map((b: any) => (
                <CircleMarker
                  key={b.id}
                  center={[b.gps_lat, b.gps_lng]}
                  radius={9}
                  pathOptions={{
                    color: priorityColour(b.priority),
                    fillColor: '#059669',
                    fillOpacity: 0.82,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold">🌿 {b.job_number}</p>
                      <p className="text-xs font-medium">{b.title}</p>
                      {b.address && <p className="text-xs text-gray-500">{b.address}</p>}
                      <p className="text-xs capitalize">{b.inspection_type?.replace(/_/g, ' ')}</p>
                      <p className="text-xs">{timeSince(b.created_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Smoke Complaint OOH Jobs ──────────────────────────────── */}
              {visibleLayers.smoke && smokeJobs.map((s: any) => (
                <CircleMarker
                  key={s.id}
                  center={[s.gps_lat, s.gps_lng]}
                  radius={9}
                  pathOptions={{
                    color: s.is_out_of_hours ? '#b45309' : '#d97706',
                    fillColor: '#d97706',
                    fillOpacity: 0.82,
                    weight: s.is_out_of_hours ? 3 : 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold">💨 {s.job_number}</p>
                      <p className="text-xs font-medium">{s.title}</p>
                      {s.address && <p className="text-xs text-gray-500">{s.address}</p>}
                      {s.is_out_of_hours && <p className="text-xs font-semibold text-amber-700">⚠ Out of Hours</p>}
                      <p className="text-xs">{timeSince(s.created_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Alarm Activations ─────────────────────────────────────── */}
              {visibleLayers.alarms && alarmJobs.map((a: any) => (
                <CircleMarker
                  key={a.id}
                  center={[a.gps_lat, a.gps_lng]}
                  radius={11}
                  pathOptions={{ color: '#b91c1c', fillColor: '#b91c1c', fillOpacity: 0.85, weight: 2.5 }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[200px]">
                      <p className="font-semibold text-red-800">🚨 {a.job_number}</p>
                      <p className="text-xs font-medium">{a.title}</p>
                      {a.address && <p className="text-xs text-gray-500">{a.address}</p>}
                      {a.alarm_type && <p className="text-xs capitalize">{a.alarm_type.replace(/_/g, ' ')}</p>}
                      {a.assigned_officer && (
                        <p className="text-xs text-green-700">
                          → {a.assigned_officer.first_name} {a.assigned_officer.last_name}
                        </p>
                      )}
                      <p className="text-xs text-gray-500">{timeSince(a.created_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Incidents ─────────────────────────────────────────────── */}
              {visibleLayers.incidents && incidents.map((i: any) => (
                <CircleMarker
                  key={i.id}
                  center={[i.location_lat, i.location_lng]}
                  radius={8}
                  pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.75, weight: 2 }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold text-indigo-700">Incident</p>
                      {i.plate_number && <p className="text-xs font-mono">{i.plate_number}</p>}
                      {i.location_address && <p className="text-xs text-gray-500">{i.location_address}</p>}
                      <p className="text-xs text-gray-500">{timeSince(i.created_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Vehicle of Interest ───────────────────────────────────── */}
              {visibleLayers.voi && voiVehicles.map((v: any) => (
                <CircleMarker
                  key={v.id}
                  center={[v.gps_latitude, v.gps_longitude]}
                  radius={9}
                  pathOptions={{ color: '#ca8a04', fillColor: '#ca8a04', fillOpacity: 0.8, weight: 2 }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold text-amber-700">🚗 {v.plate_number}</p>
                      {(v.make || v.model) && <p className="text-xs">{[v.colour, v.make, v.model].filter(Boolean).join(' ')}</p>}
                      {v.risk_level && <p className="text-xs capitalize">Risk: {v.risk_level}</p>}
                      <p className="text-xs text-gray-500">Last seen {timeSince(v.last_seen_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* ── Person of Interest ────────────────────────────────────── */}
              {visibleLayers.poi && poiPersons.map((p: any) => (
                <CircleMarker
                  key={p.id}
                  center={[p.last_seen_lat, p.last_seen_lng]}
                  radius={9}
                  pathOptions={{ color: '#db2777', fillColor: '#db2777', fillOpacity: 0.8, weight: 2 }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[180px]">
                      <p className="font-semibold text-pink-700">👤 {p.full_name}</p>
                      {p.risk_level && <p className="text-xs capitalize">Risk: {p.risk_level}</p>}
                      {p.last_seen_location && <p className="text-xs text-gray-500">{p.last_seen_location}</p>}
                      <p className="text-xs text-gray-500">Last seen {timeSince(p.last_seen_at)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

            </MapContainer>
            {activeEmergencyAlert && (
              <div className={`pointer-events-none absolute z-[1000] left-4 top-20 rounded-md px-3 py-2 text-xs font-semibold shadow ${
                emergencyPulse ? 'bg-red-700 text-white' : 'bg-red-100 text-red-800'
              }`}>
                Emergency channel broadcast active: {activeEmergencyAlert.officer_name || 'Officer'} GPS {' '}
                ({Number(activeEmergencyAlert.gps_latitude).toFixed(5)}, {Number(activeEmergencyAlert.gps_longitude).toFixed(5)})
              </div>
            )}
            {navigationDestination && dismissedNavigationKey !== navigationDestination.key && (
              <LiveNavigationOverlay
                destination={navigationDestination.destination}
                onDismiss={() => setDismissedNavigationKey(navigationDestination.key)}
              />
            )}
          </div>
        </div>

        {/* ── Status bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
          {visibleLayers.officers && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {officers.length} officer{officers.length !== 1 ? 's' : ''} tracked
            </span>
          )}
          {visibleLayers.welfare && welfareAlerts.length > 0 && (
            <span className="flex items-center gap-1 text-red-600 font-semibold animate-pulse">
              <Heart className="h-3 w-3" />
              {welfareAlerts.length} welfare alert{welfareAlerts.length !== 1 ? 's' : ''}!
            </span>
          )}
          {visibleLayers.alarms && alarmJobs.length > 0 && (
            <span className="flex items-center gap-1 text-red-700 font-semibold">
              <Siren className="h-3 w-3" />
              {alarmJobs.length} alarm{alarmJobs.length !== 1 ? 's' : ''} active
            </span>
          )}
          {visibleLayers.breaches && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              {breachAlerts.length} breach{breachAlerts.length !== 1 ? 'es' : ''}
            </span>
          )}
          {autoRefresh && (
            <span className="ml-auto flex items-center gap-1 text-green-600">
              <RefreshCw className="h-3 w-3" />
              Live · auto-refresh 30s
            </span>
          )}
          {historyMode && (
            <Badge variant="outline" className="text-[10px] ml-1">History Mode</Badge>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
