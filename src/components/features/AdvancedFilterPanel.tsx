import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  Filter, 
  X, 
  Save, 
  ChevronDown, 
  ChevronUp,
  Calendar,
  MapPin,
  Car,
  AlertCircle
} from 'lucide-react'

export interface FilterPreset {
  id: string
  name: string
  filters: Record<string, any>
}

export interface AdvancedFilters {
  plateNumber?: string
  zoneIds?: string[]
  dateFrom?: string
  dateTo?: string
  complianceStatus?: 'compliant' | 'breach' | 'all'
  selfContained?: boolean | null
  homelessStatus?: string | null
  minObservations?: number
  maxObservations?: number
  hasEnforcement?: boolean | null
}

interface AdvancedFilterPanelProps {
  filters: AdvancedFilters
  onFiltersChange: (filters: AdvancedFilters) => void
  presets?: FilterPreset[]
  onSavePreset?: (name: string, filters: AdvancedFilters) => void
  onLoadPreset?: (preset: FilterPreset) => void
  onDeletePreset?: (presetId: string) => void
}

export function AdvancedFilterPanel({
  filters,
  onFiltersChange,
  presets = [],
  onSavePreset,
  onLoadPreset,
  onDeletePreset
}: AdvancedFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [showSavePreset, setShowSavePreset] = useState(false)

  const activeFilterCount = Object.keys(filters).filter(key => {
    const value = filters[key as keyof AdvancedFilters]
    return value !== undefined && value !== null && value !== '' && value !== 'all'
  }).length

  const handleClearAll = () => {
    onFiltersChange({})
  }

  const handleSavePreset = () => {
    if (presetName.trim() && onSavePreset) {
      onSavePreset(presetName.trim(), filters)
      setPresetName('')
      setShowSavePreset(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            <CardTitle className="text-lg">Advanced Filters</CardTitle>
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeFilterCount} active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
              >
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {/* Saved Presets */}
          {presets.length > 0 && (
            <div>
              <Label className="mb-2 block">Saved Filters</Label>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onLoadPreset?.(preset)}
                    >
                      {preset.name}
                    </Button>
                    {onDeletePreset && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeletePreset(preset.id)}
                        className="h-8 w-8 p-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Current Filters */}
          {onSavePreset && activeFilterCount > 0 && (
            <div>
              {showSavePreset ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="Preset name..."
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSavePreset()}
                  />
                  <Button onClick={handleSavePreset} size="sm">
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowSavePreset(false)
                      setPresetName('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSavePreset(true)}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Current Filters
                </Button>
              )}
            </div>
          )}

          {/* Filter Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Plate Number */}
            <div>
              <Label htmlFor="plate-filter">
                <Car className="h-4 w-4 inline mr-2" />
                Plate Number
              </Label>
              <Input
                id="plate-filter"
                placeholder="ABC123"
                value={filters.plateNumber || ''}
                onChange={(e) => onFiltersChange({ ...filters, plateNumber: e.target.value })}
                className="mt-2"
              />
            </div>

            {/* Date Range */}
            <div>
              <Label htmlFor="date-from">
                <Calendar className="h-4 w-4 inline mr-2" />
                Date From
              </Label>
              <Input
                id="date-from"
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="date-to">
                <Calendar className="h-4 w-4 inline mr-2" />
                Date To
              </Label>
              <Input
                id="date-to"
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value })}
                className="mt-2"
              />
            </div>

            {/* Compliance Status */}
            <div>
              <Label htmlFor="compliance-status">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                Compliance Status
              </Label>
              <select
                id="compliance-status"
                value={filters.complianceStatus || 'all'}
                onChange={(e) => onFiltersChange({ ...filters, complianceStatus: e.target.value as any })}
                className="w-full mt-2 px-3 py-2 border rounded-md"
              >
                <option value="all">All</option>
                <option value="compliant">Compliant Only</option>
                <option value="breach">Breaches Only</option>
              </select>
            </div>

            {/* Self-Contained */}
            <div>
              <Label htmlFor="self-contained">Self-Contained</Label>
              <select
                id="self-contained"
                value={filters.selfContained === null ? 'all' : filters.selfContained ? 'true' : 'false'}
                onChange={(e) => {
                  const value = e.target.value === 'all' ? null : e.target.value === 'true'
                  onFiltersChange({ ...filters, selfContained: value })
                }}
                className="w-full mt-2 px-3 py-2 border rounded-md"
              >
                <option value="all">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>

            {/* Homeless Status */}
            <div>
              <Label htmlFor="homeless-status">Homeless Status</Label>
              <select
                id="homeless-status"
                value={filters.homelessStatus || 'all'}
                onChange={(e) => {
                  const value = e.target.value === 'all' ? null : e.target.value
                  onFiltersChange({ ...filters, homelessStatus: value })
                }}
                className="w-full mt-2 px-3 py-2 border rounded-md"
              >
                <option value="all">All</option>
                <option value="none">None</option>
                <option value="suspected">Suspected</option>
                <option value="likely">Likely</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </div>

            {/* Observation Range */}
            <div>
              <Label htmlFor="min-obs">Min Observations</Label>
              <Input
                id="min-obs"
                type="number"
                min="0"
                value={filters.minObservations || ''}
                onChange={(e) => onFiltersChange({ ...filters, minObservations: parseInt(e.target.value) || undefined })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="max-obs">Max Observations</Label>
              <Input
                id="max-obs"
                type="number"
                min="0"
                value={filters.maxObservations || ''}
                onChange={(e) => onFiltersChange({ ...filters, maxObservations: parseInt(e.target.value) || undefined })}
                className="mt-2"
              />
            </div>

            {/* Has Enforcement */}
            <div>
              <Label htmlFor="has-enforcement">Enforcement Actions</Label>
              <select
                id="has-enforcement"
                value={filters.hasEnforcement === null ? 'all' : filters.hasEnforcement ? 'true' : 'false'}
                onChange={(e) => {
                  const value = e.target.value === 'all' ? null : e.target.value === 'true'
                  onFiltersChange({ ...filters, hasEnforcement: value })
                }}
                className="w-full mt-2 px-3 py-2 border rounded-md"
              >
                <option value="all">All</option>
                <option value="true">Has Enforcement</option>
                <option value="false">No Enforcement</option>
              </select>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
