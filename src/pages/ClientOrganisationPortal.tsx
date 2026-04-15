/**
 * ClientOrganisationPortal
 *
 * A read-only portal for client organisation contacts (client_viewer role).
 * Shows guard/patrol activity, compliance scan stats, infringements, KPIs,
 * risk assessments and all sites scoped to their own organisation.
 *
 * UX inspired by: Lighthouse IO (KPI tiles), Rapid Global (RAG status),
 * GDS CATS (clean accessible tables), Deputy (activity feed).
 *
 * Enhanced with card-based navigation hub at the top.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Car,
  CheckCircle2,
  FileText,
  MapPin,
  Search,
  Shield,
  Users,
  Activity,
  Clock,
  TrendingUp,
  Phone,
  ChevronRight,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

// ─── Client hub card ──────────────────────────────────────────────────────────

function ClientModuleCard({
  title,
  description,
  Icon,
  accentColor,
  bgGradient,
  iconBg,
  metric,
  onClick,
  active,
}: {
  title: string
  description: string
  Icon: React.ElementType
  accentColor: string
  bgGradient: string
  iconBg: string
  metric?: { value: string | number; label: string; urgent?: boolean }
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left w-full rounded-xl overflow-hidden border-2 transition-all ${
        active
          ? 'border-purple-400 dark:border-purple-500 shadow-md'
          : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-md'
      } ${bgGradient}`}
    >
      <div className={`h-1 w-full ${accentColor}`} />
      <div className="p-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-2 rounded-lg ${iconBg} shrink-0`}>
            <Icon className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{title}</p>
            <p className="text-[11px] text-muted-foreground truncate">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {metric && (
            <div className="text-right">
              <p className={`text-lg font-bold leading-tight ${metric.urgent ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}>
                {metric.value}
              </p>
            </div>
          )}
          <ChevronRight className={`h-4 w-4 ${active ? 'text-purple-500' : 'text-gray-400'}`} />
        </div>
      </div>
    </button>
  )
}

// ─── RAG status helper — Rapid Global inspired ───────────────────────────────

// Shared thresholds — aligned with AdminPortal ragStatus logic for consistency
const RAG_GREEN_COMPLIANCE = 80  // % compliance rate required for green
const RAG_AMBER_COMPLIANCE = 60  // % compliance rate for amber (below = red)
const RAG_GREEN_MAX_BREACHES = 5  // max open breaches for green
const RAG_AMBER_MAX_BREACHES = 20 // max open breaches for amber (above = red)

function getRAGStatus(complianceRate: number | null, openBreaches: number): 'green' | 'amber' | 'red' {
  if (complianceRate === null) return 'amber'
  if (complianceRate >= RAG_GREEN_COMPLIANCE && openBreaches < RAG_GREEN_MAX_BREACHES) return 'green'
  if (complianceRate >= RAG_AMBER_COMPLIANCE && openBreaches <= RAG_AMBER_MAX_BREACHES) return 'amber'
  return 'red'
}

const RAG_STYLES = {
  green: { badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500', label: 'Compliant', banner: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200' },
  amber: { badge: 'bg-amber-100 text-amber-700 border-amber-300',       dot: 'bg-amber-500',   label: 'Attention Required', banner: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200' },
  red:   { badge: 'bg-red-100 text-red-700 border-red-300',             dot: 'bg-red-500 animate-pulse', label: 'Action Required', banner: 'bg-red-50 dark:bg-red-950/20 border-red-200' },
}

// ─── Stat card component — Lighthouse IO inspired ────────────────────────────

function StatCard({ title, value, icon: Icon, colour = 'blue', description, onClick }: {
  title: string
  value: string | number
  icon: React.ElementType
  colour?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate'
  description?: string
  onClick?: () => void
}) {
  const styles = {
    blue:   { icon: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',   value: 'text-blue-900 dark:text-blue-100' },
    green:  { icon: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', value: 'text-emerald-900 dark:text-emerald-100' },
    amber:  { icon: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', value: 'text-amber-900 dark:text-amber-100' },
    red:    { icon: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',       value: 'text-red-900 dark:text-red-100' },
    purple: { icon: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300', value: 'text-purple-900 dark:text-purple-100' },
    slate:  { icon: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',  value: 'text-slate-900 dark:text-slate-100' },
  }
  const s = styles[colour]
  return (
    <Card
      className={`bg-white dark:bg-gray-900 shadow-sm transition-shadow ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{title}</p>
            <p className={`text-3xl font-bold leading-tight ${s.value}`}>{value}</p>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
          <div className={`p-2.5 rounded-xl shrink-0 ${s.icon}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientOrganisationPortal() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const orgId = user?.organization_id
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('patrols')

  // ── Organisation details ─────────────────────────────────────────────────

  const { data: organisation } = useQuery({
    queryKey: ['client-org', orgId],
    queryFn: async () => {
      if (!orgId) return null
      const { data, error } = await ((supabase as any).from('organizations') as any)
        .select('id, name, organization_type, contact_email, contact_phone, is_active')
        .eq('id', orgId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!orgId,
  })

  // ── Summary stats ────────────────────────────────────────────────────────

  const { data: stats } = useQuery({
    queryKey: ['client-portal-stats', orgId],
    queryFn: async () => {
      if (!orgId) return null

      const [scansResult, compliantResult, breachesResult, patrolsResult, enforcementResult, sitesResult] = await Promise.all([
        ((supabase as any).from('observations') as any)
          .select('observation_id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        ((supabase as any).from('observations') as any)
          .select('observation_id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_compliant', true),
        ((supabase as any).from('breach_alerts') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .in('status', ['pending', 'acknowledged', 'enforcement_started']),
        ((supabase as any).from('patrols') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
        ((supabase as any).from('enforcement_actions') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        ((supabase as any).from('client_sites') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_active', true),
      ])

      const total = scansResult.count ?? 0
      const compliant = compliantResult.count ?? 0
      const complianceRate = total > 0 ? Math.round((compliant / total) * 100) : null

      return {
        totalScans:       total,
        complianceRate,
        openBreaches:     breachesResult.count ?? 0,
        patrolsThisMonth: patrolsResult.count ?? 0,
        enforcementTotal: enforcementResult.count ?? 0,
        activeSites:      sitesResult.count ?? 0,
      }
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
  })

  // ── Recent patrols ───────────────────────────────────────────────────────

  const { data: recentPatrols = [] } = useQuery({
    queryKey: ['client-portal-patrols', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await ((supabase as any).from('patrols') as any)
        .select(`id, status, patrol_date, shift, created_at, updated_at, vehicles_checked, breaches_found,
          zone:zones(name),
          officer:user_profiles(first_name, last_name)`)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Recent breach alerts ─────────────────────────────────────────────────

  const { data: breachAlerts = [] } = useQuery({
    queryKey: ['client-portal-breaches', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await ((supabase as any).from('breach_alerts') as any)
        .select('id, status, breach_type, plate_number, created_at, zone:zones(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Recent enforcement actions ────────────────────────────────────────────

  const { data: enforcementActions = [] } = useQuery({
    queryKey: ['client-portal-enforcement', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await ((supabase as any).from('enforcement_actions') as any)
        .select('id, action_type, plate_number, status, created_at, notes')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Zones / areas ────────────────────────────────────────────────────────

  const { data: zones = [] } = useQuery({
    queryKey: ['client-portal-zones', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await ((supabase as any).from('zones') as any)
        .select('id, name, zone_type, is_active, nights_per_month, max_consecutive_nights')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Client sites (multi-site orgs) ───────────────────────────────────────

  const { data: clientSites = [] } = useQuery({
    queryKey: ['client-portal-sites', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await ((supabase as any).from('client_sites') as any)
        .select(`id, name, site_code, site_type, address, city,
          gps_lat, gps_lng, contact_name, contact_phone, contact_email,
          emergency_contact_name, emergency_contact_phone, notes, is_active`)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived values ───────────────────────────────────────────────────────

  const ragStatus = getRAGStatus(stats?.complianceRate ?? null, stats?.openBreaches ?? 0)
  const ragStyle = RAG_STYLES[ragStatus]

  const filteredPatrols = recentPatrols.filter((p: any) => {
    if (!searchTerm) return true
    const q = searchTerm.toLowerCase()
    return (
      p.zone?.name?.toLowerCase().includes(q) ||
      p.status?.toLowerCase().includes(q) ||
      `${p.officer?.first_name} ${p.officer?.last_name}`.toLowerCase().includes(q)
    )
  })

  const filteredBreaches = breachAlerts.filter((b: any) => {
    if (!searchTerm) return true
    const q = searchTerm.toLowerCase()
    return (
      b.plate_number?.toLowerCase().includes(q) ||
      b.breach_type?.toLowerCase().includes(q) ||
      b.zone?.name?.toLowerCase().includes(q)
    )
  })

  const filteredEnforcement = enforcementActions.filter((e: any) => {
    if (!searchTerm) return true
    const q = searchTerm.toLowerCase()
    return (
      e.plate_number?.toLowerCase().includes(q) ||
      e.action_type?.toLowerCase().includes(q) ||
      e.status?.toLowerCase().includes(q)
    )
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40">
              <Building2 className="h-6 w-6 text-purple-700 dark:text-purple-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {organisation?.name ?? 'Client Portal'}
              </h1>
              <p className="text-sm text-muted-foreground">
                Guard activity, compliance & enforcement overview
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${ragStyle.badge}`}>
              <span className={`h-2 w-2 rounded-full ${ragStyle.dot}`} />
              {ragStyle.label}
            </span>
            <Badge variant="outline" className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300">
              Client Viewer
            </Badge>
          </div>
        </div>

        {/* ── RAG Status Banner — Rapid Global inspired ───────────────────── */}
        <div className={`rounded-xl border px-4 py-3 ${ragStyle.banner}`}>
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${ragStyle.dot}`} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold">
                {ragStatus === 'green' && 'All compliance checks passing'}
                {ragStatus === 'amber' && 'Some items require your attention'}
                {ragStatus === 'red'   && 'Compliance action required — open breaches detected'}
              </span>
              {stats && (
                <span className="text-xs text-muted-foreground ml-2">
                  {stats.complianceRate !== null ? `${stats.complianceRate}% compliance rate` : 'Calculating…'}
                  {stats.openBreaches > 0 && ` · ${stats.openBreaches} open breach${stats.openBreaches > 1 ? 'es' : ''}`}
                </span>
              )}
            </div>
            {stats?.openBreaches > 0 && (
              <Button size="sm" variant="outline" className="shrink-0 text-xs h-7 gap-1" onClick={() => navigate('/breaches')}>
                View Breaches <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* ── Module card hub ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            {
              id: 'patrols',
              title: 'Patrol Activity',
              description: 'Guard tours & check-ins',
              Icon: Shield,
              accentColor: 'bg-green-500',
              bgGradient: 'bg-green-50/80 dark:bg-green-950/30',
              iconBg: 'bg-green-600',
              metric: { value: stats?.patrolsThisMonth ?? '—', label: 'patrols (30d)' },
            },
            {
              id: 'breaches',
              title: 'Compliance',
              description: 'Breaches & alerts',
              Icon: AlertTriangle,
              accentColor: 'bg-red-500',
              bgGradient: 'bg-red-50/80 dark:bg-red-950/30',
              iconBg: 'bg-red-600',
              metric: { value: stats?.openBreaches ?? '—', label: 'open breaches', urgent: (stats?.openBreaches ?? 0) > 0 },
            },
            {
              id: 'enforcement',
              title: 'Enforcement',
              description: 'Notices & infringements',
              Icon: FileText,
              accentColor: 'bg-amber-500',
              bgGradient: 'bg-amber-50/80 dark:bg-amber-950/30',
              iconBg: 'bg-amber-600',
              metric: { value: stats?.enforcementTotal ?? '—', label: 'actions total' },
            },
            {
              id: 'zones',
              title: 'Zones',
              description: 'Monitored areas',
              Icon: MapPin,
              accentColor: 'bg-purple-500',
              bgGradient: 'bg-purple-50/80 dark:bg-purple-950/30',
              iconBg: 'bg-purple-600',
              metric: { value: zones.length || '—', label: 'active zones' },
            },
            {
              id: 'sites',
              title: 'Sites',
              description: 'Service locations',
              Icon: Building2,
              accentColor: 'bg-blue-500',
              bgGradient: 'bg-blue-50/80 dark:bg-blue-950/30',
              iconBg: 'bg-blue-600',
              metric: { value: (stats?.activeSites ?? clientSites.length) || '—', label: 'active sites' },
            },
          ].map((card) => (
            <ClientModuleCard
              key={card.id}
              title={card.title}
              description={card.description}
              Icon={card.Icon}
              accentColor={card.accentColor}
              bgGradient={card.bgGradient}
              iconBg={card.iconBg}
              metric={card.metric}
              active={activeTab === card.id}
              onClick={() => setActiveTab(card.id)}
            />
          ))}
        </div>

        {/* ── KPI Stats Grid — Lighthouse IO inspired ─────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            title="Compliance Rate"
            value={stats?.complianceRate !== null && stats?.complianceRate !== undefined ? `${stats.complianceRate}%` : '—'}
            icon={TrendingUp}
            colour={ragStatus === 'green' ? 'green' : ragStatus === 'amber' ? 'amber' : 'red'}
            description="Based on all scans"
          />
          <StatCard
            title="Vehicle Scans"
            value={stats?.totalScans ?? '—'}
            icon={Car}
            colour="blue"
            description="All time total"
          />
          <StatCard
            title="Open Breaches"
            value={stats?.openBreaches ?? '—'}
            icon={AlertTriangle}
            colour={stats?.openBreaches ? 'red' : 'green'}
            description="Awaiting action"
          />
          <StatCard
            title="Patrols (30d)"
            value={stats?.patrolsThisMonth ?? '—'}
            icon={Shield}
            colour="green"
            description="Last 30 days"
          />
          <StatCard
            title="Enforcement"
            value={stats?.enforcementTotal ?? '—'}
            icon={FileText}
            colour="amber"
            description="All time"
          />
          <StatCard
            title="Active Sites"
            value={(stats?.activeSites ?? clientSites.length) || '—'}
            icon={Building2}
            colour="purple"
            description="Service locations"
          />
        </div>

        {/* ── Search bar ──────────────────────────────────────────────────── */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search patrols, plates, zones…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* ── Tabs — GDS CATS / Lighthouse IO inspired ─────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-5 w-full max-w-2xl">
            <TabsTrigger value="patrols" className="gap-1.5 text-xs">
              <Shield className="h-3.5 w-3.5" />
              Patrols
            </TabsTrigger>
            <TabsTrigger value="breaches" className="gap-1.5 text-xs">
              <AlertTriangle className="h-3.5 w-3.5" />
              Breaches
              {filteredBreaches.filter((b: any) => b.status === 'pending' || b.status === 'open').length > 0 && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {filteredBreaches.filter((b: any) => b.status === 'pending' || b.status === 'open').length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="enforcement" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" />
              Enforcement
            </TabsTrigger>
            <TabsTrigger value="zones" className="gap-1.5 text-xs">
              <MapPin className="h-3.5 w-3.5" />
              Zones
            </TabsTrigger>
            <TabsTrigger value="sites" className="gap-1.5 text-xs">
              <Building2 className="h-3.5 w-3.5" />
              Sites
            </TabsTrigger>
          </TabsList>

          {/* Patrols tab */}
          <TabsContent value="patrols" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-green-600" />
                  Guard Patrol Activity
                </CardTitle>
                <CardDescription className="text-xs">Recent patrol sessions logged by your security team</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {filteredPatrols.length === 0 ? (
                  <div className="py-8 text-center">
                    <Shield className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No patrols found.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredPatrols.map((p: any) => {
                      const officerName = p.officer ? `${p.officer.first_name ?? ''} ${p.officer.last_name ?? ''}`.trim() : 'Unknown officer'
                      const statusStyle = p.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : p.status === 'in_progress'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                      return (
                        <div key={p.id} className="flex items-center justify-between py-2.5 gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 px-1 rounded-md transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`p-1.5 rounded-lg shrink-0 ${p.status === 'in_progress' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-green-100 dark:bg-green-900/40'}`}>
                              <Shield className={`h-3.5 w-3.5 ${p.status === 'in_progress' ? 'text-blue-600' : 'text-green-600'}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{p.zone?.name ?? 'Unknown zone'}</p>
                              <p className="text-xs text-muted-foreground">{officerName} · {formatDateTime(p.created_at)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {p.vehicles_checked > 0 && (
                              <span className="text-xs text-muted-foreground">{p.vehicles_checked} scans</span>
                            )}
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusStyle}`}>{p.status}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Breaches tab */}
          <TabsContent value="breaches" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  Breach Alerts
                </CardTitle>
                <CardDescription className="text-xs">Compliance breaches detected in your monitored zones</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {filteredBreaches.length === 0 ? (
                  <div className="py-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No breach alerts found.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredBreaches.map((b: any) => {
                      const isPending = b.status === 'pending' || b.status === 'open'
                      return (
                        <div key={b.id} className="flex items-center justify-between py-2.5 gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 px-1 rounded-md transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`p-1.5 rounded-lg shrink-0 ${isPending ? 'bg-red-100 dark:bg-red-900/40' : 'bg-gray-100 dark:bg-gray-800'}`}>
                              <AlertTriangle className={`h-3.5 w-3.5 ${isPending ? 'text-red-600' : 'text-gray-500'}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-mono font-semibold truncate">{b.plate_number ?? '—'}</p>
                              <p className="text-xs text-muted-foreground">{b.zone?.name ?? 'Unknown zone'} · {b.breach_type?.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${isPending ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{b.status}</span>
                            <span className="text-xs text-muted-foreground">{formatDateTime(b.created_at)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Enforcement tab */}
          <TabsContent value="enforcement" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-600" />
                  Enforcement Actions
                </CardTitle>
                <CardDescription className="text-xs">Notices, warnings and infringements issued in your area</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {filteredEnforcement.length === 0 ? (
                  <div className="py-8 text-center">
                    <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No enforcement actions found.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredEnforcement.map((action: any) => (
                      <div key={action.id} className="flex items-center justify-between py-2.5 gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 px-1 rounded-md transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
                            <FileText className="h-3.5 w-3.5 text-amber-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-mono font-semibold truncate">{action.plate_number ?? '—'}</p>
                            <p className="text-xs text-muted-foreground capitalize">{action.action_type?.replace(/_/g, ' ')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-xs capitalize">{action.status}</Badge>
                          <span className="text-xs text-muted-foreground">{formatDateTime(action.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Zones tab */}
          <TabsContent value="zones" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-purple-600" />
                  Monitored Zones & Areas
                </CardTitle>
                <CardDescription className="text-xs">Freedom camping zones, parks and property areas in your jurisdiction</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {zones.length === 0 ? (
                  <div className="py-8 text-center">
                    <MapPin className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No active zones configured.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {zones.map((zone: any) => (
                      <div key={zone.id} className="flex items-start gap-3 p-3 border rounded-xl bg-gray-50 dark:bg-gray-800/40 dark:border-gray-700 hover:border-purple-200 dark:hover:border-purple-700 transition-colors">
                        <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 shrink-0">
                          <MapPin className="h-3.5 w-3.5 text-purple-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{zone.name}</p>
                          <p className="text-xs text-muted-foreground capitalize mt-0.5">
                            {zone.zone_type?.replace(/_/g, ' ') ?? 'zone'}
                            {zone.nights_per_month ? ` · Max ${zone.nights_per_month} nights/month` : ''}
                          </p>
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sites tab */}
          <TabsContent value="sites" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-purple-600" />
                  Service Locations
                  {clientSites.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">{clientSites.length} site{clientSites.length !== 1 ? 's' : ''}</Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">All sites and properties your organisation has with us</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {clientSites.length === 0 ? (
                  <div className="py-8 text-center">
                    <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No sites configured.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {clientSites
                      .filter((s: any) => {
                        if (!searchTerm) return true
                        const q = searchTerm.toLowerCase()
                        return s.name?.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q) || s.address?.toLowerCase().includes(q) || s.site_code?.toLowerCase().includes(q)
                      })
                      .map((site: any) => (
                        <div key={site.id} className="border rounded-xl p-4 bg-gray-50 dark:bg-gray-800/40 dark:border-gray-700 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5">
                              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 shrink-0">
                                <Building2 className="h-3.5 w-3.5 text-purple-600" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{site.name}</p>
                                {site.site_code && <p className="text-xs font-mono text-muted-foreground">{site.site_code}</p>}
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs capitalize shrink-0">{site.site_type?.replace(/_/g, ' ') ?? 'general'}</Badge>
                          </div>
                          {(site.address || site.city) && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {[site.address, site.city].filter(Boolean).join(', ')}
                            </p>
                          )}
                          {site.notes && (
                            <p className="text-xs text-muted-foreground border-l-2 border-gray-200 dark:border-gray-600 pl-2">{site.notes}</p>
                          )}
                          {(site.contact_name || site.contact_phone || site.emergency_contact_name) && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t dark:border-gray-700">
                              {site.contact_name && <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" />{site.contact_name}</span>}
                              {site.contact_phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{site.contact_phone}</span>}
                              {site.emergency_contact_name && (
                                <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                                  🚨 {site.emergency_contact_name}{site.emergency_contact_phone ? ` · ${site.emergency_contact_phone}` : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </AppLayout>
  )
}
