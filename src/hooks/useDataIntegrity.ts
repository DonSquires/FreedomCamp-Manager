import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface IntegrityCheck {
  id: string
  title: string
  description: string
  status: 'pass' | 'warning' | 'fail'
  count: number
  total: number
  details?: string
}

interface UseDataIntegrityChecksOptions {
  user?: {
    role?: string | null
    organization_id?: string | null
  } | null
  organizationId?: string | null
}

export function useDataIntegrityChecks(options: UseDataIntegrityChecksOptions) {
  const { user, organizationId } = options

  return useQuery({
    queryKey: ['data-integrity', organizationId, user?.organization_id, user?.role],
    queryFn: async () => {
      const orgFilter = organizationId || ((user?.role === 'master' || user?.role === 'grand_master') ? null : user?.organization_id)

      const checks: IntegrityCheck[] = []

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

      let scopedGpsQuery = supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })

      if (orgFilter) scopedGpsQuery = scopedGpsQuery.eq('organization_id', orgFilter)

      const { count: obsWithMissingGPSCoordinates } = await scopedGpsQuery.or('gps_latitude.is.null,gps_longitude.is.null')

      checks.push({
        id: 'obs-gps',
        title: 'Observations with GPS',
        description: 'GPS coordinates required for legal evidence',
        status: obsWithMissingGPSCoordinates === 0 ? 'pass' : obsWithMissingGPSCoordinates > 5 ? 'fail' : 'warning',
        count: (totalObs || 0) - (obsWithMissingGPSCoordinates || 0),
        total: totalObs || 0,
        details: obsWithMissingGPSCoordinates > 0 ? `${obsWithMissingGPSCoordinates} observations missing GPS` : undefined,
      })

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
}
