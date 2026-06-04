import { useEffect, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SERVICE_TYPE_PORTAL, getOfficerPortalPath } from '@/lib/officerPortalRouting'
import { Shield, Radio, ChevronRight, ParkingSquare, Volume2, Building2, Zap, MapPin, Clock, Lock, ArrowRight, Layers } from 'lucide-react'
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { format, parseISO } from 'date-fns'

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
    } else if (['client_viewer', 'client_officer', 'client_admin'].includes(user.role)) {
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
    const path = getOfficerPortalPath(rosteredShift)
    if (!path) return
    navigate(path, { replace: true })
  }, [user, rosterLoading, rosteredShift, navigate])

  const selectPortal = (path: string) => {
    window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    navigate(path)
  }

  const activateWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, onActivate: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate()
    }
  }

  const portalCards = [
    {
      id: 'admin',
      title: 'Admin Portal',
      subtitle: 'Compliance, enforcement, reports',
      icon: Shield,
      tone: 'from-sky-500 to-blue-700',
      border: 'border-sky-300/40 hover:border-sky-200/80',
      text: 'text-sky-100',
      action: () => selectPortal('/admin'),
    },
    {
      id: 'field',
      title: 'Field Officer',
      subtitle: 'Scanning, patrol, live compliance',
      icon: Radio,
      tone: 'from-emerald-500 to-teal-700',
      border: 'border-emerald-300/40 hover:border-emerald-200/80',
      text: 'text-emerald-100',
      action: () => selectPortal('/field-officer'),
    },
    {
      id: 'site-guard',
      title: 'Site Guard',
      subtitle: 'POI, incidents, camera review',
      icon: Lock,
      tone: 'from-cyan-500 to-teal-700',
      border: 'border-cyan-300/40 hover:border-cyan-200/80',
      text: 'text-cyan-100',
      badge: rosteredShift?.service_type === 'guarding' ? 'Rostered' : null,
      action: () => {
        if (rosteredShift?.service_type === 'guarding' && rosteredShift.client_site_id) {
          selectPortal(`/site-guard?site=${rosteredShift.client_site_id}&roster=${rosteredShift.id}`)
          return
        }
        selectPortal('/site-guard')
      },
    },
    {
      id: 'parking',
      title: 'Parking Enforcement',
      subtitle: 'Chalk pass, permit checks, notices',
      icon: ParkingSquare,
      tone: 'from-amber-500 to-orange-700',
      border: 'border-amber-300/40 hover:border-amber-200/80',
      text: 'text-amber-100',
      action: () => selectPortal('/parking-officer'),
    },
    {
      id: 'noise',
      title: 'Noise Control',
      subtitle: 'RMA assessments and notices',
      icon: Volume2,
      tone: 'from-yellow-500 to-amber-700',
      border: 'border-yellow-300/40 hover:border-yellow-200/80',
      text: 'text-yellow-100',
      action: () => selectPortal('/noise-officer'),
    },
    {
      id: 'ems',
      title: 'EMS',
      subtitle: 'Device fit, removal, operational checks',
      icon: Zap,
      tone: 'from-rose-500 to-red-700',
      border: 'border-rose-300/40 hover:border-rose-200/80',
      text: 'text-rose-100',
      badge: 'Electronic Monitoring',
      action: () => selectPortal('/ems'),
    },
    {
      id: 'client',
      title: 'Client Organisation Portal',
      subtitle: 'Guard activity, KPIs, risk and infringements',
      icon: Building2,
      tone: 'from-indigo-500 to-blue-700',
      border: 'border-indigo-300/40 hover:border-indigo-200/80',
      text: 'text-indigo-100',
      span: 'md:col-span-2',
      action: () => selectPortal('/client-portal'),
    },
  ]

  // ── Rostered shift banner (for admin_officer role) ─────────────────────────
  const rosterBanner = rosteredShift && (
    <div className="rounded-xl border border-green-400/40 bg-green-900/30 backdrop-blur p-3 flex items-start gap-3">
      <Clock className="h-5 w-5 text-green-300 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-green-200">
          Today&apos;s Rostered Shift
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
            const path = getOfficerPortalPath(rosteredShift)
            if (!path) return
            selectPortal(path)
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_15%,rgba(34,197,94,0.18),transparent_36%),radial-gradient(circle_at_85%_0%,rgba(14,116,144,0.26),transparent_42%),linear-gradient(145deg,#0f172a_0%,#111827_52%,#0b1220_100%)] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-5xl space-y-5">

        {/* Logo / greeting */}
        <div className="rounded-2xl border border-white/15 bg-slate-900/50 backdrop-blur-md p-4 md:p-6 text-white shadow-2xl shadow-black/25">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/iron-eagle-security-logo.jpg"
                alt="Iron Eagle Security Limited"
                className="h-12 w-12 rounded-xl object-cover shadow-md shrink-0"
              />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight leading-tight">Field Compliance Manager</h1>
                <p className="text-slate-300 text-sm">
                  Welcome back, {user?.full_name || user?.email}
                </p>
                <p className="text-xs text-slate-400 mt-1">Choose a workspace to continue your shift</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="bg-white/10 text-slate-200 border border-white/20">
                <Layers className="h-3.5 w-3.5 mr-1" />
                Multi-Portal Access
              </Badge>
              {rosteredShift?.service_type && (
                <Badge className="bg-emerald-600/90 hover:bg-emerald-600 text-white border border-emerald-300/40">
                  Active Shift: {SERVICE_TYPE_PORTAL[rosteredShift.service_type]?.label}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Roster banner */}
        {rosterBanner}

        {/* Responsive portal grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {portalCards.map((portal) => {
            const Icon = portal.icon
            return (
              <div
                key={portal.id}
                role="button"
                tabIndex={0}
                data-testid={`portal-card-${portal.id}`}
                onClick={portal.action}
                onKeyDown={(event) => activateWithKeyboard(event, portal.action)}
                className={`group ${portal.span ?? ''} rounded-2xl border ${portal.border} bg-white/5 backdrop-blur-md px-4 py-4 md:px-5 md:py-5 cursor-pointer transition-all duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}
                aria-label={`Open ${portal.title}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${portal.tone} flex items-center justify-center shadow-lg shadow-black/30 shrink-0`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm md:text-base font-semibold text-white leading-tight flex flex-wrap items-center gap-2">
                      {portal.title}
                      {portal.badge ? (
                        <Badge className="bg-white/15 text-white text-[10px] py-0 px-1.5 border border-white/25 hover:bg-white/15">
                          {portal.badge}
                        </Badge>
                      ) : null}
                    </p>
                    <p className={`text-xs md:text-sm mt-1 ${portal.text} truncate`}>{portal.subtitle}</p>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-white/85 group-hover:text-white transition-colors">
                    Open
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
