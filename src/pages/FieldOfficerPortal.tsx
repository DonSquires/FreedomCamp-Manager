import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { Camera, Map, FileText, History, AlertTriangle, MapPin } from 'lucide-react'

export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  return (
    <AppLayout title="Field Officer Portal" description={`Welcome, ${user?.first_name || 'Officer'}`}>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Quick Action Cards */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/vehicles')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Camera className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              Scan Vehicle
            </CardTitle>
            <CardDescription>
              Capture vehicle plate and location
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full">
              Open Scanner
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                <Map className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              Active Patrol
            </CardTitle>
            <CardDescription>
              Start or end your patrol session
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              Start Patrol
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              Create Report
            </CardTitle>
            <CardDescription>
              Submit incident or H&S report
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              New Report
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/compliance')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                <History className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              My Scans
            </CardTitle>
            <CardDescription>
              View recent observations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              View History
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/breaches')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              Breach Alerts
            </CardTitle>
            <CardDescription>
              View active breach notifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              View Alerts
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/zones')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-teal-100 dark:bg-teal-900 rounded-lg">
                <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              Zones
            </CardTitle>
            <CardDescription>
              View enforcement zones
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              View Zones
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Officer Tips */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quick Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li>• Always ensure GPS is enabled for accurate location tracking</li>
            <li>• Capture clear photos of vehicle plates and self-contained stickers</li>
            <li>• Report any safety concerns immediately</li>
            <li>• Check breach alerts before starting your patrol</li>
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
