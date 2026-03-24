/**
 * NZSCVMonitor
 *
 * Admin page to monitor canonical_scv (Self-Contained Vehicle) certifications.
 * Shows all plates in the canonical SCV registry, their certification status,
 * expiry dates, and source. Allows triggering a sync from the NZSCV list.
 *
 * Roles: admin, master, nzscv_monitor
 * Route: /admin/nzscv
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import {
  loadScvCurrentEntries,
  mergeScvResults,
  EMPTY_SCV_RESULT,
  SCV_BATCH_SIZE,
  type ScvSyncResult,
  type ScvSyncResponse,
} from '@/lib/scvUtils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CheckCircle,
  XCircle,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Clock,
} from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

type CanonicalScvRow = {
  plate_number: string
  is_self_contained: boolean
  certificate_expiry: string | null
  source: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export default function NZSCVMonitor() {
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [scvFilter, setScvFilter] = useState<'all' | 'certified' | 'not_certified' | 'expired'>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState(false)
  const [syncResult, setSyncResult] = useState<ScvSyncResult | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────
  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ['canonical-scv', scvFilter, sourceFilter],
    queryFn: async ({ signal }) => {
      let query = supabase
        .from('canonical_scv')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)
        .abortSignal(signal)

      if (scvFilter === 'certified') query = query.eq('is_self_contained', true)
      if (scvFilter === 'not_certified') query = query.eq('is_self_contained', false)
      if (scvFilter === 'expired') {
        query = query
          .eq('is_self_contained', true)
          .not('certificate_expiry', 'is', null)
          .lt('certificate_expiry', new Date().toISOString())
      }
      if (sourceFilter !== 'all') query = query.eq('source', sourceFilter)

      const { data, error } = await query
      if (error) throw error
      return data as CanonicalScvRow[]
    },
  })

  // ── Stats ──────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery({
    queryKey: ['canonical-scv-stats'],
    queryFn: async () => {
      const [totalRes, certRes, notCertRes, expiredRes] = await Promise.all([
        supabase.from('canonical_scv').select('*', { count: 'exact', head: true }),
        supabase.from('canonical_scv').select('*', { count: 'exact', head: true }).eq('is_self_contained', true),
        supabase.from('canonical_scv').select('*', { count: 'exact', head: true }).eq('is_self_contained', false),
        supabase
          .from('canonical_scv')
          .select('*', { count: 'exact', head: true })
          .eq('is_self_contained', true)
          .not('certificate_expiry', 'is', null)
          .lt('certificate_expiry', new Date().toISOString()),
      ])
      return {
        total: totalRes.count ?? 0,
        certified: certRes.count ?? 0,
        notCertified: notCertRes.count ?? 0,
        expired: expiredRes.count ?? 0,
      }
    },
  })

  // ── Distinct sources for filter ─────────────────────────────────────────────
  const sources = Array.from(new Set((rows ?? []).map((r) => r.source).filter(Boolean))) as string[]

  // ── Trigger sync ──────────────────────────────────────────────────────────
  const handleSync = async () => {
    if (user?.role === 'nzscv_monitor' && !user?.organization_id) {
      toast.error('Insufficient permissions to trigger sync')
      return
    }
    setSyncing(true)
    setSyncResult(null)
    setSyncStatus('Loading SCV list…')

    try {
      // Step 1: fetch + parse the NZSCV Excel file client-side so the edge
      // function receives pre-parsed entries rather than fetching the file itself.
      const scvCurrentEntries = await loadScvCurrentEntries()
      if (scvCurrentEntries.length === 0) {
        toast.error('SCV list contains no current entries')
        return
      }

      // Step 2: run batched sync — each call processes one page of canonical_vehicles
      let offset = 0
      let aggregate = { ...EMPTY_SCV_RESULT }
      let hasMore = true
      let batchNumber = 0

      while (hasMore) {
        batchNumber++
        setSyncStatus(`Syncing batch ${batchNumber}…`)

        const { data, error } = await edgeFunctions.syncScvList({
          dry_run: dryRun,
          offset,
          batch_size: SCV_BATCH_SIZE,
          include_related_updates: true,
          scv_total_in_list: scvCurrentEntries.length,
          scv_current_entries: scvCurrentEntries,
        })

        if (error) {
          toast.error(`SCV sync failed: ${error}`)
          return
        }

        const response = data as ScvSyncResponse | null
        if (!response?.result || !response.batch) {
          toast.error('SCV sync returned an invalid response')
          return
        }

        aggregate = mergeScvResults(aggregate, response.result)
        hasMore = response.batch.has_more
        offset = response.batch.next_offset ?? 0
      }

      setSyncResult(aggregate)
      toast.success(dryRun ? 'Dry run complete — no changes written' : 'SCV list sync complete')
      if (!dryRun) {
        refetch()
      }
    } catch (err: any) {
      toast.error(err?.message || 'Sync failed')
    } finally {
      setSyncing(false)
      setSyncStatus(null)
    }
  }

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = (rows ?? []).filter((r) => {
    if (!searchQuery.trim()) return true
    return r.plate_number.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const isExpired = (row: CanonicalScvRow) =>
    row.is_self_contained &&
    row.certificate_expiry &&
    new Date(row.certificate_expiry) < new Date()

  return (
    <AppLayout
      title="NZSCV Monitor"
      description="Self-Contained Vehicle certification registry"
      showBackButton
    >
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Certified SCV</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.certified ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Not SCV</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600">{stats?.notCertified ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Expired Certs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats?.expired ?? '—'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Sync Controls */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                id="nzscv-dryrun"
                type="checkbox"
                className="h-4 w-4"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              <label htmlFor="nzscv-dryrun" className="text-sm font-medium">Dry run (preview only)</label>
            </div>
            <Button onClick={handleSync} disabled={syncing}>
              {syncing
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{syncStatus ?? 'Syncing…'}</>
                : <><RefreshCw className="h-4 w-4 mr-2" />Sync NZSCV List</>}
            </Button>
          </div>
          {syncResult && (
            <div className="mt-3 p-3 bg-muted/40 rounded text-sm space-y-1">
              <p className="font-medium mb-1">
                {dryRun ? 'Dry-run result (no changes written)' : 'Sync result'}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">SCV list entries:</span>
                <span className="font-medium">{syncResult.total_in_scv_list.toLocaleString()}</span>
                <span />
                <span className="text-muted-foreground">Vehicles checked:</span>
                <span className="font-medium">{syncResult.canonical_vehicles_checked.toLocaleString()}</span>
                <span />
                <span className="text-muted-foreground">Set to current:</span>
                <span className="font-medium text-green-600">{syncResult.set_to_current.toLocaleString()}</span>
                <span />
                <span className="text-muted-foreground">Set to not current:</span>
                <span className="font-medium text-red-600">{syncResult.set_to_not_current.toLocaleString()}</span>
                <span />
                <span className="text-muted-foreground">Expiry corrected:</span>
                <span className="font-medium">{syncResult.expiry_corrected.toLocaleString()}</span>
                <span />
                <span className="text-muted-foreground">Unchanged:</span>
                <span className="font-medium">{syncResult.unchanged.toLocaleString()}</span>
                <span />
                <span className="text-muted-foreground">canonical_scv enriched:</span>
                <span className="font-medium">{syncResult.canonical_scv_enriched.toLocaleString()}</span>
                <span />
              </div>
              {syncResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-600">
                  <p className="font-medium">Errors ({syncResult.errors.length}):</p>
                  <ul className="list-disc ml-4 space-y-0.5">
                    {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search plate…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={scvFilter} onValueChange={(v) => setScvFilter(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="certified">✅ Certified SCV</SelectItem>
            <SelectItem value="not_certified">❌ Not SCV</SelectItem>
            <SelectItem value="expired">⚠️ Expired cert</SelectItem>
          </SelectContent>
        </Select>
        {sources.length > 0 && (
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            No records found for the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Plate</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Certificate Expiry</th>
                <th className="text-left px-4 py-3 font-medium">Source</th>
                <th className="text-left px-4 py-3 font-medium">Verified At</th>
                <th className="text-left px-4 py-3 font-medium">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((row) => {
                const expired = isExpired(row)
                return (
                  <tr key={row.plate_number} className="hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono font-semibold">{row.plate_number}</td>
                    <td className="px-4 py-2">
                      {row.is_self_contained ? (
                        expired ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />Expired
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                            <CheckCircle className="h-3 w-3 mr-1" />Certified
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-300">
                          <XCircle className="h-3 w-3 mr-1" />Not SCV
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {row.certificate_expiry ? (
                        <span className={expired ? 'text-amber-600 font-medium' : ''}>
                          {expired && <Clock className="h-3.5 w-3.5 inline mr-1" />}
                          {formatDate(row.certificate_expiry)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-muted-foreground text-xs">{row.source ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {row.verified_at ? formatDateTime(row.verified_at) : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDateTime(row.updated_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 500 && (
            <div className="text-center py-2 text-xs text-muted-foreground border-t">
              Showing first 500 records — use search/filters to narrow results
            </div>
          )}
        </div>
      )}
    </AppLayout>
  )
}
