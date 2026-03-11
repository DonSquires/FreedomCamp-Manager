import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useSessionLockStore } from '@/stores/sessionLockStore'
import { useSessionPreferencesStore } from '@/stores/sessionPreferencesStore'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import {
  Menu,
  Home,
  BarChart3,
  AlertTriangle,
  Car,
  MapPin,
  Users,
  FileText,
  Shield,
  Settings,
  Database,
  Building2,
  LogOut,
  ChevronLeft,
  Search,
  Activity,
  Gavel,
  MonitorPlay,
  EyeOff,
  ScanLine,
  Receipt,
  User,
  Lock,
  Unlock,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { signalSessionActivity } from '@/hooks/useSessionInactivityLock'

interface AppLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
  showBackButton?: boolean
}

const navigationItems = [
  { path: '/', icon: Home, label: 'Home', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/search', icon: Search, label: 'Universal Search', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/compliance', icon: BarChart3, label: 'Compliance Dashboard', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/compliance-recalculation', icon: Shield, label: 'Manual Recalculation', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/breaches', icon: AlertTriangle, label: 'Breach & Safety Alerts', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/enforcement-actions', icon: Gavel, label: 'Enforcement Actions', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/infringements', icon: Receipt, label: 'Infringement Notices', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/enforcement-command-center', icon: MonitorPlay, label: 'Command Center', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/vehicles', icon: Car, label: 'Vehicle Management', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/zones', icon: MapPin, label: 'Zone Management', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/users', icon: Users, label: 'User Management', roles: ['admin', 'master'] },
  { path: '/incidents', icon: Shield, label: 'Incidents & Evidence', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/reports', icon: FileText, label: 'Reports', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/audit-log', icon: Activity, label: 'Audit Log', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/privacy-curtain', icon: EyeOff, label: 'Privacy Curtain', roles: ['admin', 'master'] },
  { path: '/patrol-checkpoints', icon: ScanLine, label: 'Patrol Checkpoints', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/data', icon: Database, label: 'Data Management', roles: ['admin', 'master'] },
  { path: '/organization-profile', icon: Building2, label: 'Organization Profile', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/organizations', icon: Building2, label: 'Organizations', roles: ['master'] },
  { path: '/diagnostics', icon: Settings, label: 'System Diagnostics', roles: ['master'] },
  { path: '/profile', icon: User, label: 'My Profile', roles: ['admin', 'admin_officer', 'master', 'officer'] },
  { path: '/settings', icon: Settings, label: 'Settings', roles: ['admin', 'admin_officer', 'master', 'officer'] },
]

function NavigationLinks({ onClick }: { onClick?: () => void }) {
  const location = useLocation()
  const { user } = useAuthStore()

  const filteredItems = navigationItems.filter(item => 
    user && item.roles.includes(user.role)
  )

  return (
    <nav className="space-y-1">
      {filteredItems.map((item) => {
        const Icon = item.icon
        const isActive = location.pathname === item.path
        
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onClick}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-blue-50 text-blue-700 shadow-[inset_3px_0_0_theme(colors.blue.600)] dark:bg-blue-950/50 dark:text-blue-200 dark:shadow-[inset_3px_0_0_theme(colors.blue.400)]'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500')} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function AppLayout({ children, title, description, showBackButton }: AppLayoutProps) {
  const brandLogoUrl = 'https://kxwjcupuxnnbnzcgmkoi.supabase.co/storage/v1/object/public/Logo/IES%20Logo.jpg'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopNavOpen, setDesktopNavOpen] = useState(true)
  const [reLoginPassword, setReLoginPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const { user, logout, unlockSession } = useAuthStore()
  const {
    isLocked,
    isWarningVisible,
    warningSecondsRemaining,
    title: lockTitle,
    message: lockMessage,
    clearWarning,
    unlock,
  } = useSessionLockStore()
  const { autoLogoffEnabled } = useSessionPreferencesStore()
  const { themeMode } = useThemePreferencesStore()
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (typeof window === 'undefined') {
      setResolvedTheme('light')
      return
    }

    const applyResolvedTheme = () => {
      if (themeMode === 'light' || themeMode === 'dark') {
        setResolvedTheme(themeMode)
        return
      }

      setResolvedTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    }

    applyResolvedTheme()

    if (themeMode !== 'system') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyResolvedTheme()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }

    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [themeMode])

  const themeBadgeText =
    themeMode === 'system'
      ? `System -> ${resolvedTheme === 'dark' ? 'Dark' : 'Light'}`
      : themeMode === 'dark'
        ? 'Dark'
        : 'Light'

  const ThemeBadgeIcon =
    themeMode === 'system'
      ? Monitor
      : resolvedTheme === 'dark'
        ? Moon
        : Sun

  const handleLogout = async () => {
    await logout()
    queryClient.clear()
    navigate('/login')
  }

  const handleBack = () => {
    navigate('/')
  }

  const handleUnlockSession = async () => {
    if (!user?.email) {
      toast.error('Session cannot be restored. Please log in again.')
      return
    }
    if (!reLoginPassword.trim()) {
      toast.error('Enter your password to unlock the session.')
      return
    }

    setUnlocking(true)
    try {
      // unlockSession re-authenticates without a loading flash and clears the
      // lock state internally; no separate unlock() call is needed here.
      await unlockSession(user.email, reLoginPassword)
      setReLoginPassword('')
      toast.success('Session unlocked')
    } catch (error: any) {
      toast.error(error?.message || 'Unable to unlock session')
    } finally {
      setUnlocking(false)
    }
  }

  const handleLogoutCompletely = async () => {
    unlock()
    await handleLogout()
  }

  const handleStaySignedIn = () => {
    clearWarning()
    signalSessionActivity()
    toast.success('Session extended')
  }

  return (
    <div className="min-h-screen bg-gray-50/80 dark:bg-gray-900 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.04),_transparent_60%)]">
      {/* Mobile Header */}
      <header className="lg:hidden bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex flex-col h-full">
                  <div className="p-4 border-b dark:border-gray-700">
                    <h2 className="font-semibold text-lg">FreedomCamp</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {user?.full_name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {user?.role === 'master' ? 'System Admin' : 
                       user?.role === 'admin' ? 'Admin' :
                       user?.role === 'admin_officer' ? 'Admin Officer' : 'Officer'}
                    </p>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4">
                    <NavigationLinks onClick={() => setSidebarOpen(false)} />
                  </div>

                  <div className="p-4 border-t dark:border-gray-700">
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Logout
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {showBackButton && (
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ChevronLeft className="h-6 w-6" />
              </Button>
            )}
          </div>

          <h1 className="font-semibold text-lg truncate">{title || 'FreedomCamp'}</h1>
          
          <div className="w-10" /> {/* Spacer for alignment */}
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:block fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 z-30 transition-transform duration-200 shadow-[2px_0_12px_-2px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_12px_-2px_rgba(0,0,0,0.4)]',
          desktopNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          <div className="p-5 border-b dark:border-gray-700 bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900">
            <h2 className="font-bold text-xl text-white">FreedomCamp</h2>
            <p className="text-sm text-blue-100 mt-0.5">
              {user?.full_name}
            </p>
            <p className="text-xs text-blue-200 mt-0.5">
              {user?.role === 'master' ? 'System Administrator' : 
               user?.role === 'admin' ? 'Administrator' :
               user?.role === 'admin_officer' ? 'Admin Officer' : 'Field Officer'}
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <NavigationLinks />
          </div>

          <div className="p-4 border-t dark:border-gray-700">
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={cn('transition-[padding] duration-200', desktopNavOpen ? 'lg:pl-64' : 'lg:pl-0')}>
        {/* Desktop Header */}
        <header className="hidden lg:block bg-white dark:bg-gray-800 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)] sticky top-0 z-20 border-b border-gray-100 dark:border-gray-700/50">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDesktopNavOpen((v) => !v)}
                  title={desktopNavOpen ? 'Collapse menu' : 'Open menu'}
                  className="mt-0.5"
                >
                  <Menu className="h-5 w-5" />
                </Button>

                <div>
                {showBackButton && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleBack}
                    className="mb-2"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back to Home
                  </Button>
                )}
                {title && (
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {title}
                  </h1>
                )}
                {description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {description}
                  </p>
                )}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-6 relative">
          {children}

          {autoLogoffEnabled && isWarningVisible && !isLocked && (
            <div className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[3px] flex items-start justify-center pt-16 px-4 pb-4">
              <div className="session-mesh session-mesh--amber" aria-hidden="true" />
              <div className="session-mesh session-mesh--rose" aria-hidden="true" />
              <div className="w-full max-w-lg rounded-3xl border border-amber-200/80 bg-white/95 shadow-[0_25px_80px_rgba(15,23,42,0.45)] overflow-hidden relative">
                <div className="absolute -top-20 -right-14 h-52 w-52 rounded-full bg-orange-300/30 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl pointer-events-none" />

                <div className="relative bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-6 text-white">
                  <div className="flex items-center gap-3">
                    <img src={brandLogoUrl} alt="Iron Eagle Security logo" className="h-12 w-12 rounded-xl object-cover border border-white/30 shadow-sm transition dark:brightness-90 dark:contrast-125 dark:saturate-75" />
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Session Timeout Warning</h2>
                      <p className="text-sm opacity-95">No activity detected. Your data view will lock soon.</p>
                      <span className="inline-flex items-center gap-1.5 mt-2 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                        <ThemeBadgeIcon className="h-3.5 w-3.5" />
                        Theme: {themeBadgeText}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative p-6 space-y-4">
                  <p className="text-sm text-slate-600">
                    Locking in <span className="font-semibold text-slate-900">{warningSecondsRemaining}s</span> unless activity is detected.
                  </p>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 transition-all"
                      style={{ width: `${Math.max(2, (warningSecondsRemaining / 60) * 100)}%` }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={handleStaySignedIn}>
                      Keep Working
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={handleLogoutCompletely}>
                      Logout
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLocked && (
            <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-md flex items-start justify-center pt-16 px-4 pb-4">
              <div className="session-mesh session-mesh--cyan" aria-hidden="true" />
              <div className="session-mesh session-mesh--violet" aria-hidden="true" />
              <div className="w-full max-w-xl rounded-3xl border border-slate-200/60 bg-white/95 shadow-[0_30px_100px_rgba(15,23,42,0.55)] overflow-hidden relative">
                <div className="absolute -top-24 -left-10 h-64 w-64 rounded-full bg-cyan-200/25 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -right-12 h-72 w-72 rounded-full bg-rose-200/20 blur-3xl pointer-events-none" />

                <div className="relative bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 p-6 text-white">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-white/15 p-2">
                      <img src={brandLogoUrl} alt="Iron Eagle Security logo" className="h-10 w-10 rounded-lg object-cover border border-white/20 transition dark:brightness-90 dark:contrast-125 dark:saturate-75" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider opacity-90">Time Out Detected</p>
                      <h2 className="text-2xl font-bold leading-tight">{lockTitle}</h2>
                      <span className="inline-flex items-center gap-1.5 mt-2 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                        <ThemeBadgeIcon className="h-3.5 w-3.5" />
                        Theme: {themeBadgeText}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative p-6 space-y-4">
                  <p className="text-sm text-slate-600">{lockMessage}</p>
                  <p className="text-sm text-slate-600">
                    Log back in from this screen to continue where you left off, or sign out completely.
                  </p>

                  <div className="space-y-2">
                    <label htmlFor="unlock-password" className="text-sm font-medium text-slate-700">
                      Password for {user?.email}
                    </label>
                    <Input
                      id="unlock-password"
                      type="password"
                      value={reLoginPassword}
                      onChange={(e) => setReLoginPassword(e.target.value)}
                      placeholder="Enter password to unlock"
                      disabled={unlocking}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleUnlockSession()
                        }
                      }}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <Button className="flex-1" onClick={handleUnlockSession} disabled={unlocking}>
                      <Unlock className="h-4 w-4 mr-2" />
                      {unlocking ? 'Unlocking...' : 'Log Back In'}
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={handleLogoutCompletely} disabled={unlocking}>
                      <LogOut className="h-4 w-4 mr-2" />
                      Logout Completely
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
