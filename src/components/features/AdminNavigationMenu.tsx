import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  Shield, Home, Car, MapPin, Users, BarChart3, FileText,
  LogOut, Settings, ChevronLeft,
} from 'lucide-react'

const navLinks = [
  { to: '/admin', label: 'Dashboard', icon: Home },
  { to: '/compliance', label: 'Compliance', icon: Shield },
  { to: '/vehicles', label: 'Vehicles', icon: Car },
  { to: '/zones', label: 'Zones', icon: MapPin },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/reports-hub', label: 'Reports Hub', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AdminNavigationMenu() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          {/* Brand */}
          <Link to="/admin" className="flex items-center gap-2 mr-4 shrink-0">
            <Shield className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-gray-900 hidden sm:block text-sm">
              FreedomCamp
            </span>
          </Link>

          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            className="mr-2"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Nav links */}
          <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors whitespace-nowrap shrink-0"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden md:block">{label}</span>
              </Link>
            ))}
          </div>

          {/* User + logout */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            {user && (
              <span className="text-xs text-gray-500 hidden lg:block">
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
