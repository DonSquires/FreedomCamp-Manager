/**
 * PWA Install Prompt - Encourages field staff to add app to home screen
 * Shows install banner with Iron Eagle Security branding
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Download, Smartphone, Zap } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    
    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Check if user has dismissed the prompt before
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    const dismissedDate = dismissed ? parseInt(dismissed) : 0;
    const daysSinceDismissal = (Date.now() - dismissedDate) / (1000 * 60 * 60 * 24);
    
    // Don't show again if dismissed within last 7 days
    if (daysSinceDismissal < 7) {
      return;
    }

    // Listen for the beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the default mini-infobar
      e.preventDefault();
      
      // Stash the event for later use
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Show custom install prompt after 3 seconds
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setShowPrompt(false);
      console.log('✅ PWA installed successfully');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setShowPrompt(false);
    } else {
      console.log('User dismissed the install prompt');
      handleDismiss();
    }

    // Clear the deferred prompt
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  // Show manual install instructions for iOS
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const handleIOSInstall = () => {
    setShowIOSInstructions(true);
  };

  if (isInstalled || !showPrompt) return null;

  return (
    <>
      {/* Main Install Banner */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-safe animate-in slide-in-from-bottom duration-300">
        <Card className="border-2 border-primary bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 shadow-2xl">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {/* App Icon */}
              <div className="shrink-0">
                <img 
                  src="/iron-eagle-security-logo.png" 
                  alt="Iron Eagle Security" 
                  className="h-16 w-16 rounded-xl shadow-lg"
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                    Install FreedomCamp Manager
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    <Zap className="h-3 w-3 mr-1" />
                    Fast & Offline
                  </Badge>
                </div>
                
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                  Add to your home screen for instant access, offline support, and automatic updates
                </p>

                {/* Benefits */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-900/50">
                    📱 Works Offline
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-900/50">
                    🔄 Auto-Updates
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-900/50">
                    ⚡ Faster Access
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-900/50">
                    🔒 Secure Login
                  </Badge>
                </div>

                {/* Buttons */}
                <div className="flex gap-2">
                  {isIOS ? (
                    <Button
                      onClick={handleIOSInstall}
                      className="flex-1 h-12 text-base font-bold shadow-lg"
                      size="lg"
                    >
                      <Smartphone className="h-5 w-5 mr-2" />
                      Install Instructions
                    </Button>
                  ) : (
                    <Button
                      onClick={handleInstallClick}
                      className="flex-1 h-12 text-base font-bold shadow-lg"
                      size="lg"
                      disabled={!deferredPrompt}
                    >
                      <Download className="h-5 w-5 mr-2" />
                      Install Now
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleDismiss}
                    className="h-12 w-12 shrink-0"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* iOS Install Instructions Modal */}
      {showIOSInstructions && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <Card className="w-full max-w-md border-2 border-primary bg-white dark:bg-gray-900 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Smartphone className="h-6 w-6 text-blue-600" />
                  Install on iOS
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowIOSInstructions(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                    1
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Tap the Share button</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Look for the <strong>Share</strong> icon (square with arrow) at the bottom of Safari
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                    2
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Select "Add to Home Screen"</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Scroll down in the share menu and tap <strong>Add to Home Screen</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                    3
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Tap "Add"</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Confirm the name and tap <strong>Add</strong> to install the app icon
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <Button
                  onClick={() => {
                    setShowIOSInstructions(false);
                    handleDismiss();
                  }}
                  variant="outline"
                  className="w-full h-12"
                >
                  Got It
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
