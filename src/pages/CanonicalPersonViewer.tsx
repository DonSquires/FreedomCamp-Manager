/**
 * CanonicalPersonViewer — B-47
 *
 * Deduplication viewer for canonical_persons — the master identity records
 * that consolidate multiple person_records observations into a single
 * authoritative profile per individual.
 *
 * Features:
 *  - KPI cards: Total / Identified / POI / Trespassed / Flagged / Minors
 *  - Filters: identity_status, risk_level, POI/trespassed/flagged toggles, keyword search
 *  - Table: full name, DOB, identity status, risk, POI/trespass/banned/flagged badges,
 *    access status, total interactions, first seen, last seen
 *  - Detail slide-out (expandable row): contact, address, clearance level, flagged reason,
 *    homeless status, notes
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Users, Search, RefreshCw, AlertCircle, Loader2,
  ShieldAlert, CheckCircle2, Ban, Flag, Baby,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type CanonicalPerson = Database['public']['Tables']['canonical_persons']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const IDENTITY_STYLES: Record<string, { label: string; className: string }> = {
  identified: { label: 'Identified', className: 'bg-green-100 text-green-800' },
  partial:    { label: 'Partial',    className: 'bg-yellow-100 text-yellow-800' },
  unknown:    { label: 'Unknown',    className: 'bg-gray-100 text-gray-600' },
}

const RISK_STYLES: Record<string, { label: string; className: string }> = {
  low:      { label: 'Low',      className: 'bg-green-100 text-green-700' },
  medium:   { label: 'Medium',   className: 'bg-yellow-100 text-yellow-700' },
  high:     { label: 'High',     className: 'bg-orange-100 text-orange-700' },
  critical: { label: 'Critical', className: 'bg-red-100 text-red-700' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function displayName(p: CanonicalPerson) {
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '(No name)'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CanonicalPersonViewer() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch] = useState('')
  const [identityFilter, setIdentityFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [poiOnly, setPoiOnly] = useState(false)
  const [trespassedOnly, setTrespassedOnly] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: persons = [], isLoading, refetch } = useQuery({
    queryKey: ['canonical-persons', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canonical_persons')
        .select('*')
        .eq('organization_id', orgId!)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as CanonicalPerson[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:      persons.length,
    identified: persons.filter(p => p.identity_status === 'identified').length,
    poi:        persons.filter(p => p.is_poi).length,
    trespassed: persons.filter(p => p.is_trespassed).length,
    flagged:    persons.filter(p => p.is_flagged).length,
    minors:     persons.filter(p => p.is_minor).length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = persons.filter(p => {
    if (identityFilter !== 'all' && p.identity_status !== identityFilter) return false
    if (riskFilter !== 'all' && p.risk_level !== riskFilter) return false
    if (poiOnly && !p.is_poi) return false
    if (trespassedOnly && !p.is_trespassed) return false
    if (flaggedOnly && !p.is_flagged) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !displayName(p).toLowerCase().includes(q) &&
        !(p.contact_email ?? '').toLowerCase().includes(q) &&
        !(p.contact_phone ?? '').toLowerCase().includes(q) &&
        !(p.address ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Canonical Person Viewer" description="Master identity deduplication records">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">Canonical Person Viewer</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Total',      value: kpis.total,      icon: <Users className="h-4 w-4" />,        color: 'text-foreground' },
          { label: 'Identified', value: kpis.identified, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
          { label: 'POI',        value: kpis.poi,        icon: <ShieldAlert className="h-4 w-4" />,  color: 'text-orange-600' },
          { label: 'Trespassed', value: kpis.trespassed, icon: <Ban className="h-4 w-4" />,          color: 'text-red-600' },
          { label: 'Flagged',    value: kpis.flagged,    icon: <Flag className="h-4 w-4" />,         color: 'text-amber-600' },
          { label: 'Minors',     value: kpis.minors,     icon: <Baby className="h-4 w-4" />,         color: 'text-purple-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={identityFilter} onValueChange={setIdentityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Identity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(IDENTITY_STYLES).map(([v, s]) => (
              <SelectItem key={v} value={v}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Risk level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risks</SelectItem>
            {Object.entries(RISK_STYLES).map(([v, s]) => (
              <SelectItem key={v} value={v}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-4 px-2">
          {[
            { id: 'poi',        label: 'POI',        value: poiOnly,        set: setPoiOnly },
            { id: 'tres',       label: 'Trespassed', value: trespassedOnly, set: setTrespassedOnly },
            { id: 'flagged',    label: 'Flagged',    value: flaggedOnly,    set: setFlaggedOnly },
          ].map(f => (
            <div key={f.id} className="flex items-center gap-1.5">
              <Checkbox
                id={f.id}
                checked={f.value}
                onCheckedChange={v => f.set(!!v)}
              />
              <Label htmlFor={f.id} className="text-sm cursor-pointer">{f.label}</Label>
            </div>
          ))}
        </div>
      </div>

      {/* Empty-state */}
      {!isLoading && persons.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No canonical person records found. Records are created automatically when identity verification links observations to an individual.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Name</TableHead>
              <TableHead>DOB</TableHead>
              <TableHead>Identity</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Interactions</TableHead>
              <TableHead>First Seen</TableHead>
              <TableHead>Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && persons.length > 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  No records match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(p => {
              const expanded = expandedId === p.id
              return [
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    <div className="flex items-center gap-1.5">
                      {p.is_minor && <Baby className="h-3 w-3 text-purple-500" aria-label="Minor" />}
                      {displayName(p)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(p.date_of_birth)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${IDENTITY_STYLES[p.identity_status]?.className ?? ''}`}>
                      {IDENTITY_STYLES[p.identity_status]?.label ?? p.identity_status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {p.risk_level
                      ? <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${RISK_STYLES[p.risk_level]?.className ?? ''}`}>
                          {RISK_STYLES[p.risk_level]?.label ?? p.risk_level}
                        </span>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {p.is_poi       && <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">POI</Badge>}
                      {p.is_trespassed && <Badge variant="outline" className="text-xs border-red-300 text-red-700">Trespassed</Badge>}
                      {p.is_banned    && <Badge variant="outline" className="text-xs border-red-400 text-red-800">Banned</Badge>}
                      {p.is_flagged   && <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">Flagged</Badge>}
                      {!p.is_poi && !p.is_trespassed && !p.is_banned && !p.is_flagged && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.access_allowed === true  && <Badge variant="secondary" className="text-xs text-green-700">Allowed</Badge>}
                    {p.access_allowed === false && <Badge variant="destructive" className="text-xs">Denied</Badge>}
                    {p.access_allowed === null  && <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-center">{p.total_interactions}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(p.first_seen_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(p.last_seen_at)}</TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${p.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={9} className="py-3 text-sm">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                        {p.contact_email && (
                          <div><span className="text-muted-foreground text-xs">Email:</span> <span>{p.contact_email}</span></div>
                        )}
                        {p.contact_phone && (
                          <div><span className="text-muted-foreground text-xs">Phone:</span> <span>{p.contact_phone}</span></div>
                        )}
                        {p.address && (
                          <div><span className="text-muted-foreground text-xs">Address:</span> <span>{p.address}</span></div>
                        )}
                        {p.access_clearance_level && (
                          <div><span className="text-muted-foreground text-xs">Clearance:</span> <span className="capitalize">{p.access_clearance_level.replace('_', ' ')}</span></div>
                        )}
                        {p.access_badge_number && (
                          <div><span className="text-muted-foreground text-xs">Badge #:</span> <span>{p.access_badge_number}</span></div>
                        )}
                        {p.homeless_status && (
                          <div><span className="text-muted-foreground text-xs">Homeless Status:</span> <span className="capitalize">{p.homeless_status}</span></div>
                        )}
                        {p.flagged_reason && (
                          <div className="col-span-2 md:col-span-3">
                            <span className="text-muted-foreground text-xs">Flagged Reason:</span> <span className="text-amber-700">{p.flagged_reason}</span>
                          </div>
                        )}
                        {p.distinguishing_features && (
                          <div className="col-span-2 md:col-span-3">
                            <span className="text-muted-foreground text-xs">Distinguishing Features:</span> <span>{p.distinguishing_features}</span>
                          </div>
                        )}
                        {p.notes && (
                          <div className="col-span-2 md:col-span-3">
                            <span className="text-muted-foreground text-xs">Notes:</span> <span>{p.notes}</span>
                          </div>
                        )}
                        {p.privacy_lawful_purpose && (
                          <div className="col-span-2 md:col-span-3">
                            <span className="text-muted-foreground text-xs">Lawful Purpose:</span> <span>{p.privacy_lawful_purpose}</span>
                          </div>
                        )}
                        {p.expiry_date && (
                          <div><span className="text-muted-foreground text-xs">Record Expires:</span> <span className="text-red-600">{fmtDate(p.expiry_date)}</span></div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {persons.length} records
        </p>
      )}
    </AppLayout>
  )
}
