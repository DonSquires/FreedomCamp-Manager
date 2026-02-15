
/**
 * FreedomCamp Manager - Phase 1 Unified App
 * Simple role-based routing
 * v2.1.6 - Build: Production
 */

import { useState, useEffect } from 'react';
import { PWAInstallPrompt } from '@/components/features/PWAInstallPrompt';
import { PWAUpdateNotification } from '@/components/features/PWAUpdateNotification';
import { StandaloneDetector } from '@/components/features/StandaloneDetector';
import { NetworkStatusBar } from '@/components/features/NetworkStatusBar';
import { AppBadge } from '@/components/features/AppBadge';
import { useAuthStore } from '@/stores/authStore';
import { FieldOfficerPortal } from '@/pages/FieldOfficerPortal';
import { AdminPortal } from '@/pages/AdminPortal';
import { DataMigrationUtility } from '@/pages/DataMigrationUtility';
import { Login } from '@/pages/Login';
import { FancyLoader } from '@/components/features/FancyLoader';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { initializePushNotifications } from '@/lib/pushNotifications';

function App() {
  const { user, isAuthenticated, logout, checkSession } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialize auth on mount - check for existing session
  useEffect(() => {
    const initAuth = async () => {
      try {
        await checkSession();
      } catch (error) {
        console.error('Session check failed:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    initAuth();
  }, [checkSession]);

  // Initialize push notifications on first user interaction
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const handleFirstInteraction = async () => {
      const granted = await initializePushNotifications();
      if (granted) {
        toast.success('🔔 Notifications enabled', { duration: 3000 });
      }
    };

    document.addEventListener('click', handleFirstInteraction, { once: true });
    return () => document.removeEventListener('click', handleFirstInteraction);
  }, [isAuthenticated, user]);

  // Show loader during initialization
  if (isInitializing) {
    return <FancyLoader />;
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        <Login />
        <Toaster position="top-right" richColors />
      </>
    );
  }

  // Route based on role
  const isFieldOfficer = user?.role === 'officer' || user?.role === 'field_staff';
  const isAdmin = user?.role === 'admin' || user?.role === 'master';
  const isAdminOfficer = user?.role === 'admin_officer';

  // Admin_officer can access both portals based on stored preference
  if (isAdminOfficer) {
    const selectedPortal = localStorage.getItem('selected_portal') as 'field' | 'admin' | null;
    
    if (selectedPortal === 'field') {
      return (
        <>
          <FieldOfficerPortal onLogout={logout} />
          <Toaster position="top-right" richColors />
          <StandaloneDetector />
          <NetworkStatusBar />
          <AppBadge />
        </>
      );
    } else if (selectedPortal === 'admin') {
      return (
        <>
          <AdminPortal onLogout={logout} />
          <Toaster position="top-right" richColors />
          <StandaloneDetector />
          <NetworkStatusBar />
          <AppBadge />
        </>
      );
    } else {
      // No portal selected yet - should not happen, but handle gracefully
      return (
        <>
          <Login />
          <Toaster position="top-right" richColors />
        </>
      );
    }
  }

  return (
    <>
      {isFieldOfficer ? (
        <FieldOfficerPortal onLogout={logout} />
      ) : isAdmin ? (
        <AdminPortal onLogout={logout} />
      ) : (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">Unknown Role</h1>
            <p className="text-muted-foreground mb-4">
              Your account role ({user?.role}) is not recognized. Please contact your administrator.
            </p>
            <button
              onClick={logout}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
            >
              Logout
            </button>
          </div>
        </div>
      )}
      <Toaster position="top-right" richColors />
      <StandaloneDetector />
      <NetworkStatusBar />
      <AppBadge />
    </>
  );
}

export default App;
