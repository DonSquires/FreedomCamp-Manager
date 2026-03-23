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
  const [dryRun, setDryRun] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)

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
    try {
      const result = await edgeFunctions.syncScvList({ dry_run: dryRun })
      if (result.error) throw new Error(result.error)
      setSyncResult(result.data)
      toast.success(dryRun ? 'Dry run complete — no changes written' : 'SCV list sync triggered')
      if (!dryRun) {
        refetch()
      }
    } catch (err: any) {
      toast.error(err?.message || 'Sync failed')
    } finally {
      setSyncing(false)
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
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</>
                : <><RefreshCw className="h-4 w-4 mr-2" />Sync NZSCV List</>}
            </Button>
          </div>
          {syncResult && (
            <div className="mt-3 p-3 bg-muted/40 rounded text-sm">
              <p className="font-medium mb-1">Sync Result</p>
              <pre className="text-xs overflow-auto whitespace-pre-wrap">{JSON.stringify(syncResult, null, 2)}</pre>
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
