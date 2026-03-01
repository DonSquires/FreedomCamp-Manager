import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  BarChart3, 
  AlertTriangle, 
  Car, 
  MapPin, 
  Users, 
  FileText,
  Shield,
  Settings,
  Database,
  Building2,
  Activity,
  CheckCircle,
} from 'lucide-react'

export default function AdminPortal() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  // Live KPI stats
  const { data: kpis } = useQuery({
    queryKey: ['admin-portal-kpis', user?.organization_id, user?.role],
    queryFn: async () => {
      let obsQuery = supabase.from('observations').select('id, is_compliant', { count: 'exact' }).is('deleted_at', null)
      let breachQuery = supabase.from('breach_alerts').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      let vehicleQuery = supabase.from('canonical_vehicles').select('id', { count: 'exact', head: true })
      let patrolQuery = supabase.from('patrols').select('id', { count: 'exact', head: true }).eq('status', 'in_progress')

      if (user?.role !== 'master' && user?.organization_id) {
        obsQuery = obsQuery.eq('organization_id', user.organization_id)
        breachQuery = breachQuery.eq('organization_id', user.organization_id)
        patrolQuery = patrolQuery.eq('organization_id', user.organization_id)
      }

      const [obsResult, breachResult, vehicleResult, patrolResult] = await Promise.all([
        obsQuery, breachQuery, vehicleQuery, patrolQuery,
      ])

      const totalObs = obsResult.count || 0
      const compliantObs = obsResult.data?.filter(o => o.is_compliant).length || 0
      const complianceRate = totalObs > 0 ? Math.round((compliantObs / totalObs) * 100) : 0

      return {
        totalObservations: totalObs,
        pendingBreaches: breachResult.count || 0,
        totalVehicles: vehicleResult.count || 0,
        activePatrols: patrolResult.count || 0,
        complianceRate,
      }
    },
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              FreedomCamp Manager
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {user?.role === 'master' ? 'System Administrator' : 'Organisation Administrator'} · {user?.full_name}
            </p>
          </div>
          <Button variant="outline" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Live KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Observations</span>
              <div className="p-1.5 rounded-lg bg-blue-500">
                <Activity className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="text-2xl font-black text-gray-900 dark:text-white">
              {kpis?.totalObservations ?? '—'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Pending Breaches</span>
              <div className="p-1.5 rounded-lg bg-red-500">
                <AlertTriangle className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="text-2xl font-black text-red-600 dark:text-red-400">
              {kpis?.pendingBreaches ?? '—'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Compliance Rate</span>
              <div className={`p-1.5 rounded-lg ${(kpis?.complianceRate ?? 0) >= 80 ? 'bg-green-500' : 'bg-orange-500'}`}>
                <CheckCircle className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className={`text-2xl font-black ${(kpis?.complianceRate ?? 0) >= 80 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
              {kpis ? `${kpis.complianceRate}%` : '—'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Vehicles</span>
              <div className="p-1.5 rounded-lg bg-purple-500">
                <Car className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="text-2xl font-black text-gray-900 dark:text-white">
              {kpis?.totalVehicles ?? '—'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Patrols</span>
              <div className="p-1.5 rounded-lg bg-emerald-500">
                <Shield className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {kpis?.activePatrols ?? '—'}
            </div>
          </div>
        </div>

        {/* Navigation Grid */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Quick Access</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Compliance Dashboard
              </CardTitle>
              <CardDescription>
                View compliance metrics and trends
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/compliance')}>
                View Dashboard
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Breach Alerts
              </CardTitle>
              <CardDescription>
                Manage active breaches
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/breaches')}>
                View Breaches
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="h-5 w-5" />
                Vehicle Management
              </CardTitle>
              <CardDescription>
                Search and manage vehicles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/vehicles')}>
                Manage Vehicles
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Zone Management
              </CardTitle>
              <CardDescription>
                Configure compliance zones
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/zones')}>
                Manage Zones
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Manage officers and admins
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/users')}>
                Manage Users
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Reports
              </CardTitle>
              <CardDescription>
                Generate compliance reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/reports')}>
                View Reports
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Enforcement
              </CardTitle>
              <CardDescription>
                Enforcement actions and notices
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
                View Enforcement
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Data Management
              </CardTitle>
              <CardDescription>
                Import/Export and data tools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/data')}>
                Manage Data
              </Button>
            </CardContent>
          </Card>

          {user?.role === 'master' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Organizations
                </CardTitle>
                <CardDescription>
                  Manage organization hierarchy
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" onClick={() => navigate('/organizations')}>
                  Manage Orgs
                </Button>
              </CardContent>
            </Card>
          )}

          {user?.role === 'master' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  System Diagnostics
                </CardTitle>
                <CardDescription>
                  System health and monitoring
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" onClick={() => navigate('/diagnostics')}>
                  View Diagnostics
                </Button>
              </CardContent>
            </Card>
          )}
          </div>
        </div>
      </main>
    </div>
  )
}
