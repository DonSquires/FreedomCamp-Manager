import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/features/StatCard'
import { FileText, Download, TrendingUp, Users, MapPin, AlertCircle, Clock, CheckCircle } from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

export default function Reports() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [generatingReport, setGeneratingReport] = useState<string | null>(null)

  // Fetch report statistics
  const { data: stats, isLoading } = useQuery({
    queryKey: ['report-stats', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      // Get observation count
      let obsQuery = supabase
        .from('observations')
        .select('id, is_compliant', { count: 'exact' })
        .is('deleted_at', null)

      if (user?.role !== 'master' && user?.organization_id) {
        obsQuery = obsQuery.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        obsQuery = obsQuery.eq('organization_id', organizationId)
      }

      if (dateFrom) {
        obsQuery = obsQuery.gte('recorded_at', dateFrom)
      }
      if (dateTo) {
        obsQuery = obsQuery.lte('recorded_at', dateTo)
      }
      if (zoneId) {
        obsQuery = obsQuery.eq('zone_id', zoneId)
      }

      const { data: observations, count: observationCount } = await obsQuery

      const compliantCount = observations?.filter(o => o.is_compliant).length || 0
      const complianceRate = observationCount && observationCount > 0 
        ? (compliantCount / observationCount) * 100 
        : 0

      // Get enforcement count
      let enforcementQuery = supabase
        .from('enforcement_actions')
        .select('id', { count: 'exact', head: true })

      if (user?.role !== 'master' && user?.organization_id) {
        enforcementQuery = enforcementQuery.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        enforcementQuery = enforcementQuery.eq('organization_id', organizationId)
      }

      if (dateFrom) {
        enforcementQuery = enforcementQuery.gte('created_at', dateFrom)
      }
      if (dateTo) {
        enforcementQuery = enforcementQuery.lte('created_at', dateTo)
      }

      const { count: enforcementCount } = await enforcementQuery

      // Get zone count
      let zoneQuery = supabase
        .from('zones')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)

      if (user?.role !== 'master' && user?.organization_id) {
        zoneQuery = zoneQuery.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        zoneQuery = zoneQuery.eq('organization_id', organizationId)
      }

      const { count: zoneCount } = await zoneQuery

      return {
        observations: observationCount || 0,
        enforcement: enforcementCount || 0,
        compliance_rate: complianceRate,
        zones: zoneCount || 0,
      }
    },
  })

  // Generate report mutation
  const generateReportMutation = useMutation({
    mutationFn: async (reportType: string) => {
      setGeneratingReport(reportType)
      
      // Call edge function to generate PDF
      const { data, error } = await supabase.functions.invoke('generate-dashboard-report', {
        body: {
          report_type: reportType,
          organization_id: organizationId || user?.organization_id,
          zone_id: zoneId,
          start_date: dateFrom,
          end_date: dateTo,
        },
      })

      // Better error handling with detailed messages
      if (error) {
        let errorMessage = error.message
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500
            const textContent = await error.context?.text()
            errorMessage = `[${statusCode}] ${textContent || error.message || 'Unknown error'}`
          } catch {
            errorMessage = error.message || 'Failed to read response'
          }
        }
        throw new Error(errorMessage)
      }
      return data
    },
    onSuccess: (data, reportType) => {
      toast.success(`${reportType} report generated successfully`)
      
      // Download the PDF if URL is returned
      if (data?.url) {
        window.open(data.url, '_blank')
      }
      
      setGeneratingReport(null)
    },
    onError: (error: any, reportType) => {
      toast.error(`Failed to generate ${reportType} report: ${error.message}`)
      setGeneratingReport(null)
    },
  })

  const handleGenerateReport = (reportType: string) => {
    generateReportMutation.mutate(reportType)
  }

  return (
    <AppLayout title="Reports" description="Generate compliance and enforcement reports" showBackButton>
      <GlobalFilterRibbon />

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
          value={`${stats?.compliance_rate?.toFixed(1) || 0}%`}
          icon={CheckCircle}
          variant={stats?.compliance_rate && stats.compliance_rate > 80 ? 'success' : 'warning'}
        />
        <StatCard
          title="Active Zones"
          value={stats?.zones || 0}
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
              disabled={generatingReport === 'compliance'}
            >
              {generatingReport === 'compliance' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
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
              disabled={generatingReport === 'enforcement'}
            >
              {generatingReport === 'enforcement' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
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
              disabled={generatingReport === 'vehicle-activity'}
            >
              {generatingReport === 'vehicle-activity' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
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
              disabled={generatingReport === 'zone-stats'}
            >
              {generatingReport === 'zone-stats' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
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
