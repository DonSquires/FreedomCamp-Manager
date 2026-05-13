/**
 * Dashboard - Consolidated KPI landing page for FieldOps Manager
 *
 * Renders role-based tabs with KPI cards, live patrol monitor,
 * compliance status, and officer welfare alerts.
 */

import { useAuthStore } from '@/stores/authStore'
import { useDashboardKPIs, useLivePatrols, useComplianceStatus, useOfficerWelfare } from './hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function Dashboard() {
  const { user } = useAuthStore()
  const { data: kpis, isLoading: kpisLoading } = useDashboardKPIs()
  const { data: livePatrols, isLoading: patrolsLoading } = useLivePatrols()
  const { data: compliance, isLoading: complianceLoading } = useComplianceStatus()
  const { data: welfare, isLoading: welfareLoading } = useOfficerWelfare()

  const isLoading = kpisLoading || patrolsLoading || complianceLoading || welfareLoading

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here's your operational overview.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis?.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
              {kpi.change !== undefined && kpi.change !== 0 && (
                <div className="text-xs mt-1">
                  <Badge
                    variant={kpi.trend === 'up' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {kpi.trend === 'up' ? '↑' : '↓'} {Math.abs(kpi.change)}%
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="operations" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="patrols">Live Patrols</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        {/* Operations Tab */}
        <TabsContent value="operations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Zone Coverage</CardTitle>
              <CardDescription>Active zone monitoring status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Zones Enabled</p>
                  <p className="text-2xl font-bold">24</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Patrols</p>
                  <p className="text-2xl font-bold">{kpis?.[0]?.value || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Live Patrols Tab */}
        <TabsContent value="patrols" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Patrols</CardTitle>
              <CardDescription>Currently active patrols</CardDescription>
            </CardHeader>
            <CardContent>
              {patrolsLoading ? (
                <p className="text-muted-foreground">Loading patrols...</p>
              ) : livePatrols && livePatrols.length > 0 ? (
                <div className="space-y-2">
                  {livePatrols.map((patrol: any) => (
                    <div key={patrol.id} className="flex items-center justify-between p-2 border rounded">
                      <div>
                        <p className="font-medium">{patrol.user_profiles?.full_name || 'Unassigned'}</p>
                        <p className="text-sm text-muted-foreground">{patrol.zones?.name || 'No Zone'}</p>
                      </div>
                      <Badge>Active</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No active patrols</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance Tab */}
        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Status</CardTitle>
              <CardDescription>Zone compliance metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Compliance Rate</p>
                  <p className="text-2xl font-bold">{compliance?.compliance_rate || 0}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Breaches (30d)</p>
                  <p className="text-2xl font-bold">{compliance?.breaches_this_month || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default Dashboard
