/**
 * ClientOrganisationPortal
 *
 * A read-only portal for client organisation contacts (client_viewer role).
 * Shows guard/patrol activity, compliance scan stats, infringements, KPIs,
 * risk assessments and all sites scoped to their own organisation.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  FileText,
  MapPin,
  Search,
  Shield,
  Building,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  colour = 'blue',
  description,
}: {
  title: string
  value: string | number
  icon: React.ElementType
  colour?: 'blue' | 'green' | 'amber' | 'red' | 'purple'
  description?: string
}) {
  const colourMap = {
    blue:   'bg-blue-50 text-blue-700',
    green:  'bg-green-50 text-green-700',
    amber:  'bg-amber-50 text-amber-700',
    red:    'bg-red-50 text-red-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {description && <p className="text-xs text-gray-400 mt-1">{description}</p>}
          </div>
          <div className={`p-3 rounded-full ${colourMap[colour]}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientOrganisationPortal() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const [searchTerm, setSearchTerm] = useState('')

  // ── Organisation details ─────────────────────────────────────────────────

  const { data: organisation } = useQuery({
    queryKey: ['client-org', orgId],
    queryFn: async () => {
      if (!orgId) return null
      const { data, error } = await (supabase.from('organizations') as any)
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

      const [scansResult, breachesResult, patrolsResult, enforcementResult, sitesResult] = await Promise.all([
        (supabase.from('observations') as any)
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId),
        (supabase.from('breach_alerts') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'open'),
        (supabase.from('patrols') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
        (supabase.from('enforcement_actions') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        (supabase.from('client_sites') as any)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_active', true),
      ])

      return {
        totalScans:       scansResult.count ?? 0,
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
      const { data, error } = await (supabase.from('patrols') as any)
        .select(`
          id, status, patrol_date, shift, created_at, updated_at,
          zone:zones(name),
          officer:user_profiles(first_name, last_name)
        `)
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
      const { data, error } = await (supabase.from('breach_alerts') as any)
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
      const { data, error } = await (supabase.from('enforcement_actions') as any)
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
      const { data, error } = await (supabase.from('zones') as any)
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
      const { data, error } = await (supabase.from('client_sites') as any)
        .select(`
          id, name, site_code, site_type, address, city,
          gps_lat, gps_lng, contact_name, contact_phone, contact_email,
          emergency_contact_name, emergency_contact_phone,
          notes, is_active
        `)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Filtered searches ────────────────────────────────────────────────────

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2Icon className="h-6 w-6 text-purple-600" />
              {organisation?.name ?? 'Client Organisation Portal'}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Read-only view of guard activity, compliance and enforcement for your organisation
            </p>
          </div>
          <Badge variant="outline" className="bg-purple-50 text-purple-700">
            Client Viewer
          </Badge>
        </div>

        {/* KPI summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Total Vehicle Scans"
            value={stats?.totalScans ?? '—'}
            icon={Car}
            colour="blue"
            description="All time"
          />
          <StatCard
            title="Open Breaches"
            value={stats?.openBreaches ?? '—'}
            icon={AlertTriangle}
            colour={stats?.openBreaches ? 'red' : 'green'}
            description="Awaiting action"
          />
          <StatCard
            title="Patrols (30 days)"
            value={stats?.patrolsThisMonth ?? '—'}
            icon={Shield}
            colour="green"
          />
          <StatCard
            title="Enforcement Actions"
            value={stats?.enforcementTotal ?? '—'}
            icon={FileText}
            colour="amber"
            description="All time"
          />
          <StatCard
            title="Active Sites"
            value={(stats?.activeSites ?? clientSites.length) || '—'}
            icon={Building}
            colour="purple"
            description="Service locations"
          />
        </div>

        {/* Search bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search patrols, plates, zones…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="patrols">
          <TabsList>
            <TabsTrigger value="patrols">
              <Shield className="h-4 w-4 mr-1.5" />
              Patrols
            </TabsTrigger>
            <TabsTrigger value="breaches">
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              Breaches
            </TabsTrigger>
            <TabsTrigger value="enforcement">
              <FileText className="h-4 w-4 mr-1.5" />
              Enforcement
            </TabsTrigger>
            <TabsTrigger value="zones">
              <MapPin className="h-4 w-4 mr-1.5" />
              Zones
            </TabsTrigger>
            <TabsTrigger value="sites">
              <Building className="h-4 w-4 mr-1.5" />
              Sites
              {clientSites.length > 0 && (
                <span className="ml-1 bg-purple-100 text-purple-700 text-xs px-1.5 rounded-full">
                  {clientSites.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Patrols tab ─────────────────────────────────────────────── */}
          <TabsContent value="patrols" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Guard Patrols</CardTitle>
                <CardDescription>Guard patrol activity for your area</CardDescription>
              </CardHeader>
              <CardContent>
                {filteredPatrols.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No patrols found.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredPatrols.map((patrol: any) => (
                      <div
                        key={patrol.id}
                        className="flex items-center justify-between p-3 border rounded-lg text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${
                            patrol.status === 'active'    ? 'bg-green-500' :
                            patrol.status === 'completed' ? 'bg-blue-500'  : 'bg-gray-400'
                          }`} />
                          <div>
                            <p className="font-medium">{patrol.zone?.name ?? 'Unknown zone'}</p>
                            <p className="text-xs text-gray-500">
                              {patrol.officer
                                ? `${patrol.officer.first_name} ${patrol.officer.last_name}`
                                : 'Officer unknown'
                              } · {patrol.shift} shift
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline" className="text-xs capitalize">
                            {patrol.status}
                          </Badge>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDateTime(patrol.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Breaches tab ─────────────────────────────────────────────── */}
          <TabsContent value="breaches" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breach Alerts</CardTitle>
                <CardDescription>Vehicles detected in breach of freedom camping rules</CardDescription>
              </CardHeader>
              <CardContent>
                {filteredBreaches.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No breach alerts found.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredBreaches.map((breach: any) => (
                      <div
                        key={breach.id}
                        className="flex items-center justify-between p-3 border rounded-lg text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <AlertTriangle className={`h-4 w-4 ${
                            breach.status === 'open' ? 'text-red-500' : 'text-gray-400'
                          }`} />
                          <div>
                            <p className="font-medium font-mono">{breach.plate_number ?? '—'}</p>
                            <p className="text-xs text-gray-500 capitalize">
                              {breach.breach_type?.replace(/_/g, ' ')} · {breach.zone?.name}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge
                            variant="outline"
                            className={`text-xs capitalize ${
                              breach.status === 'open'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-gray-50 text-gray-600'
                            }`}
                          >
                            {breach.status}
                          </Badge>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDateTime(breach.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Enforcement tab ──────────────────────────────────────────── */}
          <TabsContent value="enforcement" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Enforcement Actions</CardTitle>
                <CardDescription>Notices, warnings and infringements issued in your area</CardDescription>
              </CardHeader>
              <CardContent>
                {filteredEnforcement.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No enforcement actions found.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredEnforcement.map((action: any) => (
                      <div
                        key={action.id}
                        className="flex items-center justify-between p-3 border rounded-lg text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-4 w-4 text-amber-500" />
                          <div>
                            <p className="font-medium font-mono">{action.plate_number ?? '—'}</p>
                            <p className="text-xs text-gray-500 capitalize">
                              {action.action_type?.replace(/_/g, ' ')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline" className="text-xs capitalize">
                            {action.status}
                          </Badge>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDateTime(action.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Zones tab ────────────────────────────────────────────────── */}
          <TabsContent value="zones" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Monitored Zones & Areas</CardTitle>
                <CardDescription>Freedom camping zones, parks and property areas in your jurisdiction</CardDescription>
              </CardHeader>
              <CardContent>
                {zones.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No active zones configured.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {zones.map((zone: any) => (
                      <div key={zone.id} className="flex items-center gap-3 p-3 border rounded-lg text-sm">
                        <MapPin className="h-4 w-4 text-purple-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{zone.name}</p>
                          <p className="text-xs text-gray-500 capitalize">
                            {zone.zone_type?.replace(/_/g, ' ') ?? 'zone'}
                            {zone.nights_per_month
                              ? ` · Max ${zone.nights_per_month} nights/month`
                              : ''}
                          </p>
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Sites tab ────────────────────────────────────────────────── */}
          <TabsContent value="sites" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building className="h-4 w-4 text-purple-600" />
                  Service Locations
                  {clientSites.length > 0 && (
                    <Badge variant="outline" className="ml-1 text-xs">
                      {clientSites.length} {clientSites.length === 1 ? 'site' : 'sites'}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  All sites and properties your organisation has with First Security
                </CardDescription>
              </CardHeader>
              <CardContent>
                {clientSites.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No sites configured.</p>
                ) : (
                  <div className="space-y-3">
                    {clientSites
                      .filter((s: any) => {
                        if (!searchTerm) return true
                        const q = searchTerm.toLowerCase()
                        return (
                          s.name?.toLowerCase().includes(q) ||
                          s.city?.toLowerCase().includes(q) ||
                          s.address?.toLowerCase().includes(q) ||
                          s.site_code?.toLowerCase().includes(q)
                        )
                      })
                      .map((site: any) => (
                        <div
                          key={site.id}
                          className="border rounded-lg p-4 space-y-2 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              <Building className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="font-semibold">{site.name}</p>
                                {site.site_code && (
                                  <p className="text-xs font-mono text-gray-400">{site.site_code}</p>
                                )}
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-xs capitalize flex-shrink-0"
                            >
                              {site.site_type?.replace(/_/g, ' ') ?? 'general'}
                            </Badge>
                          </div>

                          {/* Address */}
                          {(site.address || site.city) && (
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {[site.address, site.city].filter(Boolean).join(', ')}
                            </p>
                          )}

                          {/* Notes */}
                          {site.notes && (
                            <p className="text-xs text-gray-500 border-l-2 border-gray-200 pl-2">
                              {site.notes}
                            </p>
                          )}

                          {/* Contacts */}
                          {(site.contact_name || site.contact_phone) && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 pt-1 border-t">
                              {site.contact_name && (
                                <span>📋 {site.contact_name}</span>
                              )}
                              {site.contact_phone && (
                                <span>📞 {site.contact_phone}</span>
                              )}
                              {site.emergency_contact_name && (
                                <span className="text-red-600">
                                  🚨 Emergency: {site.emergency_contact_name}
                                  {site.emergency_contact_phone
                                    ? ` · ${site.emergency_contact_phone}`
                                    : ''}
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

// Inline icon to avoid import collision with lucide Building2
function Building2Icon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v8h4" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11h-4" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  )
}
