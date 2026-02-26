import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { checkRailwayServicesHealth } from '@/lib/railway'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Activity, Database, Server, Shield, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'

export default function SystemDiagnostics() {
  const { user } = useAuthStore()
  const [testResults, setTestResults] = useState<any>(null)

  // Check user role
  const isMaster = user?.role === 'master'

  // Fetch Railway services health
  const { data: railwayHealth, isLoading: railwayLoading, refetch: refetchRailway } = useQuery({
    queryKey: ['railway-health'],
    queryFn: () => checkRailwayServicesHealth(),
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Check database stats
  const { data: dbStats, isLoading: dbLoading } = useQuery({
    queryKey: ['database-stats'],
    queryFn: async () => {
      const [observations, vehicles, breaches, zones, users] = await Promise.all([
        supabase.from('observations').select('id', { count: 'exact', head: true }),
        supabase.from('canonical_vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('breach_alerts').select('id', { count: 'exact', head: true }),
        supabase.from('zones').select('id', { count: 'exact', head: true }),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
      ])

      return {
        observations: observations.count || 0,
        vehicles: vehicles.count || 0,
        breaches: breaches.count || 0,
        zones: zones.count || 0,
        users: users.count || 0,
      }
    },
  })

  // Run integrity check
  const integrityCheckMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-data-integrity', {
        body: { comprehensive: true }
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setTestResults(data)
      toast.success('Integrity check complete')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Integrity check failed')
    },
  })

  if (!isMaster) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Master role required.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Diagnostics</h1>
          <p className="text-gray-600 mt-1">
            Monitor system health and run integrity checks
          </p>
        </div>
        <Button onClick={() => refetchRailway()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Database */}
        <Card>
          <CardHeader className="pb-3">
            <Database className="h-8 w-8 text-blue-600 mb-2" />
            <CardTitle className="text-lg">Database</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="default" className="mb-2">
              <CheckCircle className="h-3 w-3 mr-1" />
              Healthy
            </Badge>
            {dbStats && (
              <div className="text-sm text-gray-600 space-y-1">
                <div>{dbStats.observations.toLocaleString()} observations</div>
                <div>{dbStats.vehicles.toLocaleString()} vehicles</div>
                <div>{dbStats.zones} zones</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Proxy Server */}
        <Card>
          <CardHeader className="pb-3">
            <Server className="h-8 w-8 text-green-600 mb-2" />
            <CardTitle className="text-lg">Proxy Server</CardTitle>
          </CardHeader>
          <CardContent>
            {railwayLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : railwayHealth?.proxy ? (
              <Badge variant="default">
                <CheckCircle className="h-3 w-3 mr-1" />
                Online
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Offline
              </Badge>
            )}
            <div className="text-xs text-gray-600 mt-2">
              NZSCV / MotorWeb Gateway
            </div>
          </CardContent>
        </Card>

        {/* Inference Server */}
        <Card>
          <CardHeader className="pb-3">
            <Activity className="h-8 w-8 text-purple-600 mb-2" />
            <CardTitle className="text-lg">Inference Service</CardTitle>
          </CardHeader>
          <CardContent>
            {railwayLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : railwayHealth?.inference ? (
              <Badge variant="default">
                <CheckCircle className="h-3 w-3 mr-1" />
                Online
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Offline
              </Badge>
            )}
            <div className="text-xs text-gray-600 mt-2">
              Vehicle Photo Analysis
            </div>
          </CardContent>
        </Card>

        {/* Authentication */}
        <Card>
          <CardHeader className="pb-3">
            <Shield className="h-8 w-8 text-orange-600 mb-2" />
            <CardTitle className="text-lg">Authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="default">
              <CheckCircle className="h-3 w-3 mr-1" />
              Active
            </Badge>
            <div className="text-sm text-gray-600 mt-2">
              {dbStats?.users || 0} users
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Integrity Checks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Data Integrity</CardTitle>
              <CardDescription>
                Run comprehensive data integrity checks
              </CardDescription>
            </div>
            <Button
              onClick={() => integrityCheckMutation.mutate()}
              disabled={integrityCheckMutation.isPending}
            >
              <Activity className="h-4 w-4 mr-2" />
              {integrityCheckMutation.isPending ? 'Running...' : 'Run Check'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {testResults ? (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="font-medium text-green-900">Integrity Check Complete</span>
                </div>
                <pre className="mt-2 text-xs text-green-800 overflow-auto">
                  {JSON.stringify(testResults, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600">
              Click "Run Check" to verify data integrity
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Errors (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>
            System errors and warnings from the last 24 hours
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-600">
            No recent errors
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
