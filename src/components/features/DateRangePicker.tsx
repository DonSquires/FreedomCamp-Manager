/**
 * DateRangePicker Component
 * Advanced date selection with presets
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Calendar, X } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface DateRange {
  from: string
  to: string
}

interface DateRangePickerProps {
  value?: DateRange
  onChange: (range: DateRange) => void
  presets?: DatePreset[]
  placeholder?: string
}

interface DatePreset {
  label: string
  getValue: () => DateRange
}

export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  placeholder = 'Select date range',
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(value?.from || '')
  const [customTo, setCustomTo] = useState(value?.to || '')

  const handlePresetClick = (preset: DatePreset) => {
    const range = preset.getValue()
    onChange(range)
    setCustomFrom(range.from)
    setCustomTo(range.to)
    setIsOpen(false)
  }

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      onChange({ from: customFrom, to: customTo })
      setIsOpen(false)
    }
  }

  const handleClear = () => {
    onChange({ from: '', to: '' })
    setCustomFrom('')
    setCustomTo('')
  }

  const formatDateRange = (range?: DateRange) => {
    if (!range || (!range.from && !range.to)) {
      return placeholder
    }

    const from = range.from ? new Date(range.from).toLocaleDateString() : '...'
    const to = range.to ? new Date(range.to).toLocaleDateString() : '...'
    
    return `${from} - ${to}`
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{formatDateRange(value)}</span>
          </div>
          {value && (value.from || value.to) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
              className="ml-2 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Select Date Range
          </SheetTitle>
          <SheetDescription>
            Choose a preset or set custom dates
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Presets */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Quick Presets</div>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick(preset)}
                  className="justify-start"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom range */}
          <div className="space-y-3 border-t pt-6">
            <div className="text-sm font-medium">Custom Range</div>
            
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">From</label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">To</label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                min={customFrom}
              />
            </div>

            <Button
              onClick={handleCustomApply}
              disabled={!customFrom || !customTo}
              className="w-full"
            >
              Apply Custom Range
            </Button>
          </div>

          {/* Clear button */}
          {value && (value.from || value.to) && (
            <Button
              variant="outline"
              onClick={handleClear}
              className="w-full"
            >
              <X className="h-4 w-4 mr-2" />
              Clear Selection
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Default date presets
const DEFAULT_PRESETS: DatePreset[] = [
  {
    label: 'Today',
    getValue: () => {
      const today = new Date().toISOString().split('T')[0]
      return { from: today, to: today }
    },
  },
  {
    label: 'Yesterday',
    getValue: () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const date = yesterday.toISOString().split('T')[0]
      return { from: date, to: date }
    },
  },
  {
    label: 'Last 7 Days',
    getValue: () => {
      const to = new Date().toISOString().split('T')[0]
      const from = new Date()
      from.setDate(from.getDate() - 6)
      return { from: from.toISOString().split('T')[0], to }
    },
  },
  {
    label: 'Last 30 Days',
    getValue: () => {
      const to = new Date().toISOString().split('T')[0]
      const from = new Date()
      from.setDate(from.getDate() - 29)
      return { from: from.toISOString().split('T')[0], to }
    },
  },
  {
    label: 'This Month',
    getValue: () => {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date().toISOString().split('T')[0]
      return { from: from.toISOString().split('T')[0], to }
    },
  },
  {
    label: 'Last Month',
    getValue: () => {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0)
      return {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0],
      }
    },
  },
]
