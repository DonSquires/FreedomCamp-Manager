/**
 * NotificationList Component
 * Full notification list with filters
 */

import { useState } from 'react'
import { useOfficerNotifications } from '@/hooks/useOfficerNotifications'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Bell,
  Search,
  Filter,
  CheckCheck,
  Trash2,
  AlertTriangle,
  FileText,
  MapPin,
  Calendar,
  RefreshCw,
} from 'lucide-react'

interface NotificationListProps {
  limit?: number
}

export function NotificationList({
  limit = 50,
}: NotificationListProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'read'>('all')
  const [filterType, setFilterType] = useState<string>('all')

  const { 
    notifications, 
    isLoading, 
    refetch,
    markAsRead,
    deleteNotification,
  } = useOfficerNotifications({
    limit,
    unreadOnly: filterStatus === 'unread',
  })

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'breach':
        return <AlertTriangle className="h-5 w-5 text-red-600" />
      case 'enforcement':
        return <FileText className="h-5 w-5 text-blue-600" />
      case 'patrol':
        return <MapPin className="h-5 w-5 text-green-600" />
      default:
        return <Bell className="h-5 w-5 text-gray-600" />
    }
  }

  // Filter notifications
  const filteredNotifications = notifications?.filter((notification: any) => {
    // Search filter
    if (searchTerm && !notification.plate_number?.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false
    }

    // Status filter
    if (filterStatus === 'unread' && notification.status !== 'pending') {
      return false
    }
    if (filterStatus === 'read' && notification.status === 'pending') {
      return false
    }

    // Type filter
    if (filterType !== 'all' && notification.breach_type !== filterType) {
      return false
    }

    return true
  })

  const unreadCount = notifications?.filter((n: any) => n.status === 'pending').length || 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              All Notifications
            </CardTitle>
            <CardDescription className="mt-1">
              {unreadCount > 0 ? (
                `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
              ) : (
                'You\'re all caught up!'
              )}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="flex-1">
            <Label htmlFor="search" className="sr-only">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by plate number..."
                className="pl-10"
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="flex gap-2">
            <Button
              variant={filterStatus === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus('all')}
            >
              All
            </Button>
            <Button
              variant={filterStatus === 'unread' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus('unread')}
            >
              Unread
            </Button>
            <Button
              variant={filterStatus === 'read' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus('read')}
            >
              Read
            </Button>
          </div>
        </div>

        {/* Notification list */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading notifications...
          </div>
        ) : filteredNotifications && filteredNotifications.length > 0 ? (
          <div className="space-y-3">
            {filteredNotifications.map((notification: any) => (
              <Card
                key={notification.id}
                className={
                  notification.status === 'pending'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : ''
                }
              >
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    {getNotificationIcon(notification.breach_type || 'breach')}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-lg">
                          {notification.plate_number}
                        </span>
                        {notification.status === 'pending' && (
                          <Badge variant="destructive">New</Badge>
                        )}
                        <Badge variant="outline">
                          {notification.breach_type?.replace(/_/g, ' ') || 'Alert'}
                        </Badge>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          <span>{notification.zones?.name || 'Unknown zone'}</span>
                        </div>

                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(notification.created_at).toLocaleString()}</span>
                        </div>

                        {notification.breach_details && (
                          <div className="p-2 bg-muted rounded text-xs mt-2">
                            {typeof notification.breach_details === 'string'
                              ? notification.breach_details
                              : JSON.stringify(notification.breach_details)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1">
                      {notification.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markAsRead(notification.id)}
                          title="Mark as read"
                        >
                          <CheckCheck className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteNotification(notification.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No notifications found</p>
            {searchTerm && (
              <p className="text-sm mt-1">Try adjusting your search filters</p>
            )}
          </div>
        )}

        {/* Count */}
        {filteredNotifications && filteredNotifications.length > 0 && (
          <div className="text-sm text-center text-muted-foreground border-t pt-4">
            Showing {filteredNotifications.length} notification{filteredNotifications.length > 1 ? 's' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
