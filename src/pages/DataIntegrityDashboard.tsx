import { useQuery } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { StatCard } from '@/components/features/StatCard'
import { ListCardRow } from '@/components/features/ListCardRow'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
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

interface IntegrityCheck {
  id: string
  title: string
  description: string
  status: 'pass' | 'warning' | 'fail'
  count: number
  total: number
  details?: string
}

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

  // Fetch data integrity checks
  const { data: integrityChecks, isLoading } = useQuery({
    queryKey: ['data-integrity', organizationId],
    queryFn: async () => {
      const orgFilter = organizationId || (user?.role === 'master' ? null : user?.organization_id)

      const checks: IntegrityCheck[] = []

      // 1. Observations without photos
      let obsQuery = supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .or('photo_url.is.null,photo_hash.is.null')

      if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter)
      const { count: obsWithoutPhotos } = await obsQuery

      let totalObsQuery = supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })

      if (orgFilter) totalObsQuery = totalObsQuery.eq('organization_id', orgFilter)
      const { count: totalObs } = await totalObsQuery

      checks.push({
        id: 'obs-photos',
        title: 'Observations with Photos',
        description: 'All observations must have photo evidence',
        status: obsWithoutPhotos === 0 ? 'pass' : obsWithoutPhotos > 10 ? 'fail' : 'warning',
        count: (totalObs || 0) - (obsWithoutPhotos || 0),
        total: totalObs || 0,
        details: obsWithoutPhotos > 0 ? `${obsWithoutPhotos} observations missing photos` : undefined,
      })

      // 2. Observations with GPS
      let gpsQuery = supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })

      if (orgFilter) gpsQuery = gpsQuery.eq('organization_id', orgFilter)
      gpsQuery = gpsQuery.or('gps_latitude.is.null,gps_longitude.is.null')
      const { count: obsWithoutGPS } = await gpsQuery

      checks.push({
        id: 'obs-gps',
        title: 'Observations with GPS',
        description: 'GPS coordinates required for legal evidence',
        status: obsWithoutGPS === 0 ? 'pass' : obsWithoutGPS > 5 ? 'fail' : 'warning',
        count: (totalObs || 0) - (obsWithoutGPS || 0),
        total: totalObs || 0,
        details: obsWithoutGPS > 0 ? `${obsWithoutGPS} observations missing GPS` : undefined,
      })

      // 3. Breach alerts linked to an observation
      // NOTE: compliance_results table EXISTS in the live DB (Schema Extract #20: 1,959 rows).
      // Compliance state also lives directly on observations rows. We check observation_id linkage.
      let breachQuery = supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })
        .is('observation_id', null)

      if (orgFilter) breachQuery = breachQuery.eq('organization_id', orgFilter)
      const { count: breachesWithoutObs } = await breachQuery

      let totalBreachQuery = supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })

      if (orgFilter) totalBreachQuery = totalBreachQuery.eq('organization_id', orgFilter)
      const { count: totalBreaches } = await totalBreachQuery

      checks.push({
        id: 'breach-compliance',
        title: 'Breaches Linked to Observations',
        description: 'All breach alerts should reference the triggering observation',
        status: breachesWithoutObs === 0 ? 'pass' : breachesWithoutObs > 10 ? 'fail' : 'warning',
        count: (totalBreaches || 0) - (breachesWithoutObs || 0),
        total: totalBreaches || 0,
        details: breachesWithoutObs > 0 ? `${breachesWithoutObs} breaches missing observation link` : undefined,
      })

      // 4. Zones with compliance matrix
      let zoneQuery = (supabase.from('zones') as any)
        .select('id, zone_compliance_matrix(id)')

      if (orgFilter) zoneQuery = zoneQuery.eq('organization_id', orgFilter)
      const { data: zones } = await zoneQuery

      const zonesWithoutMatrix = zones?.filter(z => !z.zone_compliance_matrix || (z.zone_compliance_matrix as any[]).length === 0).length || 0

      checks.push({
        id: 'zone-matrix',
        title: 'Zones with Compliance Matrix',
        description: 'Each zone must have compliance rules defined',
        status: zonesWithoutMatrix === 0 ? 'pass' : zonesWithoutMatrix > 3 ? 'fail' : 'warning',
        count: (zones?.length || 0) - zonesWithoutMatrix,
        total: zones?.length || 0,
        details: zonesWithoutMatrix > 0 ? `${zonesWithoutMatrix} zones missing compliance rules` : undefined,
      })

      // 5. Vehicles with observations
      // NOTE: canonical_vehicles PK is plate_number; use vehicle_id (UUID) for row identity
      const { data: vehiclesData } = await (supabase.from('canonical_vehicles') as any)
        .select('vehicle_id, total_observations')

      const vehiclesWithoutObs = vehiclesData?.filter(v => v.total_observations === 0).length || 0

      checks.push({
        id: 'vehicle-obs',
        title: 'Vehicles with Observations',
        description: 'All canonical vehicles should have at least one observation',
        status: vehiclesWithoutObs === 0 ? 'pass' : vehiclesWithoutObs > 20 ? 'fail' : 'warning',
        count: (vehiclesData?.length || 0) - vehiclesWithoutObs,
        total: vehiclesData?.length || 0,
        details: vehiclesWithoutObs > 0 ? `${vehiclesWithoutObs} vehicles with no observations (possible orphans)` : undefined,
      })

      // 6. Users with valid organizations
      const { count: usersWithoutOrg } = await supabase
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .is('organization_id', null)

      const { count: totalUsers } = await supabase
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })

      checks.push({
        id: 'user-org',
        title: 'Users with Organisations',
        description: 'All users must belong to an organisation',
        status: usersWithoutOrg === 0 ? 'pass' : usersWithoutOrg > 5 ? 'fail' : 'warning',
        count: (totalUsers || 0) - (usersWithoutOrg || 0),
        total: totalUsers || 0,
        details: usersWithoutOrg > 0 ? `${usersWithoutOrg} users not assigned to organisation` : undefined,
      })

      return checks
    },
    enabled: !!user,
  })

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
