/**
 * ScanQueue Component
 * Offline scan queue viewer and retry management
 */

import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useOfflineQueue, useOfflineQueueStats } from '@/hooks/useOfflineQueue'
import { 
  RefreshCw, 
  Trash2, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  Upload,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'

interface ScanQueueProps {
  onRetrySuccess?: () => void
}

export function ScanQueue({ onRetrySuccess }: ScanQueueProps) {
  const queryClient = useQueryClient()
  const [isRetrying, setIsRetrying] = useState(false)
  
  const {
    queue,
    isLoading,
    syncObservation,
    syncAll,
    clearSynced,
    removeFromQueue,
  } = useOfflineQueue()

  const { data: stats } = useOfflineQueueStats()

  // Retry single item
  const handleRetryItem = async (id: string) => {
    try {
      await syncObservation.mutateAsync(id)
      toast.success('Scan uploaded successfully')
      onRetrySuccess?.()
    } catch (error: any) {
      toast.error(`Retry failed: ${error.message}`)
    }
  }

  // Retry all failed items
  const handleRetryAll = async () => {
    setIsRetrying(true)
    try {
      const results = await syncAll.mutateAsync()
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      if (successCount > 0) {
        toast.success(`${successCount} scans uploaded successfully`)
        onRetrySuccess?.()
      }
      
      if (failCount > 0) {
        toast.error(`${failCount} scans failed to upload`)
      }
    } catch (error: any) {
      toast.error(`Retry failed: ${error.message}`)
    } finally {
      setIsRetrying(false)
    }
  }

  // Clear all queue items
  const handleClearQueue = async () => {
    if (confirm('Clear all queued scans? This cannot be undone.')) {
      await clearSynced.mutateAsync()
      toast.success('Queue cleared')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-600" />
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      default:
        return <Clock className="h-4 w-4" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'success':
        return <Badge className="bg-green-600">Success</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            Loading queue...
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5" />
              Offline Scan Queue
            </CardTitle>
            <CardDescription className="mt-1">
              Scans waiting to be uploaded when network is available
            </CardDescription>
          </div>
          {stats && stats.total_queued > 0 && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetryAll}
                disabled={isRetrying || stats.pending === 0}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
                Retry All
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearQueue}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Queue
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Stats */}
        {stats && stats.total_queued > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{stats.total_queued}</div>
              <div className="text-sm text-muted-foreground">Total</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-sm text-muted-foreground">Pending</div>
            </div>
            <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              <div className="text-sm text-muted-foreground">Failed</div>
            </div>
          </div>
        )}

        {/* Queue items */}
        {queue && queue.length > 0 ? (
          <div className="space-y-3">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 p-3 border rounded-lg"
              >
                {/* Status icon */}
                <div className="mt-1">
                  {getStatusIcon(item.status)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">
                      {item.plate_number || 'Unknown Plate'}
                    </span>
                    {getStatusBadge(item.status)}
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    {item.zone_id || 'Unknown Zone'} • {' '}
                    {formatDateTime(item.created_at)}
                  </div>

                  {item.status === 'failed' && item.sync_error && (
                    <div className="mt-2 text-xs text-red-600">
                      Error: {item.sync_error}
                    </div>
                  )}

                  {item.sync_attempts > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Retried {item.sync_attempts} time(s)
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-1">
                  {item.status !== 'synced' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetryItem(item.id)}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeFromQueue.mutate(item.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Upload className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No pending scans</p>
            <p className="text-sm mt-1">
              Scans will appear here when offline
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
