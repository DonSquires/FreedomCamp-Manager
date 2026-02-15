/**
 * useOfflineQueue Hook
 * Manages offline scan queue and auto-sync
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineStorage, type OfflineScan } from '@/lib/offlineStorage';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function useOfflineQueue() {
  const [pendingScans, setPendingScans] = useState<OfflineScan[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSyncAttempt, setLastSyncAttempt] = useState<Date | null>(null);
  const syncIntervalRef = useRef<number | null>(null);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log('🌐 Network connection restored');
      setIsOnline(true);
      toast.success('Back online - syncing queued scans...');
      syncQueue();
    };

    const handleOffline = () => {
      console.log('📵 Network connection lost');
      setIsOnline(false);
      toast.warning('Working offline - scans will be queued');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load pending scans on mount
  useEffect(() => {
    loadPendingScans();
  }, []);

  // Auto-sync when online
  useEffect(() => {
    if (isOnline && pendingScans.length > 0 && !isSyncing) {
      // Start sync interval (every 30 seconds)
      syncIntervalRef.current = window.setInterval(() => {
        syncQueue();
      }, 30000);

      // Initial sync
      syncQueue();
    } else if (!isOnline || pendingScans.length === 0) {
      // Clear sync interval when offline or no pending scans
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [isOnline, pendingScans.length, isSyncing]);

  // Register service worker sync event
  useEffect(() => {
    if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
      navigator.serviceWorker.ready.then((registration) => {
        // Request background sync when connection restored
        if (isOnline && pendingScans.length > 0) {
          registration.sync.register('sync-scans').catch((error) => {
            console.warn('Background sync registration failed:', error);
          });
        }
      });
    }
  }, [isOnline, pendingScans.length]);

  const loadPendingScans = async () => {
    try {
      const scans = await offlineStorage.getPendingScans();
      setPendingScans(scans);
      console.log(`📥 Loaded ${scans.length} pending scans from offline queue`);
    } catch (error) {
      console.error('Failed to load pending scans:', error);
    }
  };

  const addToQueue = async (
    scan: Omit<OfflineScan, 'id' | 'syncStatus' | 'syncAttempts'>
  ): Promise<string> => {
    try {
      const scanId = await offlineStorage.addScan(scan);
      await loadPendingScans(); // Refresh list
      
      toast.info(`Scan queued offline: ${scan.plateNumber}`);
      console.log('✅ Scan added to offline queue:', scanId);

      // Try immediate sync if online
      if (isOnline) {
        setTimeout(() => syncQueue(), 1000);
      }

      return scanId;
    } catch (error: any) {
      console.error('Failed to add scan to queue:', error);
      toast.error('Failed to queue scan: ' + error.message);
      throw error;
    }
  };

  const syncQueue = async () => {
    if (isSyncing || !isOnline) return;

    setIsSyncing(true);
    setLastSyncAttempt(new Date());

    try {
      const scans = await offlineStorage.getPendingScans();
      console.log(`🔄 Syncing ${scans.length} pending scans...`);

      let successCount = 0;
      let failCount = 0;

      for (const scan of scans) {
        try {
          // Update status to syncing
          await offlineStorage.updateScanStatus(scan.id, 'syncing');

          // Call process-field-scan Edge Function
          const { error: syncError } = await supabase.functions.invoke('process-field-scan', {
            body: {
              plateNumber: scan.plateNumber,
              zoneId: scan.zoneId,
              organizationId: scan.organizationId,
              imageUrl: scan.photoDataUrl || null, // Base64 data URL
              gpsLocation: scan.gpsLocation,
              vehicleDetails: scan.vehicleDetails,
              detectionMethod: scan.detectionMethod,
              isSelfContained: scan.isSelfContained,
              notes: scan.notes,
              timestamp: scan.timestamp,
            },
          });

          if (syncError) {
            throw syncError;
          }

          // Mark as synced and delete from queue
          await offlineStorage.updateScanStatus(scan.id, 'synced');
          await offlineStorage.deleteScan(scan.id);
          successCount++;
          console.log(`✅ Synced scan: ${scan.plateNumber}`);
        } catch (error: any) {
          console.error(`❌ Failed to sync scan ${scan.plateNumber}:`, error);
          await offlineStorage.updateScanStatus(scan.id, 'failed', error.message);
          failCount++;
        }
      }

      // Refresh pending list
      await loadPendingScans();

      // Show summary
      if (successCount > 0) {
        toast.success(`Synced ${successCount} scan${successCount !== 1 ? 's' : ''} from queue`);
      }
      if (failCount > 0) {
        toast.error(`Failed to sync ${failCount} scan${failCount !== 1 ? 's' : ''}`);
      }
    } catch (error: any) {
      console.error('Sync queue failed:', error);
      toast.error('Sync failed: ' + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const retryFailed = async () => {
    // Reset failed scans to pending
    const scans = await offlineStorage.getAllScans();
    const failedScans = scans.filter((s) => s.syncStatus === 'failed');

    for (const scan of failedScans) {
      await offlineStorage.updateScanStatus(scan.id, 'pending');
    }

    await loadPendingScans();
    toast.info(`Retrying ${failedScans.length} failed scan${failedScans.length !== 1 ? 's' : ''}...`);
    
    if (isOnline) {
      syncQueue();
    }
  };

  const clearQueue = async () => {
    const count = await offlineStorage.clearSyncedScans();
    await loadPendingScans();
    toast.success(`Cleared ${count} synced scan${count !== 1 ? 's' : ''} from queue`);
  };

  return {
    pendingScans,
    pendingCount: pendingScans.length,
    isSyncing,
    isOnline,
    lastSyncAttempt,
    addToQueue,
    syncQueue,
    retryFailed,
    clearQueue,
    refreshQueue: loadPendingScans,
  };
}
