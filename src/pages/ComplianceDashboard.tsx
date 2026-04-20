import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { getEffectiveOrgId } from '@/lib/orgUtils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  CheckCircle, 
  AlertTriangle, 
  Car, 
  Users, 
  Activity,
  Brain,
  RefreshCw,
  MapPin,
} from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import { analyzeVehiclePhoto } from '@/lib/proxyServices'
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
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false)
  const [analysisResults, setAnalysisResults] = useState<any>(null)

  const effectiveOrganizationId = getEffectiveOrgId(user, organizationId)
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  // Single RPC call – all aggregation and rate calculation done on the server.
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const start = startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end   = endDate   ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_admin_dashboard_stats', {
        p_start_date:      start,
        p_end_date:        end,
        p_organization_id: effectiveOrganizationId ?? null,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return {
        total_observations:         row?.total_observations         ?? 0,
        compliant_observations:     row?.compliant_observations     ?? 0,
        non_compliant_observations: row?.non_compliant_observations ?? 0,
        compliance_rate:            row?.compliance_rate            ?? 0,
        active_breaches:            row?.pending_breach_alerts      ?? 0,
        total_vehicles:             row?.total_vehicles             ?? 0,
        active_patrols:             row?.active_patrols             ?? 0,
      } as DashboardStats
    },
  })

  // Fetch recent activity
  const { data: recentActivity } = useQuery({
    queryKey: ['recent-activity', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = (supabase.from('observations') as any)
        .select(`
          observation_id,
          plate_number,
          recorded_at,
          zones:zone_id(name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (startDate) {
        query = query.gte('recorded_at', startDate)
      }
      if (endDate) {
        query = query.lte('recorded_at', endDate)
      }

      const { data } = await query

      return (data || []).map(obs => ({
        id: obs.observation_id,
        type: 'observation' as const,
        plate_number: obs.plate_number,
        zone_name: (obs.zones as any)?.name || 'Unknown Zone',
        created_at: obs.recorded_at,
        status: 'recorded',
      }))
    },
  })

  // Zone compliance breakdown (Jurisdiction vs specific zones)
  const { data: zoneBreakdown = [] } = useQuery({
    queryKey: ['zone-breakdown', effectiveOrganizationId, dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      const start = (dateFrom ? nzDateToUTCStart(dateFrom) : null) ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end   = (dateTo ? nzDateToUTCEnd(dateTo) : null) ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_zone_compliance_breakdown', {
        p_start:            start,
        p_end:              end,
        p_organization_id:  effectiveOrganizationId ?? null,
      }).abortSignal(signal)
      if (error) throw error
      return (Array.isArray(data) ? data : []) as Array<{
        zone_id: string
        zone_name: string
        zone_type: string | null
        parent_zone_id: string | null
        obs_count: number
        breach_count: number
        compliance_pct: number
        is_active: boolean
        organization_name: string
      }>
    },
  })

  const jurisdictionZones = zoneBreakdown.filter(z => z.parent_zone_id === null)
  const specificZones     = zoneBreakdown.filter(z => z.parent_zone_id !== null)

  // Bob Integration: Analyze recent vehicle photos via inference service
  const handleAnalyzeRecentPhotos = async () => {
    setAnalyzingPhotos(true)
    try {
      // Get recent observations with photos
      let query = (supabase.from('observations') as any)
        .select('observation_id, photo_url, plate_number')
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      const { data: observations, error } = await query

      if (error) throw error

      if (!observations || observations.length === 0) {
        toast.error('No recent photos to analyse')
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

      toast.success('Bob analysis complete')
    } catch (error: any) {
      toast.error(error.message || 'Failed to analyse photos')
    } finally {
      setAnalyzingPhotos(false)
    }
  }

  return (
    <AppLayout title="Compliance Dashboard" description="Real-time compliance monitoring and analytics" showBackButton>
      <GlobalFilterRibbon />

      {isLoading ? (
        <PaperworkSearchAnimation text="Loading compliance data…" />
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

          {/* Zone Compliance Breakdown: Jurisdiction vs Specific Zones */}
          {zoneBreakdown.length > 0 && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Zone Compliance Breakdown
                </CardTitle>
                <CardDescription>Compliance by jurisdiction and specific zone</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="specific">
                  <TabsList className="mb-4">
                    <TabsTrigger value="jurisdiction">
                      Jurisdictions ({jurisdictionZones.length})
                    </TabsTrigger>
                    <TabsTrigger value="specific">
                      Zones ({specificZones.length})
                    </TabsTrigger>
                  </TabsList>

                  {(['jurisdiction', 'specific'] as const).map((tab) => {
                    const rows = tab === 'jurisdiction' ? jurisdictionZones : specificZones
                    return (
                      <TabsContent key={tab} value={tab} className="space-y-2">
                        {rows.length === 0 ? (
                          <p className="text-center text-sm text-muted-foreground py-6">No {tab} zones found</p>
                        ) : (
                          rows.map(z => (
                            <div key={z.zone_id} className={`flex items-center justify-between p-3 rounded-lg border ${z.is_active ? 'bg-white dark:bg-gray-900 border-gray-200' : 'bg-gray-50 dark:bg-gray-800 border-gray-100 opacity-60'}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{z.zone_name}</p>
                                  <p className="text-xs text-muted-foreground">{z.organization_name}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-muted-foreground">{z.obs_count} obs · {z.breach_count} breaches</span>
                                <Badge variant="outline" className={`text-xs ${z.compliance_pct >= 80 ? 'bg-green-50 text-green-700 border-green-300' : z.compliance_pct >= 50 ? 'bg-yellow-50 text-yellow-700 border-yellow-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
                                  {z.compliance_pct.toFixed(0)}%
                                </Badge>
                              </div>
                            </div>
                          ))
                        )}
                      </TabsContent>
                    )
                  })}
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* Bob Photo Analysis */}
          <Card className="mb-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5" />
                    Bob Photo Analysis
                  </CardTitle>
                  <CardDescription>
                    Analyse vehicle photos using Bob inference service (RunPod)
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
                      Analyse Photos
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
                  Click "Analyse Photos" to run Bob analysis on recent observations
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
