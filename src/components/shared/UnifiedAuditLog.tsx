/**
 * UnifiedAuditLog - Reusable audit history component
 * 
 * Replaces 30+ scattered *Log pages with a single configurable component.
 * Displays inline in detail pages or as standalone audit view.
 * See docs/ENTERPRISE_UI_CONSOLIDATION_PATTERNS.md §3
 */

import { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
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

export interface AuditEntry {
  id: string
  entity_type: string
  entity_id: string
  user_id: string
  user_name?: string
  action: 'created' | 'updated' | 'deleted' | 'archived'
  changes?: Record<string, { old: any; new: any }>
  timestamp: string
  ip_address?: string
}

interface UnifiedAuditLogProps {
  entityType?: string
  entityId?: string
  inline?: boolean // true for tab in detail page
  className?: string
}

export function UnifiedAuditLog({
  entityType,
  entityId,
  inline = false,
  className = '',
}: UnifiedAuditLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [actionFilter, setActionFilter] = useState<string | undefined>()
  const [userSearch, setUserSearch] = useState('')

  const loadAuditHistory = useCallback(async () => {
    if (!entityType || !entityId) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: entityId,
      })
      if (actionFilter) params.append('action', actionFilter)
      if (userSearch) params.append('user_name', userSearch)

      const response = await fetch(`/api/audit-log?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to load audit history')

      const data = await response.json()
      setEntries(Array.isArray(data) ? data : data.entries || [])
    } catch (error) {
      console.error('Audit load error:', error)
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId, actionFilter, userSearch])

  useEffect(() => {
    void loadAuditHistory()
  }, [loadAuditHistory])

  const getActionColor = (action: string) => {
    switch (action) {
      case 'created':
        return 'bg-green-100 text-green-800'
      case 'updated':
        return 'bg-blue-100 text-blue-800'
      case 'deleted':
        return 'bg-red-100 text-red-800'
      case 'archived':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {!inline && (
        <div>
          <h3 className="text-lg font-semibold">Audit History</h3>
          <p className="text-sm text-muted-foreground">All changes to this record</p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Select value={actionFilter || 'all'} onValueChange={v => setActionFilter(v === 'all' ? undefined : v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Filter by user..."
          value={userSearch}
          onChange={e => setUserSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Audit Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Changes</TableHead>
              {!inline && <TableHead>IP Address</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={inline ? 4 : 5} className="text-center py-4">
                  Loading...
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={inline ? 4 : 5} className="text-center py-4 text-muted-foreground">
                  No changes recorded
                </TableCell>
              </TableRow>
            ) : (
              entries.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm">
                    <span title={new Date(entry.timestamp).toLocaleString()}>
                      {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={getActionColor(entry.action)}>
                      {entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{entry.user_name || entry.user_id || 'System'}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate font-mono">
                    {entry.changes && Object.keys(entry.changes).length > 0 ? (
                      <code>{Object.keys(entry.changes).join(', ')}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {!inline && (
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.ip_address || 'N/A'}
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
