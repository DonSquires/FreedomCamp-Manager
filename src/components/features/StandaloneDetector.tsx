/**
 * Standalone Mode Detector
 * Detects when app is running as installed PWA vs browser
 * Shows helpful tips for first-time PWA users
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Smartphone, Zap, Wifi, WifiOff } from 'lucide-react';

export function StandaloneDetector() {
  const [isStandalone, setIsStandalone] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    // Detect if running as installed PWA
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    
    setIsStandalone(standalone);

    // Show tip on first launch as installed app
    if (standalone) {
      const hasSeenTip = localStorage.getItem('pwa-tip-seen');
      if (!hasSeenTip) {
        setTimeout(() => setShowTip(true), 2000);
      }
    }

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

  const dismissTip = () => {
    setShowTip(false);
    localStorage.setItem('pwa-tip-seen', 'true');
  };

  if (!showTip) {
    // Just show online/offline status badge in standalone mode
    if (isStandalone) {
      return (
        <div className="fixed top-4 right-4 z-40">
          <Badge 
            variant={isOnline ? 'default' : 'destructive'}
            className="shadow-lg"
          >
            {isOnline ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Online
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 mr-1" />
                Offline Mode
              </>
            )}
          </Badge>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
      <Card className="max-w-md border-2 border-primary bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 shadow-2xl animate-in zoom-in duration-300">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="h-6 w-6 text-blue-600" />
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                App Installed!
              </h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={dismissTip}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <p className="text-sm text-gray-700 dark:text-gray-300">
            FreedomCamp Manager is now installed on your device. Here's what you can do:
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
              <Zap className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm mb-1 text-gray-900 dark:text-white">
                  Instant Access
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Launch directly from your home screen - no browser needed
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
              <WifiOff className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm mb-1 text-gray-900 dark:text-white">
                  Offline Mode
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Scan vehicles even without internet - auto-syncs when back online
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
              <Smartphone className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm mb-1 text-gray-900 dark:text-white">
                  Always Updated
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  App automatically updates in the background - no downloads needed
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={dismissTip}
            className="w-full h-12 text-base font-bold"
          >
            Got It, Let's Go!
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
