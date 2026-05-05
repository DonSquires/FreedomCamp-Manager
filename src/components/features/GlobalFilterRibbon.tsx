import { useEffect, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, Building2, MapPin, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'

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
  const [, startTransition] = useTransition()
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

  // Non-master users are fixed to their own organization scope unless they are
  // admin/admin_officer with multi-org (descendant) access.
  const canSwitchOrg =
    user?.role === 'master' ||
    user?.role === 'grand_master' ||
    user?.role === 'admin' ||
    user?.role === 'admin_officer'

  const effectiveOrganizationId =
    canSwitchOrg && organizationId
      ? organizationId
      : user?.organization_id ?? null

  // For master/grand_master: fetch all orgs.
  // For admin/admin_officer: fetch descendant orgs only so they can't
  // spoof other org IDs that aren't in their access tree.
  const isMasterLevel = user?.role === 'master' || user?.role === 'grand_master'

  const { data: organizations } = useQuery({
    queryKey: ['organizations-filter', user?.organization_id, isMasterLevel],
    queryFn: async () => {
      if (isMasterLevel) {
        const { data, error } = await (supabase.from('organizations') as any)
          .select('id, name')
          .eq('is_active', true)
          .order('name')
        if (error) throw error
        return data as { id: string; name: string }[]
      }
      // admin / admin_officer — fetch descendant tree only
      const { data, error } = await (supabase.rpc as any)(
        'get_descendant_organizations',
        { org_id: user?.organization_id },
      )
      if (error) throw error
      const ids: string[] = (data ?? []) as string[]
      if (ids.length <= 1) return []  // Only own org — no switcher needed
      const { data: orgs, error: orgsErr } = await (supabase.from('organizations') as any)
        .select('id, name')
        .in('id', ids)
        .eq('is_active', true)
        .order('name')
      if (orgsErr) throw orgsErr
      return (orgs ?? []) as { id: string; name: string }[]
    },
    enabled: showOrgFilter && canSwitchOrg,
    staleTime: 5 * 60 * 1000,
  })

  // Fetch zones
  const { data: zones } = useQuery({
    queryKey: ['zones-filter', effectiveOrganizationId],
    queryFn: async () => {
      let query = (supabase.from('zones') as any)
        .select('id, name')
        .eq('is_active', true)
        .order('name')

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      const { data, error } = await query
      if (error) throw error
      return data
    },
    enabled: showZoneFilter,
  })

  // If persisted zone filter does not belong to current scoped zone list, clear it.
  useEffect(() => {
    if (!zoneId || !zones) return
    const zoneStillValid = zones.some((z: any) => z.id === zoneId)
    if (!zoneStillValid) {
      setZone(null, null)
    }
  }, [zoneId, zones, setZone])

  const hasActiveFilters = dateFrom || dateTo || organizationId || zoneId

  const handleFromDateChange = (value: string) => {
    const nextFrom = value || null
    const safeTo = dateTo && nextFrom && dateTo < nextFrom ? nextFrom : dateTo
    setDateRange(nextFrom, safeTo, nextFrom || safeTo ? 'custom' : null)
  }

  const handleToDateChange = (value: string) => {
    const nextTo = value || null
    const safeFrom = dateFrom && nextTo && dateFrom > nextTo ? nextTo : dateFrom
    setDateRange(safeFrom, nextTo, safeFrom || nextTo ? 'custom' : null)
  }

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
                      {formatDate(dateFrom)}
                      {dateTo && dateTo !== dateFrom && ` - ${formatDate(dateTo)}`}
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

              <div className="flex items-center gap-2 ml-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">From</span>
                  <Input
                    type="date"
                    value={dateFrom || ''}
                    onChange={(e) => handleFromDateChange(e.target.value)}
                    max={dateTo || undefined}
                    className="h-8 w-[150px]"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">To</span>
                  <Input
                    type="date"
                    value={dateTo || ''}
                    onChange={(e) => handleToDateChange(e.target.value)}
                    min={dateFrom || undefined}
                    className="h-8 w-[150px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Organization Filter */}
          {showOrgFilter && canSwitchOrg && organizations && organizations.length > 0 && (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-500" />
              <Select
                value={organizationId || '__all__'}
                onValueChange={(value) => {
                  const prevOrgId = organizationId
                  const nextOrgId = (value === '__all__' || !value) ? null : value
                  startTransition(() => {
                    if (!nextOrgId) {
                      setOrganization(null, null)
                      setZone(null, null)
                    } else {
                      const org = organizations?.find(o => o.id === nextOrgId)
                      setOrganization(nextOrgId, org?.name || null)
                      setZone(null, null)
                    }
                  })
                  // Audit the org context switch (fire-and-forget; never blocks the UI)
                  if (prevOrgId !== nextOrgId && user?.id) {
                    supabase.from('audit_log').insert({
                      action: 'org_context_switch',
                      entity_type: 'organization',
                      entity_id: nextOrgId ?? prevOrgId,
                      performed_by: user.id,
                      organization_id: user.organization_id ?? null,
                      old_values: { organization_id: prevOrgId },
                      new_values: { organization_id: nextOrgId },
                    } as any)
                  }
                }}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="All Organisations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Organisations</SelectItem>
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
                  startTransition(() => {
                    if (value === '__all__' || !value) {
                      setZone(null, null)
                      return
                    }
                    const zone = zones?.find(z => z.id === value)
                    setZone(value, zone?.name || null)
                  })
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
