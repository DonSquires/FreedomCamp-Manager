/**
 * AuditLogViewer Component
 * Searchable audit trail with filters
 */

import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { useAuditLogs } from '@/hooks/useAuditLogs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  FileText,
  Search,
  Filter,
  Calendar,
  User,
  Activity,
  RefreshCw,
  Download,
} from 'lucide-react'

interface AuditLogViewerProps {
  limit?: number
  onExport?: () => void
}

export function AuditLogViewer({
  limit = 50,
  onExport,
}: AuditLogViewerProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterAction, setFilterAction] = useState<string>('all')
  const [filterEntity, setFilterEntity] = useState<string>('all')

  const { logs: auditLogs, isLoading, refetch } = useAuditLogs({ limit })

  const getActionBadge = (action: string) => {
    const actionColors: Record<string, string> = {
      create: 'bg-green-600',
      update: 'bg-blue-600',
      delete: 'bg-red-600',
      view: 'bg-gray-600',
    }

    return (
      <Badge className={actionColors[action.toLowerCase()] || 'bg-gray-600'}>
        {action.toUpperCase()}
      </Badge>
    )
  }

  const getEntityIcon = (entityType: string) => {
    // Return appropriate icon based on entity type
    return <Activity className="h-4 w-4" />
  }

  // Filter audit logs
  const filteredLogs = auditLogs?.filter((log: any) => {
    // Search filter
    const searchLower = searchTerm.toLowerCase()
    const matchesSearch = 
      log.action?.toLowerCase().includes(searchLower) ||
      log.entity_type?.toLowerCase().includes(searchLower) ||
      log.user_email?.toLowerCase().includes(searchLower)
    
    if (searchTerm && !matchesSearch) return false

    // Action filter
    if (filterAction !== 'all' && log.action?.toLowerCase() !== filterAction.toLowerCase()) {
      return false
    }

    // Entity filter
    if (filterEntity !== 'all' && log.entity_type !== filterEntity) {
      return false
    }

    return true
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Audit Log
            </CardTitle>
            <CardDescription className="mt-1">
              Complete system activity trail
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search actions, entities, or users..."
                className="pl-10"
              />
            </div>
          </div>

          {/* Action filter */}
          <div className="flex gap-2">
            <Button
              variant={filterAction === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAction('all')}
            >
              All
            </Button>
            <Button
              variant={filterAction === 'create' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAction('create')}
            >
              Create
            </Button>
            <Button
              variant={filterAction === 'update' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAction('update')}
            >
              Update
            </Button>
            <Button
              variant={filterAction === 'delete' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAction('delete')}
            >
              Delete
            </Button>
          </div>
        </div>

        {/* Audit log entries */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading audit logs...
          </div>
        ) : filteredLogs && filteredLogs.length > 0 ? (
          <div className="space-y-2">
            {filteredLogs.map((log: any) => (
              <Card key={log.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    {getEntityIcon(log.entity_type)}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getActionBadge(log.action)}
                        <span className="font-medium">{log.entity_type}</span>
                        {log.entity_id && (
                          <span className="text-sm text-muted-foreground">
                            #{log.entity_id.substring(0, 8)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>{log.user_email || 'System'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDateTime(log.created_at)}</span>
                        </div>
                      </div>

                      {/* Changed values */}
                      {(log.old_values || log.new_values) && (
                        <div className="p-2 bg-muted rounded text-xs mt-2">
                          {log.old_values && (
                            <div className="mb-1">
                              <span className="font-medium">Previous:</span>{' '}
                              {JSON.stringify(log.old_values)}
                            </div>
                          )}
                          {log.new_values && (
                            <div>
                              <span className="font-medium">New:</span>{' '}
                              {JSON.stringify(log.new_values)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* IP and user agent */}
                      {(log.ip_address || log.user_agent) && (
                        <div className="text-xs text-muted-foreground mt-2">
                          {log.ip_address && (
                            <div>IP: {log.ip_address}</div>
                          )}
                          {log.user_agent && (
                            <div className="truncate">Agent: {log.user_agent}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No audit logs found</p>
            {searchTerm && (
              <p className="text-sm mt-1">Try adjusting your search filters</p>
            )}
          </div>
        )}

        {/* Count */}
        {filteredLogs && filteredLogs.length > 0 && (
          <div className="text-sm text-center text-muted-foreground border-t pt-4">
            Showing {filteredLogs.length} audit log{filteredLogs.length > 1 ? 's' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
