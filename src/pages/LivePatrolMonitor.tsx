import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  MapPin, 
  User, 
  Clock, 
  Navigation,
  Activity,
  CheckCircle,
  AlertCircle,
  Calendar,
  Car,
  Shield,
  Radio,
  Eye,
  TrendingUp,
  Wifi,
  WifiOff,
  AlertTriangle,
  Users,
} from 'lucide-react'
import { formatDateTime, formatDate } from '@/lib/utils'
import { toast } from 'sonner'

interface ActivePatrol {
  id: string
  status: string
  patrol_date: string
  shift: string
  created_at: string
  updated_at: string
  notes: string | null
  zone: {
    id: string
    name: string
  }
  officer: {
    id: string
    first_name: string
    last_name: string
    phone: string | null
  }
  patrol_route: {
    route_name: string
  } | null
  _vehicles_checked: number
  _duration_minutes: number
  _last_gps_update: string | null
  _last_gps_lat: number | null
  _last_gps_lng: number | null
}

interface PatrolStats {
  total_active: number
  total_officers: number
  total_vehicles_checked: number
  average_duration_minutes: number
  zones_covered: number
  last_check_in: string | null
}

interface OfficerActivity {
  user_id: string
  gps_latitude: number
  gps_longitude: number
  gps_accuracy: number
  recorded_at: string
  activity_type: string
}

/** An officer who has recent GPS activity — shown even without a formal patrol record. */
interface ActiveOfficer {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  organization_id: string | null
  last_gps_latitude: number | null
  last_gps_longitude: number | null
  last_gps_accuracy: number | null
  last_gps_update: string | null
  _vehicles_scanned_today: number
  _welfare_status: 'ok' | 'warning' | 'alert'
}

export default function LivePatrolMonitor() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const [selectedPatrol, setSelectedPatrol] = useState<string | null>(null)

  // ── Supabase Realtime: instant invalidation when patrol rows change ─────────
  useEffect(() => {
    const channel = supabase
      .channel('live-patrol-monitor')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patrols' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['live-patrols'] })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'officer_welfare_alerts' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['active-officers-welfare'] })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  // Fetch active patrols with enriched data
  const { data: patrols, isLoading: patrolsLoading, error: patrolsError } = useQuery({
    queryKey: ['live-patrols', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      
      // Try the FK join first; fall back to a simpler query if the FK doesn't exist
      let patrolsData: any[] | null = null
      let queryError: any = null

      // Attempt 1: Full join with FK reference
      {
        let query = (supabase.from('patrols') as any)
          .select(`
            id,
            status,
            patrol_date,
            shift,
            notes,
            organization_id,
            assigned_to,
            created_at,
            updated_at,
            zone:zones(id, name),
            officer:user_profiles!patrols_assigned_to_fkey(id, first_name, last_name, phone),
            patrol_route:patrol_routes!patrol_route_id(route_name)
          `)
          // Show in_progress and scheduled patrols; also include today's completed ones
          .in('status', ['in_progress', 'scheduled', 'completed'])
          .order('created_at', { ascending: false })

        // Organization scoping
        if (user?.role !== 'master' && user?.organization_id) {
          query = query.eq('organization_id', user.organization_id)
        } else if (organizationId) {
          query = query.eq('organization_id', organizationId)
        }

        if (zoneId) {
          query = query.eq('zone_id', zoneId)
        }

        // Date filter — default to today if no dates are set
        if (dateFrom) {
          query = query.gte('patrol_date', dateFrom)
        } else {
          query = query.gte('patrol_date', today)
        }
        if (dateTo) {
          query = query.lte('patrol_date', dateTo)
        } else {
          query = query.lte('patrol_date', today)
        }

        const result = await query
        if (!result.error) {
          patrolsData = result.data
        } else {
          queryError = result.error
        }
      }

      // Attempt 2: Fallback without FK join if the FK reference fails
      if (queryError) {
        let query = (supabase.from('patrols') as any)
          .select(`
            id,
            status,
            patrol_date,
            shift,
            notes,
            organization_id,
            assigned_to,
            created_at,
            updated_at,
            zone_id
          `)
          .in('status', ['in_progress', 'scheduled', 'completed'])
          .order('created_at', { ascending: false })

        if (user?.role !== 'master' && user?.organization_id) {
          query = query.eq('organization_id', user.organization_id)
        } else if (organizationId) {
          query = query.eq('organization_id', organizationId)
        }

        if (zoneId) {
          query = query.eq('zone_id', zoneId)
        }

        if (dateFrom) {
          query = query.gte('patrol_date', dateFrom)
        } else {
          query = query.gte('patrol_date', today)
        }
        if (dateTo) {
          query = query.lte('patrol_date', dateTo)
        } else {
          query = query.lte('patrol_date', today)
        }

        const result = await query
        if (result.error) throw result.error
        patrolsData = result.data

        // Manually enrich with zone name and officer info using bulk queries
        const zoneIds = [...new Set((patrolsData ?? []).filter((p: any) => p.zone_id && !p.zone).map((p: any) => p.zone_id))]
        const officerIds = [...new Set((patrolsData ?? []).filter((p: any) => p.assigned_to && !p.officer).map((p: any) => p.assigned_to))]

        let zoneMap: Record<string, any> = {}
        let officerMap: Record<string, any> = {}

        if (zoneIds.length > 0) {
          const { data: zones } = await (supabase.from('zones') as any).select('id, name').in('id', zoneIds)
          zoneMap = Object.fromEntries((zones ?? []).map((z: any) => [z.id, z]))
        }
        if (officerIds.length > 0) {
          const { data: officers } = await (supabase.from('user_profiles') as any)
            .select('id, first_name, last_name, phone')
            .in('id', officerIds)
          officerMap = Object.fromEntries((officers ?? []).map((o: any) => [o.id, o]))
        }

        for (const patrol of patrolsData ?? []) {
          if (patrol.zone_id && !patrol.zone) {
            patrol.zone = zoneMap[patrol.zone_id] || { id: patrol.zone_id, name: 'Unknown Zone' }
          }
          if (patrol.assigned_to && !patrol.officer) {
            patrol.officer = officerMap[patrol.assigned_to] || { id: patrol.assigned_to, first_name: 'Unknown', last_name: 'Officer', phone: null }
          }
        }
      }

      if (!patrolsData || patrolsData.length === 0) return []

      // Filter out patrols with missing officer data (malformed joins)
      const validPatrols = (patrolsData ?? []).filter((p: any) => p.officer?.id)

      // Enrich with vehicle counts and GPS data
      const enrichedPatrols = await Promise.all(
        validPatrols.map(async (patrol: any) => {
          // Get vehicles checked count from observations
          const { count: vehiclesChecked } = await (supabase.from('observations') as any)
            .select('*', { count: 'exact', head: true })
            .eq('recorded_by', patrol.officer.id)
            .gte('recorded_at', patrol.created_at || today)

          // Get latest GPS position from activity log
          const { data: latestActivity } = await (supabase.from('officer_activity_log') as any)
            .select('gps_latitude, gps_longitude, recorded_at')
            .eq('user_id', patrol.officer.id)
            .gte('recorded_at', patrol.created_at || today)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single()

          // Calculate duration
          const startTime = patrol.status === 'in_progress' ? new Date(patrol.updated_at || patrol.created_at) : new Date()
          const now = new Date()
          const durationMs = now.getTime() - startTime.getTime()
          const durationMinutes = Math.floor(durationMs / 60000)

          return {
            ...(patrol as any),
            _vehicles_checked: vehiclesChecked || 0,
            _duration_minutes: durationMinutes,
            _last_gps_update: (latestActivity as any)?.recorded_at || null,
            _last_gps_lat: (latestActivity as any)?.gps_latitude || null,
            _last_gps_lng: (latestActivity as any)?.gps_longitude || null,
          } as ActivePatrol
        })
      )

      return enrichedPatrols
    },
    refetchInterval: 15000, // Refresh every 15 seconds for live tracking
  })

  // Fetch officer activity for selected patrol
  const { data: officerActivity } = useQuery({
    queryKey: ['officer-activity', selectedPatrol],
    queryFn: async () => {
      if (!selectedPatrol) return []

      const patrol = patrols?.find(p => p.id === selectedPatrol)
      if (!patrol) return []

      const { data, error } = await supabase
        .from('officer_activity_log')
        .select('*')
        .eq('user_id', patrol.officer.id)
        .gte('recorded_at', patrol.created_at || new Date().toISOString())
        .order('recorded_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as OfficerActivity[]
    },
    enabled: !!selectedPatrol,
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  // ─── Fetch active officers (logged-in officers with recent GPS, regardless
  //     of whether a formal patrol record exists) ───────────────────────────
  const { data: activeOfficers = [], isLoading: officersLoading } = useQuery({
    queryKey: ['active-officers-welfare', organizationId, patrols?.map(p => p.officer.id).join(',')],
    queryFn: async () => {
      // Officers active in the last 2 hours
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

      let query = (supabase.from('user_profiles') as any)
        .select('id, first_name, last_name, phone, organization_id, last_gps_latitude, last_gps_longitude, last_gps_accuracy, last_gps_update')
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)
        .not('last_gps_update', 'is', null)
        .gte('last_gps_update', twoHoursAgo)
        .order('last_gps_update', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data: officerRows, error } = await query
      if (error) throw error
      if (!officerRows || officerRows.length === 0) return [] as ActiveOfficer[]

      // IDs of officers already covered by a patrol record
      const patrolOfficerIds = new Set((patrols ?? []).map(p => p.officer.id))

      // Enrich each officer with today's scan count & welfare status
      const today = new Date().toISOString().split('T')[0]
      const enriched: ActiveOfficer[] = await Promise.all(
        (officerRows as any[]).map(async (o: any) => {
          const { count: scans } = await (supabase.from('observations') as any)
            .select('*', { count: 'exact', head: true })
            .eq('recorded_by', o.id)
            .gte('recorded_at', today)

          // Check for pending welfare alerts
          const { data: welfareAlerts } = await (supabase.from('officer_welfare_alerts') as any)
            .select('id')
            .eq('officer_id', o.id)
            .eq('status', 'pending')
            .limit(1)

          const hasAlert = (welfareAlerts ?? []).length > 0

          // Determine welfare status based on GPS recency
          let welfareStatus: 'ok' | 'warning' | 'alert' = 'ok'
          if (hasAlert) {
            welfareStatus = 'alert'
          } else if (o.last_gps_update) {
            const minutesSinceGps = Math.floor((Date.now() - new Date(o.last_gps_update).getTime()) / 60000)
            if (minutesSinceGps > 30) welfareStatus = 'warning'
          }

          return {
            id: o.id,
            first_name: o.first_name,
            last_name: o.last_name,
            phone: o.phone,
            organization_id: o.organization_id,
            last_gps_latitude: o.last_gps_latitude,
            last_gps_longitude: o.last_gps_longitude,
            last_gps_accuracy: o.last_gps_accuracy,
            last_gps_update: o.last_gps_update,
            _vehicles_scanned_today: scans ?? 0,
            _welfare_status: welfareStatus,
            _has_patrol: patrolOfficerIds.has(o.id),
          } as ActiveOfficer & { _has_patrol: boolean }
        })
      )

      // Only show officers NOT already in the patrols list — avoids duplication
      return enriched.filter((o: any) => !o._has_patrol)
    },
    // Wait until patrols query has settled so we can deduplicate correctly
    enabled: !patrolsLoading,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Calculate patrol + officer statistics (combined view)
  const patrolCount = patrols?.length ?? 0
  const officerCount = activeOfficers.length
  const hasAnyData = patrolCount > 0 || officerCount > 0

  const stats: PatrolStats | null = hasAnyData ? {
    total_active: patrolCount + officerCount,
    total_officers: new Set([
      ...(patrols ?? []).map(p => p.officer.id),
      ...activeOfficers.map(o => o.id),
    ]).size,
    total_vehicles_checked:
      (patrols ?? []).reduce((sum, p) => sum + p._vehicles_checked, 0) +
      activeOfficers.reduce((sum, o) => sum + o._vehicles_scanned_today, 0),
    average_duration_minutes: patrolCount > 0 
      ? Math.floor((patrols ?? []).reduce((sum, p) => sum + p._duration_minutes, 0) / patrolCount)
      : 0,
    zones_covered: new Set((patrols ?? []).map(p => p.zone.id)).size,
    last_check_in: (patrols ?? [])[0]?.created_at || null,
  } : null

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours > 0) {
      return `${hours}h ${mins}m`
    }
    return `${mins}m`
  }

  const getGPSStatusColor = (lastUpdate: string | null) => {
    if (!lastUpdate) return 'bg-gray-100 text-gray-800'
    
    const updateTime = new Date(lastUpdate).getTime()
    const now = new Date().getTime()
    const minutesAgo = Math.floor((now - updateTime) / 60000)

    if (minutesAgo < 5) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    if (minutesAgo < 15) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  }

  const getGPSStatusText = (lastUpdate: string | null) => {
    if (!lastUpdate) return 'No GPS'
    
    const updateTime = new Date(lastUpdate).getTime()
    const now = new Date().getTime()
    const minutesAgo = Math.floor((now - updateTime) / 60000)

    if (minutesAgo < 1) return 'Live'
    if (minutesAgo < 5) return `${minutesAgo}m ago`
    if (minutesAgo < 60) return `${minutesAgo}m ago`
    const hoursAgo = Math.floor(minutesAgo / 60)
    return `${hoursAgo}h ago`
  }

  const getPatrolStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return <Badge className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400">In Progress</Badge>
      case 'scheduled':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400">Scheduled</Badge>
      case 'completed':
        return <Badge className="bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900/30 dark:text-gray-400">Completed</Badge>
      case 'cancelled':
        return <Badge variant="outline" className="text-red-600 border-red-300">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getWelfareBadge = (status: 'ok' | 'warning' | 'alert') => {
    switch (status) {
      case 'ok':
        return <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400"><Wifi className="h-3 w-3 mr-1" />Active</Badge>
      case 'warning':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400"><AlertTriangle className="h-3 w-3 mr-1" />GPS Stale</Badge>
      case 'alert':
        return <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400"><AlertCircle className="h-3 w-3 mr-1" />Welfare Alert</Badge>
    }
  }

  return (
    <AppLayout 
      title="Live Patrol & Welfare Monitor" 
      description="Real-time patrol tracking, officer GPS monitoring and welfare"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* ── Welfare alert strip — officers needing immediate attention ── */}
      {(() => {
        const alertOfficers = activeOfficers.filter((o: any) => o._welfare_status === 'alert')
        if (alertOfficers.length === 0) return null
        return (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 flex-wrap mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{alertOfficers.length} officer{alertOfficers.length > 1 ? 's' : ''} — welfare check overdue</span>
            <span className="text-red-400 font-normal">{alertOfficers.map((o: any) => o.officer?.full_name || 'Unknown').join(', ')}</span>
          </div>
        )
      })()}

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Active Patrols
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">
                {stats.total_active}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
                <User className="h-4 w-4" />
                Officers On Duty
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">
                {stats.total_officers}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                <Car className="h-4 w-4" />
                Vehicles Checked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {stats.total_vehicles_checked}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Avg Duration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {formatDuration(stats.average_duration_minutes)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-indigo-600 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Zones Covered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-indigo-600">
                {stats.zones_covered}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Last Check-In
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-bold text-gray-600">
                {stats.last_check_in ? formatDateTime(stats.last_check_in).split(' ')[1] : 'N/A'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Patrols List */}
      {patrolsLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading patrols...</p>
        </div>
      ) : patrolsError ? (
        <Card>
          <CardContent className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <p className="text-gray-600">Unable to load patrols</p>
            <p className="text-sm text-gray-500 mt-2">{(patrolsError as any)?.message || 'Check that the patrols table and its relationships exist'}</p>
          </CardContent>
        </Card>
      ) : patrols && patrols.length === 0 && activeOfficers.length > 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <Shield className="h-10 w-10 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No formal patrols scheduled for today</p>
            <p className="text-sm text-gray-500 mt-1">Active officers are shown below.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {patrols?.map((patrol) => (
            <Card 
              key={patrol.id} 
              className={`hover:shadow-lg transition-all ${
                selectedPatrol === patrol.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {patrol.patrol_route?.route_name && (
                        <Badge className="font-medium bg-blue-600 text-white gap-1 shrink-0">
                          <Radio className="h-3 w-3" />{patrol.patrol_route.route_name}
                        </Badge>
                      )}
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <User className="h-5 w-5 text-blue-600" />
                        {patrol.officer.first_name} {patrol.officer.last_name}
                      </CardTitle>
                      {getPatrolStatusBadge(patrol.status)}
                      <Badge className={getGPSStatusColor(patrol._last_gps_update)}>
                        <Navigation className="h-3 w-3 mr-1" />
                        {getGPSStatusText(patrol._last_gps_update)}
                      </Badge>
                    </div>
                    <CardDescription>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {patrol.zone.name}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {patrol.shift}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(patrol._duration_minutes)}
                        </span>
                      </div>
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPatrol(
                      selectedPatrol === patrol.id ? null : patrol.id
                    )}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Patrol Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                      <Car className="h-4 w-4 text-green-600 mx-auto mb-1" />
                      <div className="text-2xl font-bold text-green-600">
                        {patrol._vehicles_checked}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Vehicles</p>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                      <Clock className="h-4 w-4 text-blue-600 mx-auto mb-1" />
                      <div className="text-lg font-bold text-blue-600">
                        {formatDuration(patrol._duration_minutes)}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Duration</p>
                    </div>

                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-center">
                      <TrendingUp className="h-4 w-4 text-purple-600 mx-auto mb-1" />
                      <div className="text-lg font-bold text-purple-600">
                        {patrol._vehicles_checked > 0 
                          ? Math.floor(patrol._vehicles_checked / Math.max(1, patrol._duration_minutes / 60))
                          : 0}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Per Hour</p>
                    </div>
                  </div>

                  {/* Check-in Details */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm mb-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="font-semibold">Started:</span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {patrol.status === 'in_progress' ? formatDateTime(patrol.updated_at || patrol.created_at) : 'Not started'}
                      </span>
                    </div>
                  </div>

                  {/* Current GPS Position */}
                  {patrol._last_gps_lat && patrol._last_gps_lng && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <Navigation className="h-4 w-4 text-blue-600" />
                        <span className="font-semibold">Current Position:</span>
                        <span className="text-gray-600 dark:text-gray-400">
                          {getGPSStatusText(patrol._last_gps_update)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <MapPin className="h-3 w-3" />
                        <span>
                          {patrol._last_gps_lat.toFixed(6)}, {patrol._last_gps_lng.toFixed(6)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Contact Info */}
                  {patrol.officer.phone && (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Radio className="h-4 w-4 text-gray-600" />
                        <span className="font-semibold">Contact:</span>
                        <a 
                          href={`tel:${patrol.officer.phone}`}
                          className="text-blue-600 hover:underline"
                        >
                          {patrol.officer.phone}
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {patrol.notes && (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-semibold">Notes:</span> {patrol.notes}
                      </p>
                    </div>
                  )}

                  {/* Expanded Activity Log */}
                  {selectedPatrol === patrol.id && officerActivity && officerActivity.length > 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 mt-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Activity className="h-4 w-4 text-yellow-600" />
                        <span className="font-semibold text-sm">Recent GPS Activity</span>
                      </div>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {officerActivity.slice(0, 10).map((activity, idx) => (
                          <div key={idx} className="text-xs bg-white dark:bg-gray-800 rounded p-2">
                            <div className="flex justify-between items-start">
                              <span className="text-gray-600 dark:text-gray-400">
                                {formatDateTime(activity.recorded_at)}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {activity.activity_type}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1 mt-1 text-gray-500">
                              <MapPin className="h-3 w-3" />
                              <span>
                                {activity.gps_latitude.toFixed(6)}, {activity.gps_longitude.toFixed(6)}
                              </span>
                              <span className="ml-2">
                                ±{activity.gps_accuracy}m
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Active Officers (no formal patrol) ─────────────────────────── */}
      {activeOfficers.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Active Officers
            </h2>
            <Badge variant="outline" className="ml-2 text-purple-600 border-purple-300">
              {activeOfficers.length} logged in
            </Badge>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Officers with recent GPS activity who are not assigned to a formal patrol.
          </p>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {activeOfficers.map((officer) => (
              <Card key={officer.id} className="hover:shadow-lg transition-all">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <User className="h-4 w-4 text-purple-600" />
                      {officer.first_name} {officer.last_name}
                    </CardTitle>
                    {getWelfareBadge(officer._welfare_status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* GPS Position */}
                  <div className="flex items-center gap-2 text-sm">
                    <Navigation className="h-4 w-4 text-blue-600 shrink-0" />
                    <Badge className={getGPSStatusColor(officer.last_gps_update)}>
                      {getGPSStatusText(officer.last_gps_update)}
                    </Badge>
                    {officer.last_gps_latitude && officer.last_gps_longitude && (
                      <span className="text-xs text-gray-500">
                        {Number(officer.last_gps_latitude).toFixed(5)}, {Number(officer.last_gps_longitude).toFixed(5)}
                      </span>
                    )}
                  </div>

                  {/* Vehicle scans today */}
                  <div className="flex items-center gap-2 text-sm">
                    <Car className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="font-medium">{officer._vehicles_scanned_today}</span>
                    <span className="text-gray-500">vehicles scanned today</span>
                  </div>

                  {/* Contact */}
                  {officer.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Radio className="h-4 w-4 text-gray-500 shrink-0" />
                      <a
                        href={`tel:${officer.phone}`}
                        className="text-blue-600 hover:underline"
                      >
                        {officer.phone}
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state — no patrols AND no active officers */}
      {!patrolsLoading && !officersLoading && (patrols?.length ?? 0) === 0 && activeOfficers.length === 0 && !patrolsError && (
        <Card className="mt-4">
          <CardContent className="text-center py-12">
            <WifiOff className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No active officers or patrols detected</p>
            <p className="text-sm text-gray-500 mt-2">
              Officers will appear here automatically once they log in and start sending GPS updates.
              Patrols will show when scheduled for today.
            </p>
          </CardContent>
        </Card>
      )}
    </AppLayout>
  )
}
