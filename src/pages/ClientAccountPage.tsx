/**
 * ClientAccountPage – CRM Account detail for a client organisation.
 *
 * Sections:
 *  1. Account Information  – contact, address, contract dates
 *  2. Client Sites         – all sites belonging to this client org
 *  3. Recent Shifts        – roster shifts scheduled at this client's sites
 *  4. Notes                – free-text notes field
 *
 * Reached from CRMModule when clicking a "client" org card.
 * Route: /crm/client/:orgId
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Building2, Phone, Mail, ChevronDown, ChevronUp, Edit2,
  Save, X, MapPin, Calendar, Clock, ArrowLeft, Users, DollarSign,
  CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientOrg {
  id: string
  name: string
  organization_type: string
  organization_level: number
  is_active: boolean
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  parent: { name: string } | null
}

interface ClientSite {
  id: string
  zone_id: string | null
  loi_id: string | null
  name: string
  site_code: string | null
  site_type: string
  address: string | null
  city: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  contract_start_date: string | null
  contract_end_date: string | null
  default_response_minutes: number
  default_pay_rate: number | null
  default_charge_rate: number | null
  is_active: boolean
  zone: { name: string } | null
}

interface ClientZone {
  id: string
  name: string
  zone_type: string
  is_active: boolean
  loi_id: string | null
}

interface LocationOfInterestRow {
  id: string
  name?: string | null
  loi_kind?: string | null
  address_full?: string | null
  display_address?: string | null
  suburb?: string | null
  city?: string | null
  is_active?: boolean
}

interface RecentShift {
  id: string
  shift_date: string
  shift_type: string
  start_time: string | null
  end_time: string | null
  status: string
  guard_cost_rate: number | null
  client_charge_rate: number | null
  officer: { first_name: string; last_name: string } | null
  site: { name: string } | null
}

interface OperationsSnapshot {
  activeSites: number
  inactiveSites: number
  linkedZones: number
  activeZones: number
  configuredRateSites: number
  contacts: number
  activePatrolRoutes: number
  scheduledPatrols: number
  upcomingRosterShifts: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-600',
  published:  'bg-blue-100 text-blue-700',
  confirmed:  'bg-green-100 text-green-700',
  completed:  'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-600',
}

const SITE_TYPE_LABELS: Record<string, string> = {
  general:        'General',
  freedom_camping:'Freedom Camping',
  guarding:       'Guarding Post',
  patrol:         'Patrol Site',
  parking:        'Parking',
  noise_control:  'Noise Control',
  event:          'Event Site',
  infrastructure: 'Infrastructure',
  commercial:     'Commercial',
}

function Section({
  title, open, toggle, children,
}: {
  title: string; open: boolean; toggle: () => void; children: React.ReactNode
}) {
  return (
    <Card className="mb-4">
      <CardHeader
        className="cursor-pointer select-none py-3 px-4"
        onClick={toggle}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0 px-4 pb-4">{children}</CardContent>}
    </Card>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClientAccountPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const [secAccount, setSecAccount] = useState(true)
  const [secSites,   setSecSites]   = useState(true)
  const [secZones, setSecZones] = useState(true)
  const [secLocations, setSecLocations] = useState(true)
  const [secControlCenter, setSecControlCenter] = useState(true)
  const [secOperations, setSecOperations] = useState(true)
  const [secShifts,  setSecShifts]  = useState(false)

  const [editingContact, setEditingContact] = useState(false)
  const [contactForm, setContactForm] = useState<Partial<ClientOrg>>({})

  const canEdit = ['grand_master', 'master', 'admin', 'admin_officer'].includes(user?.role ?? '')

  // ── Org access guard — prevent URL-spoofed orgId from leaking data ──────────
  const { orgIds, isLoading: orgIdsLoading } = useClientOrgIds()
  useEffect(() => {
    if (orgIdsLoading || !orgId) return
    // null = grand_master (unrestricted); otherwise verify orgId is in allowed set
    if (orgIds !== null && !orgIds.includes(orgId)) {
      navigate('/crm', { replace: true })
    }
  }, [orgId, orgIds, orgIdsLoading, navigate])

  // ── Organisation ──────────────────────────────────────────────────────────

  const { data: org, isLoading: orgLoading } = useQuery<ClientOrg | null>({
    queryKey: ['crm_client_org', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id, name, organization_type, organization_level, is_active, contact_email, contact_phone, notes, parent:organizations!parent_organization_id(name)')
        .eq('id', orgId)
        .single()
      if (error) throw error
      const d = data as any
      return {
        ...d,
        parent: Array.isArray(d.parent) ? (d.parent[0] ?? null) : d.parent,
      } as ClientOrg
    },
    enabled: !!orgId,
  })

  // ── Client sites ──────────────────────────────────────────────────────────

  const { data: sites = [], isLoading: sitesLoading } = useQuery<ClientSite[]>({
    queryKey: ['crm_client_sites', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('client_sites')
        .select('id, zone_id, loi_id, name, site_code, site_type, address, city, contact_name, contact_phone, contact_email, contract_start_date, contract_end_date, default_response_minutes, default_pay_rate, default_charge_rate, is_active, zone:zones!zone_id(name)')
        .eq('organization_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []).map((s: any) => ({
        ...s,
        zone: Array.isArray(s.zone) ? (s.zone[0] ?? null) : s.zone,
      })) as ClientSite[]
    },
    enabled: !!orgId,
  })

  const { data: zones = [], isLoading: zonesLoading } = useQuery<ClientZone[]>({
    queryKey: ['crm_client_zones', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('zones')
        .select('id, name, zone_type, is_active, loi_id')
        .eq('organization_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []) as ClientZone[]
    },
    enabled: !!orgId,
  })

  const { data: locations = [], isLoading: locationsLoading } = useQuery<LocationOfInterestRow[]>({
    queryKey: ['crm_client_loi', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('locations_of_interest')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LocationOfInterestRow[]
    },
    enabled: !!orgId,
  })

  // ── Recent shifts ─────────────────────────────────────────────────────────

  const { data: recentShifts = [], isLoading: shiftsLoading } = useQuery<RecentShift[]>({
    queryKey: ['crm_client_shifts', orgId],
    queryFn: async () => {
      // Get site IDs for this org first
      const { data: siteData, error: siteErr } = await (supabase as any)
        .from('client_sites')
        .select('id')
        .eq('organization_id', orgId)
      if (siteErr) throw siteErr
      const siteIds = (siteData ?? []).map((s: any) => s.id)
      if (siteIds.length === 0) return []

      const { data, error } = await (supabase as any)
        .from('roster_shifts')
        .select(`
          id, shift_date, shift_type, start_time, end_time, status,
          guard_cost_rate, client_charge_rate,
          officer:user_profiles!officer_id(first_name, last_name),
          site:client_sites!client_site_id(name)
        `)
        .in('client_site_id', siteIds)
        .order('shift_date', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []).map((s: any) => ({
        ...s,
        officer: Array.isArray(s.officer) ? (s.officer[0] ?? null) : s.officer,
        site:    Array.isArray(s.site)    ? (s.site[0]    ?? null) : s.site,
      })) as RecentShift[]
    },
    enabled: !!orgId && secShifts,
  })

  // ── Unified account operations snapshot ─────────────────────────────────

  const { data: operationsSnapshot } = useQuery<OperationsSnapshot>({
    queryKey: ['crm_client_operations_snapshot', orgId, sites.map(s => s.id).join(',')],
    queryFn: async () => {
      const activeSites = sites.filter(s => s.is_active).length
      const inactiveSites = sites.length - activeSites
      const configuredRateSites = sites.filter(s => s.default_pay_rate != null || s.default_charge_rate != null).length
      const zoneIds = Array.from(new Set(sites.map(s => s.zone_id).filter(Boolean) as string[]))

      const [directContactsRes, employerContactsRes, activeZonesRes, activeRoutesRes, scheduledPatrolsRes, rosterShiftsRes] = await Promise.all([
        (supabase as any)
          .from('user_profiles')
          .select('id')
          .eq('organization_id', orgId),
        (supabase as any)
          .from('user_profiles')
          .select('id')
          .eq('employer_organization_id', orgId),
        zoneIds.length > 0
          ? (supabase as any)
              .from('zones')
              .select('id', { count: 'exact', head: true })
              .in('id', zoneIds)
              .eq('is_active', true)
          : Promise.resolve({ count: 0 }),
        (supabase as any)
          .from('patrol_routes')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_active', true),
        zoneIds.length > 0
          ? (supabase as any)
              .from('patrols')
              .select('id', { count: 'exact', head: true })
              .in('zone_id', zoneIds)
              .in('status', ['scheduled', 'in_progress'])
          : Promise.resolve({ count: 0 }),
        sites.length > 0
          ? (supabase as any)
              .from('roster_shifts')
              .select('id', { count: 'exact', head: true })
              .in('client_site_id', sites.map(s => s.id))
              .in('status', ['published', 'confirmed'])
          : Promise.resolve({ count: 0 }),
      ])

      const uniqueContactIds = new Set<string>()
      for (const row of directContactsRes.data ?? []) uniqueContactIds.add(row.id)
      for (const row of employerContactsRes.data ?? []) uniqueContactIds.add(row.id)

      return {
        activeSites,
        inactiveSites,
        linkedZones: zoneIds.length,
        activeZones: activeZonesRes.count ?? 0,
        configuredRateSites,
        contacts: uniqueContactIds.size,
        activePatrolRoutes: activeRoutesRes.count ?? 0,
        scheduledPatrols: scheduledPatrolsRes.count ?? 0,
        upcomingRosterShifts: rosterShiftsRes.count ?? 0,
      }
    },
    enabled: !!orgId && sites.length >= 0,
  })

  // ── Save contact mutation ─────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<ClientOrg>) => {
      const { error } = await (supabase as any)
        .from('organizations')
        .update({ contact_email: payload.contact_email, contact_phone: payload.contact_phone, notes: payload.notes })
        .eq('id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Account updated')
      qc.invalidateQueries({ queryKey: ['crm_client_org', orgId] })
      qc.invalidateQueries({ queryKey: ['crm_accounts'] })
      setEditingContact(false)
    },
    onError: (e: any) => toast.error(e.message ?? 'Save failed'),
  })

  // ─────────────────────────────────────────────────────────────────────────

  if (orgLoading) {
    return (
      <AppLayout title="Client Account" showBackButton>
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      </AppLayout>
    )
  }

  if (!org) {
    return (
      <AppLayout title="Client Account" showBackButton>
        <p className="text-sm text-red-500 py-8 text-center">Client not found.</p>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={org.name}
      description={org.parent ? `via ${org.parent.name}` : 'Client Account'}
      showBackButton
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/crm')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> CRM
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
            <Building2 className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-sm">{org.name}</p>
            {org.parent && <p className="text-xs text-muted-foreground">via {org.parent.name}</p>}
          </div>
          <Badge variant="outline" className={`text-xs ml-2 ${org.is_active ? 'bg-green-50 text-green-700 border-green-300' : 'bg-gray-100 text-gray-500'}`}>
            {org.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      {/* ── Section 1: Account Information ─────────────────────────────── */}
      <Section title="Account Information" open={secAccount} toggle={() => setSecAccount(v => !v)}>
        {editingContact ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contact Email</Label>
                <Input
                  className="h-8 text-sm mt-1"
                  value={contactForm.contact_email ?? ''}
                  onChange={e => setContactForm(f => ({ ...f, contact_email: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Contact Phone</Label>
                <Input
                  className="h-8 text-sm mt-1"
                  value={contactForm.contact_phone ?? ''}
                  onChange={e => setContactForm(f => ({ ...f, contact_phone: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                className="text-sm mt-1"
                rows={3}
                value={contactForm.notes ?? ''}
                onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="gap-1" onClick={() => saveMutation.mutate(contactForm)} disabled={saveMutation.isPending}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingContact(false)}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Mail className="h-3 w-3" /> Email</p>
                <p className="font-medium">{org.contact_email ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</p>
                <p className="font-medium">{org.contact_phone ?? '—'}</p>
              </div>
            </div>
            {org.notes && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                <p className="text-sm whitespace-pre-line">{org.notes}</p>
              </div>
            )}
            {canEdit && (
              <Button
                size="sm" variant="outline" className="gap-1 mt-2"
                onClick={() => { setContactForm({ contact_email: org.contact_email, contact_phone: org.contact_phone, notes: org.notes }); setEditingContact(true) }}
              >
                <Edit2 className="h-3.5 w-3.5" /> Edit Contact
              </Button>
            )}
          </div>
        )}
      </Section>

      {/* ── Section 2: Client Sites ─────────────────────────────────────── */}
      <Section title={`Client Sites (${sites.length})`} open={secSites} toggle={() => setSecSites(v => !v)}>
        {sitesLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading sites…</p>
        ) : sites.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No sites registered for this client.</p>
        ) : (
          <div className="space-y-2">
            {sites.map(site => (
              <div key={site.id} className={`rounded-md border p-3 text-sm ${!site.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{site.name}</p>
                    {site.site_code && <p className="text-xs text-muted-foreground">{site.site_code}</p>}
                    {(site.address || site.city) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {[site.address, site.city].filter(Boolean).join(', ')}
                      </p>
                    )}
                    <div className="mt-1">
                      {site.loi_id ? (
                        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Site linked to LOI
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Site missing LOI link
                        </Badge>
                      )}
                    </div>
                    {site.contact_name && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Users className="h-3 w-3 flex-shrink-0" /> {site.contact_name}
                        {site.contact_phone && ` · ${site.contact_phone}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {SITE_TYPE_LABELS[site.site_type] ?? site.site_type}
                    </Badge>
                    {!site.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                  </div>
                </div>
                {(site.contract_start_date || site.contract_end_date) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1.5">
                    <Calendar className="h-3 w-3 flex-shrink-0" />
                    Contract: {site.contract_start_date ? format(parseISO(site.contract_start_date), 'd MMM yyyy') : '—'}
                    {' → '}
                    {site.contract_end_date ? format(parseISO(site.contract_end_date), 'd MMM yyyy') : 'Ongoing'}
                  </p>
                )}
                {(site.default_pay_rate || site.default_charge_rate) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Pay: ${site.default_pay_rate?.toFixed(2) ?? '—'}/hr · Charge: ${site.default_charge_rate?.toFixed(2) ?? '—'}/hr
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => navigate('/client-sites')}>
            <Building2 className="h-3.5 w-3.5" /> Manage All Sites
          </Button>
        </div>
      </Section>

      {/* ── Section 3: Zones ────────────────────────────────────────────── */}
      <Section title={`Zones (${zones.length})`} open={secZones} toggle={() => setSecZones(v => !v)}>
        {zonesLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading zones…</p>
        ) : zones.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No zones found for this client organisation.</p>
        ) : (
          <div className="space-y-2">
            {zones.map(zone => (
              <div key={zone.id} className={`rounded-md border p-3 text-sm ${!zone.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{zone.name}</p>
                    <p className="text-xs text-muted-foreground">{zone.zone_type}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {zone.loi_id ? (
                      <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Linked to LOI
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Missing LOI Link
                      </Badge>
                    )}
                    {!zone.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 4: Locations of Interest ───────────────────────────── */}
      <Section title={`Locations of Interest (${locations.length})`} open={secLocations} toggle={() => setSecLocations(v => !v)}>
        {locationsLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading locations…</p>
        ) : locations.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No LOI records found for this client organisation.</p>
        ) : (
          <div className="space-y-2">
            {locations.map(loc => (
              <div key={loc.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{loc.name || loc.display_address || loc.address_full || 'Unnamed Location'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {loc.display_address || loc.address_full || [loc.suburb, loc.city].filter(Boolean).join(', ') || 'No address available'}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{loc.loi_kind || 'address'}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 5: Operations & Settings ───────────────────────────── */}
      <Section
        title="Client Control Center"
        open={secControlCenter}
        toggle={() => setSecControlCenter(v => !v)}
      >
        <p className="text-xs text-muted-foreground mb-3">
          Central access to the core client management surfaces: commercial settings, access control, service modules, rostering, and client documents.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded border p-2.5">
            <p className="font-semibold mb-2">Commercial ($)</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/pricing')}>
                <DollarSign className="h-3.5 w-3.5 mr-1" /> Pricing Matrix
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/invoicing')}>
                Invoicing
              </Button>
            </div>
          </div>

          <div className="rounded border p-2.5">
            <p className="font-semibold mb-2">Access & Permissions</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/users')}>
                User Access
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/site-permissions')}>
                Site Permissions
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/admin/service-provider-access')}>
                Roster Overrides
              </Button>
            </div>
          </div>

          <div className="rounded border p-2.5">
            <p className="font-semibold mb-2">Modules & Service Areas</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/compliance')}>
                Freedom Camping
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/noise-control')}>
                Noise Control
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/biosecurity-control')}>
                Biosecurity
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/smoke-control')}>
                Smoke
              </Button>
            </div>
          </div>

          <div className="rounded border p-2.5">
            <p className="font-semibold mb-2">Operations, Rostering & Docs</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/roster')}>
                Roster Planner
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/dispatch')}>
                Dispatch
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/import-data')}>
                Client Documents
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Section 6: Operations & Settings ───────────────────────────── */}
      <Section
        title="Operations & Settings"
        open={secOperations}
        toggle={() => setSecOperations(v => !v)}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="rounded border p-2.5">
            <p className="text-muted-foreground">Sites</p>
            <p className="font-semibold">{operationsSnapshot?.activeSites ?? 0} active / {operationsSnapshot?.inactiveSites ?? 0} inactive</p>
          </div>
          <div className="rounded border p-2.5">
            <p className="text-muted-foreground">Zones</p>
            <p className="font-semibold">{operationsSnapshot?.activeZones ?? 0} active of {operationsSnapshot?.linkedZones ?? 0} linked</p>
          </div>
          <div className="rounded border p-2.5">
            <p className="text-muted-foreground">Patrol Setup</p>
            <p className="font-semibold">{operationsSnapshot?.activePatrolRoutes ?? 0} routes · {operationsSnapshot?.scheduledPatrols ?? 0} scheduled/in progress</p>
          </div>
          <div className="rounded border p-2.5">
            <p className="text-muted-foreground">Contacts</p>
            <p className="font-semibold">{operationsSnapshot?.contacts ?? 0} account contacts</p>
          </div>
          <div className="rounded border p-2.5">
            <p className="text-muted-foreground">Rates</p>
            <p className="font-semibold">{operationsSnapshot?.configuredRateSites ?? 0} sites with pay/charge rates</p>
          </div>
          <div className="rounded border p-2.5">
            <p className="text-muted-foreground">Roster Access</p>
            <p className="font-semibold">{operationsSnapshot?.upcomingRosterShifts ?? 0} published/confirmed shifts</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/client-sites')}>
            Manage Sites
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/zones')}>
            Manage Zones
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/patrol-schedule')}>
            Patrol Setup
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate('/site-permissions')}>
            Site Access Rules
          </Button>
        </div>
      </Section>

      {/* ── Section 7: Recent Shifts ────────────────────────────────────── */}
      <Section
        title="Recent Shifts"
        open={secShifts}
        toggle={() => setSecShifts(v => !v)}
      >
        {shiftsLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading shifts…</p>
        ) : recentShifts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No shifts recorded at this client's sites.</p>
        ) : (
          <div className="space-y-1.5">
            {recentShifts.map(shift => (
              <div key={shift.id} className="flex items-center justify-between gap-2 rounded border p-2.5 text-xs">
                <div className="min-w-0">
                  <p className="font-medium">{shift.site?.name ?? '—'}</p>
                  <p className="text-muted-foreground">
                    {shift.officer ? `${shift.officer.first_name} ${shift.officer.last_name}` : 'Unassigned'}
                    {' · '}
                    {format(parseISO(shift.shift_date), 'd MMM')}
                    {shift.start_time && ` · ${shift.start_time.slice(0, 5)}`}
                    {shift.end_time   && `–${shift.end_time.slice(0, 5)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {shift.client_charge_rate && (
                    <span className="text-muted-foreground">${shift.client_charge_rate.toFixed(2)}/hr</span>
                  )}
                  <Badge className={`text-xs py-0 ${STATUS_COLOURS[shift.status] ?? ''}`}>
                    {shift.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" className="gap-1 text-xs mt-3" onClick={() => navigate('/roster')}>
          <Clock className="h-3.5 w-3.5" /> Open Roster Planner
        </Button>
      </Section>
    </AppLayout>
  )
}
