/**
 * PersonInteractionLog — B-70
 *
 * Admin log for person_interactions — every officer-to-person contact event.
 *
 * Features:
 *  - KPI cards: Total / Follow-up Required / Linked to Incident / Linked to H&S
 *  - Filters: interaction_type, follow-up required toggle, search (person_id / notes)
 *  - Table: interaction_at, type, officer, outcome, follow_up_date, zone
 *  - Expandable row detail: notes, GPS, photos count, linked incident/hs_report
 *
 * Route: /person-interactions — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Users, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CalendarClock, MapPin,
  Image as ImageIcon, LinkIcon,
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
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type PersonInteraction = Database['public']['Tables']['person_interactions']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDateShort(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

const TYPE_COLOURS: Record<string, string> = {
  warning:       'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  caution:       'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  information:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  welfare_check: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  enforcement:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  eviction:      'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PersonInteractionLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]             = useState('')
  const [filterType, setFilterType]     = useState('all')
  const [filterFollowUp, setFilterFollowUp] = useState(false)
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: interactions = [], isLoading, error, refetch } = useQuery<PersonInteraction[]>({
    queryKey: ['person-interactions', orgId],
    queryFn: async () => {
      let q = supabase
        .from('person_interactions')
        .select('*')
        .order('interaction_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = interactions.filter(i => {
    if (filterType !== 'all' && i.interaction_type !== filterType) return false
    if (filterFollowUp && !i.requires_follow_up) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        i.person_id?.toLowerCase().includes(s) ||
        i.officer_notes?.toLowerCase().includes(s) ||
        i.outcome?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total        = interactions.length
  const followUpReq  = interactions.filter(i => i.requires_follow_up).length
  const linkedInc    = interactions.filter(i => i.incident_id).length
  const linkedHs     = interactions.filter(i => i.hs_report_id).length

  const types = Array.from(new Set(interactions.map(i => i.interaction_type).filter(Boolean)))

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Users className="h-7 w-7 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold">Person Interaction Log</h1>
              <p className="text-sm text-muted-foreground">Officer-to-person contact events and outcomes</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',             value: total,       icon: Users,        colour: 'text-slate-600' },
            { label: 'Follow-up Required',value: followUpReq, icon: CalendarClock,colour: followUpReq > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'Linked Incidents',  value: linkedInc,   icon: LinkIcon,     colour: 'text-red-500' },
            { label: 'Linked H&S Reports',value: linkedHs,    icon: LinkIcon,     colour: 'text-blue-500' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Person ID, notes, outcome…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Interaction Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {types.map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={filterFollowUp ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterFollowUp(f => !f)}
          >
            <CalendarClock className="h-4 w-4 mr-1.5" />
            Follow-up Required{filterFollowUp && ` (${followUpReq})`}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No interactions match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Interaction At</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Follow-up</TableHead>
                    <TableHead>Photos</TableHead>
                    <TableHead>Links</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(i => {
                    const isExpanded = expandedId === i.id
                    return (
                      <>
                        <TableRow
                          key={i.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : i.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(i.interaction_at)}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${TYPE_COLOURS[i.interaction_type] ?? 'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-300'}`}>
                              {i.interaction_type?.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {i.outcome ?? '—'}
                          </TableCell>
                          <TableCell>
                            {i.requires_follow_up ? (
                              <div className="text-sm text-orange-600 flex items-center gap-1">
                                <CalendarClock className="h-3.5 w-3.5" />
                                {fmtDateShort(i.follow_up_date)}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(i.photos?.length ?? 0) > 0 ? (
                              <span className="flex items-center gap-1">
                                <ImageIcon className="h-3.5 w-3.5" />
                                {i.photos!.length}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1.5">
                              {i.incident_id && (
                                <Badge className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 text-xs">
                                  Incident
                                </Badge>
                              )}
                              {i.hs_report_id && (
                                <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 text-xs">
                                  H&S
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${i.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={7} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                {i.officer_notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Officer Notes</p>
                                    <p>{i.officer_notes}</p>
                                  </div>
                                )}
                                {(i.gps_latitude != null && i.gps_longitude != null) && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">GPS Location</p>
                                    <p className="flex items-center gap-1">
                                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                      {i.gps_latitude.toFixed(5)}, {i.gps_longitude.toFixed(5)}
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Person ID</p>
                                  <p className="font-mono text-xs">{i.person_id}</p>
                                </div>
                                {i.vehicle_id && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Vehicle ID</p>
                                    <p className="font-mono text-xs">{i.vehicle_id}</p>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
