/**
 * VehicleDiscrepancies
 *
 * Admin page to review vehicle_discrepancies records.
 * Discrepancies are generated automatically when vehicle attribute sources disagree
 * (e.g. ALPR vs manual vs NZSCV).
 *
 * Roles: admin, admin_officer, master
 * Route: /vehicle-discrepancies
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import {
  AlertTriangle,
  CheckCircle,
  Search,
  Car,
  Loader2,
  ArrowUpRight,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

type Discrepancy = {
  id: string
  plate_number: string | null
  discrepancy_type: string
  severity: string
  source_a: string
  source_b: string
  value_a: string | null
  value_b: string | null
  details: any
  requires_review: boolean | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  observation_id: string
  organization_id: string | null
  created_at: string | null
}

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-300',
  high: 'bg-orange-50 text-orange-700 border-orange-300',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  low: 'bg-green-50 text-green-700 border-green-300',
}

export default function VehicleDiscrepancies() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [reviewedFilter, setReviewedFilter] = useState<'all' | 'pending' | 'reviewed'>('pending')

  // Review dialog state
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  const effectiveOrgId =
    user?.role !== 'master' && user?.role !== 'grand_master' ? user?.organization_id || null : organizationId || null

  // ── Main query ─────────────────────────────────────────────────────────────
  const { data: discrepancies, isLoading } = useQuery({
    queryKey: ['vehicle-discrepancies', effectiveOrgId, severityFilter, typeFilter, reviewedFilter],
    queryFn: async ({ signal }) => {
      let query = supabase
        .from('vehicle_discrepancies')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
        .abortSignal(signal)

      if (effectiveOrgId) query = query.eq('organization_id', effectiveOrgId)
      if (severityFilter !== 'all') query = query.eq('severity', severityFilter)
      if (typeFilter !== 'all') query = query.eq('discrepancy_type', typeFilter)
      if (reviewedFilter === 'pending') query = query.eq('requires_review', true).is('reviewed_at', null)
      if (reviewedFilter === 'reviewed') query = query.not('reviewed_at', 'is', null)

      const { data, error } = await query
      if (error) throw error
      return data as Discrepancy[]
    },
  })

  // ── Stats ──────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery({
    queryKey: ['discrepancy-stats', effectiveOrgId],
    queryFn: async () => {
      const baseQuery = (s: any) =>
        effectiveOrgId ? s.eq('organization_id', effectiveOrgId) : s

      const [totalRes, pendingRes, criticalRes] = await Promise.all([
        baseQuery(supabase.from('vehicle_discrepancies').select('*', { count: 'exact', head: true })),
        baseQuery(
          supabase
            .from('vehicle_discrepancies')
            .select('*', { count: 'exact', head: true })
            .eq('requires_review', true)
            .is('reviewed_at', null),
        ),
        baseQuery(
          supabase
            .from('vehicle_discrepancies')
            .select('*', { count: 'exact', head: true })
            .eq('severity', 'critical')
            .is('reviewed_at', null),
        ),
      ])

      return {
        total: totalRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        critical: criticalRes.count ?? 0,
      }
    },
  })

  // ── Mark reviewed mutation ─────────────────────────────────────────────────
  const markReviewedMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await (supabase.from('vehicle_discrepancies') as any)
        .update({
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          review_notes: notes || null,
          requires_review: false,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Discrepancy marked as reviewed')
      queryClient.invalidateQueries({ queryKey: ['vehicle-discrepancies'] })
      queryClient.invalidateQueries({ queryKey: ['discrepancy-stats'] })
      setReviewingId(null)
      setReviewNotes('')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to mark reviewed')
    },
  })

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = (discrepancies ?? []).filter((d) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      d.plate_number?.toLowerCase().includes(q) ||
      d.discrepancy_type.toLowerCase().includes(q) ||
      d.source_a.toLowerCase().includes(q) ||
      d.source_b.toLowerCase().includes(q)
    )
  })

  return (
    <AppLayout title="Vehicle Discrepancies" description="Review vehicle attribute conflicts requiring attention">
      <GlobalFilterRibbon />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Discrepancies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats?.pending ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Critical Unreviewed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats?.critical ?? '—'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search plate, type, source…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={reviewedFilter} onValueChange={(v) => setReviewedFilter(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending review</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="scv_status">SCV Status</SelectItem>
            <SelectItem value="make_model">Make / Model</SelectItem>
            <SelectItem value="colour">Colour</SelectItem>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="homeless_status">Homeless Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <CheckCircle className="h-10 w-10 mx-auto mb-3 text-green-400" />
            <p className="font-medium">No discrepancies found</p>
            <p className="text-sm mt-1">All vehicle records are consistent with current filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
            <Card key={d.id} className="border-l-4" style={{ borderLeftColor: d.severity === 'critical' ? '#ef4444' : d.severity === 'high' ? '#f97316' : d.severity === 'medium' ? '#eab308' : '#22c55e' }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {d.plate_number && (
                        <span className="font-mono font-bold text-base">{d.plate_number}</span>
                      )}
                      <Badge className={`text-xs border ${SEVERITY_COLOURS[d.severity] ?? 'bg-gray-50 text-gray-700 border-gray-300'}`}>
                        {d.severity.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {d.discrepancy_type.replace(/_/g, ' ')}
                      </Badge>
                      {d.reviewed_at ? (
                        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300">
                          <CheckCircle className="h-3 w-3 mr-1" />Reviewed
                        </Badge>
                      ) : d.requires_review ? (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                          <AlertTriangle className="h-3 w-3 mr-1" />Needs review
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-0.5">
                      <div>
                        <span className="font-medium">Source A</span> ({d.source_a}):&nbsp;
                        <span className="font-mono">{d.value_a ?? 'n/a'}</span>
                        &nbsp;vs&nbsp;
                        <span className="font-medium">Source B</span> ({d.source_b}):&nbsp;
                        <span className="font-mono">{d.value_b ?? 'n/a'}</span>
                      </div>
                      {d.created_at && (
                        <div className="text-xs text-gray-400">{formatDateTime(d.created_at)}</div>
                      )}
                      {d.review_notes && (
                        <div className="mt-1 p-2 bg-muted/40 rounded text-xs">
                          <span className="font-medium">Review notes:</span> {d.review_notes}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {!d.reviewed_at && d.requires_review && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => { setReviewingId(d.id); setReviewNotes('') }}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Mark Reviewed
                      </Button>
                    )}
                    {d.plate_number && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/vehicles/${d.plate_number}`)}
                      >
                        <Car className="h-4 w-4 mr-1" />
                        Vehicle
                        <ArrowUpRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!reviewingId} onOpenChange={(open) => { if (!open) setReviewingId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Discrepancy as Reviewed</DialogTitle>
            <DialogDescription>
              Optionally add review notes explaining the resolution or context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="vd-review-notes">Review Notes (optional)</Label>
              <Textarea
                id="vd-review-notes"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Describe how this discrepancy was resolved or why it can be disregarded…"
                className="min-h-20"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewingId(null)}>Cancel</Button>
            <Button
              onClick={() => reviewingId && markReviewedMutation.mutate({ id: reviewingId, notes: reviewNotes })}
              disabled={markReviewedMutation.isPending}
            >
              {markReviewedMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : 'Confirm Review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
