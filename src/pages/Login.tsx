import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/authStore';
import { Fingerprint, Scan, AlertTriangle, Monitor, Shield } from 'lucide-react';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { toast } from 'sonner';
import { APP_VERSION } from '@/constants/version';

import {
  isBiometricAvailable,
  hasBiometricCredential,
  registerBiometric,
  authenticateBiometric,
} from '@/lib/biometric';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showBiometricEnrollment, setShowBiometricEnrollment] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [lastSuccessfulEmail, setLastSuccessfulEmail] = useState('');
  const [showDuplicateSessionDialog, setShowDuplicateSessionDialog] = useState(false);
  const [duplicateSessionInfo, setDuplicateSessionInfo] = useState({ device: '', lastActive: '' });
  const loginWithPassword = useAuthStore((state) => state.login);
  const forceLogin = useAuthStore((state) => state.forceLogin);

  // Check biometric availability
  useEffect(() => {
    setBiometricAvailable(isBiometricAvailable());
    const lastEmail = localStorage.getItem('last_login_email');
    if (lastEmail) {
      setEmail(lastEmail);
      setHasBiometric(hasBiometricCredential(lastEmail));
    }
  }, []);

  // Update biometric status when email changes
  useEffect(() => {
    if (email && biometricAvailable) {
      setHasBiometric(hasBiometricCredential(email));
    } else {
      setHasBiometric(false);
    }
  }, [email, biometricAvailable]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Please enter both email and password');
      return;
    }

    if (!email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      await loginWithPassword(email, password);
      
      // Save email for biometric
      localStorage.setItem('last_login_email', email);
      setLastSuccessfulEmail(email);

      // Check if biometric is available and not yet enrolled
      if (biometricAvailable && !hasBiometricCredential(email)) {
        setShowBiometricEnrollment(true);
      } else {
        toast.success('🎉 Welcome back! Redirecting to dashboard...', {
          duration: 3000,
        });
      }
      
      // Login successful - don't reset loading, let navigation happen
    } catch (error: any) {
      // Check if this is a duplicate session error
      if (error?.code === 'DUPLICATE_SESSION' || error?.message?.includes('DUPLICATE_SESSION')) {
        const parts = error.message.split('|||');
        if (parts.length >= 3) {
          setDuplicateSessionInfo({
            device: parts[1] || 'Another device',
            lastActive: parts[2] || 'Recently',
          });
          setShowDuplicateSessionDialog(true);
        }
        setIsLoading(false);
        return;
      }

      toast.error(error.message || 'Login failed. Please check your credentials.');
      setIsLoading(false);
    }
  };

  const handleForceLogin = async () => {
    setShowDuplicateSessionDialog(false);
    setIsLoading(true);

    try {
      await forceLogin(email, password);
      
      toast.success('✅ Logged in successfully. Previous session terminated.', {
        duration: 3000,
      });

      // Save email for biometric
      localStorage.setItem('last_login_email', email);
      setLastSuccessfulEmail(email);

      // Check if biometric is available and not yet enrolled
      if (biometricAvailable && !hasBiometricCredential(email)) {
        setShowBiometricEnrollment(true);
      }
    } catch (error: any) {
      toast.error(error.message || 'Force login failed');
      setIsLoading(false);
    }
  };

  const handleCancelForceLogin = () => {
    setShowDuplicateSessionDialog(false);
    setIsLoading(false);
    toast.info('Login cancelled');
  };

  const handleBiometricLogin = async () => {
    if (!email || !hasBiometricCredential(email)) {
      toast.error('Please enter your email or set up biometric login first');
      return;
    }

    setIsLoading(true);
    try {
      const result = await authenticateBiometric(email);
      if (result.success) {
        toast.success('Biometric authentication successful!');
        toast.info('Complete login by entering your password');
      } else {
        toast.error('Biometric authentication failed');
      }
    } catch (error: any) {
      toast.error(error.message || 'Biometric authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnrollBiometric = async () => {
    try {
      const credential = await registerBiometric(lastSuccessfulEmail, lastSuccessfulEmail.split('@')[0]);
      if (credential) {
        toast.success('Biometric login enabled!');
        setShowBiometricEnrollment(false);
        setHasBiometric(true);
      } else {
        toast.error('Failed to enable biometric login');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to enable biometric login');
    }
  };

  const handleSkipBiometric = () => {
    setShowBiometricEnrollment(false);
    toast.success('Welcome back!');
  };

  return (
    <>
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto mb-4">
            <JDSLogo size="xl" showShadow={true} className="mx-auto" />
          </div>
          <h1 className="text-3xl font-bold">FreedomCamp Manager</h1>
          <p className="text-sm text-muted-foreground font-mono">v{APP_VERSION}</p>
          <p className="text-base text-muted-foreground">Patrol Operations & Enforcement</p>
        </div>

        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" className="h-8 w-8 rounded-full object-cover" />
              <CardTitle>Login</CardTitle>
            </div>
            <CardDescription>
              Sign in to access the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@patrol.nz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
              
              {biometricAvailable && hasBiometric && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleBiometricLogin}
                  disabled={isLoading || !email}
                >
                  <Fingerprint className="h-5 w-5 mr-2" />
                  Use Biometric Login
                </Button>
              )}
            </form>

            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-500 mb-1">ℹ️ Need Access?</p>
              <p className="text-xs text-muted-foreground">
                Contact your administrator to request an account.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    {/* Duplicate Session Warning Dialog */}
    <Dialog open={showDuplicateSessionDialog} onOpenChange={setShowDuplicateSessionDialog}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
          <DialogTitle className="text-center text-xl">Already Logged In</DialogTitle>
          <DialogDescription className="text-center pt-2">
            You are currently logged in on another device
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="p-4 bg-muted rounded-lg border-2 border-amber-300/30">
            <div className="flex items-start gap-3">
              <Monitor className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground mb-1">Active Device:</p>
                <p className="text-xs text-muted-foreground break-words mb-2">{duplicateSessionInfo.device}</p>
                <p className="text-xs text-muted-foreground">{duplicateSessionInfo.lastActive}</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-300 dark:border-amber-700">
            <p className="text-sm text-amber-900 dark:text-amber-100 font-semibold mb-2">⚠️ What happens next?</p>
            <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
              <li>Your session on the other device will be terminated</li>
              <li>You will be logged out on that device immediately</li>
              <li>You will be logged in on this device</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleCancelForceLogin} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button onClick={handleForceLogin} className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Continue & Log Out Other Device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Biometric Enrollment Dialog */}
    <Dialog open={showBiometricEnrollment} onOpenChange={setShowBiometricEnrollment}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Scan className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">Enable Biometric Login?</DialogTitle>
          <DialogDescription className="text-center pt-2">
            Use your fingerprint or Face ID for faster, more secure access to FreedomCamp Manager.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3 py-4">
          <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
            <Shield className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-medium">More Secure</p>
              <p className="text-xs text-muted-foreground">Your biometric data never leaves your device</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
            <Fingerprint className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-medium">Faster Login</p>
              <p className="text-xs text-muted-foreground">Skip typing your password every time</p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleSkipBiometric} className="w-full sm:w-auto">
            Maybe Later
          </Button>
          <Button onClick={handleEnrollBiometric} className="w-full sm:w-auto">
            <Fingerprint className="h-4 w-4 mr-2" />
            Enable Biometric Login
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
