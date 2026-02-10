/**
 * App Badge Component
 * Shows notification badges on app icon for queued items and alerts
 */

import { useEffect } from 'react';
import { getQueueStats } from '@/lib/pwa';

export function AppBadge() {
  useEffect(() => {
    const updateBadge = async () => {
      try {
        // Check if badge API is supported
        if ('setAppBadge' in navigator) {
          const stats = await getQueueStats();
          
          if (stats.total > 0) {
            // Set badge with queue count
            await (navigator as any).setAppBadge(stats.total);
          } else {
            // Clear badge
            await (navigator as any).clearAppBadge();
          }
        }
      } catch (error) {
        console.error('Failed to update app badge:', error);
      }
    };

    // Update badge immediately
    updateBadge();

    // Update badge every 30 seconds
    const interval = setInterval(updateBadge, 30000);

    // Update when coming back online
    const handleOnline = () => updateBadge();
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return null; // No UI, just badge updates
}
