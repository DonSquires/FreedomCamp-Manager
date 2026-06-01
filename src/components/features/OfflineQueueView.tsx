import type { ReactElement } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  Trash2,
} from 'lucide-react'

interface QueueItem {
  id: string
  type: string
  plate_number?: string
  status: 'pending' | 'syncing' | 'synced' | 'failed'
  created_at: string
  error?: string
}

interface OfflineQueueViewProps {
  items: QueueItem[]
  isOnline: boolean
  isSyncing?: boolean
  onRetryFailed?: () => void
  onClearSynced?: () => void
}

const STATUS_ORDER: QueueItem['status'][] = ['syncing', 'pending', 'failed', 'synced']

const STATUS_CONFIG: Record<
  QueueItem['status'],
  { label: string; bg: string; icon: ReactElement; badge: string }
> = {
  syncing: {
    label: 'Syncing',
    bg: 'bg-blue-50 border-blue-200',
    icon: <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />,
    badge: 'bg-blue-100 text-blue-700',
  },
  pending: {
    label: 'Pending',
    bg: 'bg-yellow-50 border-yellow-200',
    icon: <Clock className="h-4 w-4 text-yellow-600 shrink-0" />,
    badge: 'bg-yellow-100 text-yellow-700',
  },
  failed: {
    label: 'Failed',
    bg: 'bg-red-50 border-red-200',
    icon: <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />,
    badge: 'bg-red-100 text-red-700',
  },
  synced: {
    label: 'Synced',
    bg: 'bg-gray-50 border-gray-200',
    icon: <CheckCircle className="h-4 w-4 text-gray-400 shrink-0" />,
    badge: 'bg-gray-100 text-gray-500',
  },
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function OfflineQueueView({
  items,
  isOnline,
  isSyncing,
  onRetryFailed,
  onClearSynced,
}: OfflineQueueViewProps) {
  const failedItems = items.filter((i) => i.status === 'failed')
  const syncedItems = items.filter((i) => i.status === 'synced')

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: items.filter((i) => i.status === status),
  })).filter((g) => g.items.length > 0)

  return (
    <Card className="overflow-hidden">
      {/* Status bar */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 ${
          isOnline ? 'bg-green-600' : 'bg-red-600'
        } text-white`}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          {isOnline ? (
            <>
              <Wifi className="h-4 w-4" />
              <span>Online</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4" />
              <span>Offline</span>
            </>
          )}
          {isSyncing && (
            <span className="flex items-center gap-1 text-xs bg-white/20 rounded px-2 py-0.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing…
            </span>
          )}
        </div>
        <span className="text-xs opacity-80">{`${items.length} ${items.length !== 1 ? 'items' : 'item'}`}</span>
      </div>

      {/* Count summary */}
      {items.length > 0 && (
        <div className="flex gap-2 px-4 py-2 bg-gray-50 border-b flex-wrap">
          {STATUS_ORDER.map((status) => {
            const count = items.filter((i) => i.status === status).length
            if (!count) return null
            const cfg = STATUS_CONFIG[status]
            return (
              <span key={status} className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
                {count} {cfg.label}
              </span>
            )
          })}
        </div>
      )}

      {/* Items */}
      <ScrollArea className="max-h-80">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <CheckCircle className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">Queue is empty</p>
          </div>
        ) : (
          <div className="divide-y">
            {grouped.map(({ status, items: groupItems }) => (
              <div key={status}>
                <div className="px-4 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {STATUS_CONFIG[status].label} ({groupItems.length})
                </div>
                {groupItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 px-4 py-2.5 border-b last:border-0 ${STATUS_CONFIG[item.status].bg}`}
                  >
                    {STATUS_CONFIG[item.status].icon}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {item.type}
                        </span>
                        {item.plate_number && (
                          <Badge variant="outline" className="text-xs h-5 px-1.5 font-mono">
                            {item.plate_number}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatTime(item.created_at)}
                      </p>
                      {item.error && (
                        <p className="text-xs text-red-600 mt-0.5 truncate">{item.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer actions */}
      {(failedItems.length > 0 || syncedItems.length > 0) && (
        <div className="flex gap-2 px-4 py-2.5 border-t bg-gray-50">
          {failedItems.length > 0 && onRetryFailed && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8 border-red-300 text-red-700 hover:bg-red-50"
              onClick={onRetryFailed}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry Failed ({failedItems.length})
            </Button>
          )}
          {syncedItems.length > 0 && onClearSynced && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8 text-gray-600"
              onClick={onClearSynced}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear Synced ({syncedItems.length})
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
