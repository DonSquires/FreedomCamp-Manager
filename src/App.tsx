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
import { BugReportButton } from '@/components/features/BugReportButton';
import { useAuthStore } from '@/stores/authStore';
import { FieldOfficerPortal } from '@/pages/FieldOfficerPortal';
import { AdminPortal } from '@/pages/AdminPortal';
import { PortalSelection } from '@/pages/PortalSelection';
import { Login } from '@/pages/Login';
import { PasswordReset } from '@/pages/PasswordReset';
import { VehicleRegistryFiltered } from '@/pages/VehicleRegistryFiltered';
import ALPRDiagnostic from '@/pages/ALPRDiagnostic';
import HotspotsMapPage from '@/pages/HotspotsMap';
import DatabaseToolsPage from '@/pages/DatabaseTools';
import ObservationsPage from '@/pages/ObservationsPage';
import { EnforcementReviewPortal } from '@/pages/EnforcementReviewPortal';
import BreachAlertsReport from '@/pages/BreachAlertsReport';
import EnforcementActions from '@/pages/EnforcementActions';
import OfficerWelfareManagement from '@/pages/OfficerWelfareManagement';
import ReportsHub from '@/pages/ReportsHub';
import ZoneManagement from '@/pages/ZoneManagement';
import UserManagement from '@/pages/UserManagement';
import VehicleRegistryFiltered from '@/pages/VehicleRegistryFiltered';
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

  // Auto-navigate based on role after login
  useEffect(() => {
    if (isAuthenticated && !isInitializing && user) {
      const selectedPortal = localStorage.getItem('selected_portal');
      const currentPath = window.location.pathname;
      
      // Skip if already on a portal page
      if (currentPath.startsWith('/field-officer') || currentPath.startsWith('/admin') || currentPath === '/portal-selection') {
        return;
      }

      // Route based on user role
      if (user.role === 'admin_officer') {
        // Dual role - show portal selection if no portal chosen yet
        if (!selectedPortal) {
          navigate('/portal-selection');
        } else {
          // Navigate to previously selected portal
          navigate(selectedPortal === 'field' ? '/field-officer' : '/admin');
        }
      } else if (user.role === 'officer') {
        // Officers go directly to field portal
        navigate('/field-officer');
      } else if (user.role === 'admin' || user.role === 'master') {
        // Admins/Masters go directly to admin portal
        navigate('/admin');
      }
    }
  }, [isAuthenticated, isInitializing, user, navigate]);

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
        <Route path="/password-reset" element={<PasswordReset />} />
        
        {/* Protected Routes */}
        {isAuthenticated && user ? (
          <>
            {/* Portal Selection - Only for admin_officer role */}
            {user.role === 'admin_officer' && (
              <Route path="/portal-selection" element={<PortalSelection />} />
            )}
            
            {/* Field Officer Portal - For officers and admin_officers */}
            {(user.role === 'officer' || user.role === 'admin_officer') && (
              <Route path="/field-officer" element={<FieldOfficerPortal onLogout={logout} />} />
            )}
            
            {/* Admin Portal - For admins, masters, and admin_officers */}
            {(user.role === 'admin' || user.role === 'master' || user.role === 'admin_officer') && (
              <>
                <Route path="/admin" element={<AdminPortal onLogout={logout} />} />
                <Route path="/admin/dashboard" element={<AdminPortal onLogout={logout} />} />
                <Route path="/admin/hotspots" element={<HotspotsMapPage />} />
                <Route path="/admin/observations" element={<ObservationsPage />} />
                <Route path="/admin/vehicles" element={<VehicleRegistryFiltered />} />
                <Route path="/admin/zones" element={<ZoneManagement />} />
                <Route path="/admin/users" element={<UserManagement />} />
                
                {/* Enforcement Review Portal */}
                <Route path="/admin/enforcement-review" element={<EnforcementReviewPortal />} />
                
                {/* Breach Alerts Page */}
                <Route path="/admin/breaches" element={<BreachAlertsReport />} />
                
                {/* Reports Hub */}
                <Route path="/admin/reports" element={<ReportsHub />} />
                {/* Full Pages - No longer redirects */}
                <Route path="/admin/enforcement" element={<EnforcementActions />} />
                <Route path="/admin/officer-welfare" element={<OfficerWelfareManagement />} />
                
                {/* Database/System Tools */}
                <Route path="/admin/db-tools" element={<DatabaseToolsPage />} />
                <Route path="/admin/alpr-diagnostic" element={<ALPRDiagnostic />} />
              </>
            )}
            
            {/* Root - Redirect based on role */}
            <Route path="/" element={
              user.role === 'admin_officer' ? <Navigate to="/portal-selection" replace /> :
              user.role === 'officer' ? <Navigate to="/field-officer" replace /> :
              <Navigate to="/admin" replace />
            } />
            
            {/* Catch-all - Redirect to appropriate portal */}
            <Route path="*" element={
              user.role === 'admin_officer' ? <Navigate to="/portal-selection" replace /> :
              user.role === 'officer' ? <Navigate to="/field-officer" replace /> :
              <Navigate to="/admin" replace />
            } />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>

      <Toaster position="top-right" richColors />
      <StandaloneDetector />
      <NetworkStatusBar />
      <AppBadge />
      <BugReportButton />
    </>
  );
}

export default App;
