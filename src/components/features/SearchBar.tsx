/**
 * SearchBar Component
 * Global search with filters
 */

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Search,
  X,
  Filter,
  Calendar,
  MapPin,
  Car,
  User,
  AlertCircle,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface SearchFilter {
  id: string
  label: string
  icon: React.ReactNode
  isActive: boolean
}

interface SearchBarProps {
  value?: string
  onChange: (value: string) => void
  onSearch?: (query: string, filters: string[]) => void
  placeholder?: string
  availableFilters?: SearchFilter[]
  showQuickFilters?: boolean
}

export function SearchBar({
  value = '',
  onChange,
  onSearch,
  placeholder = 'Search...',
  availableFilters = DEFAULT_FILTERS,
  showQuickFilters = true,
}: SearchBarProps) {
  const [searchValue, setSearchValue] = useState(value)
  const [activeFilters, setActiveFilters] = useState<string[]>([])
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  useEffect(() => {
    setSearchValue(value)
  }, [value])

  const handleChange = (newValue: string) => {
    setSearchValue(newValue)
    onChange(newValue)
  }

  const handleSearch = () => {
    if (onSearch) {
      onSearch(searchValue, activeFilters)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleClear = () => {
    setSearchValue('')
    onChange('')
    setActiveFilters([])
  }

  const toggleFilter = (filterId: string) => {
    setActiveFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((id) => id !== filterId)
        : [...prev, filterId]
    )
  }

  const activeFilterCount = activeFilters.length

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            className="pl-10 pr-10"
          />
          {searchValue && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Button onClick={handleSearch}>
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>

        {/* Filter button */}
        <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="relative">
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-2 px-1.5 py-0 text-xs"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </SheetTrigger>

          <SheetContent>
            <SheetHeader>
              <SheetTitle>Search Filters</SheetTitle>
              <SheetDescription>
                Refine your search by selecting filters
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {availableFilters.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => toggleFilter(filter.id)}
                  className={`w-full p-3 border rounded-lg text-left hover:bg-muted transition-colors ${
                    activeFilters.includes(filter.id)
                      ? 'bg-primary/10 border-primary'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-muted-foreground">{filter.icon}</div>
                      <span className="font-medium">{filter.label}</span>
                    </div>
                    {activeFilters.includes(filter.id) && (
                      <Badge variant="default">Active</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-6 flex gap-2">
              <Button
                variant="outline"
                onClick={() => setActiveFilters([])}
                className="flex-1"
              >
                Clear All
              </Button>
              <Button onClick={() => setIsFilterOpen(false)} className="flex-1">
                Apply Filters
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Quick filters (chips) */}
      {showQuickFilters && activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filterId) => {
            const filter = availableFilters.find((f) => f.id === filterId)
            if (!filter) return null

            return (
              <Badge
                key={filterId}
                variant="secondary"
                className="pl-2 pr-1 py-1"
              >
                <span className="mr-1">{filter.label}</span>
                <button
                  onClick={() => toggleFilter(filterId)}
                  className="hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Default filter options
const DEFAULT_FILTERS: SearchFilter[] = [
  {
    id: 'vehicles',
    label: 'Vehicles',
    icon: <Car className="h-4 w-4" />,
    isActive: false,
  },
  {
    id: 'observations',
    label: 'Observations',
    icon: <Calendar className="h-4 w-4" />,
    isActive: false,
  },
  {
    id: 'zones',
    label: 'Zones',
    icon: <MapPin className="h-4 w-4" />,
    isActive: false,
  },
  {
    id: 'users',
    label: 'Users',
    icon: <User className="h-4 w-4" />,
    isActive: false,
  },
  {
    id: 'breaches',
    label: 'Breaches',
    icon: <AlertCircle className="h-4 w-4" />,
    isActive: false,
  },
]
