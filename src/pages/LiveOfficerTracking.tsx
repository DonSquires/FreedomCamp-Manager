import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { 
  MapPin, 
  Clock, 
  Activity, 
  AlertCircle,
  CheckCircle,
  Navigation,
  User,
  RefreshCw
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'

interface OfficerLocation {
  id: string
  user_id: string
  first_name: string
  last_name: string
  role: string
  last_activity_at: string
  gps_latitude: number | null
  gps_longitude: number | null
  gps_accuracy: number | null
  activity_type: string
  zone_name: string | null
  status: 'active' | 'inactive' | 'warning'
}

export default function LiveOfficerTracking() {
  const { organizationId } = useGlobalFiltersStore()
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Fetch live officer locations
  const { data: officers, isLoading, refetch } = useQuery({
    queryKey: ['live-officers', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc('get_live_officer_locations', {
          p_organization_id: organizationId || null
        })

      if (error) throw error
      return data as OfficerLocation[]
    },
    refetchInterval: autoRefresh ? 30000 : false, // Refresh every 30 seconds
  })

  // Calculate statistics
  const stats = officers ? {
    total: officers.length,
    active: officers.filter(o => o.status === 'active').length,
    inactive: officers.filter(o => o.status === 'inactive').length,
    warnings: officers.filter(o => o.status === 'warning').length,
  } : null

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500'
      case 'inactive': return 'bg-gray-400'
      case 'warning': return 'bg-orange-500'
      default: return 'bg-gray-400'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
      case 'inactive':
        return <Badge variant="outline" className="text-gray-600">Inactive</Badge>
      case 'warning':
        return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Warning</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const getTimeSince = (timestamp: string) => {
    const now = new Date()
    const then = new Date(timestamp)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return `${Math.floor(diffHours / 24)}d ago`
  }

  return (
    <AppLayout
      title="Live Officer Tracking"
      description="Real-time GPS tracking and activity monitoring"
      showBackButton
    >
      <div className="space-y-6">
        {/* Header Controls */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                  <span className="text-sm font-medium">
                    {autoRefresh ? 'Live Updates' : 'Paused'}
                  </span>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                >
                  {autoRefresh ? 'Pause' : 'Resume'}
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>

              <div className="text-sm text-gray-600">
                Last updated: {formatDateTime(new Date().toISOString())}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">Total Officers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-600">Active</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">Inactive</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-600">{stats.inactive}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-orange-600">Warnings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold text-orange-600">{stats.warnings}</div>
                  {stats.warnings > 0 && <AlertCircle className="h-5 w-5 text-orange-600" />}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Officer List */}
        {isLoading ? (
          <PaperworkSearchAnimation text="Loading officer locations…" />
        ) : officers && officers.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No active officers</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {officers?.map((officer) => (
              <Card key={officer.id} className="relative overflow-hidden">
                {/* Status Indicator */}
                <div className={`absolute top-0 left-0 right-0 h-1 ${getStatusColor(officer.status)}`} />
                
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {officer.first_name} {officer.last_name}
                      </CardTitle>
                      <CardDescription className="capitalize">{officer.role}</CardDescription>
                    </div>
                    {getStatusBadge(officer.status)}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Location */}
                  {officer.gps_latitude && officer.gps_longitude ? (
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                      <div className="flex-1 text-sm">
                        <div className="font-medium">{officer.zone_name || 'Unknown location'}</div>
                        <div className="text-gray-500 text-xs">
                          {officer.gps_latitude.toFixed(6)}, {officer.gps_longitude.toFixed(6)}
                          {officer.gps_accuracy && ` (±${Math.round(officer.gps_accuracy)}m)`}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-gray-500">
                      <MapPin className="h-4 w-4 mt-0.5" />
                      <span className="text-sm">No GPS location</span>
                    </div>
                  )}

                  {/* Last Activity */}
                  <div className="flex items-start gap-2">
                    <Activity className="h-4 w-4 text-gray-500 mt-0.5" />
                    <div className="flex-1 text-sm">
                      <div className="font-medium capitalize">{officer.activity_type}</div>
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {getTimeSince(officer.last_activity_at)}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      disabled={!officer.gps_latitude || !officer.gps_longitude}
                      onClick={() => {
                        if (officer.gps_latitude && officer.gps_longitude) {
                          window.open(
                            `https://www.google.com/maps?q=${officer.gps_latitude},${officer.gps_longitude}`,
                            '_blank'
                          )
                        }
                      }}
                    >
                      <Navigation className="h-4 w-4 mr-1" />
                      View Map
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
