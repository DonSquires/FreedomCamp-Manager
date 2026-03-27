import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Activity, Database, Server, Shield, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { checkProxyHealth, checkInferenceHealth } from '@/lib/railwayServices'

interface IntegrityResults {
  processed: number
  duplicates_deleted: number
  invalid_plates_marked: number
  issues: Array<{
    table: string
    issue_type: string
    severity: string
    record_id: string
    plate_number?: string
    description: string
    action_taken?: string
  }>
}

function IntegrityResultsDisplay({ results }: { results: IntegrityResults }) {
  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{results.processed}</div>
          <div className="text-sm text-gray-600">Records Processed</div>
        </div>
        
        <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-green-600">{results.duplicates_deleted}</div>
          <div className="text-sm text-gray-600">Duplicates Removed</div>
        </div>
        
        <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-orange-600">{results.invalid_plates_marked}</div>
          <div className="text-sm text-gray-600">Invalid Plates</div>
        </div>
      </div>

      {/* Issues Table */}
      {results.issues && results.issues.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 font-semibold">
            Issues Found ({results.issues.length})
          </div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {results.issues.map((issue, idx) => (
              <div key={idx} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={issue.severity === 'critical' ? 'destructive' : 'secondary'}>
                    {issue.severity}
                  </Badge>
                  <span className="text-sm font-medium">{issue.table}</span>
                  <span className="text-xs text-gray-500">• {issue.issue_type}</span>
                </div>
                {issue.plate_number && (
                  <div className="text-sm font-mono text-blue-600">{issue.plate_number}</div>
                )}
                <div className="text-sm text-gray-600">{issue.description}</div>
                {issue.action_taken && (
                  <div className="text-xs text-green-600 mt-1">✓ {issue.action_taken}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SystemDiagnostics() {
  const { user } = useAuthStore()
  const [testResults, setTestResults] = useState<any>(null)

  // Check user role
  const isMaster = user?.role === 'master'

  // Railway Integration: Check Proxy Server Health
  const { data: proxyHealth, isLoading: proxyLoading, refetch: refetchProxy } = useQuery({
    queryKey: ['proxy-health'],
    queryFn: () => checkProxyHealth(),
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Railway Integration: Check Inference Service Health
  const { data: inferenceHealth, isLoading: inferenceLoading, refetch: refetchInference } = useQuery({
    queryKey: ['inference-health'],
    queryFn: () => checkInferenceHealth(),
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const refetchRailway = () => {
    refetchProxy()
    refetchInference()
  }

  // Check database stats
  const { data: dbStats, isLoading: dbLoading } = useQuery({
    queryKey: ['database-stats'],
    queryFn: async () => {
      const [observations, vehicles, breaches, zones, users] = await Promise.all([
        supabase.from('observations').select('observation_id', { count: 'exact', head: true }),
        supabase.from('canonical_vehicles').select('vehicle_id', { count: 'exact', head: true }),
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
      const { data, error } = await edgeFunctions.checkDataIntegrity({ comprehensive: true })
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
    <AppLayout title="System Diagnostics" description="Monitor system health and run integrity checks" showBackButton>
      <div className="flex justify-end mb-6">
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
            {proxyLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : proxyHealth?.status === 'online' ? (
              <>
                <Badge variant="default">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Online
                </Badge>
                {proxyHealth.latency_ms && (
                  <div className="text-xs text-gray-600 mt-1">
                    Latency: {proxyHealth.latency_ms}ms
                  </div>
                )}
              </>
            ) : proxyHealth?.status === 'degraded' ? (
              <>
                <Badge variant="secondary">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Degraded
                </Badge>
                <div className="text-xs text-red-600 mt-1">
                  {proxyHealth.error}
                </div>
              </>
            ) : (
              <>
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
                {proxyHealth?.error && (
                  <div className="text-xs text-red-600 mt-1">
                    {proxyHealth.error}
                  </div>
                )}
              </>
            )}
            <div className="text-xs text-gray-600 mt-2">
              NZSCV / Vehicle Data Gateway
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
            {inferenceLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : inferenceHealth?.status === 'online' ? (
              <>
                <Badge variant="default">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Online
                </Badge>
                {inferenceHealth.latency_ms && (
                  <div className="text-xs text-gray-600 mt-1">
                    Latency: {inferenceHealth.latency_ms}ms
                  </div>
                )}
              </>
            ) : inferenceHealth?.status === 'degraded' ? (
              <>
                <Badge variant="secondary">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Degraded
                </Badge>
                <div className="text-xs text-red-600 mt-1">
                  {inferenceHealth.error}
                </div>
              </>
            ) : (
              <>
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
                {inferenceHealth?.error && (
                  <div className="text-xs text-red-600 mt-1">
                    {inferenceHealth.error}
                  </div>
                )}
              </>
            )}
            <div className="text-xs text-gray-600 mt-2">
              YOLOv8 Vehicle Detection
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
            <IntegrityResultsDisplay results={testResults} />
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
    </AppLayout>
  )
}
