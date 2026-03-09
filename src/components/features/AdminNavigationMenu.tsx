import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  Shield, Home, Car, MapPin, Users, BarChart3, FileText,
  LogOut, Settings, ChevronLeft, AlertTriangle, ChevronDown,
  Activity, Database, Search, Heart, ScrollText, Lock, Gavel,
  Navigation, BookOpen, LayoutGrid, Map, Bell, Upload,
} from 'lucide-react'

const primaryLinks = [
  { to: '/admin',       label: 'Dashboard', icon: Home },
  { to: '/compliance',  label: 'Compliance', icon: Shield },
  { to: '/vehicles',    label: 'Vehicles',   icon: Car },
  { to: '/breaches',    label: 'Breaches',   icon: AlertTriangle },
  { to: '/search',      label: 'Search',     icon: Search },
]

const moreGroups = [
  {
    label: 'Compliance',
    links: [
      { to: '/compliance-analytics',    label: 'Analytics',              icon: BarChart3 },
      { to: '/compliance-recalculation',label: 'Recalculation',          icon: Shield },
      { to: '/spatial-compliance',      label: 'Spatial Compliance',     icon: Map },
    ],
  },
  {
    label: 'Enforcement',
    links: [
      { to: '/enforcement-command-center', label: 'Command Center',   icon: Gavel },
      { to: '/enforcement-review',         label: 'Review',           icon: ScrollText },
      { to: '/notice-to-vacate',           label: 'Notice to Vacate', icon: FileText },
      { to: '/infringements',              label: 'Infringements',    icon: Gavel },
      { to: '/breach-notices',             label: 'Breach Notices',   icon: Bell },
    ],
  },
  {
    label: 'Vehicles & Zones',
    links: [
      { to: '/vehicle-registry', label: 'Vehicle Registry', icon: BookOpen },
      { to: '/zones',            label: 'Zones',            icon: MapPin },
      { to: '/hotspots',         label: 'Hotspots Map',     icon: Map },
    ],
  },
  {
    label: 'Officers & Patrols',
    links: [
      { to: '/live-patrol',      label: 'Live Patrol',        icon: Activity },
      { to: '/live-tracking',    label: 'Officer Tracking',   icon: Navigation },
      { to: '/officer-welfare',  label: 'Officer Welfare',    icon: Heart },
      { to: '/patrol-checkpoints', label: 'Checkpoints',      icon: MapPin },
    ],
  },
  {
    label: 'People & Incidents',
    links: [
      { to: '/person-records',   label: 'Person Records',  icon: Users },
      { to: '/incidents',        label: 'Incidents',       icon: Activity },
      { to: '/incident-reports', label: 'Incident Reports',icon: FileText },
      { to: '/investigations',   label: 'Investigations',  icon: Search },
    ],
  },
  {
    label: 'Reports',
    links: [
      { to: '/reports-hub',         label: 'Reports Hub',   icon: BarChart3 },
      { to: '/observations-report', label: 'Observations',  icon: LayoutGrid },
      { to: '/observations',        label: 'Observation Map',icon: Map },
    ],
  },
  {
    label: 'Admin',
    links: [
      { to: '/users',       label: 'Users',        icon: Users },
      { to: '/audit-log',   label: 'Audit Log',    icon: ScrollText },
      { to: '/privacy-curtain', label: 'Privacy',  icon: Lock },
      { to: '/import-data',     label: 'Import Data',  icon: Upload },
      { to: '/import-historical', label: 'Import Excel', icon: Upload },
      { to: '/data',            label: 'Data Tools',   icon: Database },
      { to: '/settings',        label: 'Settings',     icon: Settings },
    ],
  },
]

const routeRoles: Record<string, Array<'master' | 'admin' | 'officer' | 'admin_officer'>> = {
  '/admin': ['admin', 'admin_officer', 'master'],
  '/compliance': ['admin', 'admin_officer', 'master', 'officer'],
  '/vehicles': ['admin', 'admin_officer', 'master', 'officer'],
  '/breaches': ['admin', 'admin_officer', 'master', 'officer'],
  '/search': ['admin', 'admin_officer', 'master', 'officer'],
  '/compliance-analytics': ['admin', 'admin_officer', 'master'],
  '/compliance-recalculation': ['admin', 'admin_officer', 'master'],
  '/spatial-compliance': ['admin', 'master'],
  '/enforcement-command-center': ['admin', 'admin_officer', 'master'],
  '/enforcement-review': ['admin', 'admin_officer', 'master'],
  '/notice-to-vacate': ['admin', 'admin_officer', 'master'],
  '/infringements': ['admin', 'admin_officer', 'master', 'officer'],
  '/breach-notices': ['admin', 'admin_officer', 'master', 'officer'],
  '/vehicle-registry': ['admin', 'admin_officer', 'master'],
  '/zones': ['admin', 'admin_officer', 'master'],
  '/hotspots': ['admin', 'admin_officer', 'master', 'officer'],
  '/live-patrol': ['admin', 'admin_officer', 'master'],
  '/live-tracking': ['admin', 'master'],
  '/officer-welfare': ['admin', 'admin_officer', 'master'],
  '/patrol-checkpoints': ['admin', 'admin_officer', 'master'],
  '/person-records': ['admin', 'admin_officer', 'master'],
  '/incidents': ['admin', 'admin_officer', 'master', 'officer'],
  '/incident-reports': ['admin', 'admin_officer', 'master', 'officer'],
  '/investigations': ['admin', 'admin_officer', 'master'],
  '/reports-hub': ['admin', 'admin_officer', 'master'],
  '/observations-report': ['admin', 'admin_officer', 'master', 'officer'],
  '/observations': ['admin', 'admin_officer', 'master', 'officer'],
  '/users': ['admin', 'master'],
  '/audit-log': ['admin', 'admin_officer', 'master'],
  '/privacy-curtain': ['admin', 'master'],
  '/import-data': ['admin', 'admin_officer', 'master'],
  '/import-historical': ['admin', 'admin_officer', 'master'],
  '/data': ['admin', 'master'],
  '/settings': ['admin', 'admin_officer', 'master', 'officer'],
}

// Dropdown panel: responsive grid, scrollable on narrow screens
const MORE_DROPDOWN_CLS =
  'absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 ' +
  'min-w-[720px] max-w-[96vw] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1'

export function AdminNavigationMenu() {
  const { user, logout } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  // Close "More" dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on route change
  useEffect(() => { setMoreOpen(false) }, [location.pathname])

  const handleLogout = async () => {
    await logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  const isActive = (to: string) => location.pathname === to
  const canAccessPath = (to: string) => {
    if (!user) return false
    const allowedRoles = routeRoles[to]
    if (!allowedRoles) return true
    return allowedRoles.includes(user.role)
  }
  const filteredPrimaryLinks = primaryLinks.filter(({ to }) => canAccessPath(to))
  const filteredMoreGroups = moreGroups
    .map((group) => ({
      ...group,
      links: group.links.filter(({ to }) => canAccessPath(to)),
    }))
    .filter((group) => group.links.length > 0)

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          {/* Brand */}
          <Link to="/admin" className="flex items-center gap-2 mr-3 shrink-0">
            <Shield className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-gray-900 hidden sm:block text-sm">
              FreedomCamp
            </span>
          </Link>

          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            className="mr-1 shrink-0"
            onClick={() => navigate(-1)}
            title="Go back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Primary nav links */}
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
            {filteredPrimaryLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors whitespace-nowrap shrink-0 ${
                  isActive(to)
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden md:block">{label}</span>
              </Link>
            ))}

            {/* More dropdown */}
            <div className="relative shrink-0" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-sm transition-colors whitespace-nowrap ${
                  moreOpen
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="hidden md:block">More</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>

              {moreOpen && (
                <div className={MORE_DROPDOWN_CLS}>
                  {filteredMoreGroups.map((group) => (
                    <div key={group.label} className="min-w-0">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 py-1 mt-1">
                        {group.label}
                      </div>
                      {group.links.map(({ to, label, icon: Icon }) => (
                        <Link
                          key={to}
                          to={to}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                            isActive(to)
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{label}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* User + logout */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            {user && (
              <span className="text-xs text-gray-500 hidden lg:block max-w-[160px] truncate">
                {user.email}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} title="Log out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}

