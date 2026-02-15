/**
 * Portal Selection - Landing Page
 * Shows after successful login - user chooses Admin or Field portal
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Shield, User, Building } from 'lucide-react';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { APP_VERSION } from '@/constants/version';
import { useAuthStore } from '@/stores/authStore';

export function PortalSelection() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [isNavigating, setIsNavigating] = useState(false);

  // Security: Only admin_officer role should see this page
  if (!user || user.role !== 'admin_officer') {
    // Redirect non-admin_officer users to their appropriate portal
    if (user?.role === 'officer') {
      navigate('/field-officer', { replace: true });
    } else if (user?.role === 'admin' || user?.role === 'master') {
      navigate('/admin', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
    return null;
  }

  const handleSelectPortal = (portal: 'field' | 'admin') => {
    setIsNavigating(true);
    
    // Store selection
    localStorage.setItem('selected_portal', portal);
    
    // Navigate to selected portal
    if (portal === 'field') {
      navigate('/field-officer');
    } else {
      navigate('/admin');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl space-y-4 sm:space-y-6 py-4">
        {/* Header */}
        <div className="text-center space-y-1 sm:space-y-2">
          <div className="mx-auto mb-2 sm:mb-4">
            <JDSLogo size="lg" showShadow={true} className="mx-auto" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">FreedomCamp Manager</h1>
          <p className="text-xs sm:text-sm text-muted-foreground font-mono">v{APP_VERSION}</p>
          <p className="text-sm sm:text-lg text-muted-foreground mt-2 sm:mt-4">
            Welcome, {user?.first_name} {user?.last_name}
          </p>
        </div>

        {/* Portal Selection Card */}
        <Card className="border-2">
          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="text-center mb-4 sm:mb-6">
              <div className="mx-auto mb-2 sm:mb-4 h-14 w-14 sm:h-16 sm:w-16 md:h-20 md:w-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Building className="h-7 w-7 sm:h-8 sm:w-8 md:h-10 md:w-10 text-primary" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">Select Portal</h2>
              <p className="text-xs sm:text-sm text-muted-foreground px-2">
                Choose which portal you'd like to access
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {/* Field Officer Portal */}
              <Button
                variant="outline"
                className="h-auto flex flex-col items-center justify-center gap-2 sm:gap-3 md:gap-4 p-4 sm:p-6 md:p-8 border-2 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all"
                onClick={() => handleSelectPortal('field')}
                disabled={isNavigating}
              >
                <div className="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <User className="h-6 w-6 sm:h-7 sm:w-7 md:h-8 md:w-8 text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-base sm:text-lg mb-1">Field Officer Portal</p>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-tight">
                    Record observations, create incidents, manage patrols
                  </p>
                </div>
              </Button>

              {/* Admin Portal */}
              <Button
                variant="outline"
                className="h-auto flex flex-col items-center justify-center gap-2 sm:gap-3 md:gap-4 p-4 sm:p-6 md:p-8 border-2 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all"
                onClick={() => handleSelectPortal('admin')}
                disabled={isNavigating}
              >
                <div className="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-6 w-6 sm:h-7 sm:w-7 md:h-8 md:w-8 text-purple-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-base sm:text-lg mb-1">Admin Portal</p>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-tight">
                    Review observations, manage enforcement, view analytics
                  </p>
                </div>
              </Button>
            </div>

            {/* Info Box */}
            {user?.role === 'admin_officer' && (
              <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-300 dark:border-amber-700">
                <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-100 font-semibold mb-1">
                  ⚠️ Important: Self-Approval Prevention
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-snug">
                  If you record observations in the Field Officer portal, you cannot approve or modify them in the Admin portal. This prevents conflicts of interest.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
