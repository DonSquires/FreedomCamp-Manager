import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  Home, Car, MapPin, Users, BarChart3, FileText,
  LogOut, Settings, ChevronLeft, AlertTriangle, ChevronDown,
  Activity, Database, Search, Heart, ScrollText, Lock, Gavel,
  Navigation, BookOpen, LayoutGrid, Map, Bell, Upload, Shield, Camera, Link2,
  CalendarDays, TrendingUp, Wrench, ParkingSquare, Volume2, Radio, Sparkles,
  ClipboardCheck, Ban,
  ScanFace,
} from 'lucide-react'

export const primaryLinks = [
  { to: '/admin',       label: 'Dashboard', icon: Home },
  { to: '/compliance',  label: 'Compliance', icon: BarChart3 },
  { to: '/vehicles',    label: 'Vehicles',   icon: Car },
  { to: '/breaches',    label: 'Breaches',   icon: AlertTriangle },
  { to: '/search',      label: 'Search',     icon: Search },
]

export const moreGroups = [
  {
    label: 'Compliance',
    links: [
      { to: '/compliance-dashboard',    label: 'Compliance Dashboard',   icon: BarChart3 },
      { to: '/compliance-analytics',    label: 'Analytics',              icon: BarChart3 },
      { to: '/compliance-recalculation',label: 'Recalculation',          icon: Shield },
      { to: '/spatial-compliance',      label: 'Spatial Compliance',     icon: Map },
    ],
  },
  {
    label: 'Enforcement',
    links: [
      { to: '/enforcement-command-center', label: 'Command Centre',   icon: Gavel },
      { to: '/enforcement-review',         label: 'Review',           icon: ScrollText },
      { to: '/disputes',                   label: 'Disputes',         icon: AlertTriangle },
      { to: '/notice-to-vacate',           label: 'Notice to Vacate', icon: FileText },
      { to: '/infringements',              label: 'Infringements',    icon: Gavel },
      { to: '/breach-notices',             label: 'Breach Notices',   icon: Bell },
    ],
  },
  {
    label: 'Vehicles & Zones',
    links: [
      { to: '/vehicle-registry',           label: 'Vehicle Registry',   icon: BookOpen },
      { to: '/admin/canonical-records',    label: 'Canonical Records',  icon: Database },
      { to: '/zones',                       label: 'Zones',              icon: MapPin },
      { to: '/hotspots',                    label: 'Hotspots Map',       icon: Map },
    ],
  },
  {
    label: 'Officers & Patrols',
    links: [
      { to: '/live-patrol',        label: 'Live Patrol',          icon: Activity },
      { to: '/live-tracking',      label: 'Officer Tracking',     icon: Navigation },
      { to: '/officer-welfare',    label: 'Officer Welfare',      icon: Heart },
      { to: '/patrol-schedule',    label: 'Patrol Schedule',      icon: CalendarDays },
      { to: '/patrol-kpis',        label: 'Patrol KPIs',          icon: TrendingUp },
      { to: '/patrol-checkpoints', label: 'Checkpoints',          icon: MapPin },
    ],
  },
  {
    label: 'People & Incidents',
    links: [
      { to: '/person-records',      label: 'Person Records',      icon: Users },
      { to: '/face-recognition',    label: 'Face Recognition',    icon: ScanFace },
      { to: '/points-of-interest',  label: 'Points of Interest',  icon: Ban },
      { to: '/incidents',           label: 'Incidents & Maintenance', icon: Activity },
      { to: '/incident-reports',    label: 'Incident Reports',    icon: FileText },
      { to: '/investigations',      label: 'Investigations',      icon: Search },
      { to: '/site-risk-assessment',label: 'Site Risk Assessment', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Specialist Services',
    links: [
      { to: '/parking',         label: 'Parking Enforcement', icon: ParkingSquare },
      { to: '/parking-officer', label: 'Parking Officer',     icon: Car },
      { to: '/noise-control',   label: 'Noise Control',       icon: Volume2 },
      { to: '/noise-officer',   label: 'Noise Officer',       icon: Radio },
    ],
  },
  {
    label: 'Reports',
    links: [
      { to: '/reports-hub',         label: 'Reports Hub',   icon: BarChart3 },
      { to: '/observations-report', label: 'Observations',  icon: LayoutGrid },
      { to: '/observations',        label: 'Observation Map',icon: Map },
      { to: '/ai-analysis',         label: 'Bob',           icon: Sparkles },
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
      { to: '/photo-reingest',  label: 'Photo Reingest', icon: Camera },
      { to: '/evidence-photo-linker', label: 'Evidence Linker', icon: Link2 },
      { to: '/settings',        label: 'Settings',     icon: Settings },
    ],
  },
]

// Dropdown panel: responsive grid, scrollable on narrow screens
const MORE_DROPDOWN_CLS =
  'absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 ' +
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

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          {/* Brand */}
          <Link to="/admin" className="flex items-center gap-2 mr-3 shrink-0">
            <img
              src="/iron-eagle-security-logo.jpg"
              alt="IES"
              className="h-7 w-7 rounded object-cover"
            />
            <span className="font-semibold text-gray-900 dark:text-white hidden sm:block text-sm">
              FieldOps
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
            {primaryLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors whitespace-nowrap shrink-0 ${
                  isActive(to)
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
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
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <span className="hidden md:block">More</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>

              {moreOpen && (
                <div className={MORE_DROPDOWN_CLS}>
                  {moreGroups.map((group) => (
                    <div key={group.label} className="min-w-0">
                      <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-2 py-1 mt-1">
                        {group.label}
                      </div>
                      {group.links.map(({ to, label, icon: Icon }) => (
                        <Link
                          key={to}
                          to={to}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                            isActive(to)
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
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
              <span className="text-xs text-gray-500 dark:text-gray-400 hidden lg:block max-w-[160px] truncate">
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

