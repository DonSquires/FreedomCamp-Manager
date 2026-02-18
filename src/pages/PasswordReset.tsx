import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, Mail, Lock, ArrowLeft, Loader2 } from 'lucide-react';

export function PasswordReset() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  // Check if we have a reset token in URL (user clicked email link)
  const resetToken = searchParams.get('access_token') || searchParams.get('token');
  const isResetMode = resetToken || mode === 'reset';

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/password-reset`,
      });

      if (error) throw error;

      setEmailSent(true);
      toast.success('Password reset email sent! Check your inbox.');
    } catch (error: any) {
      console.error('Password reset request failed:', error);
      toast.error(error.message || 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setResetComplete(true);
      toast.success('Password reset successful!');
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (error: any) {
      console.error('Password reset failed:', error);
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto mb-4">
            <JDSLogo size="xl" showShadow={true} className="mx-auto" />
          </div>
          <h1 className="text-3xl font-bold">FreedomCamp Manager</h1>
          <p className="text-base text-muted-foreground">Password Reset</p>
        </div>

        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" className="h-8 w-8 rounded-full object-cover" />
              <CardTitle>
                {isResetMode ? 'Set New Password' : 'Reset Password'}
              </CardTitle>
            </div>
            <CardDescription>
              {isResetMode
                ? 'Enter your new password below'
                : 'Enter your email to receive a password reset link'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {emailSent ? (
              // Email sent confirmation
              <div className="space-y-4">
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <AlertDescription className="ml-2 text-green-800 dark:text-green-200">
                    <strong>Email sent!</strong>
                    <p className="mt-2 text-sm">
                      Check your inbox at <strong>{email}</strong> for a password reset link.
                      The link will expire in 1 hour.
                    </p>
                  </AlertDescription>
                </Alert>

                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-500 mb-1">
                    ℹ️ Didn't receive the email?
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Check your spam/junk folder</li>
                    <li>Make sure you entered the correct email</li>
                    <li>Wait a few minutes and try again</li>
                  </ul>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => navigate('/login')} className="flex-1">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Login
                  </Button>
                  <Button onClick={() => setEmailSent(false)} className="flex-1">
                    Try Again
                  </Button>
                </div>
              </div>
            ) : resetComplete ? (
              // Password reset complete
              <div className="space-y-4">
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <AlertDescription className="ml-2 text-green-800 dark:text-green-200">
                    <strong>Password reset successful!</strong>
                    <p className="mt-2 text-sm">
                      Your password has been updated. Redirecting to login...
                    </p>
                  </AlertDescription>
                </Alert>

                <Button onClick={() => navigate('/login')} className="w-full">
                  Continue to Login
                </Button>
              </div>
            ) : isResetMode ? (
              // Reset password form (after clicking email link)
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Enter new password (min. 6 characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-xs text-blue-800 dark:text-blue-200 font-medium mb-1">
                    Password Requirements:
                  </p>
                  <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5 list-disc list-inside">
                    <li>At least 6 characters long</li>
                    <li>Use a strong, unique password</li>
                  </ul>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Resetting Password...
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Reset Password
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/login')}
                  className="w-full"
                  disabled={isLoading}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Login
                </Button>
              </form>
            ) : (
              // Request reset form
              <form onSubmit={handleRequestReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your.email@patrol.nz"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending Reset Link...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Send Reset Link
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/login')}
                  className="w-full"
                  disabled={isLoading}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Login
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
