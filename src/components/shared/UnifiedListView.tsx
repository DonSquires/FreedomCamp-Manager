/**
 * UnifiedListView - Reusable list component for all entity types
 * 
 * Reduces page duplication by using a config-driven approach.
 * See docs/ENTERPRISE_UI_CONSOLIDATION_PATTERNS.md §9.4
 */

import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface FilterDef {
  key: string
  label: string
  type: 'text' | 'select' | 'date' | 'user_select'
  options?: { value: string; label: string }[]
  placeholder?: string
}

export interface ColumnDef {
  key: string
  label: string
  width?: string
  render?: (value: any, row: any) => React.ReactNode
}

export interface UnifiedListConfig<T> {
  apiEndpoint: string
  columns: ColumnDef[]
  filters?: FilterDef[]
  detailPath?: string
  actions?: {
    label: string
    onClick: (row: T) => void
    variant?: 'default' | 'outline' | 'destructive'
  }[]
  enableSearch?: boolean
  searchPlaceholder?: string
  title?: string
  description?: string
}

interface UnifiedListViewProps<T> {
  config: UnifiedListConfig<T>
}

export function UnifiedListView<T extends { id: string | number }>({
  config,
}: UnifiedListViewProps<T>) {
  const navigate = useNavigate()
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState<Record<string, any>>({})
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'created_at',
    dir: 'desc',
  })

  const handleFetch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()

      // Add search query
      if (searchQuery && config.enableSearch) {
        params.append('search', searchQuery)
      }

      // Add filters
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(`filter_${key}`, String(value))
        }
      })

      // Add sort
      params.append('sort', sort.field)
      params.append('dir', sort.dir)

      const url = `${config.apiEndpoint}?${params.toString()}`
      const response = await fetch(url)

      if (!response.ok) throw new Error(`API error: ${response.status}`)

      const result = await response.json()
      setData(Array.isArray(result) ? result : result.data || [])
    } catch (error) {
      console.error('Failed to fetch data:', error)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [config, searchQuery, filters, sort])

  useEffect(() => {
    handleFetch()
  }, [handleFetch])

  const handleFilterChange = (filterKey: string, value: any) => {
    setFilters(prev => ({ ...prev, [filterKey]: value }))
  }

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      {(config.title || config.description) && (
        <div>
          {config.title && <h1 className="text-2xl font-bold">{config.title}</h1>}
          {config.description && <p className="text-muted-foreground text-sm">{config.description}</p>}
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex gap-2 flex-wrap items-end">
        {config.enableSearch && (
          <Input
            placeholder={config.searchPlaceholder || 'Search...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        )}

        {config.filters?.map(filter => (
          <div key={filter.key} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{filter.label}</label>
            {filter.type === 'select' ? (
              <Select value={filters[filter.key] || ''} onValueChange={v => handleFilterChange(filter.key, v)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={filter.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  {filter.options?.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={filter.type}
                placeholder={filter.placeholder}
                value={filters[filter.key] || ''}
                onChange={e => handleFilterChange(filter.key, e.target.value)}
                className="w-32"
              />
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {config.columns.map(col => (
                <TableHead key={col.key} style={{ width: col.width }} className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sort.field === col.key && (
                    <span className="ml-2">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
              ))}
              {config.actions && config.actions.length > 0 && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={config.columns.length + (config.actions?.length ? 1 : 0)} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={config.columns.length + (config.actions?.length ? 1 : 0)} className="text-center py-8 text-muted-foreground">
                  No results found
                </TableCell>
              </TableRow>
            ) : (
              data.map(row => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => config.detailPath && navigate(`${config.detailPath}/${row.id}`)}
                >
                  {config.columns.map(col => (
                    <TableCell key={col.key}>
                      {col.render ? col.render((row as any)[col.key], row) : String((row as any)[col.key] || '-')}
                    </TableCell>
                  ))}
                  {config.actions && config.actions.length > 0 && (
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {config.actions.map((action, idx) => (
                          <Button
                            key={idx}
                            size="sm"
                            variant={action.variant || 'outline'}
                            onClick={() => action.onClick(row)}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
