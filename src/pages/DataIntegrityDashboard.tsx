import { AppLayout } from '@/components/features/AppLayout'
import { StatCard } from '@/components/features/StatCard'
import { ListCardRow } from '@/components/features/ListCardRow'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { useDataIntegrityChecks } from '@/hooks/useDataIntegrity'
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Database,
  FileWarning,
  Link as LinkIcon,
  Clock,
} from 'lucide-react'

const e2DomainQueryMetrics = [
  {
    domain: 'Evidence completeness',
    surfaces: 'observations',
    checks: 'photo evidence, GPS evidence',
    scope: 'organization_id',
  },
  {
    domain: 'Enforcement event completeness',
    surfaces: 'breach_alerts',
    checks: 'triggering observation link',
    scope: 'organization_id',
  },
  {
    domain: 'Configuration completeness',
    surfaces: 'zones, zone_compliance_matrix',
    checks: 'zone compliance matrix coverage',
    scope: 'organization_id',
  },
  {
    domain: 'Identity completeness',
    surfaces: 'user_profiles',
    checks: 'organization assignment',
    scope: 'global identity audit',
  },
  {
    domain: 'Vehicle data movement',
    surfaces: 'canonical_vehicles',
    checks: 'orphan vehicle detection',
    scope: 'global canonical fleet audit',
  },
]

export default function DataIntegrityDashboard() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()

  const { data: integrityChecks, isLoading } = useDataIntegrityChecks({ user, organizationId })

  const passCount = integrityChecks?.filter(c => c.status === 'pass').length || 0
  const warningCount = integrityChecks?.filter(c => c.status === 'warning').length || 0
  const failCount = integrityChecks?.filter(c => c.status === 'fail').length || 0
  const totalChecks = integrityChecks?.length || 0

  const overallHealth = totalChecks > 0 ? (passCount / totalChecks) * 100 : 100

  const getStatusIcon = (status: 'pass' | 'warning' | 'fail') => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-600" />
    }
  }

  const getStatusBadge = (status: 'pass' | 'warning' | 'fail') => {
    switch (status) {
      case 'pass':
        return <Badge className="bg-green-600">Pass</Badge>
      case 'warning':
        return <Badge className="bg-yellow-600">Warning</Badge>
      case 'fail':
        return <Badge variant="destructive">Fail</Badge>
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Data Integrity Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Monitor data quality, validation errors, and referential integrity
          </p>
        </div>

        {/* E2 Audit / Completeness Coverage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              E2 Domain Query Metrics
            </CardTitle>
            <CardDescription>
              Audit dashboard coverage for event completeness, tenancy scope, and domain query ownership.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {e2DomainQueryMetrics.map((metric) => (
                <ListCardRow
                  key={metric.domain}
                  left={
                    <div>
                      <div className="font-medium">{metric.domain}</div>
                      <div className="text-xs text-muted-foreground">
                        {metric.surfaces} · {metric.checks}
                      </div>
                    </div>
                  }
                  right={<Badge variant="outline">{metric.scope}</Badge>}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Overall Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Overall Data Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Health Score</span>
                  <span className="text-sm font-medium">{overallHealth.toFixed(1)}%</span>
                </div>
                <Progress value={overallHealth} className="h-2" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{passCount}</div>
                  <div className="text-sm text-muted-foreground">Passing</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{warningCount}</div>
                  <div className="text-sm text-muted-foreground">Warnings</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{failCount}</div>
                  <div className="text-sm text-muted-foreground">Failures</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Integrity Checks */}
        <div className="space-y-4">
          {integrityChecks?.map((check) => (
            <Card key={check.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {getStatusIcon(check.status)}
                      {check.title}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {check.description}
                    </CardDescription>
                  </div>
                  {getStatusBadge(check.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted-foreground">
                        {check.count} / {check.total} valid
                      </span>
                      <span className="text-sm font-medium">
                        {check.total > 0 ? ((check.count / check.total) * 100).toFixed(1) : 100}%
                      </span>
                    </div>
                    <Progress 
                      value={check.total > 0 ? (check.count / check.total) * 100 : 100} 
                      className="h-2"
                    />
                  </div>
                  {check.details && (
                    <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
                      <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                      <span className="text-sm text-muted-foreground">{check.details}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Integrity Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <ListCardRow
                left={<span className="text-sm text-muted-foreground">Total Checks Run</span>}
                right={<span className="font-medium">{totalChecks}</span>}
              />
              <ListCardRow
                left={<span className="text-sm text-muted-foreground">Checks Passing</span>}
                right={<span className="font-medium text-green-600">{passCount}</span>}
              />
              <ListCardRow
                left={<span className="text-sm text-muted-foreground">Warnings</span>}
                right={<span className="font-medium text-yellow-600">{warningCount}</span>}
              />
              <ListCardRow
                left={<span className="text-sm text-muted-foreground">Failures</span>}
                right={<span className="font-medium text-red-600">{failCount}</span>}
              />
              <ListCardRow
                left={<span className="text-sm font-medium">Overall Health</span>}
                right={<span className="font-bold">{overallHealth.toFixed(1)}%</span>}
                className="pt-3 border-t"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
