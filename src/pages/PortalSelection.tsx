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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto mb-4">
            <JDSLogo size="xl" showShadow={true} className="mx-auto" />
          </div>
          <h1 className="text-3xl font-bold">FreedomCamp Manager</h1>
          <p className="text-sm text-muted-foreground font-mono">v{APP_VERSION}</p>
          <p className="text-lg text-muted-foreground mt-4">
            Welcome, {user?.first_name} {user?.last_name}
          </p>
        </div>

        {/* Portal Selection Card */}
        <Card className="border-2">
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Building className="h-10 w-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Select Portal</h2>
              <p className="text-muted-foreground">
                Choose which portal you'd like to access
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Field Officer Portal */}
              <Button
                variant="outline"
                className="h-auto flex flex-col items-center justify-center gap-4 p-8 border-2 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all"
                onClick={() => handleSelectPortal('field')}
                disabled={isNavigating}
              >
                <div className="h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <User className="h-8 w-8 text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-lg mb-1">Field Officer Portal</p>
                  <p className="text-sm text-muted-foreground">
                    Record observations, create incidents, manage patrols
                  </p>
                </div>
              </Button>

              {/* Admin Portal */}
              <Button
                variant="outline"
                className="h-auto flex flex-col items-center justify-center gap-4 p-8 border-2 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all"
                onClick={() => handleSelectPortal('admin')}
                disabled={isNavigating}
              >
                <div className="h-16 w-16 rounded-full bg-purple-500/10 flex items-center justify-center">
                  <Shield className="h-8 w-8 text-purple-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-lg mb-1">Admin Portal</p>
                  <p className="text-sm text-muted-foreground">
                    Review observations, manage enforcement, view analytics
                  </p>
                </div>
              </Button>
            </div>

            {/* Info Box */}
            {user?.role === 'admin_officer' && (
              <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-300 dark:border-amber-700">
                <p className="text-xs text-amber-900 dark:text-amber-100 font-semibold mb-1">
                  ⚠️ Important: Self-Approval Prevention
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200">
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
