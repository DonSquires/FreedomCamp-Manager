/**
 * PhotoIntegrityHealthLog — B-127
 *
 * Admin viewer for photo_integrity_health aggregate coverage by organization.
 *
 * Features:
 *  - KPIs: Total org rows / Average coverage / Missing hash / Missing URL
 *  - Filters: organization name search / minimum coverage
 *
 * Route: /photo-integrity-health-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { ShieldCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

type HealthRow = Database['public']['Views']['photo_integrity_health']['Row']

export default function PhotoIntegrityHealthLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [orgQuery, setOrgQuery] = useState('')
  const [minCoverage, setMinCoverage] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<HealthRow[]>({
    queryKey: ['photo-integrity-health-log', orgId, orgQuery, minCoverage],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('photo_integrity_health')
        .select('*')
        .eq('organization_id', orgId!)

      if (orgQuery.trim()) q = q.ilike('organization_name', `%${orgQuery.trim()}%`)
      if (minCoverage.trim()) {
        const min = Number(minCoverage)
        if (!Number.isNaN(min)) q = q.gte('photo_coverage_pct', min)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const avgCoverage = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + (r.photo_coverage_pct ?? 0), 0) / rows.length)
    : 0
  const missingHashTotal = rows.reduce((sum, r) => sum + (r.missing_hash ?? 0), 0)
  const missingUrlTotal = rows.reduce((sum, r) => sum + (r.missing_url ?? 0), 0)

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Photo Integrity Health</h1>
              <p className="text-sm text-muted-foreground">Organization-level photo coverage and integrity counters</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Rows', value: rows.length, colour: 'text-gray-700' },
            { label: 'Avg Coverage %', value: avgCoverage, colour: 'text-emerald-700' },
            { label: 'Missing Hash', value: missingHashTotal, colour: 'text-amber-700' },
            { label: 'Missing URL', value: missingUrlTotal, colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={orgQuery}
            onChange={e => setOrgQuery(e.target.value)}
            placeholder="Search organization…"
            className="w-56"
          />
          <Input
            value={minCoverage}
            onChange={e => setMinCoverage(e.target.value)}
            placeholder="Min coverage %"
            className="w-40"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No photo integrity rows found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Total Obs</TableHead>
                  <TableHead>With Photo</TableHead>
                  <TableHead>Coverage %</TableHead>
                  <TableHead>Missing Any</TableHead>
                  <TableHead>Missing Hash</TableHead>
                  <TableHead>Missing URL</TableHead>
                  <TableHead>Latest Observation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={`${row.organization_id ?? 'org'}-${idx}`}>
                    <TableCell className="font-medium">{row.organization_name ?? '—'}</TableCell>
                    <TableCell>{row.total_observations ?? 0}</TableCell>
                    <TableCell>{row.with_photo ?? 0}</TableCell>
                    <TableCell className="font-mono">{row.photo_coverage_pct ?? 0}%</TableCell>
                    <TableCell>{row.missing_any ?? 0}</TableCell>
                    <TableCell>{row.missing_hash ?? 0}</TableCell>
                    <TableCell>{row.missing_url ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.latest_observation ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
