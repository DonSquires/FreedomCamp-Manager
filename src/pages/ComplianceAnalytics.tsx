import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
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
import { toast } from 'sonner'
import { arrayToCSV, downloadCSV } from '@/lib/csvExport'
import { exportReportPDF } from '@/lib/pdfExport'
import type { PDFReportConfig, PDFSection } from '@/lib/pdfExport'

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
  const effectiveOrganizationId =
    (user?.role === 'master' || user?.role === 'grand_master') ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [viewMode, setViewMode] = useState<'overview' | 'trends' | 'zones'>('overview')

  // Single RPC call – server computes all metrics, breakdowns, and trend data.
  const { data: analytics, isLoading: metricsLoading } = useQuery({
    queryKey: ['compliance-analytics', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const start = startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end   = endDate   ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_compliance_analytics_summary', {
        p_start:            start,
        p_end:              end,
        p_organization_id:  effectiveOrganizationId ?? null,
        p_zone_id:          zoneId ?? null,
      })
      if (error) throw error
      return data as {
        metrics: ComplianceMetrics
        breach_types: { name: string; value: number }[]
        zone_compliance: { zone: string; total: number; compliant: number; rate: number }[]
        daily_trend: { date: string; total: number; compliant: number; breaches: number }[]
      }
    },
  })

  const metrics     = analytics?.metrics
  const breachTypes = analytics?.breach_types
  const zoneCompliance = analytics?.zone_compliance
  const dailyTrend  = analytics?.daily_trend

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
            <Button variant="outline" onClick={() => {
              if (!analytics) { toast.error('No data to export'); return }
              const rows: Record<string, any>[] = []
              if (zoneCompliance) {
                zoneCompliance.forEach(z => rows.push({
                  zone: z.zone,
                  total_observations: z.total,
                  compliant: z.compliant,
                  compliance_rate: `${z.rate}%`,
                }))
              }
              if (breachTypes) {
                breachTypes.forEach(b => rows.push({
                  zone: `[Breach Type] ${b.name}`,
                  total_observations: b.value,
                  compliant: '',
                  compliance_rate: '',
                }))
              }
              const csv = arrayToCSV(rows, [
                { key: 'zone', label: 'Zone / Category' },
                { key: 'total_observations', label: 'Total' },
                { key: 'compliant', label: 'Compliant' },
                { key: 'compliance_rate', label: 'Rate' },
              ])
              downloadCSV(csv, `compliance-analytics-${new Date().toISOString().slice(0, 10)}.csv`)
              toast.success('CSV downloaded')
            }}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => {
              if (!metrics) { toast.error('No data to export'); return }
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
                    `Total Observations: ${metrics.total_observations}`,
                    `Compliant: ${metrics.compliant}`,
                    `Non-Compliant: ${metrics.non_compliant}`,
                    `Compliance Rate: ${metrics.compliance_rate.toFixed(1)}%`,
                    `Total Vehicles: ${metrics.total_vehicles}`,
                    `Avg Nights/Vehicle: ${metrics.avg_nights_per_vehicle.toFixed(1)}`,
                    `Repeat Offenders: ${metrics.repeat_offenders}`,
                  ],
                  type: 'list',
                },
              ]
              if (breachTypes && breachTypes.length > 0) {
                sections.push({
                  heading: 'Breach Types',
                  content: breachTypes.map(b => ({ type: b.name, count: b.value })),
                  type: 'table',
                })
              }
              if (zoneCompliance && zoneCompliance.length > 0) {
                sections.push({
                  heading: 'Zone Compliance',
                  content: zoneCompliance.map(z => ({
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
            }}>
              <Download className="h-4 w-4 mr-2" />
              Export PDF Report
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
