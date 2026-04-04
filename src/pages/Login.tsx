import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isPasswordSetupMode, setIsPasswordSetupMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingResetEmail, setSendingResetEmail] = useState(false)
  const [updatingPassword, setUpdatingPassword] = useState(false)
  const { login, user, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()

  const getAuthTypeFromUrl = () => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const queryParams = new URLSearchParams(window.location.search)
    return hashParams.get('type') || queryParams.get('type')
  }

  // Redirect if already authenticated
  useEffect(() => {
    const type = getAuthTypeFromUrl()
    const passwordSetupMode = type === 'recovery' || type === 'invite'
    setIsPasswordSetupMode(passwordSetupMode)

    if (isAuthenticated && user && !passwordSetupMode) {
      if (user.role === 'admin_officer') {
        window.sessionStorage.removeItem('adminOfficerPortalChoice')
        navigate('/portal-selection', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    }
  }, [isAuthenticated, user, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await login(email, password)
      toast.success('Login successful')
      // Request fullscreen for tablet/mobile field officer workflows
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // Fullscreen may be denied by the browser; ignore silently
        })
      }
      // Navigation is handled by the useEffect that watches isAuthenticated/user.
      // Reset loading so the button is usable if navigation doesn't happen.
      setLoading(false)
    } catch (error: any) {
      toast.error(error.message || 'Login failed')
      setLoading(false)
    }
  }

  const handleSendResetEmail = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      toast.error('Enter your email first')
      return
    }

    setSendingResetEmail(true)
    try {
      const redirectTo = `${window.location.origin}/login`
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
      if (error) throw error
      toast.success('Password reset email sent. Check your inbox.')
    } catch (error: any) {
      toast.error(error.message || 'Failed to send password reset email')
    } finally {
      setSendingResetEmail(false)
    }
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setUpdatingPassword(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        throw new Error('Password setup session expired. Open the email link again.')
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      // Clear token fragments from URL after successful password setup.
      window.history.replaceState({}, document.title, '/login')
      setIsPasswordSetupMode(false)
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password updated successfully. You can now sign in.')
    } catch (error: any) {
      toast.error(error.message || 'Failed to update password')
    } finally {
      setUpdatingPassword(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left hero panel (desktop only) ───────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[440px] lg:flex-col lg:justify-between bg-gradient-to-b from-slate-900 via-blue-950 to-slate-900 p-10 text-white shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <img
              src="/iron-eagle-security-logo.jpg"
              alt="Iron Eagle Security"
              className="h-16 w-16 rounded-2xl object-cover shadow-lg"
            />
            <div>
              <h1 className="text-xl font-bold leading-tight">FieldOps Manager</h1>
              <p className="text-blue-300 text-sm mt-0.5">Field Operations Management Platform</p>
            </div>
          </div>

          <ul className="space-y-4 mt-6">
            {[
              'Real-time vehicle compliance & ALPR scanning',
              'Officer patrol tracking & welfare monitoring',
              'Automated breach detection & enforcement pipeline',
              'Roster, timesheets & workforce management',
              'Bob inference-agent analysis & legislation guidance',
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                <span className="text-sm text-blue-100 leading-snug">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-blue-400/70 mt-8">
          Trusted by Iron Eagle Security · OnSpace
        </p>
      </div>

      {/* ── Right form panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white dark:bg-gray-950">
        <div className="w-full max-w-sm">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img
              src="/iron-eagle-security-logo.jpg"
              alt="Iron Eagle Security"
              className="h-16 w-16 rounded-2xl object-cover shadow-md mb-3"
            />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">FieldOps Manager</h1>
            <p className="text-sm text-gray-500 mt-0.5">Field Operations Management Platform</p>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">
            {isPasswordSetupMode ? 'Set your password' : 'Sign in'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {isPasswordSetupMode ? 'Create a secure password to access your account.' : 'Enter your credentials to continue.'}
          </p>

          {isPasswordSetupMode ? (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  disabled={updatingPassword}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Confirm Password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  disabled={updatingPassword}
                />
              </div>

              <Button type="submit" className="w-full" disabled={updatingPassword}>
                {updatingPassword ? 'Updating password...' : 'Set Password'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>

              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={handleSendResetEmail}
                disabled={sendingResetEmail || loading}
              >
                {sendingResetEmail ? 'Sending reset email...' : 'Forgot password?'}
              </Button>
            </form>
          )}

          <div className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
            <p>Iron Eagle Security · Field Operations Management</p>
          </div>
        </div>
      </div>
    </div>
  )
}
