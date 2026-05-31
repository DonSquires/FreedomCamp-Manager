/**
 * SiteIncidentLog — B-69
 *
 * Admin log for site_incidents — incidents logged by officers at client sites.
 *
 * Features:
 *  - KPI cards: Total / Open / Under Review / Closed / Police Notified
 *  - Filters: status, severity, incident_type, search
 *  - Table: incident_type, severity, status, officer, site, police_notified, created_at
 *  - Expandable row: description, action_taken, subject, outcome, notes
 *  - Review action: marks reviewed_at + reviewed_by (status → reviewed)
 *
 * Route: /site-incidents — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Building2, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, Clock, ChevronDown, ChevronRight, Shield,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

type SiteIncident = Database['public']['Tables']['site_incidents']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const SEVERITY_COLOURS: Record<string, string> = {
  critical:  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high:      'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low:       'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

const STATUS_COLOURS: Record<string, string> = {
  open:           'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  under_review:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  reviewed:       'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  closed:         'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-300',
}

const STATUS_LABEL: Record<string, string> = {
  open:         'Open',
  under_review: 'Under Review',
  reviewed:     'Reviewed',
  closed:       'Closed',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SiteIncidentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]               = useState('')
  const [filterStatus, setFilterStatus]   = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterType, setFilterType]       = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: incidents = [], isLoading, error, refetch } = useQuery<SiteIncident[]>({
    queryKey: ['site-incidents', orgId],
    queryFn: async () => {
      let q = supabase
        .from('site_incidents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = incidents.filter(i => {
    if (filterStatus !== 'all' && i.status !== filterStatus) return false
    if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false
    if (filterType !== 'all' && i.incident_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        i.incident_type?.toLowerCase().includes(s) ||
        i.description?.toLowerCase().includes(s) ||
        i.subject_name?.toLowerCase().includes(s) ||
        i.location_description?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total          = incidents.length
  const openCount      = incidents.filter(i => i.status === 'open').length
  const reviewCount    = incidents.filter(i => i.status === 'under_review').length
  const closedCount    = incidents.filter(i => i.status === 'closed' || i.status === 'reviewed').length
  const policeNotified = incidents.filter(i => i.police_notified).length

  const incidentTypes = Array.from(new Set(incidents.map(i => i.incident_type).filter(Boolean)))

  // ── Review mutation ───────────────────────────────────────────────────────

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('site_incidents')
        .update({
          status:      'reviewed',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          updated_at:  new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-incidents'] })
      toast.success('Incident marked as reviewed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-7 w-7 text-indigo-500" />
            <div>
              <h1 className="text-2xl font-bold">Site Incident Log</h1>
              <p className="text-sm text-muted-foreground">Officer-reported incidents at client sites</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: 'Total',           value: total,          icon: Building2,    colour: 'text-slate-600' },
            { label: 'Open',            value: openCount,      icon: AlertCircle,  colour: 'text-blue-600' },
            { label: 'Under Review',    value: reviewCount,    icon: Clock,        colour: 'text-amber-600' },
            { label: 'Reviewed/Closed', value: closedCount,    icon: CheckCircle2, colour: 'text-green-600' },
            { label: 'Police Notified', value: policeNotified, icon: Shield,       colour: policeNotified > 0 ? 'text-red-600' : 'text-muted-foreground' },
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
              placeholder="Type, description, subject, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          {incidentTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Incident Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {incidentTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
              <div className="text-center py-12 text-muted-foreground text-sm">No incidents match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Incident Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Police</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead>Actions</TableHead>
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
                          <TableCell className="font-medium capitalize">
                            {i.incident_type?.replace(/_/g, ' ') ?? '—'}
                          </TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${SEVERITY_COLOURS[i.severity] ?? ''}`}>
                              {i.severity}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${STATUS_COLOURS[i.status] ?? ''}`}>
                              {STATUS_LABEL[i.status] ?? i.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{i.subject_name ?? '—'}</TableCell>
                          <TableCell>
                            {i.police_notified ? (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Yes</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">No</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {fmtDate(i.created_at)}
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            {(i.status === 'open' || i.status === 'under_review') && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={markReviewed.isPending}
                                onClick={() => markReviewed.mutate(i.id)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Mark Reviewed
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${i.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={8} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Description</p>
                                  <p>{i.description || '—'}</p>
                                </div>
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Action Taken</p>
                                  <p>{i.action_taken || '—'}</p>
                                </div>
                                {i.subject_description && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Subject Description</p>
                                    <p>{i.subject_description}</p>
                                  </div>
                                )}
                                {i.outcome && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Outcome</p>
                                    <p>{i.outcome}</p>
                                  </div>
                                )}
                                {i.police_notified && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Police Details</p>
                                    <p>Event #{i.police_event_number ?? '—'} · {i.police_station ?? '—'}</p>
                                    {i.police_officer_name && <p>Officer: {i.police_officer_name}</p>}
                                  </div>
                                )}
                                {i.admin_notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Admin Notes</p>
                                    <p>{i.admin_notes}</p>
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
