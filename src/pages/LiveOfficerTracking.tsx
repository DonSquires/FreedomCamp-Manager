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
  Radio,
  AlertCircle,
  CheckCircle,
  Shield,
  Wifi,
  WifiOff,
  Map as MapIcon,
  ChevronDown,
  ChevronUp,
  Target
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

interface OfficerLocation {
  user_id: string
  first_name: string
  last_name: string
  phone: string | null
  role: string
  last_activity_at: string
  gps_latitude: number
  gps_longitude: number
  gps_accuracy: number
  activity_type: string
  on_patrol: boolean
  patrol_zone: string | null
  status: 'online' | 'idle' | 'offline'
}

interface OfficerActivity {
  recorded_at: string
  gps_latitude: number
  gps_longitude: number
  gps_accuracy: number
  activity_type: string
  metadata: any
}

export default function LiveOfficerTracking() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('list')
  const [expandedActivities, setExpandedActivities] = useState<string[]>([])

  // Fetch officer locations
  const { data: officers, isLoading: officersLoading } = useQuery({
    queryKey: ['officer-locations', organizationId],
    queryFn: async () => {
      // Get all active officers
      let userQuery = supabase
        .from('user_profiles')
        .select('id, first_name, last_name, phone, role, organization_id')
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer', 'admin', 'master'])

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        userQuery = userQuery.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        userQuery = userQuery.eq('organization_id', organizationId)
      }

      const { data: officers, error: officersError } = await userQuery

      if (officersError) throw officersError

      // Enrich with latest GPS and patrol status
      const enrichedOfficers = await Promise.all(
        (officers || []).map(async (officer) => {
          // Get latest GPS activity
          const { data: latestActivity } = await supabase
            .from('officer_activity_log')
            .select('recorded_at, gps_latitude, gps_longitude, gps_accuracy, activity_type')
            .eq('user_id', officer.id)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single()

          // Check if on active patrol
          const { data: activePatrol } = await supabase
            .from('patrols')
            .select('zone_id, zones(name)')
            .eq('assigned_to', officer.id)
            .eq('status', 'in_progress')
            .single()

          // Determine status based on last activity time
          let status: 'online' | 'idle' | 'offline' = 'offline'
          if (latestActivity) {
            const lastActivityTime = new Date(latestActivity.recorded_at).getTime()
            const now = new Date().getTime()
            const minutesAgo = Math.floor((now - lastActivityTime) / 60000)

            if (minutesAgo < 5) status = 'online'
            else if (minutesAgo < 30) status = 'idle'
            else status = 'offline'
          }

          return {
            user_id: officer.id,
            first_name: officer.first_name,
            last_name: officer.last_name,
            phone: officer.phone,
            role: officer.role,
            last_activity_at: latestActivity?.recorded_at || null,
            gps_latitude: latestActivity?.gps_latitude || null,
            gps_longitude: latestActivity?.gps_longitude || null,
            gps_accuracy: latestActivity?.gps_accuracy || null,
            activity_type: latestActivity?.activity_type || 'unknown',
            on_patrol: !!activePatrol,
            patrol_zone: activePatrol?.zones?.name || null,
            status,
          } as OfficerLocation
        })
      )

      // Sort by status (online first) then by last activity
      return enrichedOfficers.sort((a, b) => {
        const statusOrder = { online: 0, idle: 1, offline: 2 }
        if (statusOrder[a.status] !== statusOrder[b.status]) {
          return statusOrder[a.status] - statusOrder[b.status]
        }
        
        if (!a.last_activity_at) return 1
        if (!b.last_activity_at) return -1
        return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
      })
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  // Fetch activity history for selected officer
  const { data: activityHistory } = useQuery({
    queryKey: ['officer-activity-history', selectedOfficer],
    queryFn: async () => {
      if (!selectedOfficer) return []

      const { data, error } = await supabase
        .from('officer_activity_log')
        .select('*')
        .eq('user_id', selectedOfficer)
        .order('recorded_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as OfficerActivity[]
    },
    enabled: !!selectedOfficer,
    refetchInterval: 15000,
  })

  // Calculate stats
  const stats = officers ? {
    total_officers: officers.length,
    online: officers.filter(o => o.status === 'online').length,
    on_patrol: officers.filter(o => o.on_patrol).length,
    idle: officers.filter(o => o.status === 'idle').length,
    offline: officers.filter(o => o.status === 'offline').length,
  } : null

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'idle':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'offline':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'idle':
        return <Clock className="h-4 w-4 text-yellow-600" />
      case 'offline':
        return <WifiOff className="h-4 w-4 text-gray-400" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const getActivityTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      scan: 'Vehicle Scan',
      check_in: 'Patrol Check-In',
      movement: 'Movement',
      location_ping: 'Location Update',
      unknown: 'Activity',
    }
    return labels[type] || type
  }

  const toggleActivityExpansion = (userId: string) => {
    setExpandedActivities(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  return (
    <AppLayout 
      title="Live Officer Tracking" 
      description="Real-time GPS monitoring and officer location tracking"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-5 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <User className="h-4 w-4" />
                Total Officers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-600">
                {stats.total_officers}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                <Wifi className="h-4 w-4" />
                Online
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {stats.online}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                On Patrol
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">
                {stats.on_patrol}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Idle
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">
                {stats.idle}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <WifiOff className="h-4 w-4" />
                Offline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-600">
                {stats.offline}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="flex gap-2 mb-4">
        <Button
          variant={viewMode === 'map' ? 'default' : 'outline'}
          onClick={() => setViewMode('map')}
          size="sm"
        >
          <MapIcon className="h-4 w-4 mr-2" />
          Map View
        </Button>
        <Button
          variant={viewMode === 'list' ? 'default' : 'outline'}
          onClick={() => setViewMode('list')}
          size="sm"
        >
          <Activity className="h-4 w-4 mr-2" />
          List View
        </Button>
      </div>

      {/* Map View (Placeholder) */}
      {viewMode === 'map' && (
        <Card className="mb-6">
          <CardContent className="p-0">
            <div className="relative bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-900 h-96 flex items-center justify-center">
              <div className="text-center">
                <MapIcon className="h-16 w-16 text-blue-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-gray-700 dark:text-gray-300 mb-2">
                  Interactive Map Integration
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
                  Live officer locations with GPS markers, patrol routes, and zone boundaries would be displayed here.
                  Requires Leaflet or Mapbox GL integration.
                </p>
                <div className="mt-4 flex gap-3 justify-center">
                  <Badge className="bg-green-100 text-green-800">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {stats?.online} Online
                  </Badge>
                  <Badge className="bg-blue-100 text-blue-800">
                    <Shield className="h-3 w-3 mr-1" />
                    {stats?.on_patrol} On Patrol
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {officersLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading officer locations...</p>
            </div>
          ) : officers && officers.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No officers found</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {officers?.map((officer) => (
                <Card 
                  key={officer.user_id}
                  className={`hover:shadow-lg transition-all ${
                    selectedOfficer === officer.user_id ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <CardTitle className="text-lg font-bold flex items-center gap-2">
                            <User className="h-5 w-5 text-blue-600" />
                            {officer.first_name} {officer.last_name}
                          </CardTitle>
                          <Badge className={getStatusColor(officer.status)}>
                            {getStatusIcon(officer.status)}
                            <span className="ml-1 capitalize">{officer.status}</span>
                          </Badge>
                          {officer.on_patrol && (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                              <Shield className="h-3 w-3 mr-1" />
                              On Patrol
                            </Badge>
                          )}
                        </div>
                        <CardDescription>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="capitalize">{officer.role.replace('_', ' ')}</span>
                            {officer.patrol_zone && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {officer.patrol_zone}
                              </span>
                            )}
                            {officer.last_activity_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDateTime(officer.last_activity_at)}
                              </span>
                            )}
                          </div>
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (selectedOfficer === officer.user_id) {
                            setSelectedOfficer(null)
                          } else {
                            setSelectedOfficer(officer.user_id)
                          }
                        }}
                      >
                        {selectedOfficer === officer.user_id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Current GPS Position */}
                      {officer.gps_latitude && officer.gps_longitude ? (
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Navigation className="h-4 w-4 text-green-600" />
                            <span className="font-semibold text-sm">Current Position</span>
                            <Badge variant="outline" className="text-xs">
                              {getActivityTypeLabel(officer.activity_type)}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <Target className="h-3 w-3" />
                              <span className="font-mono">
                                {officer.gps_latitude.toFixed(6)}, {officer.gps_longitude.toFixed(6)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span>Accuracy: ±{officer.gps_accuracy}m</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <AlertCircle className="h-4 w-4" />
                            <span>No GPS data available</span>
                          </div>
                        </div>
                      )}

                      {/* Contact Info */}
                      {officer.phone && (
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Radio className="h-4 w-4 text-gray-600" />
                            <span className="font-semibold">Contact:</span>
                            <a 
                              href={`tel:${officer.phone}`}
                              className="text-blue-600 hover:underline"
                            >
                              {officer.phone}
                            </a>
                          </div>
                        </div>
                      )}

                      {/* Expanded Activity History */}
                      {selectedOfficer === officer.user_id && activityHistory && activityHistory.length > 0 && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mt-3">
                          <div className="flex items-center gap-2 mb-3">
                            <Activity className="h-4 w-4 text-blue-600" />
                            <span className="font-semibold text-sm">Activity History (Last 50)</span>
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto">
                            {activityHistory.map((activity, idx) => (
                              <div key={idx} className="text-xs bg-white dark:bg-gray-800 rounded p-2 border border-gray-200 dark:border-gray-700">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="text-gray-600 dark:text-gray-400">
                                    {formatDateTime(activity.recorded_at)}
                                  </span>
                                  <Badge variant="outline" className="text-xs">
                                    {getActivityTypeLabel(activity.activity_type)}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-1 text-gray-500">
                                  <MapPin className="h-3 w-3" />
                                  <span className="font-mono">
                                    {activity.gps_latitude.toFixed(6)}, {activity.gps_longitude.toFixed(6)}
                                  </span>
                                  <span className="ml-2">±{activity.gps_accuracy}m</span>
                                </div>
                                {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                                  <div className="mt-1 text-gray-500">
                                    <pre className="text-xs overflow-x-auto">
                                      {JSON.stringify(activity.metadata, null, 2)}
                                    </pre>
                                  </div>
                                )}
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
        </>
      )}
    </AppLayout>
  )
}
