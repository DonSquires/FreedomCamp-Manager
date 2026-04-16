import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, Radio, ChevronRight, ParkingSquare, Volume2, Building2, Zap, MapPin, Clock, Lock } from 'lucide-react'
import { useRosteredShift, type RosterServiceType } from '@/hooks/useRosteredShift'
import { format, parseISO } from 'date-fns'

// Map service_type → portal path and label
const SERVICE_TYPE_PORTAL: Record<RosterServiceType, { path: string; label: string; buildPath?: (shift: import('@/hooks/useRosteredShift').RosteredShift) => string }> = {
  freedom_camping: { path: '/field-officer?service=freedom_camping', label: 'Freedom Camping Patrol' },
  guarding:        {
    path: '/site-guard',
    label: 'Site Guarding',
    buildPath: (shift) =>
      shift.client_site_id
        ? `/site-guard?site=${shift.client_site_id}${shift.id ? `&roster=${shift.id}` : ''}`
        : '/field-officer?service=guarding',
  },
  parking:                 { path: '/parking-officer',                             label: 'Parking Enforcement' },
  noise:                   { path: '/noise-officer',                               label: 'Noise Control' },
  patrol:                  { path: '/field-officer?service=patrol',                label: 'General Patrol' },
  alarm_response:          { path: '/field-officer?service=alarm_response',        label: 'Alarm Response' },
  ems:                     { path: '/ems',                                         label: 'EMS' },
  biosecurity_inspection:  { path: '/biosecurity-officer',                         label: 'Biosecurity Inspection' },
  smoke_complaint_ooh:     { path: '/smoke-officer',                               label: 'Smoke Complaint (OOH)' },
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
    const path = portal.buildPath ? portal.buildPath(rosteredShift) : portal.path
    navigate(path, { replace: true })
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
          onClick={() => {
            const portal = SERVICE_TYPE_PORTAL[rosteredShift.service_type!]
            const path = portal.buildPath ? portal.buildPath(rosteredShift) : portal.path
            navigate(path)
          }}
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
      <div className="w-full max-w-2xl space-y-5">

        {/* Logo / greeting */}
        <div className="flex items-center gap-4 text-white">
          <img
            src="/iron-eagle-security-logo.jpg"
            alt="Iron Eagle Security"
            className="h-12 w-12 rounded-xl object-cover shadow-md shrink-0"
          />
          <div>
            <h1 className="text-2xl font-bold leading-tight">FieldOps Manager</h1>
            <p className="text-blue-300 text-sm">
              Welcome back, {user?.full_name || user?.email}
            </p>
            <p className="text-xs text-blue-400 mt-0.5">Select your portal to continue</p>
          </div>
        </div>

        {/* Roster banner */}
        {rosterBanner}

        {/* 2-column portal grid */}
        <div className="grid grid-cols-2 gap-3">

          {/* Admin */}
          <div
            className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-blue-400/50 transition-all group"
            onClick={() => selectPortal('/admin')}
          >
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight">Admin Portal</p>
              <p className="text-xs text-blue-300 truncate">Compliance, enforcement & reports</p>
            </div>
            <span className="text-xs text-blue-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

          {/* Field Officer */}
          <div
            className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-green-400/50 transition-all group"
            onClick={() => selectPortal('/field-officer')}
          >
            <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center shrink-0">
              <Radio className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight">Field Officer</p>
              <p className="text-xs text-green-300 truncate">Scanning, patrol & compliance</p>
            </div>
            <span className="text-xs text-green-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

          {/* Site Guard */}
          <div
            className="flex items-center gap-3 rounded-xl border border-teal-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-teal-400/50 transition-all group"
            onClick={() => {
              if (rosteredShift?.service_type === 'guarding' && rosteredShift.client_site_id) {
                navigate(`/site-guard?site=${rosteredShift.client_site_id}&roster=${rosteredShift.id}`)
              } else {
                navigate('/site-guard')
              }
            }}
          >
            <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center shrink-0">
              <Lock className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">
                Site Guard
                {rosteredShift?.service_type === 'guarding' && (
                  <Badge className="bg-green-600 text-white text-[10px] py-0 px-1.5">Rostered</Badge>
                )}
              </p>
              <p className="text-xs text-teal-300 truncate">POI, incidents & camera review</p>
            </div>
            <span className="text-xs text-teal-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

          {/* Parking */}
          <div
            className="flex items-center gap-3 rounded-xl border border-orange-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-orange-400/50 transition-all group"
            onClick={() => navigate('/parking-officer')}
          >
            <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center shrink-0">
              <ParkingSquare className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight">Parking Enforcement</p>
              <p className="text-xs text-orange-300 truncate">Chalk pass, permit check & notices</p>
            </div>
            <span className="text-xs text-orange-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

          {/* Noise Control */}
          <div
            className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-yellow-400/50 transition-all group"
            onClick={() => navigate('/noise-officer')}
          >
            <div className="w-10 h-10 rounded-full bg-yellow-600 flex items-center justify-center shrink-0">
              <Volume2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight">Noise Control</p>
              <p className="text-xs text-yellow-300 truncate">RMA assessments & notices</p>
            </div>
            <span className="text-xs text-yellow-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

          {/* EMS */}
          <div
            className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-red-400/50 transition-all group"
            onClick={() => navigate('/ems')}
          >
            <div className="w-10 h-10 rounded-full bg-red-700 flex items-center justify-center shrink-0">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">
                EMS
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-red-400 text-red-300">Electronic Monitoring</Badge>
              </p>
              <p className="text-xs text-red-300 truncate">Device fit, removal & checks</p>
            </div>
            <span className="text-xs text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

          {/* Client Portal — full width */}
          <div
            className="col-span-2 flex items-center gap-3 rounded-xl border border-purple-500/30 bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 hover:border-purple-400/50 transition-all group"
            onClick={() => navigate('/client-portal')}
          >
            <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight">Client Organisation Portal</p>
              <p className="text-xs text-purple-300 truncate">Guard activity, KPIs, risk assessments & infringements for your organisation</p>
            </div>
            <span className="text-xs text-purple-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
          </div>

        </div>
      </div>
    </div>
  )
}
