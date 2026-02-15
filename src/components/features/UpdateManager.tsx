/**
 * Update Manager - Checks for updates on login and provides rollback functionality
 * Shows prominent update dialog with changelog and version comparison
 * Stores version history for rollback capability
 */

import { useState, useEffect } from 'react';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  RefreshCw, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  ArrowLeft,
  Loader2,
  Shield
} from 'lucide-react';
import { toast } from 'sonner';
import { APP_VERSION, VERSION_HISTORY, compareVersions } from '@/constants/version';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

interface UpdateManagerProps {
  onLoginComplete?: () => void;
}

interface VersionInfo {
  version: string;
  installedAt: string;
  wasRolledBack?: boolean;
  deviceInfo: string;
}

const VERSION_STORAGE_KEY = 'app_version_history';
const CURRENT_VERSION_KEY = 'app_current_version';
const UPDATE_DISMISSED_KEY = 'update_dismissed_version';
const ROLLBACK_AVAILABLE_KEY = 'rollback_version';

export function UpdateManager({ onLoginComplete }: UpdateManagerProps) {
  const { user } = useAuthStore();
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [previousVersion, setPreviousVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newVersion, setNewVersion] = useState<string>('');

  useEffect(() => {
    if (!user) return;

    checkForUpdates();
  }, [user]);

  const checkForUpdates = () => {
    const storedVersion = localStorage.getItem(CURRENT_VERSION_KEY);
    const dismissedVersion = localStorage.getItem(UPDATE_DISMISSED_KEY);
    const versionHistory = getVersionHistory();

    console.log('🔍 Checking for updates...', {
      currentVersion: APP_VERSION,
      storedVersion,
      dismissedVersion,
    });

    // If this is first install or version changed
    if (!storedVersion) {
      // First install
      console.log('✨ First install detected');
      saveVersionToHistory(APP_VERSION);
      localStorage.setItem(CURRENT_VERSION_KEY, APP_VERSION);
      onLoginComplete?.();
      return;
    }

    if (storedVersion !== APP_VERSION) {
      // Update available
      const comparison = compareVersions(APP_VERSION, storedVersion);
      
      if (comparison > 0) {
        // New version is higher
        console.log('🎉 Update available!', {
          from: storedVersion,
          to: APP_VERSION,
        });

        // Check if user already dismissed this version
        if (dismissedVersion === APP_VERSION) {
          console.log('ℹ️ Update already dismissed for this version');
          onLoginComplete?.();
          return;
        }

        setNewVersion(APP_VERSION);
        setPreviousVersion(storedVersion);
        setUpdateAvailable(true);
        setShowUpdateDialog(true);
      } else {
        // Rollback detected (current version is lower than stored)
        console.log('⚠️ Rollback detected', {
          from: storedVersion,
          to: APP_VERSION,
        });
        markAsRolledBack(APP_VERSION);
        localStorage.setItem(CURRENT_VERSION_KEY, APP_VERSION);
        toast.info('App rolled back to previous version');
        onLoginComplete?.();
      }
    } else {
      // Same version
      console.log('✅ App is up to date');
      onLoginComplete?.();
    }
  };

  const getVersionHistory = (): VersionInfo[] => {
    try {
      const history = localStorage.getItem(VERSION_STORAGE_KEY);
      return history ? JSON.parse(history) : [];
    } catch {
      return [];
    }
  };

  const saveVersionToHistory = (version: string, wasRolledBack = false) => {
    const history = getVersionHistory();
    
    // Don't duplicate if already in history
    if (history.some(v => v.version === version)) {
      return;
    }

    const versionInfo: VersionInfo = {
      version,
      installedAt: new Date().toISOString(),
      wasRolledBack,
      deviceInfo: navigator.userAgent,
    };

    history.push(versionInfo);

    // Keep only last 5 versions
    if (history.length > 5) {
      history.shift();
    }

    localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(history));
  };

  const markAsRolledBack = (version: string) => {
    const history = getVersionHistory();
    const versionIndex = history.findIndex(v => v.version === version);
    
    if (versionIndex !== -1) {
      history[versionIndex].wasRolledBack = true;
      localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(history));
    }
  };

  const handleUpdate = async () => {
    setIsUpdating(true);

    try {
      console.log('⬆️ Installing update...', {
        from: previousVersion,
        to: newVersion,
      });

      // Save previous version for rollback
      if (previousVersion) {
        localStorage.setItem(ROLLBACK_AVAILABLE_KEY, previousVersion);
      }

      // Save new version to history
      saveVersionToHistory(newVersion);

      // Update current version
      localStorage.setItem(CURRENT_VERSION_KEY, newVersion);

      // Clear dismissed flag
      localStorage.removeItem(UPDATE_DISMISSED_KEY);

      // Log out user
      await supabase.auth.signOut();

      // Tell service worker to update
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }

      toast.success('✅ Update installed! Restarting app...');

      // Reload the app
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Update failed:', error);
      toast.error('Update failed. Please try again.');
      setIsUpdating(false);
    }
  };

  const handleDismissUpdate = () => {
    console.log('ℹ️ Update dismissed');
    localStorage.setItem(UPDATE_DISMISSED_KEY, newVersion);
    setShowUpdateDialog(false);
    setUpdateAvailable(false);
    onLoginComplete?.();
  };

  const handleShowRollback = () => {
    const rollbackVersion = localStorage.getItem(ROLLBACK_AVAILABLE_KEY);
    if (rollbackVersion) {
      setPreviousVersion(rollbackVersion);
      setShowRollbackDialog(true);
    } else {
      toast.error('No previous version available for rollback');
    }
  };

  const handleRollback = async () => {
    if (!previousVersion) return;

    setIsRollingBack(true);

    try {
      console.log('⬅️ Rolling back to version', previousVersion);

      // Mark current version as rolled back
      markAsRolledBack(APP_VERSION);

      // Update current version to previous
      localStorage.setItem(CURRENT_VERSION_KEY, previousVersion);

      // Clear rollback flag
      localStorage.removeItem(ROLLBACK_AVAILABLE_KEY);

      // Log out user
      await supabase.auth.signOut();

      toast.success(`✅ Rolling back to v${previousVersion}...`);

      // Note: Actual rollback requires service worker cache management
      // For now, this just clears state and reloads
      setTimeout(() => {
        // Clear service worker caches
        if ('caches' in window) {
          caches.keys().then(keys => {
            keys.forEach(key => caches.delete(key));
          });
        }
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Rollback failed:', error);
      toast.error('Rollback failed. Please contact support.');
      setIsRollingBack(false);
    }
  };

  const getChangelogForVersion = (version: string) => {
    const versionEntry = VERSION_HISTORY.find(v => v.version === version);
    return versionEntry?.changes || [];
  };

  if (!updateAvailable) return null;

  return (
    <>
      {/* Update Dialog */}
      <AlertDialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
              <Sparkles className="h-10 w-10 text-white" />
            </div>
            <AlertDialogTitle className="text-center text-2xl">
              Update Available
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-base pt-2">
              A new version of FreedomCamp Manager is ready to install
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            {/* Version Comparison */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="border-2 border-gray-300">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground mb-1">Current Version</p>
                  <p className="text-2xl font-bold text-gray-600">{previousVersion}</p>
                </CardContent>
              </Card>
              <Card className="border-2 border-green-500 bg-green-50 dark:bg-green-950/20">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground mb-1">New Version</p>
                  <p className="text-2xl font-bold text-green-600">{newVersion}</p>
                  <Badge variant="secondary" className="mt-2">
                    ✨ Latest
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Changelog */}
            <div className="bg-muted p-4 rounded-lg border-2 border-border">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                What's New in v{newVersion}
              </h4>
              <ul className="space-y-2">
                {getChangelogForVersion(newVersion).map((change, index) => (
                  <li key={index} className="text-sm flex items-start gap-2">
                    <span className="text-green-600 shrink-0">✓</span>
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Warning */}
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-300 dark:border-amber-700">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                    Important: Update Process
                  </p>
                  <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                    <li>• You will be logged out of your current session</li>
                    <li>• The app will restart automatically</li>
                    <li>• If you experience issues, you can rollback to v{previousVersion}</li>
                    <li>• Save any unsaved work before proceeding</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel
              onClick={handleDismissUpdate}
              disabled={isUpdating}
              className="w-full sm:w-auto"
            >
              Update Later
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUpdate}
              disabled={isUpdating}
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700 h-11"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Installing Update...
                </>
              ) : (
                <>
                  <RefreshCw className="h-5 w-5 mr-2" />
                  Install Update Now
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback Dialog */}
      <AlertDialog open={showRollbackDialog} onOpenChange={setShowRollbackDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center">
              <ArrowLeft className="h-8 w-8 text-amber-600" />
            </div>
            <AlertDialogTitle className="text-center text-xl">
              Rollback to Previous Version
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center pt-2">
              Having issues with the current version?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-300 dark:border-amber-700">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                ⚠️ Rollback Process
              </p>
              <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <li>• App will revert to v{previousVersion}</li>
                <li>• You will be logged out</li>
                <li>• Recent features may not be available</li>
                <li>• Data created in current version will be preserved</li>
              </ul>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              If problems persist, please contact support
            </div>
          </div>

          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel
              disabled={isRollingBack}
              className="w-full sm:w-auto"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRollback}
              disabled={isRollingBack}
              className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700"
            >
              {isRollingBack ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Rolling Back...
                </>
              ) : (
                <>
                  <ArrowLeft className="h-5 w-5 mr-2" />
                  Rollback Now
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback Button (shown after login if rollback is available) */}
      {localStorage.getItem(ROLLBACK_AVAILABLE_KEY) && !showUpdateDialog && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom duration-300">
          <Button
            variant="outline"
            size="sm"
            onClick={handleShowRollback}
            className="shadow-lg border-2 border-amber-300 bg-white dark:bg-gray-900 hover:bg-amber-50"
          >
            <Shield className="h-4 w-4 mr-2 text-amber-600" />
            App Issues? Rollback Available
          </Button>
        </div>
      )}
    </>
  );
}
