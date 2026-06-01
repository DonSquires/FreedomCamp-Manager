/**
 * CRMModule – Zoho-style CRM hub
 *
 * Accounts tab:  All CRM-facing organisations (owners, service providers,
 *                clients, and contractors) with search, type filter and
 *                status filter. Clicking a contractor opens
 *                ContractorAccountPage; all other org types open the
 *                existing client-style organization detail page.
 *
 * Contacts tab:  People (user_profiles) linked to those organisations —
 *                contact name, role, phone, email.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Building2, Users, Search, ChevronRight, Phone, Mail,
  CheckCircle2, ShieldCheck, MapPinned,
} from 'lucide-react'
import { getOrgTypeLabel } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CRMAccount {
  id: string
  name: string
  organization_type: string
  organization_level: number
  is_active: boolean
  contact_email: string | null
  contact_phone: string | null
  parent: { name: string } | null
  // joined from contractor_profiles
  contractor_profile: {
    contact_name: string | null
    contact_phone: string | null
    contact_email: string | null
    insurance_verified: boolean
    insurance_expiry: string | null
    hs_policy_verified: boolean
    hs_policy_expiry: string | null
    service_agreement_signed: boolean
    guard_rate_per_hour: number | null
  } | null
}

interface CRMContact {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  job_title: string | null
  role: string
  is_active: boolean
  organization: { id: string; name: string } | null
  employer_org: { id: string; name: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  owner:            'bg-gray-100 text-gray-700 border-gray-300',
  service_provider: 'bg-blue-50 text-blue-700 border-blue-300',
  client:           'bg-green-50 text-green-700 border-green-300',
  contractor:       'bg-amber-50 text-amber-700 border-amber-300',
}

function complianceStatus(profile: CRMAccount['contractor_profile']) {
  if (!profile) return null
  const today = new Date().toISOString().split('T')[0]
  const expired = (expiry: string | null) => expiry && expiry < today
  if (
    !profile.service_agreement_signed ||
    !profile.insurance_verified ||
    !profile.hs_policy_verified
  ) return 'incomplete'
  if (
    expired(profile.insurance_expiry) ||
    expired(profile.hs_policy_expiry)
  ) return 'expired'
  return 'ok'
}

function ComplianceBadge({ status }: { status: string | null }) {
  if (!status) return null
  if (status === 'ok')         return <Badge className="bg-green-50 text-green-700 border-green-300 text-xs">✓ Compliant</Badge>
  if (status === 'expired')    return <Badge className="bg-red-50 text-red-700 border-red-300 text-xs">⚠ Expired</Badge>
  return <Badge className="bg-amber-50 text-amber-700 border-amber-300 text-xs">Incomplete</Badge>
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CRMModule() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { orgIds, isLoading: orgIdsLoading } = useClientOrgIds()
  const canCreateClientOrganizations = user?.role === 'master' || user?.role === 'grand_master'

  const [accountSearch, setAccountSearch]   = useState('')
  const [typeFilter, setTypeFilter]         = useState('all')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [contactSearch, setContactSearch]   = useState('')

  // ── Accounts query ────────────────────────────────────────────────────────

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<CRMAccount[]>({
    queryKey: ['crm_accounts', user?.organization_id, orgIds],
    queryFn: async () => {
      if (orgIds !== null && orgIds.length === 0) return []

      let q = (supabase.from('organizations') as any)
        .select(`
          id, name, organization_type, organization_level, is_active,
          contact_email, contact_phone,
          parent:organizations!parent_organization_id(name),
          contractor_profile:contractor_profiles(
            contact_name, contact_phone, contact_email,
            insurance_verified, insurance_expiry,
            hs_policy_verified, hs_policy_expiry,
            service_agreement_signed, guard_rate_per_hour
          )
        `)
        .in('organization_type', ['owner', 'service_provider', 'client', 'contractor'])

      if (orgIds !== null) {
        q = q.in('id', orgIds)
      }

      const { data, error } = await q
        .order('organization_type')
        .order('name')
      if (error) throw error
      // Supabase returns contractor_profile as array — unwrap
      return (data || []).map((a: any) => ({
        ...a,
        contractor_profile: Array.isArray(a.contractor_profile)
          ? (a.contractor_profile[0] ?? null)
          : a.contractor_profile,
      })) as CRMAccount[]
    },
    enabled: !orgIdsLoading && (orgIds === null || !!user?.organization_id),
  })

  // ── Contacts query ────────────────────────────────────────────────────────

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<CRMContact[]>({
    queryKey: ['crm_contacts', user?.organization_id, orgIds],
    queryFn: async () => {
      if (orgIds !== null && orgIds.length === 0) return []

      const baseQuery = (supabase.from('user_profiles') as any)
        .select(`
          id, first_name, last_name, email, phone, job_title, role, is_active,
          organization:organizations!organization_id(id, name),
          employer_org:organizations!employer_organization_id(id, name)
        `)
        .eq('is_active', true)
      
      if (orgIds === null) {
        const { data, error } = await baseQuery.order('first_name')
        if (error) throw error
        return (data || []) as CRMContact[]
      }

      const [{ data: orgContacts, error: orgError }, { data: employerContacts, error: employerError }] = await Promise.all([
        baseQuery.in('organization_id', orgIds),
        baseQuery.in('employer_organization_id', orgIds),
      ])
      if (orgError) throw orgError
      if (employerError) throw employerError

      const merged = new Map<string, CRMContact>()
      for (const row of (orgContacts || []) as CRMContact[]) merged.set(row.id, row)
      for (const row of (employerContacts || []) as CRMContact[]) merged.set(row.id, row)
      return Array.from(merged.values()).sort((a, b) =>
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
      )
    },
    enabled: !orgIdsLoading && (orgIds === null || !!user?.organization_id),
  })

  const { data: siteCount = 0, isLoading: siteCountLoading } = useQuery<number>({
    queryKey: ['crm_site_count', user?.organization_id, orgIds],
    queryFn: async () => {
      let q = (supabase.from('client_sites') as any)
        .select('id', { count: 'exact', head: true })

      if (orgIds !== null) {
        q = q.in('organization_id', orgIds)
      }

      const { count, error } = await q
      if (error) throw error
      return count ?? 0
    },
    enabled: !orgIdsLoading && (orgIds === null || !!user?.organization_id),
  })

  // ── Filtered lists ────────────────────────────────────────────────────────

  const filteredAccounts = accounts.filter((a) => {
    if (typeFilter   !== 'all' && a.organization_type !== typeFilter)          return false
    if (statusFilter === 'active'   && !a.is_active)                           return false
    if (statusFilter === 'inactive' &&  a.is_active)                           return false
    if (accountSearch) {
      const q = accountSearch.toLowerCase()
      if (!a.name.toLowerCase().includes(q) &&
          !(a.contractor_profile?.contact_name?.toLowerCase().includes(q)) &&
          !(a.contact_email?.toLowerCase().includes(q))) return false
    }
    return true
  })

  const filteredContacts = contacts.filter((c) => {
    if (!contactSearch) return true
    const q = contactSearch.toLowerCase()
    return (
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.job_title?.toLowerCase().includes(q) ||
      c.organization?.name.toLowerCase().includes(q) ||
      c.employer_org?.name.toLowerCase().includes(q)
    )
  })

  const ownerCount = accounts.filter(a => a.organization_type === 'owner').length
  const serviceProviderCount = accounts.filter(a => a.organization_type === 'service_provider').length
  const contractorCount = accounts.filter(a => a.organization_type === 'contractor').length
  const clientCount     = accounts.filter(a => a.organization_type === 'client').length
  const activeAccountCount = accounts.filter((account) => account.is_active).length
  const compliantContractorCount = accounts.filter((account) => complianceStatus(account.contractor_profile) === 'ok').length

  const overviewCards = [
    {
      label: 'Accounts',
      value: accounts.length,
      detail: `${ownerCount} owners · ${serviceProviderCount} providers · ${clientCount} clients · ${contractorCount} contractors`,
      icon: Building2,
    },
    {
      label: 'Contacts',
      value: contacts.length,
      detail: 'Visible CRM stakeholders and system-linked contacts',
      icon: Users,
    },
    {
      label: 'Sites',
      value: siteCountLoading ? '…' : siteCount,
      detail: 'Linked client locations in the current org scope',
      icon: MapPinned,
    },
    {
      label: 'Compliant Contractors',
      value: compliantContractorCount,
      detail: `${activeAccountCount} active accounts in scope`,
      icon: CheckCircle2,
    },
  ]

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="CRM" description="Accounts, contacts and contracts" showBackButton>
      <GlobalFilterRibbon />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 mb-4">
        {overviewCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.label}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-gray-500">{card.label}</p>
                    <p className="text-2xl font-semibold mt-1">{card.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{card.detail}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-5 w-5 text-slate-700" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="mb-4 border-dashed">
        <CardContent className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">CRM workspace</p>
            <p className="text-sm text-gray-500">Use CRM as the account hub for owner, service-provider, client, and contractor organizations, then move into site and access administration without losing org context.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreateClientOrganizations && (
              <Button size="sm" variant="default" className="gap-1.5" onClick={() => navigate('/organizations')}>
                <Building2 className="h-4 w-4" /> New Organisation
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/client-sites')}>
              <MapPinned className="h-4 w-4" /> Client Sites
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/access-control')}>
              <ShieldCheck className="h-4 w-4" /> Access Control
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/client-master-list')}>
              <ChevronRight className="h-4 w-4" /> Master List of Clients
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="accounts">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="accounts">
              <Building2 className="h-4 w-4 mr-1.5" />
              Accounts
              <span className="ml-1.5 bg-gray-100 text-gray-600 text-xs px-1.5 rounded-full">
                {accounts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="contacts">
              <Users className="h-4 w-4 mr-1.5" />
              Contacts
              <span className="ml-1.5 bg-gray-100 text-gray-600 text-xs px-1.5 rounded-full">
                {contacts.length}
              </span>
            </TabsTrigger>
          </TabsList>
          <div className="text-xs text-gray-400">Accounts remain the canonical entry point for CRM hierarchy, sites, access, and contractor readiness.</div>
        </div>

        {/* ── Accounts tab ────────────────────────────────────────────────── */}
        <TabsContent value="accounts">
          {/* Filter bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search accounts…"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All Types ({accounts.length})
                </SelectItem>
                <SelectItem value="client">
                  Clients ({clientCount})
                </SelectItem>
                <SelectItem value="service_provider">
                  Service Providers ({serviceProviderCount})
                </SelectItem>
                <SelectItem value="owner">
                  Owners ({ownerCount})
                </SelectItem>
                <SelectItem value="contractor">
                  Contractors ({contractorCount})
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Accounts list */}
          {accountsLoading ? (
            <p className="text-sm text-gray-400 py-6 text-center">Loading accounts…</p>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No accounts found.</p>
          ) : (
            <div className="space-y-2">
              {filteredAccounts.map((account) => {
                const compliance = complianceStatus(account.contractor_profile)
                const isContractor = account.organization_type === 'contractor'
                const contact = isContractor
                  ? account.contractor_profile
                  : null

                return (
                  <Card
                    key={account.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${
                      !account.is_active ? 'opacity-60' : ''
                    }`}
                    onClick={() =>
                      isContractor
                        ? navigate(`/crm/contractor/${account.id}`)
                        : navigate(`/crm/client/${account.id}`)
                    }
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        {/* Left: name + badges */}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isContractor ? 'bg-amber-100' : 'bg-green-100'
                          }`}>
                            <Building2 className={`h-4 w-4 ${isContractor ? 'text-amber-600' : 'text-green-600'}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold truncate">{account.name}</p>
                              <Badge
                                variant="outline"
                                className={`text-xs flex-shrink-0 ${TYPE_COLOURS[account.organization_type] ?? ''}`}
                              >
                                {getOrgTypeLabel(account.organization_type)}
                              </Badge>
                              {!account.is_active && (
                                <Badge variant="secondary" className="text-xs flex-shrink-0">Inactive</Badge>
                              )}
                              {isContractor && <ComplianceBadge status={compliance} />}
                            </div>
                            {account.parent && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                via {account.parent.name}
                              </p>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  navigate(`/client-sites?orgId=${encodeURIComponent(account.id)}`)
                                }}
                              >
                                Sites
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  navigate(`/access-control?orgId=${encodeURIComponent(account.id)}`)
                                }}
                              >
                                Access
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Middle: contact info */}
                        <div className="hidden md:flex flex-col gap-0.5 text-xs text-gray-500 min-w-0">
                          {(contact?.contact_name || account.contact_email) && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {contact?.contact_name ?? '—'}
                            </span>
                          )}
                          {(contact?.contact_phone || account.contact_phone) && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contact?.contact_phone ?? account.contact_phone}
                            </span>
                          )}
                          {(contact?.contact_email || account.contact_email) && (
                            <span className="flex items-center gap-1 truncate max-w-xs">
                              <Mail className="h-3 w-3 flex-shrink-0" />
                              {contact?.contact_email ?? account.contact_email}
                            </span>
                          )}
                        </div>

                        {/* Right: rate (contractors) or arrow */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {isContractor && account.contractor_profile?.guard_rate_per_hour && (
                            <div className="text-right hidden sm:block">
                              <p className="text-xs text-gray-400">Guard rate</p>
                              <p className="text-sm font-semibold text-amber-700">
                                ${account.contractor_profile.guard_rate_per_hour}/hr
                              </p>
                            </div>
                          )}
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Contacts tab ────────────────────────────────────────────────── */}
        <TabsContent value="contacts">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search contacts…"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {contactsLoading ? (
            <p className="text-sm text-gray-400 py-6 text-center">Loading contacts…</p>
          ) : filteredContacts.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No contacts found.</p>
          ) : (
            <div className="space-y-2">
              {filteredContacts.map((contact) => {
                const org = contact.employer_org ?? contact.organization
                return (
                  <Card key={contact.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Users className="h-4 w-4 text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {contact.first_name} {contact.last_name}
                            </p>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              {contact.job_title && (
                                <span className="text-xs text-gray-500">{contact.job_title}</span>
                              )}
                              {org && (
                                <span className="text-xs text-gray-400">@ {org.name}</span>
                              )}
                              <Badge variant="outline" className="text-xs capitalize">
                                {contact.role.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="hidden md:flex flex-col gap-0.5 text-xs text-gray-500">
                          {contact.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />{contact.phone}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />{contact.email}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
