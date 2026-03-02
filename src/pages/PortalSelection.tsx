import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Shield, Radio, ChevronRight } from 'lucide-react'

export default function PortalSelection() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  // If user only has one portal, redirect immediately
  if (user?.role === 'admin' || user?.role === 'master') {
    navigate('/admin', { replace: true })
    return null
  }
  if (user?.role === 'officer') {
    navigate('/field-officer', { replace: true })
    return null
  }

  // admin_officer — show the chooser
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo / greeting */}
        <div className="text-center text-white mb-8">
          <h1 className="text-3xl font-bold">FreedomCamp Manager</h1>
          <p className="text-blue-300 mt-1">
            Welcome back, {user?.full_name || user?.email}
          </p>
          <p className="text-sm text-blue-400 mt-0.5">Select your portal to continue</p>
        </div>

        {/* Admin portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-blue-500/30 bg-white/5 backdrop-blur"
          onClick={() => navigate('/admin')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                <Shield className="h-5 w-5 text-white" />
              </div>
              Admin Portal
            </CardTitle>
            <CardDescription className="text-blue-200">
              Compliance dashboards, enforcement management, reports and data tools
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Open Admin Portal
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* Field officer portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-green-500/30 bg-white/5 backdrop-blur"
          onClick={() => navigate('/field-officer')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center">
                <Radio className="h-5 w-5 text-white" />
              </div>
              Field Officer Portal
            </CardTitle>
            <CardDescription className="text-green-200">
              Vehicle scanning, patrol management and real-time compliance checking
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-green-600 hover:bg-green-700 text-white">
              Open Field Portal
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
