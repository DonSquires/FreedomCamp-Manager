import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  TrendingUp
} from 'lucide-react'
import { formatDateTime, formatDate } from '@/lib/utils'
import { toast } from 'sonner'

interface ActivePatrol {
  id: string
  status: string
  patrol_date: string
  shift: string
  checked_in_at: string | null
  check_in_location_lat: number | null
  check_in_location_lng: number | null
  completed_at: string | null
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

export default function LivePatrolMonitor() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [selectedPatrol, setSelectedPatrol] = useState<string | null>(null)

  // Fetch active patrols with enriched data
  const { data: patrols, isLoading: patrolsLoading } = useQuery({
    queryKey: ['live-patrols', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      
      let query = supabase
        .from('patrols')
        .select(`
          id,
          status,
          patrol_date,
          shift,
          checked_in_at,
          check_in_location_lat,
          check_in_location_lng,
          completed_at,
          notes,
          zone:zones(id, name),
          officer:user_profiles!patrols_assigned_to_fkey(id, first_name, last_name, phone)
        `)
        .eq('status', 'in_progress')
        .order('checked_in_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      // Zone filter
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      // Date filter
      if (dateFrom) {
        query = query.gte('patrol_date', dateFrom)
      }
      if (dateTo) {
        query = query.lte('patrol_date', dateTo)
      }

      const { data: patrolsData, error: patrolsError } = await query

      if (patrolsError) throw patrolsError

      // Enrich with vehicle counts and GPS data
      const enrichedPatrols = await Promise.all(
        (patrolsData || []).map(async (patrol) => {
          // Get vehicles checked count from observations
          const { count: vehiclesChecked } = await supabase
            .from('observations')
            .select('*', { count: 'exact', head: true })
            .eq('recorded_by', patrol.officer.id)
            .gte('recorded_at', patrol.checked_in_at || today)

          // Get latest GPS position from activity log
          const { data: latestActivity } = await supabase
            .from('officer_activity_log')
            .select('gps_latitude, gps_longitude, recorded_at')
            .eq('user_id', patrol.officer.id)
            .gte('recorded_at', patrol.checked_in_at || today)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single()

          // Calculate duration
          const startTime = patrol.checked_in_at ? new Date(patrol.checked_in_at) : new Date()
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
        .gte('recorded_at', patrol.checked_in_at || new Date().toISOString())
        .order('recorded_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as OfficerActivity[]
    },
    enabled: !!selectedPatrol,
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  // Calculate patrol statistics
  const stats: PatrolStats | null = patrols ? {
    total_active: patrols.length,
    total_officers: new Set(patrols.map(p => p.officer.id)).size,
    total_vehicles_checked: patrols.reduce((sum, p) => sum + p._vehicles_checked, 0),
    average_duration_minutes: patrols.length > 0 
      ? Math.floor(patrols.reduce((sum, p) => sum + p._duration_minutes, 0) / patrols.length)
      : 0,
    zones_covered: new Set(patrols.map(p => p.zone.id)).size,
    last_check_in: patrols[0]?.checked_in_at || null,
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

  return (
    <AppLayout 
      title="Live Patrol Monitor" 
      description="Real-time patrol tracking and officer GPS monitoring"
      showBackButton
    >
      <GlobalFilterRibbon />

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
          <p className="mt-4 text-gray-600">Loading active patrols...</p>
        </div>
      ) : patrols && patrols.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Shield className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No active patrols</p>
            <p className="text-sm text-gray-500 mt-2">All officers are currently off-duty</p>
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
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <User className="h-5 w-5 text-blue-600" />
                        {patrol.officer.first_name} {patrol.officer.last_name}
                      </CardTitle>
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
                      <span className="font-semibold">Checked In:</span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {patrol.checked_in_at ? formatDateTime(patrol.checked_in_at) : 'Not checked in'}
                      </span>
                    </div>
                    {patrol.check_in_location_lat && patrol.check_in_location_lng && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <MapPin className="h-3 w-3" />
                        <span>
                          {patrol.check_in_location_lat.toFixed(6)}, {patrol.check_in_location_lng.toFixed(6)}
                        </span>
                      </div>
                    )}
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
    </AppLayout>
  )
}
