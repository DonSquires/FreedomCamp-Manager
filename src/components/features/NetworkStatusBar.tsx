/**
 * Network Status Bar
 * Shows connection status and offline queue information
 */

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, Upload, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { getQueueStats, processOfflineQueue, setupOnlineListener } from '@/lib/pwa';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function NetworkStatusBar() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueStats, setQueueStats] = useState({ total: 0, byType: {}, oldestTimestamp: null, totalSize: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });

  const refreshQueueStats = async () => {
    const stats = await getQueueStats();
    setQueueStats(stats);
  };

  useEffect(() => {
    refreshQueueStats();

    // Listen for online/offline events
    const cleanup = setupOnlineListener(
      () => {
        setIsOnline(true);
        toast.success('Back online - syncing queued data...', {
          icon: <Wifi className="h-4 w-4" />,
        });
        handleSync();
      },
      () => {
        setIsOnline(false);
        toast.warning('You are offline - scans will be queued', {
          icon: <WifiOff className="h-4 w-4" />,
          duration: 5000,
        });
      }
    );

    // Refresh stats periodically
    const interval = setInterval(refreshQueueStats, 10000);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  const handleSync = async () => {
    if (!isOnline || queueStats.total === 0 || isSyncing) return;

    setIsSyncing(true);
    setSyncProgress({ current: 0, total: queueStats.total });

    try {
      const result = await processOfflineQueue(
        supabase,
        (current, total) => {
          setSyncProgress({ current, total });
        }
      );

      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} item${result.synced > 1 ? 's' : ''}`, {
          icon: <CheckCircle2 className="h-4 w-4" />,
        });
      }

      if (result.failed > 0) {
        toast.error(`Failed to sync ${result.failed} item${result.failed > 1 ? 's' : ''}`, {
          icon: <AlertCircle className="h-4 w-4" />,
          description: 'Will retry when connection improves',
        });
      }

      await refreshQueueStats();
    } catch (error) {
      console.error('Sync failed:', error);
      toast.error('Sync failed - will retry automatically');
    } finally {
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  };

  // Don't show bar if online and no queue
  if (isOnline && queueStats.total === 0) return null;

  return (
    <Card className={`fixed bottom-0 left-0 right-0 z-40 rounded-none border-x-0 border-b-0 ${
      isOnline ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : 
      'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {/* Status */}
          <div className="flex items-center gap-2 min-w-0">
            <Badge 
              variant={isOnline ? 'default' : 'secondary'}
              className={`${
                isOnline ? 'bg-green-600' : 'bg-amber-600'
              } text-white`}
            >
              {isOnline ? (
                <>
                  <Wifi className="h-3 w-3 mr-1" />
                  Online
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 mr-1" />
                  Offline
                </>
              )}
            </Badge>

            {queueStats.total > 0 && (
              <div className="text-sm font-medium truncate text-gray-700 dark:text-gray-300">
                {queueStats.total} item{queueStats.total > 1 ? 's' : ''} queued
                {queueStats.oldestTimestamp && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                    ({new Date(queueStats.oldestTimestamp).toLocaleDateString()})
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Sync Button */}
          {queueStats.total > 0 && (
            <Button
              size="sm"
              onClick={handleSync}
              disabled={!isOnline || isSyncing}
              className={`shrink-0 ${
                isOnline ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400'
              }`}
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {syncProgress.current}/{syncProgress.total}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Sync Now
                </>
              )}
            </Button>
          )}
        </div>

        {/* Sync Progress */}
        {isSyncing && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-green-600 h-2 transition-all duration-300"
                style={{ 
                  width: `${(syncProgress.current / syncProgress.total) * 100}%` 
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
