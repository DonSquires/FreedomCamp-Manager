/**
 * SystemHealthIndicator Component
 * Display system and service status
 */

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Database,
  Cloud,
  Server,
  Zap,
} from 'lucide-react'
import { checkRailwayHealth } from '@/lib/railway'

interface ServiceStatus {
  name: string
  status: 'operational' | 'degraded' | 'down'
  lastCheck?: Date
  responseTime?: number
  icon: React.ReactNode
}

export function SystemHealthIndicator() {
  // Check Railway services health
  const { data: railwayHealth, isLoading: railwayLoading, refetch } = useQuery({
    queryKey: ['railway-health'],
    queryFn: checkRailwayHealth,
    refetchInterval: 60000, // Check every minute
  })

  // Mock database health check (would be replaced with actual check)
  const { data: dbHealth } = useQuery({
    queryKey: ['database-health'],
    queryFn: async () => ({
      status: 'operational' as const,
      responseTime: 45,
      connections: 12,
      maxConnections: 100,
    }),
    refetchInterval: 30000,
  })

  // Mock storage health check
  const { data: storageHealth } = useQuery({
    queryKey: ['storage-health'],
    queryFn: async () => ({
      status: 'operational' as const,
      usedSpace: 2.4,
      totalSpace: 10,
      unit: 'GB',
    }),
    refetchInterval: 60000,
  })

  const services: ServiceStatus[] = [
    {
      name: 'Database',
      status: dbHealth?.status || 'operational',
      responseTime: dbHealth?.responseTime,
      icon: <Database className="h-5 w-5" />,
    },
    {
      name: 'Storage',
      status: storageHealth?.status || 'operational',
      icon: <Cloud className="h-5 w-5" />,
    },
    {
      name: 'Railway Services',
      status: railwayHealth?.healthy ? 'operational' : 'degraded',
      icon: <Server className="h-5 w-5" />,
    },
    {
      name: 'Edge Functions',
      status: 'operational',
      icon: <Zap className="h-5 w-5" />,
    },
  ]

  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'operational':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'degraded':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />
      case 'down':
        return <XCircle className="h-4 w-4 text-red-600" />
    }
  }

  const getStatusBadge = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'operational':
        return <Badge className="bg-green-600">Operational</Badge>
      case 'degraded':
        return <Badge variant="secondary">Degraded</Badge>
      case 'down':
        return <Badge variant="destructive">Down</Badge>
    }
  }

  const overallStatus = services.every(s => s.status === 'operational')
    ? 'operational'
    : services.some(s => s.status === 'down')
    ? 'down'
    : 'degraded'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Health
            </CardTitle>
            <CardDescription className="mt-1">
              Real-time service status monitoring
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(overallStatus)}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Overall status */}
        <div className={`p-4 rounded-lg border-2 ${
          overallStatus === 'operational' 
            ? 'bg-green-50 dark:bg-green-900/20 border-green-500' 
            : overallStatus === 'degraded'
            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
            : 'bg-red-50 dark:bg-red-900/20 border-red-500'
        }`}>
          <div className="flex items-center gap-2">
            {getStatusIcon(overallStatus)}
            <span className="font-medium">
              {overallStatus === 'operational' 
                ? 'All Systems Operational'
                : overallStatus === 'degraded'
                ? 'Some Services Degraded'
                : 'System Issues Detected'
              }
            </span>
          </div>
        </div>

        {/* Individual services */}
        <div className="space-y-3">
          {services.map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                {service.icon}
                <div>
                  <div className="font-medium">{service.name}</div>
                  {service.responseTime && (
                    <div className="text-xs text-muted-foreground">
                      Response time: {service.responseTime}ms
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(service.status)}
                <span className="text-sm">
                  {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Database details */}
        {dbHealth && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="font-medium mb-2">Database Connections</div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active:</span>
              <span className="font-medium">
                {dbHealth.connections} / {dbHealth.maxConnections}
              </span>
            </div>
          </div>
        )}

        {/* Storage details */}
        {storageHealth && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="font-medium mb-2">Storage Usage</div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Used:</span>
              <span className="font-medium">
                {storageHealth.usedSpace} / {storageHealth.totalSpace} {storageHealth.unit}
              </span>
            </div>
            <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{
                  width: `${(storageHealth.usedSpace / storageHealth.totalSpace) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Railway services detail */}
        {railwayHealth && !railwayHealth.healthy && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm">
            <div className="font-medium mb-2">Service Issues</div>
            {!railwayHealth.nzscv && (
              <div className="text-yellow-900 dark:text-yellow-100">
                • NZSCV verification service unavailable
              </div>
            )}
            {!railwayHealth.motorweb && (
              <div className="text-yellow-900 dark:text-yellow-100">
                • MotorWeb enrichment service unavailable
              </div>
            )}
            {!railwayHealth.orc && (
              <div className="text-yellow-900 dark:text-yellow-100">
                • ORC/AI inference service unavailable
              </div>
            )}
          </div>
        )}

        {/* Last updated */}
        <div className="text-xs text-center text-muted-foreground border-t pt-3">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  )
}
