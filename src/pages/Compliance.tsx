/**
 * Unified Compliance Page
 * 
 * Consolidates CompliancePage, ComplianceDashboard, and ComplianceAnalytics
 * into a single tabbed interface per CLEAN_REBUILD_DESIGN.md
 * 
 * Tabs:
 *   1. Overview - KPIs, zone breakdown, recent activity (from ComplianceDashboard)
 *   2. Observations - Breach observations table, homeless registry (from CompliancePage)  
 *   3. Analytics - Charts, trends, exports (from ComplianceAnalytics)
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow, startOfDay, subDays } from 'date-fns'
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  XCircle,
  MapPin,
  Car,
  Home,
  Shield,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  TrendingDown,
  TrendingUp,
  Activity,
  Brain,
  Users,
  Download,
  Image as ImageIcon,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Navigate, useSearchParams } from 'react-router-dom'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { getEffectiveOrgId } from '@/lib/orgUtils'
import { AppLayout } from '@/components/features/AppLayout'
import { HOMELESS_UI_STATUSES, homelessStatusLabel, normalizeHomelessStatus } from '@/lib/homelessStatus'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { getObservationPhotoUrl } from '@/lib/photoUtils'
import { AsyncStateWrapper } from '@/components/features/AsyncStateWrapper'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import { analyzeVehiclePhoto } from '@/lib/proxyServices'
import { toast } from 'sonner'
import { arrayToCSV, downloadCSV } from '@/lib/csvExport'
import { exportReportPDF } from '@/lib/pdfExport'
import type { PDFReportConfig, PDFSection } from '@/lib/pdfExport'

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  total_observations: number
  compliant_observations: number
  non_compliant_observations: number
  active_breaches: number
  total_vehicles: number
  active_patrols: number
  compliance_rate: number
}

interface BreachObservation {
  id: string
  plate_number: string | null
  recorded_at: string
  breach_type: string | null
  breach_reason: string | null
  status?: string | null
  zones: { name: string } | null
  organizations: { name: string } | null
}

interface ZoneStats {
  zone_id: string
  zone_name: string
  organization_name: string | null
  is_active: boolean
  nights_per_month: number
  max_consecutive_nights: number
  self_contained_required: boolean
  day_visit_only: boolean
  obs_count: number
  breach_count: number
  compliance_pct: number
  zone_type: string | null
  parent_zone_id: string | null
}

interface ComplianceMetrics {
  total_observations: number
  compliant: number
  non_compliant: number
  compliance_rate: number
  avg_nights_per_vehicle: number
  total_vehicles: number
  repeat_offenders: number
}

// ============================================================================
// Constants
// ============================================================================

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899']

// ============================================================================
// Main Component
// ============================================================================

export default function Compliance() {
  const { user, isAuthenticated, loading: authLoading } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [searchParams, setSearchParams] = useSearchParams()
  
  // Tab state from URL
  const activeTab = searchParams.get('tab') || 'overview'
  const setActiveTab = (tab: string) => {
    setSearchParams({ tab })
  }

  // Component-specific state
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [analyticsViewMode, setAnalyticsViewMode] = useState<'overview' | 'trends' | 'zones'>('overview')
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false)
  const [analysisResults, setAnalysisResults] = useState<any>(null)
  const pageSize = 25

  // Compute effective values (needed for queries)
  const effectiveOrganizationId = user ? getEffectiveOrgId(user, organizationId) : null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  // ============================================================================
  // Queries - MUST be called before any early returns
  // ============================================================================

  // Dashboard stats (Overview tab)
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['compliance-dashboard-stats', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const start = startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end = endDate ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_admin_dashboard_stats', {
        p_start_date: start,
        p_end_date: end,
        p_organization_id: effectiveOrganizationId ?? null,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return {
        total_observations: row?.total_observations ?? 0,
        compliant_observations: row?.compliant_observations ?? 0,
        non_compliant_observations: row?.non_compliant_observations ?? 0,
        compliance_rate: row?.compliance_rate ?? 0,
        active_breaches: row?.pending_breach_alerts ?? 0,
        total_vehicles: row?.total_vehicles ?? 0,
        active_patrols: row?.active_patrols ?? 0,
      } as DashboardStats
    },
  })

  // Zone breakdown (Overview tab)
  const { data: zoneBreakdown = [] } = useQuery({
    queryKey: ['compliance-zone-breakdown', effectiveOrganizationId, dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      const start = startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end = endDate ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_zone_compliance_breakdown', {
        p_start: start,
        p_end: end,
        p_organization_id: effectiveOrganizationId ?? null,
      }).abortSignal(signal)
      if (error) throw error
      return (Array.isArray(data) ? data : []) as ZoneStats[]
    },
  })

  // Recent activity (Overview tab)
  const { data: recentActivity } = useQuery({
    queryKey: ['compliance-recent-activity', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = (supabase.from('observations') as any)
        .select(`observation_id, plate_number, recorded_at, zones:zone_id(name)`)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)
      if (zoneId) query = query.eq('zone_id', zoneId)
      if (startDate) query = query.gte('recorded_at', startDate)
      if (endDate) query = query.lte('recorded_at', endDate)

      const { data } = await query
      return (data || []).map((obs: any) => ({
        id: obs.observation_id,
        type: 'observation' as const,
        plate_number: obs.plate_number,
        zone_name: obs.zones?.name || 'Unknown Zone',
        created_at: obs.recorded_at,
        status: 'recorded',
      }))
    },
  })

  // Breach observations (Observations tab)
  const { data: breachObservations, isLoading: breachLoading, refetch: refetchBreaches } = useQuery({
    queryKey: ['compliance-breaches', effectiveOrganizationId, zoneId, dateFrom, dateTo, searchTerm, currentPage],
    queryFn: async () => {
      let query = (supabase.from('observations') as any)
        .select(`
          observation_id,
          plate_number,
          recorded_at,
          breach_type,
          breach_reason,
          zones:zone_id(name),
          organizations:organization_id(name)
        `)
        .eq('is_compliant', false)
        .order('recorded_at', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1)

      if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)
      if (zoneId) query = query.eq('zone_id', zoneId)
      if (startDate) query = query.gte('recorded_at', startDate)
      if (endDate) query = query.lte('recorded_at', endDate)
      if (searchTerm) query = query.ilike('plate_number', `%${searchTerm}%`)

      const { data, error } = await query
      if (error) throw error
      return (data || []).map((obs: any) => ({
        id: obs.observation_id,
        plate_number: obs.plate_number,
        recorded_at: obs.recorded_at,
        breach_type: obs.breach_type,
        breach_reason: obs.breach_reason,
        zones: obs.zones,
        organizations: obs.organizations,
      })) as BreachObservation[]
    },
  })

  // Analytics data (Analytics tab)
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['compliance-analytics', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const start = startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end = endDate ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_compliance_analytics_summary', {
        p_start: start,
        p_end: end,
        p_organization_id: effectiveOrganizationId ?? null,
        p_zone_id: zoneId ?? null,
      })
      if (error) throw error
      return data as {
        metrics: ComplianceMetrics
        breach_types: { name: string; value: number }[]
        zone_compliance: { zone: string; total: number; compliant: number; rate: number }[]
        daily_trend: { date: string; total: number; compliant: number; breaches: number }[]
      }
    },
    enabled: activeTab === 'analytics',
  })

  const jurisdictionZones = zoneBreakdown.filter(z => z.parent_zone_id === null)
  const specificZones = zoneBreakdown.filter(z => z.parent_zone_id !== null)

  // Bob photo analysis handler
  const handleAnalyzeRecentPhotos = async () => {
    setAnalyzingPhotos(true)
    try {
      let query = (supabase.from('observations') as any)
        .select('observation_id, photo_url, plate_number')
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)

      const { data: observations, error } = await query
      if (error) throw error
      if (!observations || observations.length === 0) {
        toast.error('No recent photos to analyse')
        return
      }

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

  // ============================================================================
  // Auth Check - MUST be after all hooks
  // ============================================================================
  
  if (authLoading) return <PaperworkSearchAnimation text="Checking authentication…" />
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <AppLayout
      title="Compliance"
      description="Unified compliance monitoring, breach observations, and analytics"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* ── Sticky quick-action bar — primary actions above the fold ── */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-3 text-sm">
          {stats && (
            <>
              <span className="flex items-center gap-1 font-semibold">
                <Activity className="h-4 w-4 text-blue-500" />
                {stats.total_observations} obs
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="flex items-center gap-1 text-green-600 font-semibold">
                <CheckCircle className="h-4 w-4" />
                {stats.compliance_rate.toFixed(0)}% compliant
              </span>
              {(stats.total_observations - stats.compliant_observations) > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="flex items-center gap-1 text-red-600 font-semibold">
                    <AlertTriangle className="h-4 w-4" />
                    {stats.total_observations - stats.compliant_observations} breaches
                  </span>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setActiveTab('analytics')} className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Analytics
          </Button>
          <Button size="sm" onClick={() => setActiveTab('observations')} className="gap-1.5">
            <Eye className="h-3.5 w-3.5" /> View Observations
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="observations" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Observations
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* ================================================================== */}
        {/* OVERVIEW TAB                                                       */}
        {/* ================================================================== */}
        <TabsContent value="overview">
          <AsyncStateWrapper isLoading={statsLoading} loadingText="Loading compliance data…">
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

              {/* Zone Compliance Breakdown */}
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
                              <p className="text-center text-sm text-muted-foreground py-6">
                                No {tab} zones found
                              </p>
                            ) : (
                              rows.map(z => (
                                <div
                                  key={z.zone_id}
                                  className={cn(
                                    'flex items-center justify-between p-3 rounded-lg border',
                                    z.is_active
                                      ? 'bg-white dark:bg-gray-900 border-gray-200'
                                      : 'bg-gray-50 dark:bg-gray-800 border-gray-100 opacity-60'
                                  )}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
                                    <div className="min-w-0">
                                      <p className="font-medium truncate">{z.zone_name}</p>
                                      <p className="text-xs text-muted-foreground">{z.organization_name}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-xs text-muted-foreground">
                                      {z.obs_count} obs · {z.breach_count} breaches
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        'text-xs',
                                        z.compliance_pct >= 80 && 'bg-green-50 text-green-700 border-green-300',
                                        z.compliance_pct >= 50 && z.compliance_pct < 80 && 'bg-yellow-50 text-yellow-700 border-yellow-300',
                                        z.compliance_pct < 50 && 'bg-red-50 text-red-700 border-red-300'
                                      )}
                                    >
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
                    <Button onClick={handleAnalyzeRecentPhotos} disabled={analyzingPhotos} size="sm">
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
                      <div><span className="font-medium">Plate:</span> {analysisResults.plate_number}</div>
                      {analysisResults.detection && (
                        <div><span className="font-medium">Vehicles Detected:</span> {analysisResults.detection.vehicle_count}</div>
                      )}
                      {analysisResults.embedding && (
                        <div><span className="font-medium">Embedding Quality:</span> {(analysisResults.embedding.embedding_quality * 100).toFixed(1)}%</div>
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
                      {recentActivity.map((activity: any) => (
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
                            <p className="text-xs text-gray-500 mt-1">{formatDateTime(activity.created_at)}</p>
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
          </AsyncStateWrapper>
        </TabsContent>
        {/* ================================================================== */}
        <TabsContent value="observations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    Breach Observations
                  </CardTitle>
                  <CardDescription>Non-compliant vehicle observations</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                      placeholder="Search plate..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value)
                        setCurrentPage(1)
                      }}
                      className="pl-9 w-48"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchBreaches()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <AsyncStateWrapper
                isLoading={breachLoading}
                isEmpty={!breachObservations || breachObservations.length === 0}
                loadingText="Loading breach observations…"
                emptyIcon={<CheckCircle className="h-12 w-12 text-green-500" />}
                emptyTitle="No breach observations found"
                emptyDescription="All observations are compliant for the selected filters"
                onRetry={() => refetchBreaches()}
              >
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Plate</TableHead>
                          <TableHead>Date/Time</TableHead>
                          <TableHead>Zone</TableHead>
                          <TableHead>Breach Type</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {breachObservations.map((obs) => (
                          <TableRow key={obs.id}>
                            <TableCell className="font-mono font-medium">
                              {obs.plate_number || '—'}
                            </TableCell>
                            <TableCell className="text-sm text-gray-600">
                              {formatDateTime(obs.recorded_at)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {obs.zones?.name || '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="destructive" className="text-xs">
                                {obs.breach_type || 'Unknown'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-gray-600 max-w-xs truncate">
                              {obs.breach_reason || '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-600">Page {currentPage}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => p + 1)}
                      disabled={breachObservations.length < pageSize}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </>
              </AsyncStateWrapper>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================== */}
        {/* ANALYTICS TAB                                                      */}
        {/* ================================================================== */}
        <TabsContent value="analytics">
          <AsyncStateWrapper isLoading={analyticsLoading} loadingText="Loading analytics…">
            <>
              {/* Metrics Cards */}
              {analytics?.metrics && (
                <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7 mb-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Total Observations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{analytics.metrics.total_observations}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Compliant
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">{analytics.metrics.compliant}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Non-Compliant
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">{analytics.metrics.non_compliant}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-blue-600">Compliance Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-600 flex items-center gap-1">
                        {analytics.metrics.compliance_rate.toFixed(1)}%
                        {analytics.metrics.compliance_rate >= 90 ? (
                          <TrendingUp className="h-5 w-5 text-green-600" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-red-600" />
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-purple-600">Total Vehicles</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-purple-600">{analytics.metrics.total_vehicles}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-orange-600">Avg Nights/Vehicle</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-orange-600">
                        {analytics.metrics.avg_nights_per_vehicle.toFixed(1)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-red-600">Repeat Offenders</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">{analytics.metrics.repeat_offenders}</div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* View Mode Selector */}
              <div className="flex gap-2 mb-6">
                <Button
                  variant={analyticsViewMode === 'overview' ? 'default' : 'outline'}
                  onClick={() => setAnalyticsViewMode('overview')}
                  size="sm"
                >
                  Overview
                </Button>
                <Button
                  variant={analyticsViewMode === 'trends' ? 'default' : 'outline'}
                  onClick={() => setAnalyticsViewMode('trends')}
                  size="sm"
                >
                  Trends
                </Button>
                <Button
                  variant={analyticsViewMode === 'zones' ? 'default' : 'outline'}
                  onClick={() => setAnalyticsViewMode('zones')}
                  size="sm"
                >
                  Zones
                </Button>
              </div>

              {/* Overview Charts */}
              {analyticsViewMode === 'overview' && (
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Breach Types Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Breach Types Distribution</CardTitle>
                      <CardDescription>Breakdown of non-compliant observations by breach type</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {analytics?.breach_types && analytics.breach_types.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={analytics.breach_types}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                              outerRadius={100}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {analytics.breach_types.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center py-12 text-gray-500">No breach data available</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Compliance Bar Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Compliance Overview</CardTitle>
                      <CardDescription>Total compliant vs non-compliant observations</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {analytics?.metrics && (
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart
                            data={[
                              { name: 'Compliant', value: analytics.metrics.compliant, fill: '#10b981' },
                              { name: 'Non-Compliant', value: analytics.metrics.non_compliant, fill: '#ef4444' },
                            ]}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="value" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Trends View */}
              {analyticsViewMode === 'trends' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Daily Compliance Trend</CardTitle>
                    <CardDescription>Observations, compliant, and breaches over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics?.daily_trend && analytics.daily_trend.length > 0 ? (
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={analytics.daily_trend}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="total" stroke="#3b82f6" name="Total" />
                          <Line type="monotone" dataKey="compliant" stroke="#10b981" name="Compliant" />
                          <Line type="monotone" dataKey="breaches" stroke="#ef4444" name="Breaches" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-12 text-gray-500">No trend data available</div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Zone Comparison */}
              {analyticsViewMode === 'zones' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Zone Compliance Comparison</CardTitle>
                    <CardDescription>Compliance rates across all zones</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analytics?.zone_compliance && analytics.zone_compliance.length > 0 ? (
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={analytics.zone_compliance}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="zone" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="compliant" fill="#10b981" name="Compliant" />
                          <Bar dataKey="total" fill="#3b82f6" name="Total" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-12 text-gray-500">No zone data available</div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Export Actions */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Export Analytics</CardTitle>
                  <CardDescription>Download analytics reports</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!analytics) {
                          toast.error('No data to export')
                          return
                        }
                        const rows: Record<string, any>[] = []
                        if (analytics.zone_compliance) {
                          analytics.zone_compliance.forEach(z =>
                            rows.push({
                              zone: z.zone,
                              total_observations: z.total,
                              compliant: z.compliant,
                              compliance_rate: `${z.rate}%`,
                            })
                          )
                        }
                        if (analytics.breach_types) {
                          analytics.breach_types.forEach(b =>
                            rows.push({
                              zone: `[Breach Type] ${b.name}`,
                              total_observations: b.value,
                              compliant: '',
                              compliance_rate: '',
                            })
                          )
                        }
                        const csv = arrayToCSV(rows, [
                          { key: 'zone', label: 'Zone / Category' },
                          { key: 'total_observations', label: 'Total' },
                          { key: 'compliant', label: 'Compliant' },
                          { key: 'compliance_rate', label: 'Rate' },
                        ])
                        downloadCSV(csv, `compliance-analytics-${new Date().toISOString().slice(0, 10)}.csv`)
                        toast.success('CSV downloaded')
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export CSV
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!analytics?.metrics) {
                          toast.error('No data to export')
                          return
                        }
                        const config: PDFReportConfig = {
                          title: 'Compliance Analytics Report',
                          subtitle: 'Freedom Camping Compliance Analysis',
                          organizationName: effectiveOrganizationId ? 'Organisation Report' : 'All Organisations',
                          generatedBy: user?.email || 'System',
                          generatedAt: new Date(),
                        }
                        const sections: PDFSection[] = [
                          {
                            heading: 'Key Metrics',
                            content: [
                              `Total Observations: ${analytics.metrics.total_observations}`,
                              `Compliant: ${analytics.metrics.compliant}`,
                              `Non-Compliant: ${analytics.metrics.non_compliant}`,
                              `Compliance Rate: ${analytics.metrics.compliance_rate.toFixed(1)}%`,
                              `Total Vehicles: ${analytics.metrics.total_vehicles}`,
                              `Avg Nights/Vehicle: ${analytics.metrics.avg_nights_per_vehicle.toFixed(1)}`,
                              `Repeat Offenders: ${analytics.metrics.repeat_offenders}`,
                            ],
                            type: 'list',
                          },
                        ]
                        if (analytics.breach_types && analytics.breach_types.length > 0) {
                          sections.push({
                            heading: 'Breach Types',
                            content: analytics.breach_types.map(b => ({ type: b.name, count: b.value })),
                            type: 'table',
                          })
                        }
                        if (analytics.zone_compliance && analytics.zone_compliance.length > 0) {
                          sections.push({
                            heading: 'Zone Compliance',
                            content: analytics.zone_compliance.map(z => ({
                              zone: z.zone,
                              total: z.total,
                              compliant: z.compliant,
                              rate: `${z.rate}%`,
                            })),
                            type: 'table',
                          })
                        }
                        try {
                          exportReportPDF(config, sections)
                          toast.success('PDF report opened for printing')
                        } catch (err: any) {
                          toast.error(err.message || 'Failed to generate PDF')
                        }
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export PDF Report
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          </AsyncStateWrapper>
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
