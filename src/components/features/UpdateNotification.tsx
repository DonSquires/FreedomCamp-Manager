/**
 * UpdateNotification Component
 * Displays a notification when a new app version is available
 * Provides option to update the app
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, X, RefreshCw } from 'lucide-react';
import { APP_VERSION } from '@/constants/version';

interface UpdateNotificationProps {
  onDismiss?: () => void;
}

export function UpdateNotification({ onDismiss }: UpdateNotificationProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleUpdate = async () => {
    setIsUpdating(true);

    try {
      // Unregister old service worker
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }

      // Clear caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      // Force reload to get new version
      window.location.reload();
    } catch (error) {
      console.error('Update failed:', error);
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96 animate-in slide-in-from-bottom duration-300">
      <Card className="border-2 border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-2xl">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
              <Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-blue-900 dark:text-blue-100">
                  Update Available
                </p>
                <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700">
                  v{APP_VERSION}
                </Badge>
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-200 mb-3">
                A new version of FreedomCamp Manager is available with improvements and bug fixes.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleUpdate}
                  disabled={isUpdating}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white touch-manipulation"
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Update Now
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => setShowDetails(!showDetails)}
                  variant="ghost"
                  size="sm"
                  className="text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 touch-manipulation"
                >
                  {showDetails ? 'Hide' : 'What\'s New'}
                </Button>
                {onDismiss && (
                  <Button
                    onClick={onDismiss}
                    variant="ghost"
                    size="sm"
                    className="text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 touch-manipulation ml-auto"
                  >
                    Later
                  </Button>
                )}
              </div>

              {showDetails && (
                <div className="mt-3 p-3 bg-blue-100/50 dark:bg-blue-900/30 rounded-lg">
                  <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-2">
                    Version {APP_VERSION} Changes:
                  </p>
                  <ul className="text-xs text-blue-700 dark:text-blue-200 space-y-1 list-disc list-inside">
                    <li>Camera selection with sticky preferences</li>
                    <li>Enhanced zoom and flash controls</li>
                    <li>Date range filtering for dashboards</li>
                    <li>Performance improvements</li>
                  </ul>
                </div>
              )}
            </div>
            {onDismiss && (
              <Button
                onClick={onDismiss}
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 touch-manipulation"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
