/**
 * AdminHub – Card-based entry point for the admin portal.
 *
 * Replaces the flat tile grid as the first page admins/masters see.
 * Each card represents a major functional area with:
 *   • A live metric badge pulled from the database
 *   • A quick-link grid of sub-pages inside the card
 *   • A "Open →" click target on the card title
 *
 * The existing operational dashboard (AdminPortal) is still reachable at
 * /admin/dashboard via the "Operations Centre" card.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Camera,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  DollarSign,
  Eye,
  FileBarChart,
  FileText,
  FileWarning,
  Gavel,
  GraduationCap,
  Heart,
  Layers,
  Layout,
  Lock,
  Map,
  MapPin,
  Navigation,
  ParkingSquare,
  PieChart,
  Radio,
  Receipt,
  ScrollText,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Zap,
  ChevronRight,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuickLink {
  path: string
  label: string
  Icon: React.ElementType
}

interface HubCard {
  id: string
  title: string
  description: string
  primaryPath: string
  Icon: React.ElementType
  accentColor: string
  bgGradient: string
  iconBg: string
  metric?: { value: number | string; label: string; urgent?: boolean }
  quickLinks: QuickLink[]
}

// ─── Live metrics hook ────────────────────────────────────────────────────────

function useHubMetrics(orgId: string | null) {
  return useQuery({
    queryKey: ['admin-hub-metrics', orgId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })

      const [
        clientsResult,
        activeJobsResult,
        todayRosterResult,
        activeOfficersResult,
        breachesResult,
        contractsResult,
        welfareResult,
      ] = await Promise.all([
        // Active client organisations
        (supabase as any).from('organizations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_type', 'client')
          .eq('is_active', true),

        // Today's dispatch jobs
        (supabase as any).from('dispatch_jobs')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene']),

        // Today's roster shifts
        (supabase as any).from('roster_shifts')
          .select('id', { count: 'exact', head: true })
          .eq('shift_date', nzToday)
          .in('status', ['published', 'confirmed', 'in_progress']),

        // Active officers today (distinct officers with in-progress patrols)
        (supabase as any).from('patrols')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'in_progress')
          .eq('patrol_date', nzToday),

        // Open breaches
        (supabase as any).from('breach_alerts')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'acknowledged', 'enforcement_started']),

        // Active contracts
        (supabase as any).from('crm_contracts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .catch(() => ({ count: 0 })),

        // Unresolved welfare alerts
        (supabase as any).from('officer_welfare_alerts')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'acknowledged']),
      ])

      return {
        activeClients:   clientsResult.count  ?? 0,
        activeJobs:      activeJobsResult.count ?? 0,
        todayShifts:     todayRosterResult.count ?? 0,
        activePatrols:   activeOfficersResult.count ?? 0,
        openBreaches:    breachesResult.count  ?? 0,
        activeContracts: contractsResult.count ?? 0,
        welfareAlerts:   welfareResult.count   ?? 0,
      }
    },
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  })
}

// ─── Hub card component ───────────────────────────────────────────────────────

function ModuleCard({ card }: { card: HubCard }) {
  const navigate = useNavigate()
  return (
    <Card className={`group relative overflow-hidden border border-white/70 shadow-[0_12px_34px_rgba(15,23,42,0.12)] hover:shadow-[0_20px_44px_rgba(15,23,42,0.18)] transition-all duration-200 ${card.bgGradient}`}>
      <div className={`h-1.5 w-full ${card.accentColor}`} />

      <CardHeader className="pb-2 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${card.iconBg} shrink-0 shadow-md`}>
              <card.Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                {card.title}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5 text-gray-600 dark:text-gray-300">
                {card.description}
              </CardDescription>
            </div>
          </div>
          {card.metric && (
            <div className="shrink-0 text-right">
              <p className={`text-2xl font-bold leading-tight ${card.metric.urgent ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
                {card.metric.value}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight">{card.metric.label}</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {card.quickLinks.map(({ path, label, Icon }) => (
            <button
              key={path}
              onClick={(e) => { e.stopPropagation(); navigate(path) }}
              className="flex flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-center bg-white/70 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 border border-white/80 dark:border-white/20 hover:border-white/95 dark:hover:border-white/30 transition-all group/link"
            >
              <Icon className="h-4 w-4 text-gray-600 dark:text-gray-300 group-hover/link:text-gray-900 dark:group-hover/link:text-white" />
              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 group-hover/link:text-gray-900 dark:group-hover/link:text-white leading-tight">
                {label}
              </span>
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full h-8 text-xs font-medium bg-white/65 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 border border-white/70 dark:border-white/20"
          onClick={() => navigate(card.primaryPath)}
        >
          Open {card.title}
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminHub() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const effectiveOrgId =
    user?.role === 'master' ? null : user?.organization_id ?? null

  const { data: metrics } = useHubMetrics(effectiveOrgId)

  const cards: HubCard[] = [
    {
      id: 'crm',
      title: 'Clients & CRM',
      description: 'Client accounts, sites, contacts and contracts',
      primaryPath: '/crm',
      Icon: Building2,
      accentColor: 'bg-blue-500',
      bgGradient: 'bg-blue-50/80 dark:bg-blue-950/30',
      iconBg: 'bg-blue-600',
      metric: { value: metrics?.activeClients ?? '—', label: 'active clients' },
      quickLinks: [
        { path: '/crm',                label: 'CRM Hub',       Icon: Building2 },
        { path: '/client-sites',       label: 'Client Sites',  Icon: MapPin },
        { path: '/client-master-list', label: 'Master List',   Icon: Database },
        { path: '/organizations',      label: 'Organisations', Icon: Users },
        { path: '/crm',                label: 'Contacts',      Icon: UserCheck },
        { path: '/crm',                label: 'Contracts',     Icon: FileText },
      ],
    },
    {
      id: 'services',
      title: 'Services & Dispatch',
      description: 'Dispatch jobs, patrol services and call signs',
      primaryPath: '/dispatch',
      Icon: Radio,
      accentColor: 'bg-green-500',
      bgGradient: 'bg-green-50/80 dark:bg-green-950/30',
      iconBg: 'bg-green-600',
      metric: { value: metrics?.activeJobs ?? '—', label: 'active jobs' },
      quickLinks: [
        { path: '/dispatch',          label: 'Dispatch',       Icon: Radio },
        { path: '/dispatched-jobs',   label: 'Jobs List',      Icon: ClipboardCheck },
        { path: '/dispatch-monitor',  label: 'Monitor',        Icon: Eye },
        { path: '/job-map',           label: 'Job Map',        Icon: Map },
        { path: '/operations-map',    label: 'Ops Map',        Icon: Layers },
        { path: '/site-guard',        label: 'Site Guard',     Icon: Lock },
        { path: '/access-control',    label: 'Access Control', Icon: Lock },
        { path: '/noise-control',     label: 'Noise Control',  Icon: Zap },
        { path: '/parking',           label: 'Parking',        Icon: ParkingSquare },
        { path: '/ems',               label: 'EMS',            Icon: Zap },
      ],
    },
    {
      id: 'roster',
      title: 'Rostering & Workforce',
      description: 'Shifts, timesheets, open shifts and call signs',
      primaryPath: '/roster',
      Icon: CalendarDays,
      accentColor: 'bg-violet-500',
      bgGradient: 'bg-violet-50/80 dark:bg-violet-950/30',
      iconBg: 'bg-violet-600',
      metric: { value: metrics?.todayShifts ?? '—', label: "today's shifts" },
      quickLinks: [
        { path: '/roster',          label: 'Roster Planner',  Icon: CalendarDays },
        { path: '/timesheets',      label: 'Timesheets',      Icon: Clock },
        { path: '/open-shifts',     label: 'Open Shifts',     Icon: CalendarCheck2 },
        { path: '/availability',    label: 'Availability',    Icon: UserCheck },
        { path: '/patrol-schedule', label: 'Patrol Schedule', Icon: Navigation },
        { path: '/patrol-kpis',     label: 'Patrol KPIs',     Icon: TrendingUp },
      ],
    },
    {
      id: 'people',
      title: 'Staff & People',
      description: 'User management, officer welfare and live tracking',
      primaryPath: '/users',
      Icon: Users,
      accentColor: 'bg-orange-500',
      bgGradient: 'bg-orange-50/80 dark:bg-orange-950/30',
      iconBg: 'bg-orange-600',
      metric: { value: metrics?.activePatrols ?? '—', label: 'on patrol now', urgent: (metrics?.welfareAlerts ?? 0) > 0 },
      quickLinks: [
        { path: '/users',              label: 'Users',          Icon: Users },
        { path: '/officer-welfare',    label: 'Welfare',        Icon: Heart, },
        { path: '/live-tracking',      label: 'Live Tracking',  Icon: Navigation },
        { path: '/officer-skills',     label: 'Skills',         Icon: GraduationCap },
        { path: '/person-records',     label: 'Person Records', Icon: Users },
        { path: '/identity-verification', label: 'ID Check',   Icon: Shield },
      ],
    },
    {
      id: 'pricing',
      title: 'Pricing & Invoicing',
      description: 'Per-client service rates, contracts and invoices',
      primaryPath: '/pricing',
      Icon: DollarSign,
      accentColor: 'bg-amber-500',
      bgGradient: 'bg-amber-50/80 dark:bg-amber-950/30',
      iconBg: 'bg-amber-600',
      metric: { value: metrics?.activeContracts ?? '—', label: 'active contracts' },
      quickLinks: [
        { path: '/pricing',   label: 'Service Rates',  Icon: DollarSign },
        { path: '/invoicing', label: 'Invoices',       Icon: Receipt },
        { path: '/crm',       label: 'Contracts',      Icon: FileText },
        { path: '/timesheets',label: 'Timesheets',     Icon: Clock },
      ],
    },
    {
      id: 'compliance',
      title: 'Compliance & Enforcement',
      description: 'Breaches, infringements, notices and disputes',
      primaryPath: '/compliance',
      Icon: Shield,
      accentColor: 'bg-red-500',
      bgGradient: 'bg-red-50/80 dark:bg-red-950/30',
      iconBg: 'bg-red-600',
      metric: {
        value: metrics?.openBreaches ?? '—',
        label: 'open breaches',
        urgent: (metrics?.openBreaches ?? 0) > 0,
      },
      quickLinks: [
        { path: '/compliance',                 label: 'Compliance',    Icon: BarChart3 },
        { path: '/breaches',                   label: 'Breaches',      Icon: AlertTriangle },
        { path: '/enforcement-command-center', label: 'Command',       Icon: Gavel },
        { path: '/infringements',              label: 'Infringements', Icon: Receipt },
        { path: '/disputes',                   label: 'Disputes',      Icon: FileWarning },
        { path: '/breach-notices',             label: 'Notices',       Icon: ScrollText },
        { path: '/notice-to-vacate',           label: 'NTV',           Icon: FileText },
        { path: '/admin/nzscv',                label: 'NZSCV',         Icon: Car },
        { path: '/spatial-compliance',         label: 'Spatial',       Icon: Map },
      ],
    },
    {
      id: 'intelligence',
      title: 'Intelligence & Records',
      description: 'Vehicles, persons, incidents, POIs and investigations',
      primaryPath: '/vehicles',
      Icon: Search,
      accentColor: 'bg-indigo-500',
      bgGradient: 'bg-indigo-50/80 dark:bg-indigo-950/30',
      iconBg: 'bg-indigo-600',
      quickLinks: [
        { path: '/vehicles',               label: 'Vehicles',       Icon: Car },
        { path: '/vehicle-registry',       label: 'Registry',       Icon: Database },
        { path: '/person-records',         label: 'Person Records', Icon: Users },
        { path: '/face-recognition',       label: 'Face Recog.',    Icon: Camera },
        { path: '/points-of-interest',     label: 'POI',            Icon: MapPin },
        { path: '/incidents',              label: 'Incidents',      Icon: Shield },
        { path: '/investigations',         label: 'Investigations', Icon: Search },
        { path: '/observation-records',    label: 'Observations',   Icon: Eye },
        { path: '/site-risk-assessment',   label: 'Risk Assessment',Icon: ClipboardCheck },
      ],
    },
    {
      id: 'reports',
      title: 'Reports & Analytics',
      description: 'Compliance reports, KPIs, AI analysis and audit logs',
      primaryPath: '/reports-hub',
      Icon: FileBarChart,
      accentColor: 'bg-teal-500',
      bgGradient: 'bg-teal-50/80 dark:bg-teal-950/30',
      iconBg: 'bg-teal-600',
      quickLinks: [
        { path: '/reports-hub',          label: 'Reports Hub',     Icon: FileBarChart },
        { path: '/ai-analysis',          label: 'AI Analysis',     Icon: Sparkles },
        { path: '/compliance-analytics', label: 'Analytics',       Icon: PieChart },
        { path: '/patrol-kpis',          label: 'Patrol KPIs',     Icon: TrendingUp },
        { path: '/custom-reports',       label: 'Custom Reports',  Icon: BarChart3 },
        { path: '/audit-log',            label: 'Audit Log',       Icon: ScrollText },
      ],
    },
    {
      id: 'operations',
      title: 'Operations Centre',
      description: 'Live ops dashboard — real-time metrics and patrol monitor',
      primaryPath: '/admin/dashboard',
      Icon: Layout,
      accentColor: 'bg-slate-500',
      bgGradient: 'bg-slate-50/80 dark:bg-slate-900/50',
      iconBg: 'bg-slate-600',
      quickLinks: [
        { path: '/admin/dashboard', label: 'Live Dashboard',  Icon: Activity },
        { path: '/live-patrol',     label: 'Live Patrol',     Icon: Navigation },
        { path: '/live-tracking',   label: 'Officer Tracking',Icon: UserCheck },
        { path: '/dispatch-monitor',label: 'Dispatch Monitor',Icon: Radio },
        { path: '/team-chat',       label: 'Team Chat',       Icon: Radio },
        { path: '/zones',           label: 'Zones',           Icon: MapPin },
      ],
    },
  ]

  const orgLabel = user?.role === 'master'
    ? 'All organisations'
    : user?.full_name ?? user?.email ?? ''

  return (
    <AppLayout
      title="Admin Hub"
      description={`Service Provider Portal · ${orgLabel}`}
    >
      <div className="space-y-5">

        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-[linear-gradient(140deg,#ffffff_0%,#f7fafc_45%,#edf4fb_100%)] px-5 py-5 sm:px-6 sm:py-6 shadow-[0_16px_40px_rgba(15,23,42,0.1)]">
          <div className="pointer-events-none absolute -top-10 -right-12 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-14 left-10 h-40 w-40 rounded-full bg-emerald-200/35 blur-3xl" />

          <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Admin Hub</h1>
              <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                Run operations, enforce compliance, and manage service delivery from one command surface.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(metrics?.welfareAlerts ?? 0) > 0 && (
                <button
                  onClick={() => navigate('/officer-welfare')}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
                >
                  <Heart className="h-3.5 w-3.5" />
                  {metrics!.welfareAlerts} Welfare Alert{metrics!.welfareAlerts > 1 ? 's' : ''}
                </button>
              )}
              {(metrics?.openBreaches ?? 0) > 0 && (
                <Badge
                  variant="destructive"
                  className="cursor-pointer"
                  onClick={() => navigate('/breaches')}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {metrics!.openBreaches} Open Breach{metrics!.openBreaches !== 1 ? 'es' : ''}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs bg-white/70 border-slate-300 text-slate-700">
                <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />
                {metrics?.todayShifts ?? 0} shift{(metrics?.todayShifts ?? 0) !== 1 ? 's' : ''} today
              </Badge>
            </div>
          </div>

          <div className="relative mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Dispatch Load</p>
              <p className="text-lg font-semibold text-slate-900">{metrics?.activeJobs ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Active Patrols</p>
              <p className="text-lg font-semibold text-slate-900">{metrics?.activePatrols ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Client Accounts</p>
              <p className="text-lg font-semibold text-slate-900">{metrics?.activeClients ?? 0}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((card) => (
            <ModuleCard key={card.id} card={card} />
          ))}
        </div>

      </div>
    </AppLayout>
  )
}
