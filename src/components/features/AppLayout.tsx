import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function AppLayout({ children, title, description, showBackButton }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopNavOpen, setDesktopNavOpen] = useState(true)
  const { user, logout } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    queryClient.clear()
    navigate('/login')
  }

  const handleBack = () => {
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
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
          'hidden lg:block fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 z-30 transition-transform duration-200',
          desktopNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b dark:border-gray-700">
            <h2 className="font-bold text-xl text-blue-600 dark:text-blue-400">FreedomCamp</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {user?.full_name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
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
        <header className="hidden lg:block bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-20">
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
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
