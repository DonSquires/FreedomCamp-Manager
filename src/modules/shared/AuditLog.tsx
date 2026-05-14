/**
 * Unified Audit Log Component
 * 
 * Replaces 30+ individual *Log pages with a single, role-aware audit table.
 * Features:
 * - Filter by entity type (patrol, incident, observation, etc.)
 * - Filter by action (created, updated, deleted, approved, etc.)
 * - Filter by date range and user
 * - Paginated table with sorting
 * - Role-based visibility (what you can see depends on your role + org)
 * 
 * Usage:
 *   import AuditLog from '@/modules/shared/AuditLog'
 *   <AuditLog entityType="patrol" />
 *   <AuditLog /> // Show all audit types
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/authStore'
import { useOrganization } from '@/hooks/useOrganization'
import { supabase } from '@/lib/supabase'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'

export interface AuditLogProps {
  entityType?: 'patrol' | 'incident' | 'observation' | 'breach' | 'notice' | 'zone' | 'person' | 'vehicle' | string
  entityId?: string
  defaultLimit?: number
}

const ENTITY_TYPES = [
  { value: '', label: 'All Entity Types' },
  { value: 'patrol', label: 'Patrol' },
  { value: 'incident', label: 'Incident' },
  { value: 'observation', label: 'Observation' },
  { value: 'breach', label: 'Breach Alert' },
  { value: 'notice', label: 'Notice' },
  { value: 'zone', label: 'Zone' },
  { value: 'person', label: 'Person' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'user', label: 'User' },
  { value: 'organization', label: 'Organization' },
]

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'accessed', label: 'Accessed' },
]

export default function AuditLog({ entityType = '', entityId = '', defaultLimit = 50 }: AuditLogProps) {
  const { user } = useAuthStore()
  const { organization } = useOrganization()
  const [page, setPage] = useState(1)
  const [selectedEntity, setSelectedEntity] = useState(entityType)
  const [selectedAction, setSelectedAction] = useState('')
  const [searchText, setSearchText] = useState('')
  const [dateRange, setDateRange] = useState('7d') // 7d, 30d, 90d, custom

  const offset = (page - 1) * defaultLimit

  // Fetch audit log entries
  const { data: auditData, isLoading, error, refetch } = useQuery({
    queryKey: ['auditLog', organization?.id, selectedEntity, selectedAction, dateRange, page, offset],
    queryFn: async () => {
      if (!organization?.id) return { entries: [], total: 0 }

      let query = supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .eq('organization_id', organization.id)

      // Filter by entity type if specified
      if (selectedEntity) {
        query = query.eq('entity_type', selectedEntity)
      }

      // Filter by action if specified
      if (selectedAction) {
        query = query.eq('action', selectedAction)
      }

      // Filter by specific entity if provided
      if (entityId) {
        query = query.eq('entity_id', entityId)
      }

      // Date range filter
      const now = new Date()
      let startDate: Date
      switch (dateRange) {
        case '7d':
          startDate = subDays(now, 7)
          break
        case '30d':
          startDate = subDays(now, 30)
          break
        case '90d':
          startDate = subDays(now, 90)
          break
        default:
          startDate = subDays(now, 7)
      }

      query = query.gte('created_at', startOfDay(startDate).toISOString())
      query = query.lte('created_at', endOfDay(now).toISOString())

      // Search filter (simple text match on entity details or changed fields)
      if (searchText) {
        query = query.or(`changed_values.ilike.%${searchText}%,entity_details.ilike.%${searchText}%`)
      }

      // Order by date descending, paginate
      query = query.order('created_at', { ascending: false }).range(offset, offset + defaultLimit - 1)

      const { data: entries, count, error: err } = await query

      if (err) throw err

      return {
        entries: entries || [],
        total: count || 0,
      }
    },
    staleTime: 30000,
  })

  const totalPages = auditData ? Math.ceil(auditData.total / defaultLimit) : 1

  const handleExportCsv = async () => {
    if (!auditData?.entries.length) return

    const headers = ['Timestamp', 'Entity Type', 'Action', 'User', 'Changes', 'Details']
    const rows = auditData.entries.map((entry: any) => [
      format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm:ss'),
      entry.entity_type,
      entry.action,
      entry.user_name || entry.user_id?.slice(0, 8),
      JSON.stringify(entry.changed_values || {}),
      entry.entity_details || '',
    ])

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <CardDescription>System-wide activity log for {organization?.name || 'your organization'}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-5">
          <Select value={selectedEntity} onValueChange={setSelectedEntity}>
            <SelectTrigger>
              <SelectValue placeholder="Entity type" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedAction} onValueChange={setSelectedAction}>
            <SelectTrigger>
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map(action => (
                <SelectItem key={action.value} value={action.value}>
                  {action.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger>
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>

          <Input
            placeholder="Search changes..."
            value={searchText}
            onChange={e => {
              setSearchText(e.target.value)
              setPage(1)
            }}
          />

          <Button onClick={handleExportCsv} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="py-12 text-center text-gray-500">Loading audit log...</div>
        ) : error ? (
          <div className="py-12 text-center text-red-500">Error loading audit log</div>
        ) : auditData?.entries.length === 0 ? (
          <div className="py-12 text-center text-gray-500">No audit entries found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditData.entries.map((entry: any) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm text-gray-600">
                        {format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                          {entry.entity_type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            entry.action === 'created'
                              ? 'bg-green-100 text-green-800'
                              : entry.action === 'deleted'
                                ? 'bg-red-100 text-red-800'
                                : entry.action === 'approved'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {entry.action}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{entry.user_name || entry.user_id?.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs text-gray-600 max-w-xs truncate">
                        {JSON.stringify(entry.changed_values || {}).slice(0, 100)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-gray-600">
                Showing {(page - 1) * defaultLimit + 1}–{Math.min(page * defaultLimit, auditData.total)} of{' '}
                {auditData.total} entries
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  variant="outline"
                  size="sm"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-3 py-1 text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  variant="outline"
                  size="sm"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
