import { useMemo, type ReactElement } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Info,
  CheckCircle,
  AlertTriangle,
  XCircle,
  X,
  CheckCheck,
  Bell,
} from 'lucide-react'

interface Notification {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  read: boolean
  created_at: string
  action_url?: string
  action_label?: string
}

interface NotificationCenterProps {
  open: boolean
  onClose: () => void
  notifications: Notification[]
  onMarkRead?: (id: string) => void
  onMarkAllRead?: () => void
  onDismiss?: (id: string) => void
  onClearAll?: () => void
}

const TYPE_ICON: Record<Notification['type'], ReactElement> = {
  info: <Info className="h-4 w-4 text-blue-500 shrink-0" />,
  success: <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />,
  error: <XCircle className="h-4 w-4 text-red-500 shrink-0" />,
}

function relativeTime(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function NotificationCenter({
  open,
  onClose,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearAll,
}: NotificationCenterProps) {
  const unreadCount = notifications.filter((n) => !n.read).length

  const sortedNotifications = useMemo(
    () =>
      [...notifications].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [notifications],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      <div className="absolute right-4 top-16 w-96 pointer-events-auto">
        <Card className="shadow-2xl border overflow-hidden flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs h-5 px-1.5">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && onMarkAllRead && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={onMarkAllRead}
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  Mark All Read
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* List */}
          <ScrollArea className="flex-1 overflow-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              <div className="divide-y">
                {sortedNotifications.map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 flex items-start gap-3 ${
                        !n.read ? 'bg-blue-50' : 'bg-white'
                      }`}
                    >
                      {TYPE_ICON[n.type]}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm leading-snug ${
                            !n.read ? 'font-semibold text-gray-900' : 'font-normal text-gray-700'
                          }`}
                        >
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {n.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {relativeTime(n.created_at)}
                          </span>
                          {n.action_url && n.action_label && (
                            <a
                              href={n.action_url}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {n.action_label}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!n.read && onMarkRead && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Mark read"
                            onClick={() => onMarkRead(n.id)}
                          >
                            <CheckCheck className="h-3 w-3" />
                          </Button>
                        )}
                        {onDismiss && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Dismiss"
                            onClick={() => onDismiss(n.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </ScrollArea>

          {/* Footer */}
          {notifications.length > 0 && onClearAll && (
            <div className="border-t px-4 py-2 bg-gray-50">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground w-full"
                onClick={onClearAll}
              >
                Clear All
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
