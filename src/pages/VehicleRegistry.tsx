import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { LoadingSpinner } from '@/components/features/LoadingSpinner'
import {
  Search, Car, CheckCircle, AlertTriangle, Shield, Calendar,
  ChevronRight, SlidersHorizontal, BookOpen,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { HOMELESS_UI_STATUSES, isHomelessForUi } from '@/lib/homelessStatus'

interface RegistryVehicle {
  id: string
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  colour: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  is_exempt: boolean
  homeless_status: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
  last_seen_at: string | null
}

type SelfContainedFilter = 'all' | 'yes' | 'no'
type ComplianceFilter = 'all' | 'compliant' | 'breach' | 'homeless' | 'exempt'

export default function VehicleRegistry() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const navigate = useNavigate()

  const effectiveOrganizationId =
    organizationId || (user?.role !== 'master' ? user?.organization_id || null : null)

  const [searchQuery, setSearchQuery] = useState('')
  const [selfContainedFilter, setSelfContainedFilter] = useState<SelfContainedFilter>('all')
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  const { data: vehicles, isLoading, refetch } = useQuery({
    queryKey: ['vehicle-registry', effectiveOrganizationId, searchQuery, selfContainedFilter, complianceFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from('canonical_vehicles')
        .select([
          'id', 'plate_number', 'make', 'model', 'year', 'colour',
          'self_contained', 'self_contained_expiry', 'is_exempt',
          'homeless_status', 'profile_photo',
          'total_observations', 'total_breaches', 'last_seen_at',
        ].join(','))
        .order('plate_number', { ascending: true })
        .limit(200)

      if (effectiveOrganizationId) {
        const { data: matchingObservations, error: matchingObsError } = await (supabase as any)
          .from('observations')
          .select('plate_number')
          .eq('organization_id', effectiveOrganizationId)

        if (matchingObsError) throw matchingObsError

        const plateRows = (matchingObservations ?? []) as Array<{ plate_number: string | null }>
        const matchingPlates = [...new Set(plateRows.map((o) => o.plate_number).filter(Boolean) as string[])]

        if (matchingPlates.length === 0) {
          return [] as RegistryVehicle[]
        }

        query = query.in('plate_number', matchingPlates)
      }

      if (searchQuery.trim()) {
        query = query.or(
          `plate_number.ilike.%${searchQuery.trim()}%,make.ilike.%${searchQuery.trim()}%,model.ilike.%${searchQuery.trim()}%`
        )
      }

      if (selfContainedFilter === 'yes') query = query.eq('self_contained', true)
      else if (selfContainedFilter === 'no') query = query.eq('self_contained', false)

      if (complianceFilter === 'compliant') query = query.eq('total_breaches', 0).eq('is_exempt', false)
      else if (complianceFilter === 'breach') query = query.gt('total_breaches', 0)
      else if (complianceFilter === 'homeless') query = query.in('homeless_status', HOMELESS_UI_STATUSES)
      else if (complianceFilter === 'exempt') query = query.eq('is_exempt', true)

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as RegistryVehicle[]
    },
    enabled: !!user,
  })

  const total = vehicles?.length ?? 0
  const selfContainedCount = vehicles?.filter((v) => v.self_contained).length ?? 0
  const breachCount = vehicles?.filter((v) => v.total_breaches > 0).length ?? 0
  const homelessCount = vehicles?.filter((v) => isHomelessForUi(v.homeless_status)).length ?? 0
  const exemptCount = vehicles?.filter((v) => v.is_exempt).length ?? 0

  const complianceBadge = (v: RegistryVehicle) => {
    if (v.is_exempt) return <Badge variant="outline" className="text-purple-700 border-purple-300">Exempt</Badge>
    if (v.total_breaches > 0)
      return <Badge variant="destructive">{v.total_breaches} Breach{v.total_breaches !== 1 ? 'es' : ''}</Badge>
    return <Badge variant="outline" className="text-green-700 border-green-300">Compliant</Badge>
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-7 w-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Vehicle Registry</h1>
              <p className="text-sm text-gray-500">Read-only registry of canonical vehicles</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>

        <GlobalFilterRibbon showDateFilter={false} showZoneFilter={false} />

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total Vehicles', value: total, icon: Car, color: 'text-blue-600' },
            { label: 'Self-Contained', value: selfContainedCount, icon: Shield, color: 'text-green-600' },
            { label: 'With Breaches', value: breachCount, icon: AlertTriangle, color: 'text-red-600' },
            { label: 'Homeless', value: homelessCount, icon: AlertTriangle, color: 'text-orange-600' },
            { label: 'Exempt', value: exemptCount, icon: CheckCircle, color: 'text-purple-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${color}`} />
                <div>
                  <div className="text-2xl font-bold">{value}</div>
                  <div className="text-xs text-gray-500">{label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search & Filters */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="Search by plate, make, or model…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
                className="gap-1.5"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
              </Button>
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-3 pt-1">
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Self-Contained</label>
                  <Select
                    value={selfContainedFilter}
                    onValueChange={(v) => setSelfContainedFilter(v as SelfContainedFilter)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Compliance</label>
                  <Select
                    value={complianceFilter}
                    onValueChange={(v) => setComplianceFilter(v as ComplianceFilter)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="compliant">Compliant</SelectItem>
                      <SelectItem value="breach">Has Breaches</SelectItem>
                      <SelectItem value="homeless">Homeless</SelectItem>
                      <SelectItem value="exempt">Exempt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('')
                      setSelfContainedFilter('all')
                      setComplianceFilter('all')
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {isLoading ? (
          <LoadingSpinner />
        ) : !vehicles || vehicles.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Car className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No vehicles found</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your search or filters</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                {total} Vehicle{total !== 1 ? 's' : ''} found
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {vehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-4"
                    onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                  >
                    {/* Profile photo or placeholder */}
                    <div className="h-10 w-14 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
                      {vehicle.profile_photo ? (
                        <img
                          src={vehicle.profile_photo}
                          alt={vehicle.plate_number}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Car className="h-5 w-5 text-gray-400" />
                      )}
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm">{vehicle.plate_number}</span>
                        {vehicle.self_contained && (
                          <Badge variant="secondary" className="text-xs py-0">
                            <Shield className="h-3 w-3 mr-1" />
                            SC
                          </Badge>
                        )}
                        {complianceBadge(vehicle)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {[vehicle.make, vehicle.model, vehicle.year, vehicle.colour]
                          .filter(Boolean)
                          .join(' · ') || 'Vehicle details unknown'}
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="hidden sm:flex flex-col items-end text-xs text-gray-400 gap-0.5 shrink-0">
                      <span>{vehicle.total_observations} scan{vehicle.total_observations !== 1 ? 's' : ''}</span>
                      {vehicle.last_seen_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {/* formatDateTime uses Pacific/Auckland timezone (see src/lib/utils.ts) */}
                          {formatDateTime(vehicle.last_seen_at)}
                        </span>
                      )}
                    </div>

                    <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
