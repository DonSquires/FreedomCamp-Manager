/**
 * FreedomCamp Manager - Main App Router
 * Login → Portal Selection → Field/Admin Portal
 */

import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { PWAInstallPrompt } from '@/components/features/PWAInstallPrompt';
import { PWAUpdateNotification } from '@/components/features/PWAUpdateNotification';
import { StandaloneDetector } from '@/components/features/StandaloneDetector';
import { NetworkStatusBar } from '@/components/features/NetworkStatusBar';
import { AppBadge } from '@/components/features/AppBadge';
import { useAuthStore } from '@/stores/authStore';
import { FieldOfficerPortal } from '@/pages/FieldOfficerPortal';
import { AdminPortal } from '@/pages/AdminPortal';
import { PortalSelection } from '@/pages/PortalSelection';
import { Login } from '@/pages/Login';
import { FancyLoader } from '@/components/features/FancyLoader';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { initializePushNotifications } from '@/lib/pushNotifications';

function App() {
  const { user, isAuthenticated, logout, checkSession } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);
  const navigate = useNavigate();

  // Initialize auth on mount
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

  // Auto-navigate to portal selection after login if no portal selected yet
  useEffect(() => {
    if (isAuthenticated && !isInitializing) {
      const selectedPortal = localStorage.getItem('selected_portal');
      const currentPath = window.location.pathname;
      
      // If authenticated but no portal selected and not already on portal selection page
      if (!selectedPortal && currentPath !== '/portal-selection' && currentPath !== '/field-officer' && currentPath !== '/admin') {
        navigate('/portal-selection');
      }
    }
  }, [isAuthenticated, isInitializing, navigate]);

  // Initialize push notifications
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

  return (
    <>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/portal-selection" replace />} />
        
        {/* Protected Routes */}
        {isAuthenticated ? (
          <>
            <Route path="/portal-selection" element={<PortalSelection />} />
            <Route path="/field-officer" element={<FieldOfficerPortal onLogout={logout} />} />
            <Route path="/admin" element={<AdminPortal onLogout={logout} />} />
            <Route path="/" element={<Navigate to="/portal-selection" replace />} />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>

      <Toaster position="top-right" richColors />
      <StandaloneDetector />
      <NetworkStatusBar />
      <AppBadge />
    </>
  );
}

export default App;
