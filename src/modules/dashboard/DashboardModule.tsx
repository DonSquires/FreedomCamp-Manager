/**
 * Dashboard Module
 * 
 * Home page consolidation for Dashboard Hub.
 * Unifies AdminHub, FieldOfficerPortal, ComplianceDashboard, LivePatrolMonitor into single view.
 */

import { useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useOrganization } from '@/hooks/useOrganization'
import { ModuleLayout, RoleBasedVisibility } from '@/modules/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Grid3x3, Users, AlertCircle, TrendingUp } from 'lucide-react'

export default function DashboardModule() {
  const { role, user } = useAuthStore()
  const { organization } = useOrganization()

  // Show different dashboard based on role
  const dashboardTitle = useMemo(() => {
    switch (role) {
      case 'admin':
      case 'master':
        return 'Admin Dashboard'
      case 'officer':
        return 'Officer Dashboard'
      case 'admin_officer':
        return 'Officer & Admin Dashboard'
      default:
        return 'Dashboard'
    }
  }, [role])

  return (
    <ModuleLayout
      title={dashboardTitle}
      description={`Welcome back, ${user?.user_metadata?.first_name || user?.email}. Here's your operational overview for ${organization?.name || 'your organization'}.`}
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Quick stat cards */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Patrols</CardTitle>
            <Users className="w-4 h-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-gray-600">+2 from yesterday</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Breaches</CardTitle>
            <AlertCircle className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <p className="text-xs text-gray-600">Require action</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
            <TrendingUp className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">94%</div>
            <p className="text-xs text-gray-600">+2% this month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Zones</CardTitle>
            <Grid3x3 className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24</div>
            <p className="text-xs text-gray-600">Active monitoring</p>
          </CardContent>
        </Card>
      </div>

      {/* Operations Map (when implemented) */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Operations Map</CardTitle>
          <CardDescription>Live patrol locations and zone activity</CardDescription>
        </CardHeader>
        <CardContent className="h-96 bg-gray-100 rounded flex items-center justify-center">
          <div className="text-center text-gray-500">
            <p>Map view — Coming soon</p>
            <p className="text-xs">Integration with LivePatrolMonitor data</p>
          </div>
        </CardContent>
      </Card>

      {/* Role-specific sections */}
      <RoleBasedVisibility requiredRoles={['admin', 'admin_officer', 'master']}>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Admin Quick Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="p-3 border rounded hover:bg-gray-50 cursor-pointer">
                <p className="text-sm font-medium">Organization Settings</p>
                <p className="text-xs text-gray-600">Configure zones, sites, users</p>
              </div>
              <div className="p-3 border rounded hover:bg-gray-50 cursor-pointer">
                <p className="text-sm font-medium">Data Management</p>
                <p className="text-xs text-gray-600">Import, export, cleanup</p>
              </div>
              <div className="p-3 border rounded hover:bg-gray-50 cursor-pointer">
                <p className="text-sm font-medium">Audit Log</p>
                <p className="text-xs text-gray-600">System activity & changes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </RoleBasedVisibility>
    </ModuleLayout>
  )
}
