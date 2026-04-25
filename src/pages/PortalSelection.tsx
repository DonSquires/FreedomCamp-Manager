import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, Radio, ChevronRight, ParkingSquare, Volume2, Building2, Zap, MapPin, Clock, Lock, Tent, Wind, Leaf } from 'lucide-react'
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

        {/* 2-column portal grid — data-driven */}
        {(() => {
                    type PortalCard = {
                      label: string
                      description: string
                      iconBg: string
                      borderColor: string
                      textColor: string
                      Icon: React.FC<{ className?: string }>
                      colSpan?: boolean
                      badge?: React.ReactNode
                      onClick: () => void
                    }
                    const cards: PortalCard[] = [
                      {
                        label: 'Admin Portal',
                        description: 'Compliance, enforcement & reports',
                        iconBg: 'bg-blue-600',
                        borderColor: 'border-blue-500/30 hover:border-blue-400/50',
                        textColor: 'text-blue-300',
                        Icon: Shield,
                        onClick: () => selectPortal('/admin'),
                      },
                      {
                        label: 'Field Officer',
                        description: 'Scanning, patrol & compliance',
                        iconBg: 'bg-green-600',
                        borderColor: 'border-green-500/30 hover:border-green-400/50',
                        textColor: 'text-green-300',
                        Icon: Radio,
                        onClick: () => selectPortal('/field-officer'),
                      },
                      {
                        label: 'Freedom Camping',
                        description: 'Zone-based · self-contained rules',
                        iconBg: 'bg-emerald-600',
                        borderColor: 'border-emerald-500/30 hover:border-emerald-400/50',
                        textColor: 'text-emerald-300',
                        Icon: Tent,
                        onClick: () => selectPortal('/field-officer?service=freedom_camping'),
                      },
                      {
                        label: 'Site Guard',
                        description: 'POI, incidents & camera review',
                        iconBg: 'bg-teal-600',
                        borderColor: 'border-teal-500/30 hover:border-teal-400/50',
                        textColor: 'text-teal-300',
                        Icon: Lock,
                        badge: rosteredShift?.service_type === 'guarding'
                          ? <Badge className="bg-green-600 text-white text-[10px] py-0 px-1.5">Rostered</Badge>
                          : null,
                        onClick: () => {
                          if (rosteredShift?.service_type === 'guarding' && rosteredShift.client_site_id) {
                            navigate(`/site-guard?site=${rosteredShift.client_site_id}&roster=${rosteredShift.id}`)
                          } else {
                            navigate('/site-guard')
                          }
                        },
                      },
                      {
                        label: 'Parking Enforcement',
                        description: 'Zone-based permits, chalk pass & notices',
                        iconBg: 'bg-orange-600',
                        borderColor: 'border-orange-500/30 hover:border-orange-400/50',
                        textColor: 'text-orange-300',
                        Icon: ParkingSquare,
                        onClick: () => navigate('/parking-officer'),
                      },
                      {
                        label: 'Noise Control',
                        description: 'Jurisdiction-wide RMA assessments & notices',
                        iconBg: 'bg-yellow-600',
                        borderColor: 'border-yellow-500/30 hover:border-yellow-400/50',
                        textColor: 'text-yellow-300',
                        Icon: Volume2,
                        onClick: () => navigate('/noise-officer'),
                      },
                      {
                        label: 'Smoke Complaints',
                        description: 'Jurisdiction-wide OOH smoke assessments',
                        iconBg: 'bg-amber-600',
                        borderColor: 'border-amber-500/30 hover:border-amber-400/50',
                        textColor: 'text-amber-300',
                        Icon: Wind,
                        onClick: () => navigate('/smoke-officer'),
                      },
                      {
                        label: 'Biosecurity',
                        description: 'Jurisdiction-wide CNG inspections',
                        iconBg: 'bg-lime-700',
                        borderColor: 'border-lime-500/30 hover:border-lime-400/50',
                        textColor: 'text-lime-300',
                        Icon: Leaf,
                        onClick: () => navigate('/biosecurity-officer'),
                      },
                      {
                        label: 'EMS',
                        description: 'Electronic monitoring — device fit, removal & checks',
                        iconBg: 'bg-red-700',
                        borderColor: 'border-red-500/30 hover:border-red-400/50',
                        textColor: 'text-red-300',
                        Icon: Zap,
                        badge: <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-red-400 text-red-300">Electronic Monitoring</Badge>,
                        onClick: () => navigate('/ems'),
                      },
                      {
                        label: 'Client Organisation Portal',
                        description: 'Guard activity, KPIs, risk assessments & infringements for your organisation',
                        iconBg: 'bg-purple-600',
                        borderColor: 'border-purple-500/30 hover:border-purple-400/50',
                        textColor: 'text-purple-300',
                        Icon: Building2,
                        colSpan: true,
                        onClick: () => navigate('/client-portal'),
                      },
                    ]
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        {cards.map((card) => (
                          <div
                            key={card.label}
                            className={`${card.colSpan ? 'col-span-2' : ''} flex items-center gap-3 rounded-xl border ${card.borderColor} bg-white/5 backdrop-blur px-4 py-3 cursor-pointer hover:bg-white/10 transition-all group`}
                            onClick={card.onClick}
                          >
                            <div className={`w-10 h-10 rounded-full ${card.iconBg} flex items-center justify-center shrink-0`}>
                              <card.Icon className="h-5 w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">
                                {card.label}
                                {card.badge}
                              </p>
                              <p className={`text-xs ${card.textColor} truncate`}>{card.description}</p>
                            </div>
                            <ChevronRight className={`h-4 w-4 ${card.textColor} shrink-0 opacity-0 group-hover:opacity-100 transition-opacity`} />
                          </div>
                        ))}
                      </div>
                    )
                  })()}
      </div>
    </div>
  )
}
