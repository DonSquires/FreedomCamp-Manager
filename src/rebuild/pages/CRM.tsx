/**
 * CRM — Clean Rebuild surface
 *
 * Canonical account surface:  organisation -> site -> zone -> patrol/dispatch
 *
 * Tabs
 *   Accounts  — list of all organisations (clients + service providers) with search + type filter
 *   Sites     — client_sites linked to client orgs with zone + status context
 *   Contacts  — user_profiles linked to those orgs
 *   Rates     — contractor rate cards (guard_rate_per_hour from contractor_profiles)
 *
 * No debug tooling. No legacy wrappers. Real Supabase queries only.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Building2, MapPin, Users, DollarSign, Search, CheckCircle2,
  AlertTriangle, Clock, ChevronRight, Phone, Mail,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────

type OrgRow = {
  id: string
  name: string
  organization_type: string
  is_active: boolean
  contact_email: string | null
  contact_phone: string | null
}

type SiteRow = {
  id: string
  name: string
  address: string | null
  is_active: boolean
  organization_id: string
  zone_id: string | null
  organization: { name: string } | null
  zone: { name: string } | null
}

type ContactRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  job_title: string | null
  role: string
  is_active: boolean
  organization: { name: string } | null
}

type RateRow = {
  id: string
  organization_id: string
  contact_name: string | null
  guard_rate_per_hour: number | null
  insurance_verified: boolean
  service_agreement_signed: boolean
  organization: { name: string } | null
}

// ─── Status badge helper ────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">Active</Badge>
    : <Badge className="bg-slate-100 text-slate-500 border border-slate-200 text-xs">Inactive</Badge>
}

// ─── Accounts tab ──────────────────────────────────────────────────────────

function AccountsTab({ orgId }: { orgId: string }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const { data: accounts = [], isLoading } = useQuery<OrgRow[]>({
    queryKey: ['crm-accounts', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, organization_type, is_active, contact_email, contact_phone')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const types = ['all', ...Array.from(new Set(accounts.map((a) => a.organization_type).filter(Boolean)))]

  const filtered = accounts.filter((a) => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || a.organization_type === typeFilter
    return matchSearch && matchType
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search accounts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {types.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading accounts…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No accounts found.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((acc) => (
          <Card key={acc.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-sm truncate">{acc.name}</span>
                </div>
                <StatusBadge active={acc.is_active} />
              </div>
              <Badge variant="outline" className="text-xs capitalize">{acc.organization_type}</Badge>
              <div className="text-xs text-muted-foreground space-y-1">
                {acc.contact_email && (
                  <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{acc.contact_email}</div>
                )}
                {acc.contact_phone && (
                  <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{acc.contact_phone}</div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Sites tab ─────────────────────────────────────────────────────────────

function SitesTab() {
  const [search, setSearch] = useState('')

  const { data: sites = [], isLoading } = useQuery<SiteRow[]>({
    queryKey: ['crm-sites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_sites')
        .select(`
          id, name, address, is_active, organization_id, zone_id,
          organization:organizations(name),
          zone:zones(name)
        `)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as SiteRow[]
    },
  })

  const filtered = sites.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.address ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search sites or addresses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading sites…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No sites found.</p>
      )}

      <div className="space-y-2">
        {filtered.map((site) => (
          <Card key={site.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{site.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {site.organization?.name ?? '—'} {site.address ? `· ${site.address}` : ''}
                    </div>
                    {site.zone?.name && (
                      <div className="text-xs text-muted-foreground">Zone: {site.zone.name}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge active={site.is_active} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Contacts tab ──────────────────────────────────────────────────────────

function ContactsTab() {
  const [search, setSearch] = useState('')

  const { data: contacts = [], isLoading } = useQuery<ContactRow[]>({
    queryKey: ['crm-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, phone, job_title, role, is_active, organization:organizations!user_profiles_organization_id_fkey(name)')
        .order('last_name')
      if (error) throw error
      return (data ?? []) as unknown as ContactRow[]
    },
  })

  const filtered = contacts.filter((c) => {
    const full = `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase()
    return !search || full.includes(search.toLowerCase())
  })

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading contacts…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No contacts found.</p>
      )}

      <div className="space-y-2">
        {filtered.map((c) => (
          <Card key={c.id}>
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium text-sm">{c.first_name} {c.last_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.organization?.name ?? '—'} {c.job_title ? `· ${c.job_title}` : ''}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{c.email}</span>
                    {c.phone && <span>· {c.phone}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs capitalize">{c.role}</Badge>
                <StatusBadge active={c.is_active} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Rates tab ─────────────────────────────────────────────────────────────

function RatesTab() {
  const { data: rates = [], isLoading } = useQuery<RateRow[]>({
    queryKey: ['crm-rates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_profiles')
        .select(`
          id, organization_id, contact_name, guard_rate_per_hour,
          insurance_verified, service_agreement_signed,
          organization:organizations!contractor_profiles_organization_id_fkey(name)
        `)
        .order('organization_id')
      if (error) throw error
      return (data ?? []) as unknown as RateRow[]
    },
  })

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-muted-foreground">Loading rates…</p>}
      {!isLoading && rates.length === 0 && (
        <p className="text-sm text-muted-foreground">No contractor rate cards found.</p>
      )}

      {rates.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-sm">{r.organization?.name ?? r.organization_id}</div>
              {r.contact_name && (
                <div className="text-xs text-muted-foreground">{r.contact_name}</div>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0 text-sm">
              {r.guard_rate_per_hour != null && (
                <div className="flex items-center gap-1 font-medium">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  {r.guard_rate_per_hour.toFixed(2)}/hr
                </div>
              )}
              <div title="Insurance verified">
                {r.insurance_verified
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              </div>
              <div title="Agreement signed">
                {r.service_agreement_signed
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <Clock className="h-4 w-4 text-slate-400" />}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function RebuildCRMPage() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="text-sm text-muted-foreground">
          Client accounts · Sites · Contacts · Rates
        </p>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList className="mb-4">
          <TabsTrigger value="accounts">
            <Building2 className="h-4 w-4 mr-1.5" />Accounts
          </TabsTrigger>
          <TabsTrigger value="sites">
            <MapPin className="h-4 w-4 mr-1.5" />Sites
          </TabsTrigger>
          <TabsTrigger value="contacts">
            <Users className="h-4 w-4 mr-1.5" />Contacts
          </TabsTrigger>
          <TabsTrigger value="rates">
            <DollarSign className="h-4 w-4 mr-1.5" />Rates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts"><AccountsTab orgId={orgId} /></TabsContent>
        <TabsContent value="sites"><SitesTab /></TabsContent>
        <TabsContent value="contacts"><ContactsTab /></TabsContent>
        <TabsContent value="rates"><RatesTab /></TabsContent>
      </Tabs>
    </div>
  )
}
