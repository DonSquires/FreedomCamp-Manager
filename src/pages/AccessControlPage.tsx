/**
 * AccessControlPage
 *
 * Admin / master / grand_master UI for managing:
 *   1. Portal / area access (portal_access TEXT[]) — which portal sections
 *      a user is allowed to enter.
 *   2. Multi-branch / multi-org assignment (authorized_work_locations UUID[]) —
 *      additional organisations the user can access beyond their primary org.
 *   3. Extra organisation memberships (extra_organization_ids UUID[]) — user
 *      is a formal member of multiple organisations simultaneously.
 *
 * Route: /access-control
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import {
  ShieldCheck,
  Building2,
  Search,
  Users,
  ChevronRight,
  Globe,
  Layers,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react'
import { PORTAL_AREA_CODES, PORTAL_AREA_LABELS, type PortalAreaCode } from '@/hooks/usePermissions'

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrgOption {
  id: string
  name: string
  organization_type: string
  organization_level: number
  parent_organization_id: string | null
}

interface UserRow {
  id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  organization_id: string | null
  primary_org_name: string | null
  primary_org_type: string | null
  employer_org_name: string | null
  portal_access: string[]
  authorized_work_locations: string[]
  extra_organization_ids: string[]
  job_title: string | null
  enabled_portals: string[] | null
}

// ─── Helper: org type colour ─────────────────────────────────────────────────

const ORG_TYPE_COLOUR: Record<string, string> = {
  owner:            'bg-amber-100 text-amber-700 border-amber-200',
  service_provider: 'bg-blue-100 text-blue-700 border-blue-200',
  client:           'bg-purple-100 text-purple-700 border-purple-200',
  contractor:       'bg-orange-100 text-orange-700 border-orange-200',
  operator:         'bg-green-100 text-green-700 border-green-200',
}

const ROLE_COLOUR: Record<string, string> = {
  grand_master:  'bg-yellow-100 text-yellow-800 border-yellow-200',
  master:        'bg-red-100    text-red-700    border-red-200',
  admin:         'bg-blue-100   text-blue-700   border-blue-200',
  admin_officer: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  officer:       'bg-green-100  text-green-700  border-green-200',
  client_viewer: 'bg-gray-100   text-gray-700   border-gray-200',
  nzscv_monitor: 'bg-pink-100   text-pink-700   border-pink-200',
}

// ─── Area groups for the UI ──────────────────────────────────────────────────

const AREA_GROUPS: { label: string; areas: PortalAreaCode[] }[] = [
  {
    label: 'Field Operations',
    areas: ['field_officer', 'site_guard', 'parking', 'noise', 'ems'],
  },
  {
    label: 'Administration',
    areas: ['admin', 'users', 'roster', 'zones', 'data_management'],
  },
  {
    label: 'Compliance & Enforcement',
    areas: ['compliance', 'enforcement', 'investigations', 'reports'],
  },
  {
    label: 'Other',
    areas: ['dispatch', 'client_portal', 'platform'],
  },
]

// ─── AccessControlPage ────────────────────────────────────────────────────────

export default function AccessControlPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch]           = useState('')
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [filterRole, setFilterRole]   = useState<string>('all')
  const [filterOrg, setFilterOrg]     = useState<string>('all')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery<UserRow[]>({
    queryKey: ['access-control-users'],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('user_area_access') as any)
        .select('*')
        .order('full_name')
      if (error) throw error
      return (data ?? []).map((r: any) => ({
        ...r,
        portal_access:            r.portal_access            ?? [],
        authorized_work_locations:r.authorized_work_locations ?? [],
        extra_organization_ids:   r.extra_organization_ids   ?? [],
      }))
    },
  })

  const { data: orgs = [] } = useQuery<OrgOption[]>({
    queryKey: ['access-control-orgs'],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('organizations') as any)
        .select('id, name, organization_type, organization_level, parent_organization_id')
        .eq('is_active', true)
        .order('organization_level', { ascending: true })
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return users.filter(u => {
      const q = search.toLowerCase()
      const matchSearch = !q ||
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.primary_org_name ?? '').toLowerCase().includes(q)
      const matchRole = filterRole === 'all' || u.role === filterRole
      const matchOrg  = filterOrg === 'all' ||
        u.organization_id === filterOrg ||
        u.authorized_work_locations.includes(filterOrg) ||
        u.extra_organization_ids.includes(filterOrg)
      return matchSearch && matchRole && matchOrg
    })
  }, [users, search, filterRole, filterOrg])

  // ── Save mutation ──────────────────────────────────────────────────────────

  const saveAccess = useMutation({
    mutationFn: async (payload: {
      userId: string
      portalAccess: string[]
      authorizedWorkLocations: string[]
      extraOrgIds: string[]
    }) => {
      const { error } = await ((supabase as any).from('user_profiles') as any)
        .update({
          portal_access:             payload.portalAccess,
          authorized_work_locations: payload.authorizedWorkLocations,
          extra_organization_ids:    payload.extraOrgIds,
        })
        .eq('id', payload.userId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-control-users'] })
      toast.success('Access updated successfully')
      setSelectedUser(null)
    },
    onError: (e: any) => {
      toast.error(`Failed to save: ${e.message}`)
    },
  })

  // ── Per-user edit form state ───────────────────────────────────────────────

  const [editPortalAccess,  setEditPortalAccess]  = useState<string[]>([])
  const [editWorkLocations, setEditWorkLocations] = useState<string[]>([])
  const [editExtraOrgs,     setEditExtraOrgs]     = useState<string[]>([])

  const openEdit = (u: UserRow) => {
    setSelectedUser(u)
    setEditPortalAccess([...u.portal_access])
    setEditWorkLocations([...u.authorized_work_locations])
    setEditExtraOrgs([...u.extra_organization_ids])
  }

  const toggleArea = (code: string) => {
    setEditPortalAccess(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  const toggleWorkLocation = (id: string) => {
    setEditWorkLocations(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleExtraOrg = (id: string) => {
    setEditExtraOrgs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleSave = () => {
    if (!selectedUser) return
    saveAccess.mutate({
      userId: selectedUser.id,
      portalAccess: editPortalAccess,
      authorizedWorkLocations: editWorkLocations,
      extraOrgIds: editExtraOrgs,
    })
  }

  // ── Org tree helpers ───────────────────────────────────────────────────────

  const orgById = useMemo(() => {
    const m: Record<string, OrgOption> = {}
    orgs.forEach(o => { m[o.id] = o })
    return m
  }, [orgs])

  const orgDisplay = (id: string) => orgById[id]?.name ?? id

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <GlobalFilterRibbon />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Button variant="ghost" size="sm" onClick={() => navigate('/users')}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Users
              </Button>
            </div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
              Access Control
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Allocate users to specific portal areas and authorise multi-branch
              or multi-organisation access for service providers, contractors and
              client contacts.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchUsers()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email or organisation…"
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
              >
                <option value="all">All roles</option>
                {['grand_master','master','admin','admin_officer','officer','client_viewer','nzscv_monitor'].map(r => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filterOrg}
                onChange={e => setFilterOrg(e.target.value)}
              >
                <option value="all">All organisations</option>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* ── User list ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users
              <Badge variant="secondary" className="ml-auto">{filtered.length}</Badge>
            </CardTitle>
            <CardDescription>
              Click a user to configure their portal areas and organisation access.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {usersLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-40" />
                No users match the current filters.
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map(u => (
                  <button
                    key={u.id}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 text-left transition-colors"
                    onClick={() => openEdit(u)}
                  >
                    {/* Avatar */}
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                      {(u.full_name?.[0] ?? u.email[0]).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{u.full_name || u.email}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${ROLE_COLOUR[u.role] ?? ''}`}
                        >
                          {u.role.replace('_', ' ')}
                        </Badge>
                        {!u.is_active && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">inactive</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {u.primary_org_name && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {u.primary_org_name}
                          </span>
                        )}
                        {u.portal_access.length > 0 && (
                          <span className="text-xs text-blue-600 flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            {u.portal_access.length} area{u.portal_access.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {(u.authorized_work_locations.length + u.extra_organization_ids.length) > 0 && (
                          <span className="text-xs text-purple-600 flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {u.authorized_work_locations.length + u.extra_organization_ids.length} extra org{(u.authorized_work_locations.length + u.extra_organization_ids.length) !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Edit Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={!!selectedUser} onOpenChange={open => { if (!open) setSelectedUser(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              {selectedUser?.full_name || selectedUser?.email}
            </DialogTitle>
            <DialogDescription>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${ROLE_COLOUR[selectedUser?.role ?? ''] ?? ''}`}>
                {selectedUser?.role?.replace('_', ' ')}
              </span>
              {selectedUser?.primary_org_name && (
                <span className="ml-2 text-muted-foreground">
                  · {selectedUser.primary_org_name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="areas">
            <TabsList className="w-full">
              <TabsTrigger value="areas" className="flex-1">
                <Lock className="h-3.5 w-3.5 mr-1.5" />
                Portal Areas
              </TabsTrigger>
              <TabsTrigger value="branches" className="flex-1">
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Branches / Orgs
              </TabsTrigger>
            </TabsList>

            {/* ── Portal Areas tab ─────────────────────────────────────── */}
            <TabsContent value="areas" className="space-y-4 mt-4">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-700 dark:text-blue-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>Leave all unchecked</strong> to rely on role-based access only.
                    Tick specific areas to restrict this user to <em>only those portals</em> regardless of role.
                    grand_master and master users always bypass area restrictions.
                  </div>
                </div>
              </div>

              {AREA_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.areas.map(code => (
                      <label
                        key={code}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          editPortalAccess.includes(code)
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Checkbox
                          checked={editPortalAccess.includes(code)}
                          onCheckedChange={() => toggleArea(code)}
                        />
                        <span className="text-sm">{PORTAL_AREA_LABELS[code]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {editPortalAccess.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-xs text-muted-foreground self-center">Selected:</span>
                  {editPortalAccess.map(code => (
                    <Badge key={code} variant="secondary" className="text-xs">{PORTAL_AREA_LABELS[code as PortalAreaCode] ?? code}</Badge>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Branches / Orgs tab ──────────────────────────────────── */}
            <TabsContent value="branches" className="space-y-5 mt-4">
              <div className="rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 p-3 text-sm text-purple-700 dark:text-purple-300">
                <div className="flex items-start gap-2">
                  <Globe className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>Authorised Work Locations</strong> allow the user to
                    see data from those organisations (patrol zones, scans, incidents,
                    etc.) without changing their primary organisation.
                    <br />
                    <strong>Extra Membership</strong> makes the user a full member
                    of that organisation — useful for managers who oversee multiple
                    branches or contractor officers who work for two companies.
                  </div>
                </div>
              </div>

              {/* Authorised work locations */}
              <div>
                <Label className="text-sm font-semibold mb-2 block flex items-center gap-1.5">
                  <Unlock className="h-3.5 w-3.5 text-purple-600" />
                  Authorised Work Locations
                  <Badge variant="outline" className="ml-1 text-[10px]">{editWorkLocations.length}</Badge>
                </Label>
                <OrgSelector
                  orgs={orgs}
                  selected={editWorkLocations}
                  onToggle={toggleWorkLocation}
                  excludeId={selectedUser?.organization_id ?? undefined}
                  colour="purple"
                />
              </div>

              {/* Extra org membership */}
              <div>
                <Label className="text-sm font-semibold mb-2 block flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-orange-600" />
                  Extra Organisation Membership
                  <Badge variant="outline" className="ml-1 text-[10px]">{editExtraOrgs.length}</Badge>
                </Label>
                <OrgSelector
                  orgs={orgs}
                  selected={editExtraOrgs}
                  onToggle={toggleExtraOrg}
                  excludeId={selectedUser?.organization_id ?? undefined}
                  colour="orange"
                />
              </div>

              {/* Summary */}
              {(editWorkLocations.length + editExtraOrgs.length) > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground self-center">All extra orgs:</span>
                  {[...new Set([...editWorkLocations, ...editExtraOrgs])].map(id => (
                    <Badge key={id} variant="secondary" className="text-xs">{orgById[id]?.name ?? id}</Badge>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setSelectedUser(null)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saveAccess.isPending}
            >
              {saveAccess.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Saving…</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-2" />Save Access</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

// ─── OrgSelector sub-component ────────────────────────────────────────────────

function OrgSelector({
  orgs,
  selected,
  onToggle,
  excludeId,
  colour,
}: {
  orgs: OrgOption[]
  selected: string[]
  onToggle: (id: string) => void
  excludeId?: string
  colour: 'purple' | 'orange'
}) {
  const [orgSearch, setOrgSearch] = useState('')

  const filtered = orgs.filter(o =>
    o.id !== excludeId &&
    (!orgSearch || o.name.toLowerCase().includes(orgSearch.toLowerCase()))
  )

  const colourActive = colour === 'purple'
    ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30'
    : 'border-orange-500 bg-orange-50 dark:bg-orange-950/30'

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search organisations…"
          className="pl-8 h-8 text-sm"
          value={orgSearch}
          onChange={e => setOrgSearch(e.target.value)}
        />
      </div>
      <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
        {filtered.map(o => (
          <label
            key={o.id}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
              selected.includes(o.id)
                ? colourActive
                : 'hover:bg-muted/40'
            }`}
          >
            <Checkbox
              checked={selected.includes(o.id)}
              onCheckedChange={() => onToggle(o.id)}
            />
            <div className="flex-1 min-w-0">
              <span className="text-sm">{o.name}</span>
              <Badge
                variant="outline"
                className={`ml-2 text-[10px] px-1 py-0 ${ORG_TYPE_COLOUR[o.organization_type] ?? ''}`}
              >
                {o.organization_type}
              </Badge>
            </div>
            {selected.includes(o.id) && (
              <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${colour === 'purple' ? 'text-purple-600' : 'text-orange-600'}`} />
            )}
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No organisations found.</div>
        )}
      </div>
    </div>
  )
}
