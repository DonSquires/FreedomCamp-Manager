import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useSessionLockStore } from '@/stores/sessionLockStore'
import { useFeedbackCapture } from '@/hooks/useFeedbackCapture'
import { useAutoErrorReporter } from '@/hooks/useAutoErrorReporter'
import { FeedbackModal } from '@/components/features/FeedbackModal'
import { useNotificationCount } from '@/hooks/useNotifications'
import { useSessionPreferencesStore } from '@/stores/sessionPreferencesStore'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'
import { PublicSafetyBanner } from '@/components/features/PublicSafetyBanner'
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
  ChevronDown,
  Search,
  Activity,
  Gavel,
  MonitorPlay,
  EyeOff,
  Image as ImageIcon,
  ScanLine,
  Receipt,
  User,
  Lock,
  Unlock,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Upload,
  CalendarDays,
  TrendingUp,
  Camera,
  Wrench,
  MessageSquarePlus,
  MessageSquare,
  Volume2,
  ParkingSquare,
  ClipboardCheck,
  FlameKindling,
  PieChart,
  ClipboardList,
  PersonStanding,
  BrainCircuit,
  Map,
  HeartPulse,
  FileBarChart,
  ScrollText,
  Layers,
  Bell,
  Radio,
  CalendarRange,
  GraduationCap,
  CalendarCheck2,
  DollarSign,
  ClipboardCopy,
  Code2,
  Globe,
  LayoutDashboard,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Wand2,
  ListChecks,
  LayoutList,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { signalSessionActivity } from '@/hooks/useSessionInactivityLock'

interface AppLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
  showBackButton?: boolean
}

type NavItem = { path: string; icon: React.FC<{ className?: string }>; label: string; roles: string[] }

// Pinned items always visible at the top of the sidebar
const pinnedItems: NavItem[] = [
  { path: '/platform', icon: Globe, label: 'Platform Overview', roles: ['grand_master'] },
  { path: '/admin', icon: LayoutDashboard, label: 'Command Centre', roles: ['grand_master'] },
  { path: '/compliance-escalations', icon: ShieldAlert, label: 'Escalations', roles: ['grand_master'] },
  { path: '/grandmaster-code-studio', icon: Code2, label: 'Coding Studio', roles: ['grand_master'] },
  { path: '/', icon: Home, label: 'Admin Hub', roles: ['admin', 'admin_officer', 'master'] },
  { path: '/', icon: Home, label: 'Home', roles: ['officer', 'nzscv_monitor'] },
  { path: '/bob-assistant', icon: BrainCircuit, label: 'Bob Assistant', roles: ['officer'] },
  { path: '/search', icon: Search, label: 'Search', roles: ['admin', 'admin_officer', 'master', 'officer', 'nzscv_monitor', 'grand_master'] },
]

// Grouped navigation — collapsed by default, each bucket holds related items
const navigationGroups: Array<{ label: string; icon: React.FC<{ className?: string }>; items: NavItem[] }> = [
  {
    label: 'Operations',
    icon: BarChart3,
    items: [
      { path: '/compliance-unified', icon: ShieldCheck, label: 'Compliance Hub', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/observation-records', icon: ImageIcon, label: 'Observations', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/observations-report', icon: FileBarChart, label: 'Observations Report', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/breaches', icon: AlertTriangle, label: 'Breaches & Alerts', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/breach-notices', icon: ScrollText, label: 'Breach Notices', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/enforcement-actions', icon: Gavel, label: 'Enforcement Actions', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/enforcement-review', icon: ClipboardCheck, label: 'Enforcement Review', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/enforcement-command-center', icon: MonitorPlay, label: 'Enforcement Console', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/disputes', icon: AlertTriangle, label: 'Disputes', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/discrepancies', icon: AlertTriangle, label: 'Discrepancies', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/infringements', icon: Receipt, label: 'Infringements', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/compliance-analytics', icon: PieChart, label: 'Compliance Analytics', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-checkpoints', icon: ScanLine, label: 'Checkpoints', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-schedule', icon: CalendarDays, label: 'Patrol Schedule', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/patrol-kpis', icon: TrendingUp, label: 'Patrol KPIs', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Live Ops',
    icon: MonitorPlay,
    items: [
      { path: '/live-tracking', icon: Activity, label: 'Live Tracking', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/live-patrol', icon: MonitorPlay, label: 'Live Patrol Monitor', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/operations-map', icon: Layers, label: 'Operations Map', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/hotspots', icon: FlameKindling, label: 'Hotspots Map', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch', icon: Radio, label: 'Dispatch Console', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-monitor', icon: LayoutList, label: 'Dispatch Monitor', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatch-wizard', icon: Wand2, label: 'Dispatch Wizard', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/dispatched-jobs', icon: ListChecks, label: 'Dispatched Jobs', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/team-chat', icon: MessageSquare, label: 'Team Chat', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/radio', icon: Radio, label: 'Radio', roles: ['admin', 'admin_officer', 'master', 'officer'] },
    ],
  },
  {
    label: 'Management',
    icon: Car,
    items: [
      { path: '/vehicles', icon: Car, label: 'Vehicles', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/vehicle-registry', icon: Car, label: 'Vehicle Registry', roles: ['admin', 'admin_officer', 'master', 'nzscv_monitor'] },
      { path: '/admin/nzscv', icon: Car, label: 'NZSCV Monitor', roles: ['admin', 'master', 'nzscv_monitor'] },
      { path: '/admin/canonical-records', icon: Database, label: 'Canonical Records', roles: ['admin', 'master'] },
      { path: '/zones', icon: MapPin, label: 'Zones', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/client-master-list', icon: ListChecks, label: 'Client Master List', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/client-sites', icon: Building2, label: 'Client Sites', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/crm', icon: Building2, label: 'CRM / Accounts', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/tender-workspace', icon: Gavel, label: 'Tenders & Contracts', roles: ['admin', 'master', 'grand_master'] },
      { path: '/pricing', icon: DollarSign, label: 'Service Pricing', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/invoicing', icon: Receipt, label: 'Invoicing', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/dashboard', icon: MonitorPlay, label: 'Ops Dashboard', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/users', icon: Users, label: 'Users', roles: ['admin', 'master'] },
      { path: '/organization-profile', icon: Building2, label: 'Organisation', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/organizations', icon: Building2, label: 'Organisations', roles: ['master'] },
    ],
  },
  {
    label: 'Records',
    icon: FileText,
    items: [
      { path: '/incidents', icon: Shield, label: 'Incidents & Evidence', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/incident-reports', icon: ClipboardList, label: 'Incident Reports', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/investigations', icon: BrainCircuit, label: 'Investigations', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/person-records', icon: PersonStanding, label: 'Person Records', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/reports', icon: FileText, label: 'Reports', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/reports-hub', icon: FileBarChart, label: 'Reports Hub', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/audit-log', icon: Activity, label: 'Audit Log', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/privacy-curtain', icon: EyeOff, label: 'Privacy Curtain', roles: ['admin', 'master'] },
    ],
  },
  {
    label: 'Specialist Portals',
    icon: Layers,
    items: [
      { path: '/noise-control', icon: Volume2, label: 'Noise Control', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/parking', icon: ParkingSquare, label: 'Parking Enforcement', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/officer-welfare', icon: HeartPulse, label: 'Officer Welfare', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/identity-verification', icon: ShieldCheck, label: 'ID Verification', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Roster & Workforce',
    icon: CalendarRange,
    items: [
      { path: '/roster', icon: CalendarRange, label: 'Roster Planner', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/open-shifts', icon: CalendarCheck2, label: 'Open Shifts', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/availability', icon: CalendarDays, label: 'My Availability', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/officer-skills', icon: GraduationCap, label: 'Skills & Licences', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/timesheets', icon: ClipboardCopy, label: 'Timesheets', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Bob',
    icon: BrainCircuit,
    items: [
      { path: '/bob-assistant', icon: BrainCircuit, label: 'Bob Assistant', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/bob-intake-queue', icon: ClipboardList, label: 'Bob Intake Queue', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/ai-analysis', icon: BrainCircuit, label: 'Bob Analysis', roles: ['admin', 'master'] },
      { path: '/live-plan-reviews', icon: ShieldCheck, label: 'Live Plan Reviews', roles: ['admin', 'admin_officer', 'master'] },
    ],
  },
  {
    label: 'Tools',
    icon: Wrench,
    items: [
      { path: '/spatial-compliance', icon: Map, label: 'Spatial Compliance', roles: ['admin', 'master'] },
      { path: '/compliance-recalculation', icon: Shield, label: 'Recalculation', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/admin/cleanup-recalculate', icon: RefreshCw, label: 'Cleanup & Recalculate', roles: ['admin', 'master'] },
      { path: '/data', icon: Database, label: 'Data Management', roles: ['admin', 'master'] },
      { path: '/admin/data-hub', icon: Database, label: 'Data Hub', roles: ['admin', 'master'] },
      { path: '/intel-approvals', icon: ShieldAlert, label: 'Intel Approvals', roles: ['master'] },
      { path: '/import-historical', icon: Upload, label: 'Import Data', roles: ['admin', 'master'] },
      { path: '/photo-reingest', icon: Camera, label: 'Photo Reingest', roles: ['admin', 'admin_officer', 'master'] },
      { path: '/diagnostics', icon: Settings, label: 'Diagnostics', roles: ['master'] },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    items: [
      { path: '/profile', icon: User, label: 'My Profile', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/notifications', icon: Bell, label: 'Notifications', roles: ['admin', 'admin_officer', 'master', 'officer'] },
      { path: '/settings', icon: Settings, label: 'Settings', roles: ['admin', 'admin_officer', 'master', 'officer', 'nzscv_monitor'] },
    ],
  },
]

function NavigationLinks({ onClick }: { onClick?: () => void }) {
  const location = useLocation()
  const { user } = useAuthStore()
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  // grand_master sees the same grouped nav items as master
  const effectiveNavRole = user?.role === 'grand_master' ? 'master' : user?.role

  // Auto-expand the group containing the active path on navigation
  useEffect(() => {
    for (const group of navigationGroups) {
      if (group.items.some(item => location.pathname === item.path && item.roles.includes(effectiveNavRole ?? ''))) {
        setOpenGroups(prev => {
          if (prev.has(group.label)) return prev
          const next = new Set(prev)
          next.add(group.label)
          return next
        })
      }
    }
  }, [location.pathname, effectiveNavRole])

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const visiblePinned = pinnedItems.filter(item => user && item.roles.includes(user.role))

  return (
    <nav className="space-y-1">
      {/* Pinned items */}
      {visiblePinned.map((item) => {
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
                ? 'bg-primary/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary))] dark:bg-primary/15'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500')} />
            <span>{item.label}</span>
          </Link>
        )
      })}

      <div className="my-2 border-t border-gray-200 dark:border-gray-700" />

      {/* Grouped navigation with accordion */}
      {navigationGroups.map((group) => {
        const GroupIcon = group.icon
        const visibleItems = group.items.filter(item => item.roles.includes(effectiveNavRole ?? ''))
        if (visibleItems.length === 0) return null

        const isOpen = openGroups.has(group.label)
        const hasActiveChild = visibleItems.some(item => location.pathname === item.path)

        return (
          <div key={group.label}>
            <button
              onClick={() => toggleGroup(group.label)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-all duration-150',
                hasActiveChild
                  ? 'text-primary bg-primary/5 dark:bg-primary/10'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-gray-200'
              )}
            >
              <span className="flex items-center gap-3">
                <GroupIcon className={cn('h-4 w-4 shrink-0', hasActiveChild ? 'text-primary' : 'text-gray-400 dark:text-gray-500')} />
                <span>{group.label}</span>
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', isOpen && 'rotate-180')} />
            </button>

            {isOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-200 dark:border-gray-700 pl-3">
                {visibleItems.map((item) => {
                  const Icon = item.icon
                  const isActive = location.pathname === item.path
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClick}
                      className={cn(
                        'flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-all duration-150',
                        isActive
                          ? 'bg-primary/10 text-primary font-medium dark:bg-primary/15'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100'
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500')} />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function AppLayout({ children, title, description, showBackButton }: AppLayoutProps) {
  const brandLogoUrl = '/iron-eagle-security-logo.jpg'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [desktopNavOpen, setDesktopNavOpen] = useState(() => {
    // Default to open (true). Only closes if the user has explicitly set it to 'false'.
    try { return localStorage.getItem('fc_sidebar_open') !== 'false' } catch { return true }
  })
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
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark' | 'high-contrast' | 'night-patrol'>('light')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  // Passive context capture for feedback reports
  useFeedbackCapture()
  // Automatic crash detection — submits bug reports without user action
  useAutoErrorReporter()
  const { data: notifCount = 0 } = useNotificationCount()

  const teamChatSeenKey = user?.id ? `fc_team_chat_seen_at_${user.id}` : null

  const scopedOrgIds = useMemo(() => {
    if (!user) return [] as string[]
    const ids = [user.organization_id, ...(user.extra_organization_ids || []), ...(user.authorized_work_locations || [])]
    return Array.from(new Set(ids.filter(Boolean) as string[]))
  }, [user])

  const { data: chatSignalCount = 0 } = useQuery({
    queryKey: ['layout-chat-signal-count', user?.id, user?.role, scopedOrgIds, location.pathname],
    enabled: !!user,
    staleTime: 20_000,
    refetchInterval: 45_000,
    queryFn: async () => {
      if (!user) return 0

      const seenAt = (() => {
        if (typeof window === 'undefined' || !teamChatSeenKey) return null
        const value = window.localStorage.getItem(teamChatSeenKey)
        return value && !Number.isNaN(Date.parse(value)) ? value : null
      })()

      const isNewSinceSeen = (createdAt?: string | null) => {
        if (!createdAt) return false
        if (!seenAt) return true
        return new Date(createdAt).getTime() > new Date(seenAt).getTime()
      }

      const now = new Date().toISOString()
      const [alertsRes, acksRes] = await Promise.all([
        ((supabase as any).from('public_safety_alerts') as any)
          .select('id, scope, target_organization_ids, created_at')
          .eq('status', 'active')
          .lte('starts_at', now)
          .or(`expires_at.is.null,expires_at.gte.${now}`),
        ((supabase as any).from('public_safety_alert_acknowledgements') as any)
          .select('alert_id')
          .eq('user_id', user.id),
      ])

      if (alertsRes.error) throw alertsRes.error
      if (acksRes.error) throw acksRes.error

      const acked = new Set(((acksRes.data || []) as any[]).map((row) => row.alert_id))
      const unackedAlerts = ((alertsRes.data || []) as any[]).filter((row) => {
        if (acked.has(row.id)) return false
        if (!isNewSinceSeen(row.created_at)) return false
        if (row.scope === 'national') return true
        const targets = Array.isArray(row.target_organization_ids) ? row.target_organization_ids : []
        return targets.some((id: string) => scopedOrgIds.includes(id))
      }).length

      const isApprover = user.role === 'master' || user.role === 'grand_master'
      if (!isApprover) {
        return unackedAlerts
      }

      const [pendingBulletinsRes, pendingAlertsRes] = await Promise.all([
        ((supabase as any).from('external_intel_bulletins') as any)
          .select('id, created_at')
          .eq('approval_status', 'pending')
          .order('created_at', { ascending: false })
          .limit(200),
        ((supabase as any).from('public_safety_alerts') as any)
          .select('id, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(200),
      ])

      if (pendingBulletinsRes.error) throw pendingBulletinsRes.error
      if (pendingAlertsRes.error) throw pendingAlertsRes.error

      const pendingBulletinsNew = ((pendingBulletinsRes.data || []) as any[]).filter((row) => isNewSinceSeen(row.created_at)).length
      const pendingAlertsNew = ((pendingAlertsRes.data || []) as any[]).filter((row) => isNewSinceSeen(row.created_at)).length

      return unackedAlerts + pendingBulletinsNew + pendingAlertsNew
    },
  })

  useEffect(() => {
    if (!user || !teamChatSeenKey || location.pathname !== '/team-chat') return
    if (typeof window === 'undefined') return

    window.localStorage.setItem(teamChatSeenKey, new Date().toISOString())
    queryClient.invalidateQueries({ queryKey: ['layout-chat-signal-count'] })
  }, [location.pathname, queryClient, teamChatSeenKey, user])

  useEffect(() => {
    if (typeof window === 'undefined') {
      setResolvedTheme('light')
      return
    }

    const applyResolvedTheme = () => {
      if (themeMode === 'light' || themeMode === 'dark' || themeMode === 'high-contrast' || themeMode === 'night-patrol') {
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
      : themeMode === 'high-contrast'
        ? 'High Contrast'
        : themeMode === 'night-patrol'
          ? '🌙 Night Patrol'
          : themeMode === 'dark'
            ? 'Dark'
            : 'Light'

  const ThemeBadgeIcon =
    themeMode === 'system'
      ? Monitor
      : resolvedTheme === 'dark' || resolvedTheme === 'night-patrol'
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

  // Persist sidebar open/closed preference
  const toggleDesktopNav = () => {
    setDesktopNavOpen((v) => {
      const next = !v
      try { localStorage.setItem('fc_sidebar_open', String(next)) } catch { /* ignore */ }
      return next
    })
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
    await handleLogout()
    unlock()
  }

  const handleStaySignedIn = () => {
    clearWarning()
    signalSessionActivity()
    toast.success('Session extended')
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
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
                    <h2 className="font-semibold text-lg">FieldOps</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {user?.full_name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {user?.role === 'grand_master' ? 'Platform Administrator' :
                       user?.role === 'master' ? 'System Admin' : 
                       user?.role === 'admin' ? 'Admin' :
                        user?.role === 'admin_officer' ? 'Admin Officer' :
                        user?.role === 'nzscv_monitor' ? 'NZSCV Monitor' : 'Officer'}
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

          <h1 className="font-semibold text-lg truncate">{title || 'FieldOps'}</h1>
          
          {/* Mobile: notification bell */}
          <button
            type="button"
            title="Alerts"
            aria-label="Alerts"
            onClick={() => navigate('/notifications')}
            className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            {notifCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {notifCount > 9 ? '9+' : notifCount}
              </span>
            )}
          </button>
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
          <div className="p-5 border-b dark:border-gray-700 bg-gradient-to-br from-cyan-700 to-cyan-800 dark:from-cyan-900 dark:to-cyan-950">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <h2 className="font-bold text-xl text-white">FieldOps</h2>
                <p className="text-sm text-cyan-100 mt-0.5 truncate">
                  {user?.full_name}
                </p>
                <p className="text-xs text-cyan-200 mt-0.5">
                  {user?.role === 'grand_master' ? 'Platform Administrator' :
                   user?.role === 'master' ? 'System Administrator' : 
                   user?.role === 'admin' ? 'Administrator' :
                  user?.role === 'admin_officer' ? 'Admin Officer' :
                  user?.role === 'nzscv_monitor' ? 'NZSCV Monitor' : 'Field Officer'}
                </p>
              </div>
              <button
                onClick={toggleDesktopNav}
                title="Collapse sidebar"
                className="mt-0.5 shrink-0 rounded p-1 text-cyan-200 hover:bg-cyan-600/50 hover:text-white transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
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
                  onClick={toggleDesktopNav}
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
              {/* Header right side: notification bell */}
              <button
                type="button"
                title="Notifications"
                aria-label="Notifications"
                data-testid="notification-bell"
                onClick={() => navigate('/notifications')}
                className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                {notifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-6 relative">
          <PublicSafetyBanner />
          {children}

          {/* Global feedback button — visible to all authenticated users */}
          {user && !isLocked && (
            <>
              <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
                <button
                  onClick={() => navigate('/team-chat')}
                  title="Open Team Chat"
                  className="relative flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-3 py-2 text-xs font-medium hover:opacity-95 transition-all hover:shadow-xl"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="hidden sm:inline">Team Chat</span>
                  {location.pathname !== '/team-chat' && chatSignalCount > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                      {chatSignalCount > 99 ? '99+' : chatSignalCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setFeedbackOpen(true)}
                  title="Send feedback or report an issue"
                  className="flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all hover:shadow-xl group"
                >
                  <MessageSquarePlus className="h-4 w-4 text-violet-500 group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline">Feedback</span>
                </button>
              </div>
              <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
            </>
          )}

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
