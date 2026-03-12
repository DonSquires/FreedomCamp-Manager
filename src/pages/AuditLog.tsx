import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { 
  Activity, 
  Search, 
  User,
  FileText,
  Shield,
  AlertCircle,
  Clock,
  Eye,
  Download
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

interface AuditLogEntry {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  old_values: any
  new_values: any
  created_at: string
  user_id: string | null
  organization_id: string | null
  ip_address: string | null
  user_agent: string | null
  user_profile: {
    first_name: string
    last_name: string
    role: string
  } | null
}

export default function AuditLog() {
  const { user } = useAuthStore()
  const { organizationId, dateFrom, dateTo } = useGlobalFiltersStore()
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [searchQuery, setSearchQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null)

  // Only allow admins and masters to access audit log
  const isAuthorized = user?.role === 'admin' || user?.role === 'master'

  // Fetch audit log entries
  const { data: entries, isLoading } = useQuery({
    queryKey: ['audit-log', organizationId, actionFilter, entityFilter, searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      if (!isAuthorized) return []

      let query = supabase
        .from('audit_log')
        .select(`
          id,
          action,
          entity_type,
          entity_id,
          old_values,
          new_values,
          created_at,
          user_id,
          organization_id,
          ip_address,
          user_agent,
          user_profile:user_profiles(first_name, last_name, role)
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      // Date filters
      if (startDate) {
        query = query.gte('created_at', startDate)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      // Action filter
      if (actionFilter !== 'all') {
        query = query.eq('action', actionFilter)
      }

      // Entity type filter
      if (entityFilter !== 'all') {
        query = query.eq('entity_type', entityFilter)
      }

      const { data, error } = await query

      if (error) throw error

      // Filter by search query
      if (searchQuery) {
        return (data as AuditLogEntry[]).filter(entry =>
          entry.user_profile?.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          entry.user_profile?.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          entry.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
          entry.entity_type.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }

      return data as AuditLogEntry[]
    },
    enabled: isAuthorized,
  })

  // Calculate stats
  const stats = entries ? {
    total: entries.length,
    creates: entries.filter(e => e.action === 'create').length,
    updates: entries.filter(e => e.action === 'update').length,
    deletes: entries.filter(e => e.action === 'delete').length,
    unique_users: new Set(entries.map(e => e.user_id).filter(Boolean)).size,
  } : null

  const getActionColor = (action: string) => {
    switch (action) {
      case 'create':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'update':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'delete':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'create':
        return <FileText className="h-4 w-4" />
      case 'update':
        return <Activity className="h-4 w-4" />
      case 'delete':
        return <AlertCircle className="h-4 w-4" />
      default:
        return <Activity className="h-4 w-4" />
    }
  }

  if (!isAuthorized) {
    return (
      <AppLayout
        title="Audit Log"
        description="System activity audit trail"
        showBackButton
      >
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access the audit log. Admin access required.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Audit Log"
      description="System activity audit trail with user actions"
      showBackButton
    >
      <GlobalFilterRibbon showZoneFilter={false} />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-5 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Events</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Creates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.creates}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-1">
                <Activity className="h-3 w-3" />
                Updates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.updates}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Deletes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.deletes}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-1">
                <User className="h-3 w-3" />
                Unique Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.unique_users}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by user or action..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={actionFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setActionFilter('all')}
                size="sm"
              >
                All Actions
              </Button>
              <Button
                variant={actionFilter === 'create' ? 'default' : 'outline'}
                onClick={() => setActionFilter('create')}
                size="sm"
              >
                Creates
              </Button>
              <Button
                variant={actionFilter === 'update' ? 'default' : 'outline'}
                onClick={() => setActionFilter('update')}
                size="sm"
              >
                Updates
              </Button>
              <Button
                variant={actionFilter === 'delete' ? 'default' : 'outline'}
                onClick={() => setActionFilter('delete')}
                size="sm"
              >
                Deletes
              </Button>
            </div>

            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Entries */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading audit log...</p>
        </div>
      ) : entries && entries.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No audit entries found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries?.map((entry) => (
            <Card key={entry.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge className={getActionColor(entry.action)}>
                        {getActionIcon(entry.action)}
                        <span className="ml-1 capitalize">{entry.action}</span>
                      </Badge>
                      <span className="font-medium text-sm">
                        {entry.entity_type.replace(/_/g, ' ')}
                      </span>
                      {entry.entity_id && (
                        <span className="text-xs text-gray-500 font-mono">
                          {entry.entity_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                      {entry.user_profile ? (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {entry.user_profile.first_name} {entry.user_profile.last_name}
                          <Badge variant="outline" className="ml-1 text-xs">
                            {entry.user_profile.role}
                          </Badge>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          System
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(entry.created_at)}
                      </span>
                      {entry.ip_address && (
                        <span className="text-xs font-mono">{entry.ip_address}</span>
                      )}
                    </div>

                    {/* Show changes if update */}
                    {entry.action === 'update' && entry.old_values && entry.new_values && (
                      <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                        <div className="font-semibold mb-1">Changes:</div>
                        <div className="space-y-1">
                          {Object.keys(entry.new_values).map((key) => {
                            const oldVal = entry.old_values?.[key]
                            const newVal = entry.new_values?.[key]
                            if (oldVal === newVal) return null
                            return (
                              <div key={key} className="flex gap-2">
                                <span className="text-gray-500">{key}:</span>
                                <span className="text-red-600 line-through">{String(oldVal)}</span>
                                <span>→</span>
                                <span className="text-green-600">{String(newVal)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
