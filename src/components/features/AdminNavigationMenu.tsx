import { useState, useRef, useEffect, useMemo } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { getMissingManifestPaths, projectLegacyNavItems, routeManifest, type AppRole } from '@/navigation'
import {
  Home, Car, MapPin, Users, BarChart3, FileText,
  LogOut, Settings, ChevronLeft, AlertTriangle, ChevronDown,
  Activity, Database, Search, Heart, ScrollText, Lock, Gavel,
  Navigation, BookOpen, LayoutGrid, Map as MapIcon, Bell, Upload, Shield, Camera, Link2,
  CalendarDays, TrendingUp, Wrench, ParkingSquare, Volume2, Radio, Sparkles,
  ClipboardCheck, Ban,
  ScanFace,
  type LucideIcon,
} from 'lucide-react'

type AdminNavLink = {
  to: string
  label: string
  icon: LucideIcon
}

type AdminNavGroup = {
  label: string
  links: AdminNavLink[]
}

const primaryLinks = [
  { to: '/admin',       label: 'Dashboard', icon: Home },
  { to: '/compliance',  label: 'Compliance', icon: BarChart3 },
  { to: '/vehicles',    label: 'Vehicles',   icon: Car },
  { to: '/breaches',    label: 'Breaches',   icon: AlertTriangle },
  { to: '/search',      label: 'Search',     icon: Search },
]

const enforcementLegacyLinks: AdminNavLink[] = [
  { to: '/enforcement-command-center', label: 'Command Centre', icon: Gavel },
  { to: '/enforcement-review', label: 'Review', icon: ScrollText },
  { to: '/disputes', label: 'Disputes', icon: AlertTriangle },
  { to: '/notice-to-vacate', label: 'Notice to Vacate', icon: FileText },
  { to: '/infringements', label: 'Infringements', icon: Gavel },
  { to: '/breach-notices', label: 'Breach Notices', icon: Bell },
]

const vehiclesZonesLegacyLinks: AdminNavLink[] = [
  { to: '/vehicle-registry', label: 'Vehicle Registry', icon: BookOpen },
  { to: '/admin/canonical-records', label: 'Canonical Records', icon: Database },
  { to: '/zones', label: 'Zones', icon: MapPin },
  { to: '/hotspots', label: 'Hotspots Map', icon: MapIcon },
]

const reportsLegacyLinks: AdminNavLink[] = [
  { to: '/reports-hub', label: 'Reports Hub', icon: BarChart3 },
  { to: '/observations-report', label: 'Observations', icon: LayoutGrid },
  { to: '/observations', label: 'Observation Map', icon: MapIcon },
  { to: '/ai-analysis', label: 'Bob', icon: Sparkles },
]

const specialistServicesLegacyLinks: AdminNavLink[] = [
  { to: '/parking', label: 'Parking Enforcement', icon: ParkingSquare },
  { to: '/parking-officer', label: 'Parking Officer', icon: Car },
  { to: '/noise-control', label: 'Noise Control', icon: Volume2 },
  { to: '/noise-officer', label: 'Noise Officer', icon: Radio },
]

const officersPatrolsLegacyLinks: AdminNavLink[] = [
  { to: '/live-patrol', label: 'Live Patrol', icon: Activity },
  { to: '/live-tracking', label: 'Officer Tracking', icon: Navigation },
  { to: '/officer-welfare', label: 'Officer Welfare', icon: Heart },
  { to: '/patrol-schedule', label: 'Patrol Schedule', icon: CalendarDays },
  { to: '/patrol-kpis', label: 'Patrol KPIs', icon: TrendingUp },
  { to: '/patrol-checkpoints', label: 'Checkpoints', icon: MapPin },
]

const adminLegacyLinks: AdminNavLink[] = [
  { to: '/users', label: 'Users', icon: Users },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText },
  { to: '/privacy-curtain', label: 'Privacy', icon: Lock },
  { to: '/import-data', label: 'Import Data', icon: Upload },
  { to: '/import-historical', label: 'Import Excel', icon: Upload },
  { to: '/data', label: 'Data Tools', icon: Database },
  { to: '/photo-reingest', label: 'Photo Reingest', icon: Camera },
  { to: '/evidence-photo-linker', label: 'Evidence Linker', icon: Link2 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const complianceLegacyLinks: AdminNavLink[] = [
  { to: '/compliance-dashboard', label: 'Compliance Dashboard', icon: BarChart3 },
  { to: '/compliance-analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/compliance-recalculation', label: 'Recalculation', icon: Shield },
  { to: '/spatial-compliance', label: 'Spatial Compliance', icon: MapIcon },
]

const peopleIncidentsLegacyLinks: AdminNavLink[] = [
  { to: '/person-records', label: 'Person Records', icon: Users },
  { to: '/face-recognition', label: 'Face Recognition', icon: ScanFace },
  { to: '/points-of-interest', label: 'Points of Interest', icon: Ban },
  { to: '/incidents', label: 'Incidents & Maintenance', icon: Activity },
  { to: '/incident-reports', label: 'Incident Reports', icon: FileText },
  { to: '/investigations', label: 'Investigations', icon: Search },
  { to: '/site-risk-assessment', label: 'Site Risk Assessment', icon: ClipboardCheck },
]

const moreGroups: AdminNavGroup[] = [
  {
    label: 'Compliance',
    links: complianceLegacyLinks,
  },
  {
    label: 'Enforcement',
    links: enforcementLegacyLinks,
  },
  {
    label: 'Vehicles & Zones',
    links: vehiclesZonesLegacyLinks,
  },
  {
    label: 'Officers & Patrols',
    links: officersPatrolsLegacyLinks,
  },
  {
    label: 'People & Incidents',
    links: peopleIncidentsLegacyLinks,
  },
  {
    label: 'Specialist Services',
    links: specialistServicesLegacyLinks,
  },
  {
    label: 'Reports',
    links: reportsLegacyLinks,
  },
  {
    label: 'Admin',
    links: adminLegacyLinks,
  },
]

function buildEnforcementPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    enforcementLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    enforcementLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Enforcement',
      links: enforcementLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== enforcementLegacyLinks.length) {
    return {
      label: 'Enforcement',
      links: enforcementLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Enforcement',
    links: enforcementLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildVehiclesZonesPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    vehiclesZonesLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    vehiclesZonesLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Vehicles & Zones',
      links: vehiclesZonesLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== vehiclesZonesLegacyLinks.length) {
    return {
      label: 'Vehicles & Zones',
      links: vehiclesZonesLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Vehicles & Zones',
    links: vehiclesZonesLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildReportsPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    reportsLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    reportsLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Reports',
      links: reportsLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== reportsLegacyLinks.length) {
    return {
      label: 'Reports',
      links: reportsLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Reports',
    links: reportsLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildSpecialistServicesPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    specialistServicesLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    specialistServicesLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Specialist Services',
      links: specialistServicesLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== specialistServicesLegacyLinks.length) {
    return {
      label: 'Specialist Services',
      links: specialistServicesLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Specialist Services',
    links: specialistServicesLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildOfficersPatrolsPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    officersPatrolsLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    officersPatrolsLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Officers & Patrols',
      links: officersPatrolsLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== officersPatrolsLegacyLinks.length) {
    return {
      label: 'Officers & Patrols',
      links: officersPatrolsLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Officers & Patrols',
    links: officersPatrolsLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildAdminPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    adminLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    adminLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Admin',
      links: adminLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== adminLegacyLinks.length) {
    return {
      label: 'Admin',
      links: adminLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Admin',
    links: adminLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildCompliancePilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    complianceLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    complianceLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'Compliance',
      links: complianceLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== complianceLegacyLinks.length) {
    return {
      label: 'Compliance',
      links: complianceLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'Compliance',
    links: complianceLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

function buildPeopleIncidentsPilotGroup(role?: AppRole): AdminNavGroup {
  const manifestSubset = routeManifest.filter((entry) =>
    peopleIncidentsLegacyLinks.some((link) => link.to === entry.path),
  )

  const missingPaths = getMissingManifestPaths(
    peopleIncidentsLegacyLinks.map((link) => link.to),
    manifestSubset,
  )

  if (missingPaths.length > 0) {
    return {
      label: 'People & Incidents',
      links: peopleIncidentsLegacyLinks,
    }
  }

  const projected = projectLegacyNavItems(manifestSubset, {
    role,
    shell: 'admin',
  })

  if (projected.length !== peopleIncidentsLegacyLinks.length) {
    return {
      label: 'People & Incidents',
      links: peopleIncidentsLegacyLinks,
    }
  }

  const projectedByPath = new globalThis.Map(projected.map((item) => [item.path, item]))

  return {
    label: 'People & Incidents',
    links: peopleIncidentsLegacyLinks.map((legacy) => ({
      to: legacy.to,
      label: legacy.label,
      icon: legacy.icon,
    })).filter((legacy) => projectedByPath.has(legacy.to)),
  }
}

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

  const effectiveRole = (user?.role === 'grand_master' ? 'master' : user?.role) as AppRole | undefined

  const resolvedMoreGroups = useMemo(() => {
    const enforcementPilotGroup = buildEnforcementPilotGroup(effectiveRole)
    const vehiclesZonesPilotGroup = buildVehiclesZonesPilotGroup(effectiveRole)
    const officersPatrolsPilotGroup = buildOfficersPatrolsPilotGroup(effectiveRole)
    const compliancePilotGroup = buildCompliancePilotGroup(effectiveRole)
    const peopleIncidentsPilotGroup = buildPeopleIncidentsPilotGroup(effectiveRole)
    const reportsPilotGroup = buildReportsPilotGroup(effectiveRole)
    const specialistServicesPilotGroup = buildSpecialistServicesPilotGroup(effectiveRole)
    const adminPilotGroup = buildAdminPilotGroup(effectiveRole)

    return moreGroups.map((group) => {
      if (group.label === 'Compliance') return compliancePilotGroup
      if (group.label === 'Enforcement') return enforcementPilotGroup
      if (group.label === 'Vehicles & Zones') return vehiclesZonesPilotGroup
      if (group.label === 'Officers & Patrols') return officersPatrolsPilotGroup
      if (group.label === 'People & Incidents') return peopleIncidentsPilotGroup
      if (group.label === 'Reports') return reportsPilotGroup
      if (group.label === 'Specialist Services') return specialistServicesPilotGroup
      if (group.label === 'Admin') return adminPilotGroup
      return group
    })
  }, [effectiveRole])

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
                  {resolvedMoreGroups.map((group) => (
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

