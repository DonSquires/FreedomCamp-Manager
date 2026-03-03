import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, Building2, MapPin, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GlobalFilterRibbonProps {
  showDateFilter?: boolean
  showOrgFilter?: boolean
  showZoneFilter?: boolean
  className?: string
}

export function GlobalFilterRibbon({
  showDateFilter = true,
  showOrgFilter = true,
  showZoneFilter = true,
  className,
}: GlobalFilterRibbonProps) {
  const { user } = useAuthStore()
  const {
    dateFrom,
    dateTo,
    datePreset,
    organizationId,
    organizationName,
    zoneId,
    zoneName,
    setDateRange,
    setOrganization,
    setZone,
    setToday,
    setYesterday,
    setPrevDay,
    setNextDay,
    clearFilters,
  } = useGlobalFiltersStore()

  // Fetch organizations
  const { data: organizations } = useQuery({
    queryKey: ['organizations-filter'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('organizations') as any)
        .select('id, name')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data
    },
    enabled: showOrgFilter && user?.role === 'master',
  })

  // Fetch zones
  const { data: zones } = useQuery({
    queryKey: ['zones-filter', organizationId],
    queryFn: async () => {
      let query = (supabase.from('zones') as any)
        .select('id, name')
        .eq('is_active', true)
        .order('name')

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error } = await query
      if (error) throw error
      return data
    },
    enabled: showZoneFilter,
  })

  const hasActiveFilters = dateFrom || dateTo || organizationId || zoneId

  return (
    <div className={cn('bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700', className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Filter */}
          {showDateFilter && (
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="h-4 w-4 text-gray-500" />
              <div className="flex items-center gap-1">
                <Button
                  variant={datePreset === 'today' ? 'default' : 'outline'}
                  size="sm"
                  onClick={setToday}
                >
                  Today
                </Button>
                <Button
                  variant={datePreset === 'yesterday' ? 'default' : 'outline'}
                  size="sm"
                  onClick={setYesterday}
                >
                  Yesterday
                </Button>
                
                {dateFrom && (
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={setPrevDay}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium px-2 whitespace-nowrap">
                      {new Date(dateFrom).toLocaleDateString()}
                      {dateTo && dateTo !== dateFrom && ` - ${new Date(dateTo).toLocaleDateString()}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={setNextDay}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Organization Filter */}
          {showOrgFilter && user?.role === 'master' && (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-500" />
              <Select
                value={organizationId || '__all__'}
                onValueChange={(value) => {
                  if (value === '__all__' || !value) {
                    setOrganization(null, null)
                    return
                  }
                  const org = organizations?.find(o => o.id === value)
                  setOrganization(value, org?.name || null)
                }}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="All Organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Organizations</SelectItem>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Zone Filter */}
          {showZoneFilter && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500" />
              <Select
                value={zoneId || '__all__'}
                onValueChange={(value) => {
                  if (value === '__all__' || !value) {
                    setZone(null, null)
                    return
                  }
                  const zone = zones?.find(z => z.id === value)
                  setZone(value, zone?.name || null)
                }}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="All Zones" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Zones</SelectItem>
                  {zones?.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Clear All Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="ml-auto"
            >
              <X className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
