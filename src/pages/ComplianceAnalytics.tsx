import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Database } from '@/types/database'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  MapPin,
  Calendar,
  Download
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'

type Observation = Database['public']['Tables']['observations']['Row']

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899']

interface ComplianceMetrics {
  total_observations: number
  compliant: number
  non_compliant: number
  compliance_rate: number
  avg_nights_per_vehicle: number
  total_vehicles: number
  repeat_offenders: number
}

export default function ComplianceAnalytics() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [viewMode, setViewMode] = useState<'overview' | 'trends' | 'zones'>('overview')

  // Fetch compliance metrics
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['compliance-metrics', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select('*')
        .is('deleted_at', null)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (dateFrom) {
        query = query.gte('recorded_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('recorded_at', dateTo)
      }

      const { data: observations, error } = await query

      if (error) throw error

      const obsData = observations as Observation[] | null
      const total = obsData?.length || 0
      const compliant = obsData?.filter(o => o.is_compliant).length || 0
      const nonCompliant = total - compliant
      const uniqueVehicles = new Set(obsData?.map(o => o.plate_number)).size

      // Calculate average nights per vehicle
      const vehicleNights = obsData?.reduce((acc: Record<string, number>, obs) => {
        const plate = obs.plate_number
        acc[plate] = (acc[plate] || 0) + 1
        return acc
      }, {}) || {}

      const avgNights = uniqueVehicles > 0 
        ? Object.values(vehicleNights).reduce((sum: number, count: number) => sum + count, 0) / uniqueVehicles
        : 0

      // Find repeat offenders (vehicles with multiple non-compliant observations)
      const offenders = obsData?.filter(o => !o.is_compliant) || []
      const offenderCounts = offenders.reduce((acc: Record<string, number>, obs) => {
        const plate = obs.plate_number
        acc[plate] = (acc[plate] || 0) + 1
        return acc
      }, {})
      const repeatOffenders = Object.values(offenderCounts).filter(count => count > 1).length

      return {
        total_observations: total,
        compliant,
        non_compliant: nonCompliant,
        compliance_rate: total > 0 ? (compliant / total) * 100 : 0,
        avg_nights_per_vehicle: avgNights,
        total_vehicles: uniqueVehicles,
        repeat_offenders: repeatOffenders,
      } as ComplianceMetrics
    },
  })

  // Fetch breach types breakdown
  const { data: breachTypes } = useQuery({
    queryKey: ['breach-types', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select('breach_type')
        .eq('is_compliant', false)
        .is('deleted_at', null)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (dateFrom) {
        query = query.gte('recorded_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('recorded_at', dateTo)
      }

      const { data, error } = await query
      if (error) throw error

      const breachData = data as Pick<Observation, 'breach_type'>[] | null
      // Count breach types
      const counts = (breachData || []).reduce((acc: Record<string, number>, obs) => {
        const type = obs.breach_type || 'unknown'
        acc[type] = (acc[type] || 0) + 1
        return acc
      }, {})

      return Object.entries(counts).map(([name, value]) => ({
        name: name.replace(/_/g, ' '),
        value,
      }))
    },
  })

  // Fetch zone-level compliance
  const { data: zoneCompliance } = useQuery({
    queryKey: ['zone-compliance', organizationId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select('zone_id, is_compliant, zones(name)')
        .is('deleted_at', null)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (dateFrom) {
        query = query.gte('recorded_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('recorded_at', dateTo)
      }

      const { data, error } = await query
      if (error) throw error

      // Group by zone
      const zoneData = (data || []).reduce((acc: Record<string, any>, obs: any) => {
        const zoneName = obs.zones?.name || 'Unknown'
        if (!acc[zoneName]) {
          acc[zoneName] = { total: 0, compliant: 0 }
        }
        acc[zoneName].total++
        if (obs.is_compliant) {
          acc[zoneName].compliant++
        }
        return acc
      }, {})

      return Object.entries(zoneData).map(([name, stats]: [string, any]) => ({
        zone: name,
        total: stats.total,
        compliant: stats.compliant,
        rate: stats.total > 0 ? (stats.compliant / stats.total) * 100 : 0,
      }))
    },
  })

  // Fetch daily trend
  const { data: dailyTrend } = useQuery({
    queryKey: ['daily-trend', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select('recorded_at, is_compliant')
        .is('deleted_at', null)
        .order('recorded_at', { ascending: true })

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (dateFrom) {
        query = query.gte('recorded_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('recorded_at', dateTo)
      }

      const { data, error } = await query
      if (error) throw error

      const trendData = data as Pick<Observation, 'recorded_at' | 'is_compliant'>[] | null
      // Group by day
      const dailyData = (trendData || []).reduce((acc: Record<string, any>, obs) => {
        const day = formatDate(obs.recorded_at)
        if (!acc[day]) {
          acc[day] = { date: day, total: 0, compliant: 0, breaches: 0 }
        }
        acc[day].total++
        if (obs.is_compliant) {
          acc[day].compliant++
        } else {
          acc[day].breaches++
        }
        return acc
      }, {})

      return Object.values(dailyData).slice(-30) // Last 30 days
    },
  })

  return (
    <AppLayout
      title="Compliance Analytics"
      description="Deep compliance analysis with visualizations"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Observations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.total_observations}</div>
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
              <div className="text-2xl font-bold text-green-600">{metrics.compliant}</div>
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
              <div className="text-2xl font-bold text-red-600">{metrics.non_compliant}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600">Compliance Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 flex items-center gap-1">
                {metrics.compliance_rate.toFixed(1)}%
                {metrics.compliance_rate >= 90 ? (
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
              <div className="text-2xl font-bold text-purple-600">{metrics.total_vehicles}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600">Avg Nights/Vehicle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {metrics.avg_nights_per_vehicle.toFixed(1)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600">Repeat Offenders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{metrics.repeat_offenders}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Mode Selector */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={viewMode === 'overview' ? 'default' : 'outline'}
          onClick={() => setViewMode('overview')}
          size="sm"
        >
          Overview
        </Button>
        <Button
          variant={viewMode === 'trends' ? 'default' : 'outline'}
          onClick={() => setViewMode('trends')}
          size="sm"
        >
          Trends
        </Button>
        <Button
          variant={viewMode === 'zones' ? 'default' : 'outline'}
          onClick={() => setViewMode('zones')}
          size="sm"
        >
          Zones
        </Button>
      </div>

      {/* Overview Charts */}
      {viewMode === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Breach Types Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Breach Types Distribution</CardTitle>
              <CardDescription>Breakdown of non-compliant observations by breach type</CardDescription>
            </CardHeader>
            <CardContent>
              {breachTypes && breachTypes.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={breachTypes}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {breachTypes.map((_, index) => (
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

          {/* Compliance vs Non-Compliance Bar */}
          <Card>
            <CardHeader>
              <CardTitle>Compliance Overview</CardTitle>
              <CardDescription>Total compliant vs non-compliant observations</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics && (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={[
                      { name: 'Compliant', value: metrics.compliant, fill: '#10b981' },
                      { name: 'Non-Compliant', value: metrics.non_compliant, fill: '#ef4444' },
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
      {viewMode === 'trends' && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Compliance Trend (Last 30 Days)</CardTitle>
            <CardDescription>Observations, compliant, and breaches over time</CardDescription>
          </CardHeader>
          <CardContent>
            {dailyTrend && dailyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={dailyTrend}>
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
      {viewMode === 'zones' && (
        <Card>
          <CardHeader>
            <CardTitle>Zone Compliance Comparison</CardTitle>
            <CardDescription>Compliance rates across all zones</CardDescription>
          </CardHeader>
          <CardContent>
            {zoneCompliance && zoneCompliance.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={zoneCompliance}>
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
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export PDF Report
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export Charts
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
