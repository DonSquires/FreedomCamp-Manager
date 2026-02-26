import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  const {
    dateFrom,
    dateTo,
    datePreset,
    organizationName,
    zoneName,
    setDateRange,
    setToday,
    setYesterday,
    setPrevDay,
    setNextDay,
    clearFilters,
  } = useGlobalFiltersStore()

  const hasActiveFilters = dateFrom || dateTo || organizationName || zoneName

  return (
    <div className={cn('bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700', className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Filter */}
          {showDateFilter && (
            <div className="flex items-center gap-2">
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
                    <span className="text-sm font-medium px-2">
                      {new Date(dateFrom).toLocaleDateString()}
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
          {showOrgFilter && organizationName && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <Building2 className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {organizationName}
              </span>
            </div>
          )}

          {/* Zone Filter */}
          {showZoneFilter && zoneName && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-md">
              <MapPin className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900 dark:text-green-100">
                {zoneName}
              </span>
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
