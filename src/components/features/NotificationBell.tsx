/**
 * NotificationBell Component
 * Notification center with unread badge
 */

import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useOfficerNotifications } from '@/hooks/useOfficerNotifications'
import { 
  Bell,
  BellRing,
  CheckCheck,
  Trash2,
  AlertTriangle,
  FileText,
  Calendar,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'

interface NotificationBellProps {
  showUnreadOnly?: boolean
}

export function NotificationBell({
  showUnreadOnly = false,
}: NotificationBellProps) {
  const { user } = useAuthStore()
  const [isOpen, setIsOpen] = useState(false)

  // Fetch unread count
  const { data: unreadCount } = useQuery({
    queryKey: ['notification-unread-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0

      const { count, error } = await supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to', user.id)
        .eq('status', 'pending')

      if (error) throw error
      return count || 0
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // Poll every 30 seconds
  })

  // Fetch recent notifications using custom hook
  const { notifications, isLoading, markAsRead, deleteNotification } = useOfficerNotifications({
    limit: 10,
    unreadOnly: showUnreadOnly,
  })

  const handleMarkAllRead = async () => {
    if (!notifications || notifications.length === 0) return

    try {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ status: 'acknowledged' })
        .eq('assigned_to', user?.id)
        .eq('status', 'pending')

      if (error) throw error
      toast.success('All notifications marked as read')
    } catch (error: any) {
      toast.error(`Failed to mark all as read: ${error.message}`)
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'breach':
        return <AlertTriangle className="h-4 w-4 text-red-600" />
      case 'enforcement':
        return <FileText className="h-4 w-4 text-blue-600" />
      case 'patrol':
        return <MapPin className="h-4 w-4 text-green-600" />
      default:
        return <Bell className="h-4 w-4 text-gray-600" />
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {unreadCount && unreadCount > 0 ? (
            <BellRing className="h-5 w-5 animate-pulse" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unreadCount && unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </SheetTitle>
          <SheetDescription>
            {unreadCount && unreadCount > 0 ? (
              `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
            ) : (
              'You\'re all caught up!'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Actions */}
          {unreadCount && unreadCount > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllRead}
                className="flex-1"
              >
                <CheckCheck className="h-4 w-4 mr-2" />
                Mark All Read
              </Button>
            </div>
          )}

          {/* Notification list */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading notifications...
            </div>
          ) : notifications && notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map((notification: any) => (
                <div
                  key={notification.id}
                  className={`p-3 rounded-lg border ${
                    notification.status === 'pending' 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' 
                      : 'bg-muted border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {getNotificationIcon(notification.breach_type || 'breach')}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">
                          {notification.plate_number}
                        </span>
                        {notification.status === 'pending' && (
                          <Badge variant="destructive" className="text-xs">
                            New
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {notification.breach_type?.replace(/_/g, ' ')}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <Calendar className="h-3 w-3" />
                        <span>{formatDateTime(notification.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {notification.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markAsRead(notification.id)}
                        >
                          <CheckCheck className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteNotification(notification.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>No notifications</p>
              <p className="text-sm mt-1">You're all caught up!</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
