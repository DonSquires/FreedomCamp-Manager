/**
 * Officer Notification Bell
 * 
 * Shows unread notification count and dropdown with all notifications
 * Integrates with useOfficerNotifications hook
 */

import { useState } from 'react';
import { Bell, CheckCheck, AlertTriangle, Shield, FileText, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOfficerNotifications } from '@/hooks/useOfficerNotifications';
import { formatDistanceToNow } from 'date-fns';

interface OfficerNotificationBellProps {
  onNotificationClick?: (notification: any) => void;
}

export function OfficerNotificationBell({ onNotificationClick }: OfficerNotificationBellProps) {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useOfficerNotifications();
  const [open, setOpen] = useState(false);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 dark:bg-red-950/20';
      case 'high': return 'text-orange-600 bg-orange-50 dark:bg-orange-950/20';
      case 'medium': return 'text-amber-600 bg-amber-50 dark:bg-amber-950/20';
      default: return 'text-blue-600 bg-blue-50 dark:bg-blue-950/20';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'breach_assigned': return AlertTriangle;
      case 'enforcement_assigned': return Shield;
      case 'investigation_assigned': return FileText;
      case 'almost_breach': return Flag;
      default: return Bell;
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-10 w-10 touch-manipulation">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] font-bold"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 md:w-96">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="font-bold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="h-7 text-xs gap-1"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <div className="p-8 text-center">
            <Bell className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-20" />
            <p className="text-sm text-muted-foreground">No notifications</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            {notifications.map((notification) => {
              const Icon = getIcon(notification.type);
              return (
                <DropdownMenuItem
                  key={notification.id}
                  className={`flex items-start gap-3 p-3 cursor-pointer ${
                    !notification.read ? 'bg-blue-50 dark:bg-blue-950/20' : ''
                  }`}
                  onClick={() => {
                    markAsRead(notification.id);
                    if (onNotificationClick) {
                      onNotificationClick(notification);
                    }
                    setOpen(false);
                  }}
                >
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${getSeverityColor(notification.severity)}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-sm leading-tight">{notification.title}</p>
                      {!notification.read && (
                        <div className="h-2 w-2 rounded-full bg-blue-600 shrink-0 mt-1" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-tight mb-1">
                      {notification.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
