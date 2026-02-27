/**
 * FilterChips Component
 * Active filter display with remove capability
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X, RotateCcw } from 'lucide-react'

interface Filter {
  id: string
  label: string
  value: string
  icon?: React.ReactNode
}

interface FilterChipsProps {
  filters: Filter[]
  onRemove: (filterId: string) => void
  onClearAll?: () => void
  showCount?: boolean
}

export function FilterChips({
  filters,
  onRemove,
  onClearAll,
  showCount = true,
}: FilterChipsProps) {
  if (filters.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {showCount && (
        <span className="text-sm text-muted-foreground">
          {filters.length} filter{filters.length !== 1 ? 's' : ''}:
        </span>
      )}

      {filters.map((filter) => (
        <Badge
          key={filter.id}
          variant="secondary"
          className="pl-2 pr-1 py-1 gap-2"
        >
          {filter.icon}
          <span className="text-sm">
            {filter.label}: <span className="font-medium">{filter.value}</span>
          </span>
          <button
            onClick={() => onRemove(filter.id)}
            className="hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {onClearAll && filters.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-7 px-2 text-xs"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Clear All
        </Button>
      )}
    </div>
  )
}
