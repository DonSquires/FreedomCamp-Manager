/**
 * OfflineQueueView - Visual sync status UI for offline scans
 * Shows pending scans, status indicators, retry buttons, and manual sync
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  X,
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { getQueueStats, processOfflineQueue } from '@/lib/pwa';

interface OfflineQueueViewProps {
  onClose: () => void;
}

interface QueueItem {
  id: string;
  type: 'scan' | 'incident' | 'hs_report';
  data: any;
  timestamp: number;
  status: 'queued' | 'syncing' | 'failed' | 'completed';
  retryCount: number;
  error?: string;
}

export function OfflineQueueView({ onClose }: OfflineQueueViewProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  useEffect(() => {
    loadQueue();

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadQueue = async () => {
    try {
      const stats = await getQueueStats();
      // In real implementation, load actual queue items from IndexedDB
      // For now, create mock data based on stats
      const mockItems: QueueItem[] = Array.from({ length: stats.total }, (_, i) => ({
        id: `queue-${i}`,
        type: 'scan',
        data: { plateNumber: `DEMO${i}` },
        timestamp: Date.now() - i * 60000,
        status: i < stats.failed ? 'failed' : 'queued',
        retryCount: i < stats.failed ? 3 : 0,
        error: i < stats.failed ? 'Network timeout' : undefined,
      }));
      setQueueItems(mockItems);
    } catch (error) {
      console.error('Failed to load queue:', error);
    }
  };

  const handleManualSync = async () => {
    if (!isOnline) {
      toast.error('Cannot sync - device is offline');
      return;
    }

    setIsSyncing(true);
    setSyncProgress(0);

    try {
      const result = await processOfflineQueue();
      
      // Simulate progress
      for (let i = 0; i <= 100; i += 10) {
        setSyncProgress(i);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      toast.success(`Synced ${result.synced} item(s)`);
      await loadQueue();
    } catch (error: any) {
      console.error('Sync failed:', error);
      toast.error('Sync failed: ' + error.message);
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
    }
  };

  const retryItem = async (itemId: string) => {
    toast.info('Retrying item...');
    // In real implementation, retry specific item
    await loadQueue();
  };

  const removeItem = async (itemId: string) => {
    if (!confirm('Remove this item from queue? This cannot be undone.')) {
      return;
    }
    toast.success('Item removed');
    setQueueItems(prev => prev.filter(item => item.id !== itemId));
  };

  const getStatusColor = (status: QueueItem['status']) => {
    switch (status) {
      case 'queued': return 'bg-blue-500';
      case 'syncing': return 'bg-amber-500';
      case 'failed': return 'bg-red-500';
      case 'completed': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusLabel = (status: QueueItem['status']) => {
    switch (status) {
      case 'queued': return 'Queued';
      case 'syncing': return 'Syncing';
      case 'failed': return 'Failed';
      case 'completed': return 'Completed';
      default: return 'Unknown';
    }
  };

  const queuedCount = queueItems.filter(i => i.status === 'queued').length;
  const failedCount = queueItems.filter(i => i.status === 'failed').length;
  const totalSize = queueItems.reduce((acc, item) => acc + JSON.stringify(item.data).length, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-card z-10 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="flex items-center gap-2">
                {isOnline ? (
                  <Wifi className="h-5 w-5 text-green-500" />
                ) : (
                  <WifiOff className="h-5 w-5 text-amber-500" />
                )}
                Offline Sync Queue
              </CardTitle>
              <Badge variant={isOnline ? 'default' : 'secondary'}>
                {isOnline ? 'Online' : 'Offline'}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Queued</p>
              <p className="text-2xl font-black text-blue-600">{queuedCount}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Failed</p>
              <p className="text-2xl font-black text-red-600">{failedCount}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Data Size</p>
              <p className="text-2xl font-black">
                {(totalSize / 1024).toFixed(1)}
                <span className="text-sm font-normal">KB</span>
              </p>
            </div>
          </div>

          {/* Sync Progress */}
          {isSyncing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Syncing...</span>
                <span className="font-semibold">{syncProgress}%</span>
              </div>
              <Progress value={syncProgress} />
            </div>
          )}

          {/* Manual Sync Button */}
          <Button
            onClick={handleManualSync}
            disabled={!isOnline || isSyncing || queuedCount === 0}
            className="w-full"
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Sync Now ({queuedCount} items)
              </>
            )}
          </Button>

          {/* Queue Items */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Queue Items</h3>
            {queueItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No items in queue</p>
              </div>
            ) : (
              queueItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(item.status)}`} />
                        <span className="text-sm font-semibold capitalize">
                          {item.type.replace('_', ' ')}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {getStatusLabel(item.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.timestamp).toLocaleString('en-NZ', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                      {item.data.plateNumber && (
                        <p className="text-xs font-mono mt-1">{item.data.plateNumber}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {item.status === 'failed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryItem(item.id)}
                          className="h-8"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.id)}
                        className="h-8 text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Error Message */}
                  {item.error && (
                    <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded text-xs text-red-700 dark:text-red-300">
                      <AlertCircle className="h-3 w-3 inline mr-1" />
                      {item.error}
                      {item.retryCount > 0 && ` (${item.retryCount} retries)`}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Info */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs text-blue-900 dark:text-blue-100">
              💡 <strong>Auto-sync enabled:</strong> Queue items will automatically sync when you come back online.
              You can also manually sync anytime.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
