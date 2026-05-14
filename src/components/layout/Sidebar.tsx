/**
 * Sidebar Navigation Component
 * 
 * Unified navigation for all 6 modules + specialty modules.
 * Role-aware: shows/hides items based on user role and org permissions.
 * Mobile-responsive: collapses to hamburger icon on small screens.
 */

import { useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Users,
  AlertCircle,
  Map,
  Settings,
  Zap,
  ChevronDown,
  Menu,
  X,
  BarChart3,
  Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface NavItem {
  id: string
  label: string
  icon?: React.ReactNode
  href: string
  requiredRoles?: string[]
  badge?: number
  children?: NavItem[]
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-4 h-4" />,
    href: '/dashboard',
  },
  {
    id: 'patrol',
    label: 'Patrol',
    icon: <Users className="w-4 h-4" />,
    href: '/patrol',
    children: [
      { id: 'patrol-scheduler', label: 'Scheduler', href: '/patrol/scheduler' },
      { id: 'patrol-live', label: 'Live Monitor', href: '/patrol/live' },
      { id: 'patrol-analytics', label: 'Analytics', href: '/patrol/analytics' },
      { id: 'patrol-routes', label: 'Routes', href: '/patrol/routes' },
      { id: 'patrol-welfare', label: 'Welfare', href: '/patrol/welfare' },
    ],
  },
  {
    id: 'enforcement',
    label: 'Enforcement',
    icon: <AlertCircle className="w-4 h-4" />,
    href: '/enforcement',
    children: [
      { id: 'enf-breaches', label: 'Breaches', href: '/enforcement/breaches' },
      { id: 'enf-compliance', label: 'Compliance', href: '/enforcement/compliance' },
      { id: 'enf-incidents', label: 'Incidents', href: '/enforcement/incidents' },
      { id: 'enf-actions', label: 'Actions', href: '/enforcement/actions' },
      { id: 'enf-notices', label: 'Notices', href: '/enforcement/notices' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: <Map className="w-4 h-4" />,
    href: '/operations',
    children: [
      { id: 'ops-zones', label: 'Zones', href: '/operations/zones' },
      { id: 'ops-sites', label: 'Sites', href: '/operations/sites' },
      { id: 'ops-vehicles', label: 'Vehicles', href: '/operations/vehicles' },
      { id: 'ops-assets', label: 'Assets', href: '/operations/assets' },
      { id: 'ops-poi', label: 'Points of Interest', href: '/operations/poi' },
      { id: 'ops-persons', label: 'Persons', href: '/operations/persons' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: <Settings className="w-4 h-4" />,
    href: '/admin',
    requiredRoles: ['admin', 'admin_officer', 'master'],
    children: [
      { id: 'admin-users', label: 'Users & Teams', href: '/admin/users' },
      { id: 'admin-perms', label: 'Permissions', href: '/admin/permissions' },
      { id: 'admin-org', label: 'Organization', href: '/admin/organization' },
      { id: 'admin-audit', label: 'Audit Log', href: '/admin/audit' },
      { id: 'admin-data', label: 'Data Management', href: '/admin/data' },
      { id: 'admin-settings', label: 'Settings', href: '/admin/settings' },
    ],
  },
  {
    id: 'bob',
    label: 'Bob AI',
    icon: <Zap className="w-4 h-4" />,
    href: '/bob',
    children: [
      { id: 'bob-studio', label: 'Studio', href: '/bob/studio' },
      { id: 'bob-queue', label: 'Proposal Queue', href: '/bob/queue' },
    ],
  },
]

interface SidebarProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function Sidebar({ open = true, onOpenChange }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const role = user?.role
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['patrol', 'enforcement']))
  const [mobileOpen, setMobileOpen] = useState(false)

  // Filter nav items by role
  const visibleItems = useMemo(() => {
    return NAV_ITEMS.filter(item => !item.requiredRoles || item.requiredRoles.includes(role || ''))
  }, [role])

  const toggleExpanded = (id: string) => {
    const newSet = new Set(expandedItems)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setExpandedItems(newSet)
  }

  const isActive = (href: string) => location.pathname.startsWith(href)

  const renderNavItem = (item: NavItem, depth = 0) => {
    const isItemActive = isActive(item.href)
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.has(item.id)

    return (
      <div key={item.id}>
        <Button
          variant={isItemActive ? 'secondary' : 'ghost'}
          className={cn('w-full justify-start', depth > 0 && 'ml-4')}
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(item.id)
            } else {
              navigate(item.href)
              setMobileOpen(false)
            }
          }}
        >
          {item.icon}
          <span className="ml-2">{item.label}</span>
          {item.badge && <span className="ml-auto text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full">{item.badge}</span>}
          {hasChildren && (
            <ChevronDown className={cn('ml-auto w-4 h-4 transition-transform', isExpanded && 'rotate-180')} />
          )}
        </Button>

        {hasChildren && isExpanded && (
          <div className="mt-1">
            {item.children.map(child => renderNavItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Mobile hamburger button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="h-10 w-10 p-0"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 w-64 bg-white border-r z-40 p-4 overflow-y-auto transition-transform lg:relative lg:translate-x-0 lg:z-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="mb-6 mt-12 lg:mt-0">
          <h1 className="text-xl font-bold">FieldOps</h1>
          <p className="text-xs text-gray-500">Manager</p>
        </div>

        {/* Global search (placeholder) */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="⌘K Search..."
            className="w-full px-3 py-2 text-sm border rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            readOnly
          />
        </div>

        {/* Navigation items */}
        <nav className="space-y-1">
          {visibleItems.map(item => renderNavItem(item))}
        </nav>
      </div>
    </>
  )
}
