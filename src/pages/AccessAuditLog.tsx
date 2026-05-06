/**
 * AccessAuditLog — B-41
 *
 * Identity Verification & Access Entries Audit Log.
 * Shows a filterable, paginated timeline of all access_entries records
 * (face + ID verification events) per zone, person, and verification method.
 *
 * Features:
 *   - KPI cards: Total entries, Granted, Denied, Failed-face-match
 *   - Filters: entry type, verification method, keyword (person / zone)
 *   - Timeline table with face-match confidence badge and pass/fail icon
 *   - Outcome summary pill (Granted / Denied / Manual Override)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ShieldCheck, Search, RefreshCw, CheckCircle2, XCircle, AlertCircle, Loader2,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

// ─── Types ────────────────────────────────────────────────────────────────────

type AccessEntry = {
  id: string
  organization_id: string
  entry_type: string
  verification_method: string
  face_match_confidence: number | null
  face_match_passed: boolean | null
  id_verified: boolean | null
  id_name_matches: boolean | null
  officer_override_reason: string | null
  notes: string | null
  created_at: string
  zones: { name: string } | null
  person_records: { first_name: string | null; last_name: string | null } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTRY_TYPES       = ['entry', 'exit', 'denied']
const VERIFY_METHODS    = ['face_only', 'id_only', 'face_and_id', 'badge_scan', 'manual_override', 'denied_no_match']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: string) {
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function entryBadge(entry_type: string) {
  const map: Record<string, string> = {
    entry:  'bg-green-100 text-green-800',
    exit:   'bg-blue-100 text-blue-800',
    denied: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[entry_type] ?? 'bg-gray-100 text-gray-600'}`}>
      {entry_type}
    </span>
  )
}

function confidenceBadge(conf: number | null) {
  if (conf === null) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round(conf * 100)
  const color = pct >= 90 ? 'text-green-700' : pct >= 70 ? 'text-yellow-700' : 'text-red-700'
  return <span className={`text-xs font-mono font-medium ${color}`}>{pct}%</span>
}

function passIcon(passed: boolean | null) {
  if (passed === null) return null
  return passed
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : <XCircle className="h-4 w-4 text-red-500" />
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccessAuditLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const [search, setSearch]           = useState('')
  const [filterType, setFilterType]   = useState('all')
  const [filterMethod, setFilterMethod] = useState('all')

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: entries = [], isLoading, refetch } = useQuery({
    queryKey: ['access_entries', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('access_entries')
        .select(`
          id, organization_id, entry_type, verification_method,
          face_match_confidence, face_match_passed,
          id_verified, id_name_matches,
          officer_override_reason, notes, created_at,
          zones(name),
          person_records(first_name, last_name)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as AccessEntry[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:        entries.length,
    granted:      entries.filter(e => e.entry_type === 'entry').length,
    denied:       entries.filter(e => e.entry_type === 'denied').length,
    failedFace:   entries.filter(e => e.face_match_passed === false).length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = entries.filter(e => {
    if (filterType !== 'all' && e.entry_type !== filterType) return false
    if (filterMethod !== 'all' && e.verification_method !== filterMethod) return false
    if (search) {
      const q = search.toLowerCase()
      const personName = [e.person_records?.first_name, e.person_records?.last_name].filter(Boolean).join(' ').toLowerCase()
      const zoneName   = (e.zones?.name ?? '').toLowerCase()
      if (!personName.includes(q) && !zoneName.includes(q)) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Access Audit Log" description="Identity verification and access control event timeline">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">Access Audit Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Events',    value: kpis.total,      color: 'text-foreground' },
          { label: 'Access Granted',  value: kpis.granted,    color: 'text-green-600' },
          { label: 'Access Denied',   value: kpis.denied,     color: 'text-red-600' },
          { label: 'Face Match Fail', value: kpis.failedFace, color: 'text-orange-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* No data state for empty org */}
      {!isLoading && entries.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No access entries recorded yet. Entries will appear here once identity verification is performed at access-controlled zones.</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search person name or zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Entry type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ENTRY_TYPES.map(t => (
              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterMethod} onValueChange={setFilterMethod}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Verify method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {VERIFY_METHODS.map(m => (
              <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Face Conf.</TableHead>
              <TableHead>Face Pass</TableHead>
              <TableHead>ID Verified</TableHead>
              <TableHead>Override Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && entries.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No entries match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(e => (
              <TableRow key={e.id}>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {formatTs(e.created_at)}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {e.zones?.name ?? <span className="text-muted-foreground italic">Unknown</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {e.person_records
                    ? [e.person_records.first_name, e.person_records.last_name].filter(Boolean).join(' ')
                    : <span className="text-muted-foreground italic">Anonymous</span>}
                </TableCell>
                <TableCell>{entryBadge(e.entry_type)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {e.verification_method.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell>{confidenceBadge(e.face_match_confidence)}</TableCell>
                <TableCell className="flex items-center justify-center pt-3">{passIcon(e.face_match_passed)}</TableCell>
                <TableCell>{passIcon(e.id_verified)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-32 truncate">
                  {e.officer_override_reason ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AppLayout>
  )
}
