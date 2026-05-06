/**
 * CanonicalPersonViewer — Sprint 14 / B-47
 *
 * Dedicated read-only viewer of `canonical_persons` records.
 * `canonical_persons` is fully typed in database.ts — no `(supabase as any)`.
 *
 * Features:
 * - KPI cards: Total / POI / Trespassed / Flagged
 * - Table with risk level filter, identity status filter, free-text search
 * - Expandable detail panel (click a row) showing all fields
 *
 * Route: /canonical-persons
 * Roles: admin, admin_officer, master
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, ArrowLeft, Ban, ChevronDown, ChevronRight, Search, Shield, User, Users } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Database } from '@/types/database'

// ─── Types ──────────────────────────────────────────────────────────────────────

type CanonicalPerson = Database['public']['Tables']['canonical_persons']['Row']

type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
type IdentityStatus = 'identified' | 'partial' | 'unknown'

// ─── Constants ─────────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string }> = {
  low:      { label: 'Low',      color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  medium:   { label: 'Medium',   color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  high:     { label: 'High',     color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
}

const IDENTITY_CONFIG: Record<IdentityStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  identified: { label: 'Identified', variant: 'default' },
  partial:    { label: 'Partial',    variant: 'secondary' },
  unknown:    { label: 'Unknown',    variant: 'outline' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  try { return format(parseISO(s), 'd MMM yyyy') } catch { return s }
}

function displayName(p: CanonicalPerson) {
  if (p.full_name) return p.full_name
  if (p.first_name || p.last_name) return [p.first_name, p.last_name].filter(Boolean).join(' ')
  return 'Unknown'
}

// ─── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({ person }: { person: CanonicalPerson }) {
  const riskCfg = person.risk_level ? RISK_CONFIG[person.risk_level as RiskLevel] : null

  return (
    <div className="bg-muted/40 border-t px-4 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-xs">
      {/* Identity */}
      <div><span className="font-medium text-muted-foreground block mb-0.5">Date of Birth</span>{fmtDate(person.date_of_birth)}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Gender</span>{person.gender ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Nationality</span>{person.nationality ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Address</span>{person.address ?? '—'}</div>

      {/* Risk */}
      <div>
        <span className="font-medium text-muted-foreground block mb-0.5">Risk Level</span>
        {riskCfg
          ? <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-medium ${riskCfg.color}`}>{riskCfg.label}</span>
          : '—'
        }
      </div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Risk Category</span>{person.risk_category ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Flagged Priority</span>{person.flagged_priority ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Flagged Reason</span>{person.flagged_reason ?? '—'}</div>

      {/* Access */}
      <div><span className="font-medium text-muted-foreground block mb-0.5">Access Clearance</span>{person.access_clearance_level ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Badge Number</span>{person.access_badge_number ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Zone Restricted</span>{person.zone_restricted ? 'Yes' : 'No'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Expiry Date</span>{fmtDate(person.expiry_date)}</div>

      {/* Interactions */}
      <div><span className="font-medium text-muted-foreground block mb-0.5">First Seen</span>{fmtDate(person.first_seen_at)}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Last Seen</span>{fmtDate(person.last_seen_at)}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Total Interactions</span>{person.total_interactions}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Homeless Status</span>{person.homeless_status ?? '—'}</div>

      {/* Contact */}
      <div><span className="font-medium text-muted-foreground block mb-0.5">Email</span>{person.contact_email ?? '—'}</div>
      <div><span className="font-medium text-muted-foreground block mb-0.5">Phone</span>{person.contact_phone ?? '—'}</div>

      {/* Flags */}
      <div>
        <span className="font-medium text-muted-foreground block mb-1">Flags</span>
        <div className="flex flex-wrap gap-1">
          {person.is_poi && <Badge variant="destructive" className="text-[10px]">POI</Badge>}
          {person.is_trespassed && <Badge variant="destructive" className="text-[10px]">Trespassed</Badge>}
          {person.is_banned && <Badge variant="destructive" className="text-[10px]">Banned</Badge>}
          {person.is_flagged && <Badge variant="secondary" className="text-[10px]">Flagged</Badge>}
          {person.is_minor && <Badge variant="outline" className="text-[10px]">Minor</Badge>}
          {!person.is_poi && !person.is_trespassed && !person.is_banned && !person.is_flagged && !person.is_minor && (
            <span className="text-muted-foreground">None</span>
          )}
        </div>
      </div>

      {/* Notes */}
      {person.notes && (
        <div className="col-span-full">
          <span className="font-medium text-muted-foreground block mb-0.5">Notes</span>
          <p className="text-sm">{person.notes}</p>
        </div>
      )}
      {person.distinguishing_features && (
        <div className="col-span-full">
          <span className="font-medium text-muted-foreground block mb-0.5">Distinguishing Features</span>
          <p className="text-sm">{person.distinguishing_features}</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function CanonicalPersonViewer() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const [riskFilter, setRiskFilter] = useState('all')
  const [identityFilter, setIdentityFilter] = useState('all')
  const [flagFilter, setFlagFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Fetch canonical_persons — fully typed
  const { data: persons = [], isLoading, error } = useQuery<CanonicalPerson[]>({
    queryKey: ['canonical-persons', orgId],
    queryFn: async () => {
      let q = supabase
        .from('canonical_persons')
        .select('*')
        .order('last_name', { ascending: true, nullsFirst: false })
        .limit(500)

      if (orgId) q = q.eq('organization_id', orgId)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: true,
    staleTime: 60_000,
    retry: false,
  })

  // KPIs
  const kpis = useMemo(() => ({
    total:      persons.length,
    poi:        persons.filter((p) => p.is_poi).length,
    trespassed: persons.filter((p) => p.is_trespassed).length,
    flagged:    persons.filter((p) => p.is_flagged).length,
  }), [persons])

  // Filtered rows
  const filtered = useMemo(() => {
    return persons.filter((p) => {
      if (riskFilter !== 'all' && p.risk_level !== riskFilter) return false
      if (identityFilter !== 'all' && p.identity_status !== identityFilter) return false
      if (flagFilter === 'poi' && !p.is_poi) return false
      if (flagFilter === 'trespassed' && !p.is_trespassed) return false
      if (flagFilter === 'banned' && !p.is_banned) return false
      if (flagFilter === 'flagged' && !p.is_flagged) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = displayName(p).toLowerCase()
        const email = (p.contact_email ?? '').toLowerCase()
        const phone = (p.contact_phone ?? '').toLowerCase()
        const notes = (p.notes ?? '').toLowerCase()
        if (!name.includes(q) && !email.includes(q) && !phone.includes(q) && !notes.includes(q)) return false
      }
      return true
    })
  }, [persons, riskFilter, identityFilter, flagFilter, search])

  return (
    <AppLayout
      title="Canonical Persons"
      description="Master person registry — identity-verified records with risk, access, and enforcement flags"
    >
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/admin')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Persons',  value: kpis.total,      Icon: Users,         color: 'text-blue-600' },
          { label: 'POI',            value: kpis.poi,         Icon: Shield,        color: 'text-red-600' },
          { label: 'Trespassed',     value: kpis.trespassed,  Icon: Ban,           color: 'text-orange-600' },
          { label: 'Flagged',        value: kpis.flagged,     Icon: AlertTriangle, color: 'text-amber-600' },
        ].map(({ label, value, Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-bold leading-tight">{isLoading ? '—' : value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="pl-8 w-56 h-8 text-xs"
          />
        </div>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Risk level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk levels</SelectItem>
            {Object.entries(RISK_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={identityFilter} onValueChange={setIdentityFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Identity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All identity statuses</SelectItem>
            {Object.entries(IDENTITY_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={flagFilter} onValueChange={setFlagFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Flag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All flags</SelectItem>
            <SelectItem value="poi">POI</SelectItem>
            <SelectItem value="trespassed">Trespassed</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20 mb-4">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              Failed to load persons: {(error as any)?.message ?? 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <div className="rounded-xl overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs w-6" />
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Identity</TableHead>
                <TableHead className="text-xs">Risk</TableHead>
                <TableHead className="text-xs">Flags</TableHead>
                <TableHead className="text-xs">Interactions</TableHead>
                <TableHead className="text-xs">Last Seen</TableHead>
                <TableHead className="text-xs">Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    No persons match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((person) => {
                  const isExpanded = expandedId === person.id
                  const riskCfg = person.risk_level ? RISK_CONFIG[person.risk_level as RiskLevel] : null
                  const identityCfg = IDENTITY_CONFIG[person.identity_status as IdentityStatus] ?? IDENTITY_CONFIG.unknown

                  return (
                    <>
                      <TableRow
                        key={person.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpandedId(isExpanded ? null : person.id)}
                      >
                        <TableCell className="py-2 pl-3 pr-0">
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          }
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            {person.profile_photo_url
                              ? <img src={person.profile_photo_url} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
                              : <User className="h-4 w-4 text-muted-foreground shrink-0" />
                            }
                            <span className="text-sm font-medium">{displayName(person)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant={identityCfg.variant} className="text-[10px] px-1.5 py-0">
                            {identityCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          {riskCfg
                            ? <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${riskCfg.color}`}>{riskCfg.label}</span>
                            : <span className="text-muted-foreground text-xs">—</span>
                          }
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {person.is_poi        && <Badge variant="destructive" className="text-[9px] px-1 py-0">POI</Badge>}
                            {person.is_trespassed  && <Badge variant="destructive" className="text-[9px] px-1 py-0">Trespass</Badge>}
                            {person.is_banned      && <Badge variant="destructive" className="text-[9px] px-1 py-0">Banned</Badge>}
                            {person.is_flagged     && <Badge variant="secondary"   className="text-[9px] px-1 py-0">Flagged</Badge>}
                            {person.is_minor       && <Badge variant="outline"     className="text-[9px] px-1 py-0">Minor</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground text-center">{person.total_interactions}</TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(person.last_seen_at)}</TableCell>
                        <TableCell className="py-2 text-xs">
                          {person.expiry_date
                            ? <span className={new Date(person.expiry_date) < new Date() ? 'text-red-500' : 'text-muted-foreground'}>{fmtDate(person.expiry_date)}</span>
                            : <span className="text-muted-foreground">—</span>
                          }
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${person.id}-detail`}>
                          <TableCell colSpan={8} className="p-0">
                            <DetailPanel person={person} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            Showing {filtered.length} of {persons.length} person{persons.length !== 1 ? 's' : ''}
            {persons.length >= 500 && ' (capped at 500 — refine filters)'}
          </div>
        )}
      </Card>
    </AppLayout>
  )
}
