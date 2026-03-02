import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  BarChart3, 
  AlertTriangle, 
  Car, 
  MapPin, 
  Users, 
  FileText,
  Shield,
  Settings,
  Database,
  Building2
} from 'lucide-react'

export default function AdminPortal() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Admin Portal
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {user?.role === 'master' ? 'System Administrator' : 'Organisation Administrator'}
            </p>
          </div>
          <Button variant="outline" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Compliance Dashboard
              </CardTitle>
              <CardDescription>
                View compliance metrics and trends
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/compliance')}>
                View Dashboard
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Breach Alerts
              </CardTitle>
              <CardDescription>
                Manage active breaches
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/breaches')}>
                View Breaches
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="h-5 w-5" />
                Vehicle Management
              </CardTitle>
              <CardDescription>
                Search and manage vehicles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/vehicles')}>
                Manage Vehicles
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Zone Management
              </CardTitle>
              <CardDescription>
                Configure compliance zones
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/zones')}>
                Manage Zones
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Manage officers and admins
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/users')}>
                Manage Users
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Reports
              </CardTitle>
              <CardDescription>
                Generate compliance reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/reports')}>
                View Reports
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Enforcement Actions
              </CardTitle>
              <CardDescription>
                Warnings, notices, and enforcement workflow
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/enforcement')}>
                View Enforcement
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Data Management
              </CardTitle>
              <CardDescription>
                Import/Export and data tools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/data')}>
                Manage Data
              </Button>
            </CardContent>
          </Card>

          {user?.role === 'master' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Organizations
                </CardTitle>
                <CardDescription>
                  Manage organization hierarchy
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" onClick={() => navigate('/organizations')}>
                  Manage Orgs
                </Button>
              </CardContent>
            </Card>
          )}

          {user?.role === 'master' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  System Diagnostics
                </CardTitle>
                <CardDescription>
                  System health and monitoring
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" onClick={() => navigate('/diagnostics')}>
                  View Diagnostics
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
