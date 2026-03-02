import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  CheckCircle, 
  AlertTriangle, 
  Car, 
  Users, 
  Activity,
  Brain,
  RefreshCw
} from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { analyzeVehiclePhoto } from '@/lib/railwayServices'
import { toast } from 'sonner'

interface DashboardStats {
  total_observations: number
  compliant_observations: number
  non_compliant_observations: number
  active_breaches: number
  total_vehicles: number
  active_patrols: number
  compliance_rate: number
}

export default function ComplianceDashboard() {
  const { user } = useAuthStore()
  const { organizationId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false)
  const [analysisResults, setAnalysisResults] = useState<any>(null)

  // Fetch dashboard stats
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats', organizationId, dateFrom, dateTo],
    queryFn: async () => {
      return await calculateStatsManually()
    },
  })

  // Stats calculation
  const calculateStatsManually = async () => {
    let obsQuery = supabase.from('observations').select('is_compliant', { count: 'exact' })
    let breachQuery = supabase.from('breach_alerts').select('*', { count: 'exact' }).eq('status', 'pending')
    let vehicleQuery = supabase.from('canonical_vehicles').select('*', { count: 'exact' })
    let patrolQuery = supabase.from('patrols').select('*', { count: 'exact' }).eq('status', 'in_progress')

    if (user?.role !== 'master' && user?.organization_id) {
      obsQuery = obsQuery.eq('organization_id', user.organization_id)
      breachQuery = breachQuery.eq('organization_id', user.organization_id)
      vehicleQuery = vehicleQuery
      patrolQuery = patrolQuery.eq('organization_id', user.organization_id)
    } else if (organizationId) {
      obsQuery = obsQuery.eq('organization_id', organizationId)
      breachQuery = breachQuery.eq('organization_id', organizationId)
      patrolQuery = patrolQuery.eq('organization_id', organizationId)
    }

    if (dateFrom) {
      obsQuery = obsQuery.gte('recorded_at', dateFrom)
    }
    if (dateTo) {
      obsQuery = obsQuery.lte('recorded_at', dateTo)
    }

    const [obsResult, breachResult, vehicleResult, patrolResult] = await Promise.all([
      obsQuery,
      breachQuery,
      vehicleQuery,
      patrolQuery,
    ])

    const totalObs = obsResult.count || 0
    const compliantObs = obsResult.data?.filter(o => o.is_compliant).length || 0
    const complianceRate = totalObs > 0 ? (compliantObs / totalObs) * 100 : 0

    return {
      total_observations: totalObs,
      compliant_observations: compliantObs,
      non_compliant_observations: totalObs - compliantObs,
      active_breaches: breachResult.count || 0,
      total_vehicles: vehicleResult.count || 0,
      active_patrols: patrolResult.count || 0,
      compliance_rate: complianceRate,
    }
  }

  // Fetch recent activity
  const { data: recentActivity } = useQuery({
    queryKey: ['recent-activity', organizationId, user?.organization_id],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select(`
          id,
          plate_number,
          recorded_at,
          zones:zone_id(name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data } = await query

      return (data || []).map(obs => ({
        id: obs.id,
        type: 'observation' as const,
        plate_number: obs.plate_number,
        zone_name: (obs.zones as any)?.name || 'Unknown Zone',
        created_at: obs.recorded_at,
        status: 'recorded',
      }))
    },
  })

  // Railway Integration: Analyze recent vehicle photos with AI
  const handleAnalyzeRecentPhotos = async () => {
    setAnalyzingPhotos(true)
    try {
      // Get recent observations with photos
      let query = supabase
        .from('observations')
        .select('id, photo_url, plate_number')
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data: observations, error } = await query

      if (error) throw error

      if (!observations || observations.length === 0) {
        toast.error('No recent photos to analyze')
        return
      }

      // Analyze first photo as demo
      const firstPhoto = observations[0]
      const { data, error: analysisError } = await analyzeVehiclePhoto(firstPhoto.photo_url)

      if (analysisError) {
        toast.error(analysisError)
        return
      }

      setAnalysisResults({
        plate_number: firstPhoto.plate_number,
        detection: data?.detection,
        embedding: data?.embedding,
      })

      toast.success('AI analysis complete')
    } catch (error: any) {
      toast.error(error.message || 'Failed to analyze photos')
    } finally {
      setAnalyzingPhotos(false)
    }
  }

  return (
    <AppLayout title="Compliance Dashboard" description="Real-time compliance monitoring and analytics" showBackButton>
      <GlobalFilterRibbon />

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Total Observations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.total_observations || 0}</div>
                <p className="text-xs text-gray-500 mt-1">
                  {dateFrom ? `Since ${formatDate(dateFrom)}` : 'All time'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Compliance Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">
                  {stats?.compliance_rate.toFixed(1)}%
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {stats?.compliant_observations} / {stats?.total_observations} compliant
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Active Breaches
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">
                  {stats?.active_breaches || 0}
                </div>
                <p className="text-xs text-gray-500 mt-1">Pending action</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Total Vehicles
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">
                  {stats?.total_vehicles || 0}
                </div>
                <p className="text-xs text-gray-500 mt-1">In registry</p>
              </CardContent>
            </Card>
          </div>

          {/* Secondary Metrics */}
          <div className="grid gap-4 md:grid-cols-2 mb-8">
            <Card>
              <CardHeader>
                <CardTitle>Non-Compliant Observations</CardTitle>
                <CardDescription>Observations requiring attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {stats?.non_compliant_observations || 0}
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Compliance rate target:</span>
                    <span className="font-medium">95%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Current rate:</span>
                    <span className={`font-medium ${(stats?.compliance_rate || 0) >= 95 ? 'text-green-600' : 'text-red-600'}`}>
                      {stats?.compliance_rate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active Patrols</CardTitle>
                <CardDescription>Officers currently on patrol</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">
                  {stats?.active_patrols || 0}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {stats?.active_patrols || 0} officers in the field
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Railway Integration: AI Photo Analysis */}
          <Card className="mb-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5" />
                    AI Photo Analysis
                  </CardTitle>
                  <CardDescription>
                    Analyze vehicle photos using Railway inference service
                  </CardDescription>
                </div>
                <Button
                  onClick={handleAnalyzeRecentPhotos}
                  disabled={analyzingPhotos}
                  size="sm"
                >
                  {analyzingPhotos ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-2" />
                      Analyze Photos
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {analysisResults ? (
                <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div>
                    <span className="font-medium">Plate:</span> {analysisResults.plate_number}
                  </div>
                  {analysisResults.detection && (
                    <div>
                      <span className="font-medium">Vehicles Detected:</span>{' '}
                      {analysisResults.detection.vehicle_count}
                    </div>
                  )}
                  {analysisResults.embedding && (
                    <div>
                      <span className="font-medium">Embedding Quality:</span>{' '}
                      {(analysisResults.embedding.embedding_quality * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600">
                  Click "Analyze Photos" to run AI analysis on recent observations
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest observations and events</CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity && recentActivity.length > 0 ? (
                <div className="space-y-3">
                  {recentActivity.map((activity) => (
                    <div 
                      key={activity.id} 
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Car className="h-5 w-5 text-gray-400" />
                        <div>
                          <p className="font-medium">{activity.plate_number}</p>
                          <p className="text-sm text-gray-600">{activity.zone_name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline">{activity.status}</Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDateTime(activity.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">No recent activity</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AppLayout>
  )
}
