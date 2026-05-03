import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { CheckCircle2, RadioTower, ShieldCheck, Route } from 'lucide-react'
import { getDefaultRouteForRole } from '@/navigation/rolePath'

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

  const operationalPillars = [
    {
      icon: ShieldCheck,
      title: 'Compliance Confidence',
      description: 'End-to-end enforcement workflows with auditable evidence trails.',
    },
    {
      icon: RadioTower,
      title: 'Live Operations',
      description: 'Real-time officer status, patrol movement, and event response.',
    },
    {
      icon: Route,
      title: 'Shift Clarity',
      description: 'Roster-aware experiences for patrol, guarding, parking, and noise.',
    },
  ]

  useEffect(() => {
    const type = getAuthTypeFromUrl()
    const passwordSetupMode = type === 'recovery' || type === 'invite'
    setIsPasswordSetupMode(passwordSetupMode)

    if (isAuthenticated && user && !passwordSetupMode) {
      if (user.role === 'admin_officer') {
        window.sessionStorage.removeItem('adminOfficerPortalChoice')
        navigate(getDefaultRouteForRole(user.role), { replace: true })
      } else {
        navigate(getDefaultRouteForRole(user.role), { replace: true })
      }
    }
  }, [isAuthenticated, user, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await login(email, password)
      toast.success('Login successful')
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // Browser may deny fullscreen; this is non-fatal.
        })
      }
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
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      toast.success('Password updated successfully')
      setIsPasswordSetupMode(false)
      navigate('/login', { replace: true })
    } catch (error: any) {
      toast.error(error.message || 'Failed to update password')
    } finally {
      setUpdatingPassword(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[linear-gradient(140deg,#f3ebde_0%,#f5f1e7_38%,#dbe5f1_100%)]">
      <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-orange-300/35 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-sky-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-emerald-200/30 blur-3xl" />

      <div className="relative mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 lg:gap-8 items-stretch">
          <section className="rounded-3xl border border-white/70 bg-white/75 backdrop-blur-lg p-6 sm:p-8 lg:p-10 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-center gap-4 mb-6">
              <img
                src="/iron-eagle-security-logo.jpg"
                alt="Iron Eagle Security"
                className="h-14 w-14 rounded-2xl object-cover shadow-md"
              />
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Operations Platform</p>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">FieldOps Manager</h1>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-3xl sm:text-4xl font-semibold leading-tight tracking-tight text-slate-900">
                Secure command center for field enforcement in New Zealand.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 max-w-2xl">
                Coordinate patrols, compliance, and incident response from one operational console designed for speed under pressure.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {operationalPillars.map((pillar) => {
                const Icon = pillar.icon
                return (
                  <div
                    key={pillar.title}
                    className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-4 transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <Icon className="h-5 w-5 text-slate-700" />
                    <p className="mt-3 text-sm font-semibold text-slate-900">{pillar.title}</p>
                    <p className="mt-1 text-xs leading-snug text-slate-600">{pillar.description}</p>
                  </div>
                )
              })}
            </div>


          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white/88 backdrop-blur-xl p-6 sm:p-8 shadow-[0_20px_60px_rgba(15,23,42,0.14)]">
            <div className="lg:hidden flex items-center gap-3 mb-6">
              <img
                src="/iron-eagle-security-logo.jpg"
                alt="Iron Eagle Security"
                className="h-11 w-11 rounded-xl object-cover shadow-sm"
              />
              <div>
                <h1 className="text-lg font-semibold text-slate-900">FieldOps Manager</h1>
                <p className="text-xs text-slate-600">Field Operations Management Platform</p>
              </div>
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 mb-1">
              {isPasswordSetupMode ? 'Create your password' : 'Sign in'}
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              {isPasswordSetupMode ? 'Set a secure password to activate your account access.' : 'Use your assigned credentials to continue.'}
            </p>

            {isPasswordSetupMode ? (
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 mb-1.5">
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
                    className="h-11 bg-white"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">
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
                    className="h-11 bg-white"
                  />
                </div>

                <Button type="submit" className="w-full h-11 bg-slate-900 hover:bg-slate-800" disabled={updatingPassword}>
                  {updatingPassword ? 'Updating password...' : 'Set Password'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
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
                    className="h-11 bg-white"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
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
                    className="h-11 bg-white"
                  />
                </div>

                <Button type="submit" className="w-full h-11 bg-slate-900 hover:bg-slate-800" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>

                <Button
                  type="button"
                  variant="link"
                  className="w-full text-slate-600"
                  onClick={handleSendResetEmail}
                  disabled={sendingResetEmail || loading}
                >
                  {sendingResetEmail ? 'Sending reset email...' : 'Forgot password?'}
                </Button>
              </form>
            )}

            <div className="mt-7 text-center text-xs text-slate-500 border-t border-slate-200 pt-4">
              <p className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Iron Eagle Security · Field Operations Management
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
