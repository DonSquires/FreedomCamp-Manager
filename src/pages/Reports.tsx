import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/features/StatCard'
import { FileText, Download, TrendingUp, Users, MapPin, AlertCircle } from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'

export default function Reports() {
  const { user } = useAuthStore()
  const { dateRange, organizationId, zoneId } = useGlobalFiltersStore()

  // Fetch report statistics
  const { data: stats, isLoading } = useQuery({
    queryKey: ['report-stats', dateRange, organizationId, zoneId],
    queryFn: async () => {
      // Get compliance statistics
      const { data: complianceData } = await supabase.rpc('get_compliance_statistics', {
        start_date: dateRange.from?.toISOString(),
        end_date: dateRange.to?.toISOString(),
        org_id: organizationId,
        zone_id: zoneId,
      })

      // Get observation count
      let obsQuery = supabase
        .from('observations')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)

      if (dateRange.from) {
        obsQuery = obsQuery.gte('recorded_at', dateRange.from.toISOString())
      }
      if (dateRange.to) {
        obsQuery = obsQuery.lte('recorded_at', dateRange.to.toISOString())
      }
      if (organizationId) {
        obsQuery = obsQuery.eq('organization_id', organizationId)
      }
      if (zoneId) {
        obsQuery = obsQuery.eq('zone_id', zoneId)
      }

      const { count: observationCount } = await obsQuery

      // Get enforcement count
      let enforcementQuery = supabase
        .from('enforcement_actions')
        .select('id', { count: 'exact', head: true })

      if (dateRange.from) {
        enforcementQuery = enforcementQuery.gte('recorded_at', dateRange.from.toISOString())
      }
      if (dateRange.to) {
        enforcementQuery = enforcementQuery.lte('recorded_at', dateRange.to.toISOString())
      }
      if (organizationId) {
        enforcementQuery = enforcementQuery.eq('organization_id', organizationId)
      }

      const { count: enforcementCount } = await enforcementQuery

      return {
        observations: observationCount || 0,
        enforcement: enforcementCount || 0,
        compliance: complianceData || {},
      }
    },
  })

  // Generate report mutation (placeholder)
  const handleGenerateReport = (reportType: string) => {
    console.log('Generating report:', reportType)
    // This would call an edge function to generate the report
  }

  return (
    <AppLayout title="Reports" description="Generate compliance and enforcement reports" showBackButton>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Observations"
          value={stats?.observations || 0}
          icon={TrendingUp}
          description="in selected period"
        />
        <StatCard
          title="Enforcement Actions"
          value={stats?.enforcement || 0}
          icon={AlertCircle}
          description="warnings & notices"
        />
        <StatCard
          title="Compliance Rate"
          value={stats?.compliance?.rate ? `${stats.compliance.rate}%` : '0%'}
          icon={Users}
          variant={stats?.compliance?.rate > 80 ? 'success' : 'warning'}
        />
        <StatCard
          title="Active Zones"
          value={stats?.compliance?.zones || 0}
          icon={MapPin}
          description="monitored zones"
        />
      </div>

      {/* Report Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Compliance Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <FileText className="h-8 w-8 text-blue-600 mb-2" />
            <CardTitle>Compliance Report</CardTitle>
            <CardDescription>
              Detailed compliance statistics and trends
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Compliance rate by zone</li>
              <li>• Breach type breakdown</li>
              <li>• Monthly trends</li>
              <li>• Top violators</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('compliance')}
              className="w-full"
              disabled
            >
              <Download className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </CardContent>
        </Card>

        {/* Enforcement Activity Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <AlertCircle className="h-8 w-8 text-orange-600 mb-2" />
            <CardTitle>Enforcement Activity</CardTitle>
            <CardDescription>
              Warnings, notices, and enforcement actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Actions by type</li>
              <li>• Officer activity</li>
              <li>• Resolution rates</li>
              <li>• Timeline view</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('enforcement')}
              className="w-full"
              disabled
            >
              <Download className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </CardContent>
        </Card>

        {/* Vehicle Activity Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <Users className="h-8 w-8 text-green-600 mb-2" />
            <CardTitle>Vehicle Activity</CardTitle>
            <CardDescription>
              Vehicle observations and patterns
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Most frequent vehicles</li>
              <li>• Stay duration analysis</li>
              <li>• Zone preferences</li>
              <li>• Seasonal patterns</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('vehicle-activity')}
              className="w-full"
              disabled
            >
              <Download className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </CardContent>
        </Card>

        {/* Zone Statistics Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <MapPin className="h-8 w-8 text-purple-600 mb-2" />
            <CardTitle>Zone Statistics</CardTitle>
            <CardDescription>
              Zone-specific metrics and insights
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Observations per zone</li>
              <li>• Peak usage times</li>
              <li>• Compliance by zone</li>
              <li>• Capacity analysis</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('zone-stats')}
              className="w-full"
              disabled
            >
              <Download className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Report History (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Reports</CardTitle>
          <CardDescription>
            Previously generated reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-600">
            No reports generated yet
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
