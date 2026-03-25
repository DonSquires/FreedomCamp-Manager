import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, Radio, ChevronRight, ParkingSquare, Volume2, Building2, Zap, MapPin, Clock } from 'lucide-react'
import { useRosteredShift, type RosterServiceType } from '@/hooks/useRosteredShift'
import { format, parseISO } from 'date-fns'

// Map service_type → portal path and label
const SERVICE_TYPE_PORTAL: Record<RosterServiceType, { path: string; label: string }> = {
  freedom_camping: { path: '/field-officer?service=freedom_camping', label: 'Freedom Camping Patrol' },
  guarding:        { path: '/field-officer?service=guarding',        label: 'Guarding' },
  parking:         { path: '/parking-officer',                       label: 'Parking Enforcement' },
  noise:           { path: '/noise-officer',                         label: 'Noise Control' },
  patrol:          { path: '/field-officer?service=patrol',          label: 'General Patrol' },
  alarm_response:  { path: '/field-officer?service=alarm_response',  label: 'Alarm Response' },
  ems:             { path: '/ems',                                    label: 'EMS' },
}

export default function PortalSelection() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { rosteredShift, isLoading: rosterLoading } = useRosteredShift()

  // Auto-redirect based on role
  useEffect(() => {
    if (!user) return
    if (user.role === 'grand_master') {
      navigate('/platform', { replace: true })
    } else if (user.role === 'admin' || user.role === 'master') {
      navigate('/admin', { replace: true })
    } else if (user.role === 'client_viewer') {
      navigate('/client-portal', { replace: true })
    }
    // officer + admin_officer fall through to show the chooser below
  }, [user, navigate])

  // Officers with a single-service roster shift: auto-route after load
  useEffect(() => {
    if (rosterLoading) return
    if (user?.role !== 'officer') return
    if (!rosteredShift?.service_type) {
      // No roster — default to field portal
      navigate('/field-officer', { replace: true })
      return
    }
    const portal = SERVICE_TYPE_PORTAL[rosteredShift.service_type]
    navigate(portal.path, { replace: true })
  }, [user, rosterLoading, rosteredShift, navigate])

  const selectPortal = (path: string) => {
    window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    navigate(path)
  }

  // ── Rostered shift banner (for admin_officer role) ─────────────────────────
  const rosterBanner = rosteredShift && (
    <div className="rounded-xl border border-green-400/40 bg-green-900/30 backdrop-blur p-3 flex items-start gap-3">
      <Clock className="h-5 w-5 text-green-300 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-green-200">
          Today's Rostered Shift
        </p>
        <p className="text-xs text-green-300 mt-0.5">
          {rosteredShift.service_type
            ? SERVICE_TYPE_PORTAL[rosteredShift.service_type]?.label
            : rosteredShift.position_title ?? 'Shift'}
          {rosteredShift.start_time && (
            <> · {format(parseISO(rosteredShift.start_time), 'h:mm a')}</>
          )}
        </p>
        {rosteredShift.client_org_name && (
          <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3" />
            {rosteredShift.client_site_name
              ? `${rosteredShift.client_site_name} — ${rosteredShift.client_org_name}`
              : rosteredShift.client_org_name}
          </p>
        )}
      </div>
      {rosteredShift.service_type && (
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
          onClick={() => navigate(SERVICE_TYPE_PORTAL[rosteredShift.service_type!].path)}
        >
          Go to Shift
          <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      )}
    </div>
  )

  // admin_officer — show the chooser
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Logo / greeting */}
        <div className="text-center text-white mb-6">
          <h1 className="text-3xl font-bold">FreedomCamp Manager</h1>
          <p className="text-blue-300 mt-1">
            Welcome back, {user?.full_name || user?.email}
          </p>
          <p className="text-sm text-blue-400 mt-0.5">Select your portal to continue</p>
        </div>

        {/* Roster banner */}
        {rosterBanner}

        {/* Admin portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-blue-500/30 bg-white/5 backdrop-blur"
          onClick={() => selectPortal('/admin')}
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
          onClick={() => selectPortal('/field-officer')}
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

        {/* Parking officer portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-orange-500/30 bg-white/5 backdrop-blur"
          onClick={() => navigate('/parking-officer')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center">
                <ParkingSquare className="h-5 w-5 text-white" />
              </div>
              Parking Enforcement
            </CardTitle>
            <CardDescription className="text-orange-200">
              TicketOr2-style chalk pass, recheck, permit check and infringement issuance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white">
              Open Parking Portal
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* Noise control officer portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-yellow-500/30 bg-white/5 backdrop-blur"
          onClick={() => navigate('/noise-officer')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-yellow-600 flex items-center justify-center">
                <Volume2 className="h-5 w-5 text-white" />
              </div>
              Noise Control
            </CardTitle>
            <CardDescription className="text-yellow-200">
              NZ RMA noise assessments, AN / DN / END notices and equipment seizures
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-yellow-600 hover:bg-yellow-700 text-white">
              Open Noise Control Portal
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* EMS portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-red-500/30 bg-white/5 backdrop-blur"
          onClick={() => navigate('/ems')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-red-700 flex items-center justify-center">
                <Zap className="h-5 w-5 text-white" />
              </div>
              EMS
              <Badge variant="outline" className="text-xs border-red-400 text-red-300 ml-1">Electronic Monitoring</Badge>
            </CardTitle>
            <CardDescription className="text-red-200">
              Electronic Monitoring Services — device fit, removal, checks and escort
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-red-700 hover:bg-red-800 text-white">
              Open EMS Portal
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* Client organisation portal */}
        <Card
          className="cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-purple-500/30 bg-white/5 backdrop-blur"
          onClick={() => navigate('/client-portal')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              Client Organisation Portal
            </CardTitle>
            <CardDescription className="text-purple-200">
              View guard activity, KPIs, risk assessments and infringements for your organisation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white">
              Open Client Portal
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
