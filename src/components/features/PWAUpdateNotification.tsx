
/**
 * PWA Update Notification - Auto-reloads app when new version is deployed
 * Shows 5-second countdown before automatic reload
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, Sparkles, LogOut, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function PWAUpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const { logout } = useAuthStore();

  useEffect(() => {
    // Check if service worker is supported
    if (!('serviceWorker' in navigator)) return;

    // Listen for service worker updates
    navigator.serviceWorker.ready.then((registration) => {
      // Check for updates every 30 seconds when app is active
      const checkInterval = setInterval(() => {
        registration.update().catch((error) => {
          console.error('Service worker update check failed:', error);
        });
      }, 30000);

      // Listen for waiting service worker
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            console.log('✨ New version available!');
            toast.success('🎉 Update available! Reloading in 5 seconds...');
            setUpdateAvailable(true);
            setUpdateWorker(newWorker);
          }
        });
      });

      return () => {
        clearInterval(checkInterval);
      };
    });

    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'UPDATE_AVAILABLE') {
        console.log('✨ Update message received from service worker');
        toast.success('🎉 Update available! Reloading in 5 seconds...');
        setUpdateAvailable(true);
      }
    });

    // Listen for controller change (new SW activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Reload page to get new version
      window.location.reload();
    });
  }, []);

  // Show confirmation dialog when update is available
  useEffect(() => {
    if (updateAvailable) {
      setShowConfirmDialog(true);
      toast.success('🎉 Update available!');
    }
  }, [updateAvailable]);

  const handleUpdate = async () => {
    setShowConfirmDialog(false);
    setIsUpdating(true);

    try {
      // Step 1: Logout user
      console.log('🔐 Logging out user before update...');
      await supabase.auth.signOut();
      logout();
      
      // Step 2: Tell service worker to skip waiting
      if (updateWorker) {
        updateWorker.postMessage({ type: 'SKIP_WAITING' });
      }
      
      // Step 3: Close notification immediately
      setShowConfirmDialog(false);
      setUpdateAvailable(false);
      
      // Step 4: Show final notification and reload
      toast.success('Update complete - app will restart...');
      
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Update failed:', error);
      toast.error('Update failed - please refresh manually');
      setIsUpdating(false);
    }
  };

  if (!updateAvailable) return null;

  return (
    <>
    <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-6 w-6 text-green-600" />
            Update Available
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-4 pt-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border-2 border-blue-200 dark:border-blue-700">
              <p className="text-base font-semibold text-gray-900 dark:text-white mb-2">
                A new version is ready to install!
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                This update will:
              </p>
              <ul className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li className="flex items-start gap-2">
                  <LogOut className="h-4 w-4 shrink-0 mt-0.5 text-orange-600" />
                  <span><strong>Log you out</strong> of your current session</span>
                </li>
                <li className="flex items-start gap-2">
                  <RefreshCw className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
                  <span><strong>Restart the app</strong> with the latest version</span>
                </li>
                <li className="flex items-start gap-2">
                  <X className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
                  <span><strong>Clear your current session</strong> (save any work first)</span>
                </li>
              </ul>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Please ensure you have saved any important work before proceeding.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-col gap-2">
          <AlertDialogAction
            onClick={handleUpdate}
            disabled={isUpdating}
            className="w-full h-12 text-base font-bold bg-green-600 hover:bg-green-700"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 mr-2" />
                Update Now
              </>
            )}
          </AlertDialogAction>
          <AlertDialogCancel
            className="w-full h-12 text-base font-bold"
            disabled={isUpdating}
          >
            Update Later
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* The error was here: A duplicated div was causing the parsing error. Removed the extra div. */}
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 max-w-md w-full animate-in slide-in-from-top duration-300">
      <Card className="border-2 border-green-500 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 shadow-2xl">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="shrink-0 h-12 w-12 rounded-xl bg-green-500 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-white" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Update Available
                </h3>
                <Badge variant="secondary" className="text-xs">
                  ✨ New Features
                </Badge>
              </div>
              
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                A new version is ready. Auto-reloading in <strong className="text-green-600 dark:text-green-400">{countdown}</strong> seconds...
              </p>

              {/* Update Button */}
              <Button
                onClick={() => setShowConfirmDialog(true)}
                disabled={isUpdating}
                className="w-full h-10 text-sm font-bold bg-green-600 hover:bg-green-700"
                size="sm"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Review Update
                  </>
                )}
              </Button>

              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 text-center">
                Click to review update details and proceed
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
