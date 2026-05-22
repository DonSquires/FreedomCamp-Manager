import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  Car,
  FileText,
  MapPin,
  User,
  AlertTriangle,
  Shield,
  Activity,
  Clock,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

interface SearchResults {
  vehicles: any[]
  observations: any[]
  incidents: any[]
  patrols: any[]
  breaches: any[]
}

const EMPTY_RESULTS: SearchResults = {
  vehicles: [],
  observations: [],
  incidents: [],
  patrols: [],
  breaches: [],
}

export default function UniversalSearch() {
  const { user } = useAuthStore()
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')

  const orgFilter = user?.role !== 'master' ? user?.organization_id : null

  const { data: results, isLoading } = useQuery({
    queryKey: ['universal-search', submittedQuery, orgFilter],
    queryFn: async (): Promise<SearchResults> => {
      if (!submittedQuery || submittedQuery.trim().length < 2) return EMPTY_RESULTS

      const q = submittedQuery.trim()

      // Run all searches in parallel
      const [vehiclesRes, observationsRes, incidentsRes, patrolsRes, breachesRes] =
        await Promise.all([
          // Vehicles – plate, vehicle_make, vehicle_model, vehicle_color
          supabase
            .from('canonical_vehicles')
            .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, owner_first_name, owner_last_name')
            .or(`plate_number.ilike.%${q}%,vehicle_make.ilike.%${q}%,vehicle_model.ilike.%${q}%`)
            .limit(20),

          // Observations – officer notes and zone context
          (() => {
            let obsQuery = supabase
              .from('observations')
              .select('observation_id, officer_notes, recorded_at, is_compliant, plate_number, zones(name)')
              
              .or(`officer_notes.ilike.%${q}%,plate_number.ilike.%${q}%`)
              .order('recorded_at', { ascending: false })
              .limit(20)
            if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter)
            return obsQuery
          })(),

          // Incidents – description, location
          (() => {
            let incQuery = supabase
              .from('incidents')
              .select('id, description, location_name, created_at, status, type')
              .or(`description.ilike.%${q}%,location_name.ilike.%${q}%`)
              .order('created_at', { ascending: false })
              .limit(20)
            if (orgFilter) incQuery = incQuery.eq('organization_id', orgFilter)
            return incQuery
          })(),

          // Patrols – include assigned officer and zone, then filter client-side by query text
          (() => {
            let patrolQuery = supabase
              .from('patrols')
              .select('id, created_at, started_at, status, zones(name), officer:user_profiles!patrols_assigned_to_fkey(first_name,last_name)')
              .order('created_at', { ascending: false })
              .limit(100)
            if (orgFilter) patrolQuery = patrolQuery.eq('organization_id', orgFilter)
            return patrolQuery
          })(),

          // Breaches – plate number
          (() => {
            let bQuery = supabase
              .from('breach_alerts')
              .select('id, plate_number, breach_type, status, created_at, zones(name)')
              .ilike('plate_number', `%${q}%`)
              .order('created_at', { ascending: false })
              .limit(20)
            if (orgFilter) bQuery = bQuery.eq('organization_id', orgFilter)
            return bQuery
          })(),
        ])

      const patrols = (patrolsRes.data || []).filter((p: any) => {
        const officerName = `${p.officer?.first_name || ''} ${p.officer?.last_name || ''}`.trim().toLowerCase()
        const zoneName = (p.zones?.name || '').toLowerCase()
        const status = (p.status || '').toLowerCase()
        const qLower = q.toLowerCase()
        return officerName.includes(qLower) || zoneName.includes(qLower) || status.includes(qLower)
      }).slice(0, 20)

      return {
        vehicles: vehiclesRes.data || [],
        observations: observationsRes.data || [],
        incidents: incidentsRes.data || [],
        patrols,
        breaches: breachesRes.data || [],
      }
    },
    enabled: submittedQuery.trim().length >= 2,
  })

  const totalResults = results
    ? Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
    : 0

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittedQuery(query)
  }

  return (
    <AppLayout
      title="Universal Search"
      description='Search across all records – vehicles, observations, incidents, patrols'
      showBackButton
    >
      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              placeholder='Try "Toyota Hiace", "Graffiti", "Officer Jones", or a plate number…'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 text-base"
              autoFocus
            />
          </div>
          <Button type="submit" disabled={query.trim().length < 2}>
            Search
          </Button>
        </div>
        {submittedQuery && !isLoading && (
          <p className="text-sm text-gray-500 mt-2">
            {totalResults} result{totalResults !== 1 ? 's' : ''} for &quot;{submittedQuery}&quot;
          </p>
        )}
      </form>

      {isLoading && (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Searching all records…</p>
        </div>
      )}

      {!isLoading && submittedQuery && totalResults === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <Search className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No results found for &quot;{submittedQuery}&quot;</p>
          </CardContent>
        </Card>
      )}

      {results && totalResults > 0 && (
        <div className="space-y-6">
          {/* Vehicles */}
          {results.vehicles.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
                <Car className="h-5 w-5 text-blue-600" />
                Vehicles
                <Badge variant="secondary">{results.vehicles.length}</Badge>
              </h2>
              <div className="space-y-2">
                {results.vehicles.map((v: any) => (
                  <Card key={v.vehicle_id}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div>
                        <span className="font-bold text-lg">{v.plate_number}</span>
                        <span className="ml-3 text-gray-600">
                          {[v.vehicle_year, v.vehicle_make, v.vehicle_model, v.vehicle_color].filter(Boolean).join(' ')}
                        </span>
                        {(v.owner_first_name || v.owner_last_name) && (
                          <span className="ml-3 text-sm text-gray-500">
                            Owner: {[v.owner_first_name, v.owner_last_name].filter(Boolean).join(' ')}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Observations */}
          {results.observations.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
                <FileText className="h-5 w-5 text-green-600" />
                Observations
                <Badge variant="secondary">{results.observations.length}</Badge>
              </h2>
              <div className="space-y-2">
                {results.observations.map((o: any) => (
                  <Card key={o.observation_id}>
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          {o.plate_number && (
                            <span className="font-bold mr-2">{o.plate_number}</span>
                          )}
                          {o.zones?.name && (
                            <span className="text-gray-600 flex items-center gap-1 text-sm mt-0.5">
                              <MapPin className="h-3 w-3" />
                              {o.zones.name}
                            </span>
                          )}
                          {o.officer_notes && (
                            <p className="text-sm text-gray-700 mt-1 truncate">{o.officer_notes}</p>
                          )}
                        </div>
                        <div className="ml-4 text-right shrink-0">
                          <Badge
                            variant={o.is_compliant ? 'default' : 'destructive'}
                            className="text-xs"
                          >
                            {o.is_compliant ? 'Compliant' : 'Breach'}
                          </Badge>
                          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1 justify-end">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(o.recorded_at)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Incidents */}
          {results.incidents.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
                <Shield className="h-5 w-5 text-orange-600" />
                Incidents
                <Badge variant="secondary">{results.incidents.length}</Badge>
              </h2>
              <div className="space-y-2">
                {results.incidents.map((inc: any) => (
                  <Card key={inc.id}>
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium capitalize">{inc.type || 'Incident'}</span>
                          {inc.location_name && (
                            <span className="ml-2 text-sm text-gray-600">
                              @ {inc.location_name}
                            </span>
                          )}
                          {inc.description && (
                            <p className="text-sm text-gray-600 mt-1 truncate">{inc.description}</p>
                          )}
                        </div>
                        <div className="ml-4 shrink-0 text-right">
                          <Badge variant="outline" className="capitalize text-xs">
                            {inc.status}
                          </Badge>
                          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1 justify-end">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(inc.created_at)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Breach Alerts */}
          {results.breaches.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Breach Alerts
                <Badge variant="secondary">{results.breaches.length}</Badge>
              </h2>
              <div className="space-y-2">
                {results.breaches.map((b: any) => (
                  <Card key={b.id}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div>
                        <span className="font-bold">{b.plate_number}</span>
                        <span className="ml-2 text-sm text-gray-600 capitalize">
                          {b.breach_type?.replace(/_/g, ' ')}
                        </span>
                        {b.zones?.name && (
                          <span className="ml-2 text-sm text-gray-500 flex items-center gap-1 inline-flex">
                            <MapPin className="h-3 w-3" />
                            {b.zones.name}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <Badge variant="outline" className="capitalize text-xs">
                          {b.status}
                        </Badge>
                        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1 justify-end">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(b.created_at)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Patrols */}
          {results.patrols.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
                <Activity className="h-5 w-5 text-purple-600" />
                Patrols
                <Badge variant="secondary">{results.patrols.length}</Badge>
              </h2>
              <div className="space-y-2">
                {results.patrols.map((p: any) => (
                  <Card key={p.id}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div>
                        <span className="font-medium capitalize">{p.status}</span>
                        {(p.officer?.first_name || p.officer?.last_name) && (
                          <span className="ml-2 text-sm text-gray-600 inline-flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {[p.officer?.first_name, p.officer?.last_name].filter(Boolean).join(' ')}
                          </span>
                        )}
                        {p.zones?.name && (
                          <span className="ml-2 text-sm text-gray-600 flex items-center gap-1 inline-flex">
                            <MapPin className="h-3 w-3" />
                            {p.zones.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(p.started_at || p.created_at)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!submittedQuery && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" />
              Universal Search
            </CardTitle>
            <CardDescription>
              Search across all system records instantly
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-gray-600">
              <div className="flex items-start gap-2">
                <Car className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                <span>Vehicles – plate, vehicle make, vehicle model, owner name</span>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                <span>Observations – officer notes, zone, plate</span>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 mt-0.5 text-orange-600 shrink-0" />
                <span>Incidents – description, location</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-red-600 shrink-0" />
                <span>Breach Alerts – plate number</span>
              </div>
              <div className="flex items-start gap-2">
                <Activity className="h-4 w-4 mt-0.5 text-purple-600 shrink-0" />
                <span>Patrols – officer name, zone, status</span>
              </div>
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 mt-0.5 text-gray-600 shrink-0" />
                <span>Example: &quot;Toyota Hiace&quot;, &quot;Graffiti&quot;, &quot;Officer Jones&quot;</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </AppLayout>
  )
}
