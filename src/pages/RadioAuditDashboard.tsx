/**
 * RadioAuditDashboard — Ticket Group E: Trust and Operations
 *
 * Provides admin-gated visibility into:
 *  - Voice twin consent records (active, revoked) — Group E.1 audit trail
 *  - Synthetic TTS render records with audit tags — Group E.2 synthetic media check
 *  - 7-day synthetic render volume chart (recharts)
 *
 * Route: /radio/audit — accessible to admin, admin_officer, master, grand_master only.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Activity, AlertTriangle, ArrowLeft, ShieldCheck, Volume2 } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatInTimeZone } from 'date-fns-tz'

const NZ_TZ = 'Pacific/Auckland'
const CAN_MANAGE_ROLES = ['admin', 'admin_officer', 'master', 'grand_master']

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  return formatInTimeZone(new Date(iso), NZ_TZ, 'dd MMM yyyy HH:mm')
}

interface ConsentRow {
  id: string
  officer_id: string
  officer_name: string | null
  purpose: string | null
  provider: string | null
  retention_days: number | null
  consented_at: string | null
  revoked_at: string | null
  revocation_reason: string | null
}

interface RenderRow {
  id: string
  created_at: string
  target_language: string
  provider: string
  is_synthetic: boolean
  render_latency_ms: number | null
  duration_ms: number | null
  voice_profile_id: string | null
}

interface DayBucket {
  day: string
  renders: number
}

interface LatencyBucket {
  label: string
  count: number
}

interface LatencyTrendPoint {
  ts: string
  latency: number
}

export default function RadioAuditDashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const effectiveOrgId = user?.organization_id ?? null
  const [activeTab, setActiveTab] = useState('consents')

  const canAccess = CAN_MANAGE_ROLES.includes(user?.role || '')

  const { data: consents = [], isLoading: consentsLoading } = useQuery<ConsentRow[]>({
    queryKey: ['radio-audit-consents', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return []
      const { data, error } = await (supabase as any)
        .from('radio_voice_consents')
        .select(`
          id,
          officer_id,
          purpose,
          provider,
          retention_days,
          consented_at,
          revoked_at,
          revocation_reason
        `)
        .eq('organization_id', effectiveOrgId)
        .order('consented_at', { ascending: false })
        .limit(200)
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        officer_id: r.officer_id,
        officer_name: r.officer_name ?? null,
        purpose: r.purpose ?? null,
        provider: r.provider ?? null,
        retention_days: r.retention_days ?? null,
        consented_at: r.consented_at ?? null,
        revoked_at: r.revoked_at ?? null,
        revocation_reason: r.revocation_reason ?? null,
      }))
    },
    enabled: !!effectiveOrgId && canAccess,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

  const { data: renders = [], isLoading: rendersLoading } = useQuery<RenderRow[]>({
    queryKey: ['radio-audit-renders', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return []
      const { data, error } = await (supabase as any)
        .from('radio_tts_renders')
        .select('id, created_at, target_language, provider, is_synthetic, render_latency_ms, duration_ms, voice_profile_id')
        .eq('organization_id', effectiveOrgId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        target_language: r.target_language ?? '—',
        provider: r.provider ?? 'unknown',
        is_synthetic: r.is_synthetic !== false,
        render_latency_ms: Number.isFinite(Number(r.render_latency_ms)) ? Number(r.render_latency_ms) : null,
        duration_ms: Number.isFinite(Number(r.duration_ms)) ? Number(r.duration_ms) : null,
        voice_profile_id: r.voice_profile_id ?? null,
      }))
    },
    enabled: !!effectiveOrgId && canAccess,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

  // 7-day synthetic render volume buckets
  const renderVolume = useMemo((): DayBucket[] => {
    const buckets: Record<string, number> = {}
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      buckets[formatInTimeZone(d, NZ_TZ, 'dd MMM')] = 0
    }
    for (const r of renders) {
      const dayKey = formatInTimeZone(new Date(r.created_at), NZ_TZ, 'dd MMM')
      if (dayKey in buckets) {
        buckets[dayKey] = (buckets[dayKey] || 0) + 1
      }
    }
    return Object.entries(buckets).map(([day, count]) => ({ day, renders: count }))
  }, [renders])

  const activeConsents = useMemo(() => consents.filter((c) => !c.revoked_at), [consents])
  const revokedConsents = useMemo(() => consents.filter((c) => !!c.revoked_at), [consents])
  const syntheticRenders = useMemo(() => renders.filter((r) => r.is_synthetic), [renders])
  const voiceTwinRenders = useMemo(() => renders.filter((r) => !!r.voice_profile_id), [renders])

  // Latency stats derived from render_latency_ms
  const latencyValues = useMemo(
    () => renders.map((r) => r.render_latency_ms).filter((v): v is number => v !== null),
    [renders],
  )
  const latencyStats = useMemo(() => {
    if (latencyValues.length === 0) return null
    const sorted = [...latencyValues].sort((a, b) => a - b)
    const sum = sorted.reduce((acc, v) => acc + v, 0)
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      mean: Math.round(sum / sorted.length),
      max: sorted[sorted.length - 1] ?? 0,
      count: sorted.length,
    }
  }, [latencyValues])

  // Latency distribution histogram — 10 buckets 0–500 ms, overflow bucket
  const latencyHistogram = useMemo((): LatencyBucket[] => {
    const BUCKETS = 10
    const BUCKET_SIZE = 50
    const counts = Array(BUCKETS + 1).fill(0) as number[]
    for (const v of latencyValues) {
      const idx = Math.min(Math.floor(v / BUCKET_SIZE), BUCKETS)
      counts[idx]++
    }
    return counts.map((count, i) => ({
      label: i < BUCKETS ? `${i * BUCKET_SIZE}–${(i + 1) * BUCKET_SIZE}` : '500+',
      count,
    }))
  }, [latencyValues])

  // Latency trend — last 50 renders with latency, oldest first
  const latencyTrend = useMemo((): LatencyTrendPoint[] => {
    return renders
      .filter((r) => r.render_latency_ms !== null)
      .slice(0, 50)
      .reverse()
      .map((r, i) => ({
        ts: String(i + 1),
        latency: r.render_latency_ms!,
      }))
  }, [renders])

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-slate-400">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <p className="text-lg font-medium">Access restricted</p>
        <p className="text-sm">Radio audit dashboard requires admin or supervisor role.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/radio')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Radio
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/radio')} className="text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-4 w-4 mr-1" /> Radio
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Radio Audit Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Voice twin consent records and synthetic render audit log</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800" data-testid="stat-active-consents">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider">Active Consents</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-2xl font-bold text-green-400">{activeConsents.length}</span>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800" data-testid="stat-revoked-consents">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider">Revoked Consents</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-2xl font-bold text-red-400">{revokedConsents.length}</span>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800" data-testid="stat-synthetic-renders">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider">Synthetic Renders</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-2xl font-bold text-violet-400">{syntheticRenders.length}</span>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800" data-testid="stat-voice-twin-renders">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider">Voice Twin Renders</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span className="text-2xl font-bold text-cyan-400">{voiceTwinRenders.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* 7-day render chart */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-violet-400" />
            Synthetic Renders — Last 7 Days
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={renderVolume} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#a78bfa' }}
              />
              <Bar dataKey="renders" fill="#7c3aed" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabs: Consents / Renders */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="consents" className="data-[state=active]:bg-slate-700 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Consent Records
          </TabsTrigger>
          <TabsTrigger value="renders" className="data-[state=active]:bg-slate-700 text-xs">
            <Volume2 className="h-3.5 w-3.5 mr-1" />
            Render Audit Log
          </TabsTrigger>
          <TabsTrigger value="latency" className="data-[state=active]:bg-slate-700 text-xs">
            <Activity className="h-3.5 w-3.5 mr-1" />
            Latency
          </TabsTrigger>
        </TabsList>

        {/* Consent Records */}
        <TabsContent value="consents" className="mt-3">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-0">
              {consentsLoading ? (
                <p className="text-sm text-slate-500 p-4">Loading consent records…</p>
              ) : consents.length === 0 ? (
                <p className="text-sm text-slate-500 p-4">No consent records found for this organisation.</p>
              ) : (
                <ScrollArea className="max-h-[380px]">
                  <Table data-testid="consent-audit-table">
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400 text-xs">Status</TableHead>
                        <TableHead className="text-slate-400 text-xs">Officer ID</TableHead>
                        <TableHead className="text-slate-400 text-xs">Purpose</TableHead>
                        <TableHead className="text-slate-400 text-xs">Provider</TableHead>
                        <TableHead className="text-slate-400 text-xs">Retention</TableHead>
                        <TableHead className="text-slate-400 text-xs">Consented</TableHead>
                        <TableHead className="text-slate-400 text-xs">Revoked</TableHead>
                        <TableHead className="text-slate-400 text-xs">Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consents.map((c) => (
                        <TableRow key={c.id} className="border-slate-800 hover:bg-slate-800/40">
                          <TableCell>
                            {c.revoked_at ? (
                              <Badge variant="destructive" className="text-[9px] py-0 px-1.5">Revoked</Badge>
                            ) : (
                              <Badge className="text-[9px] py-0 px-1.5 bg-green-900/60 text-green-300 border border-green-700/50 hover:bg-green-900/60">Active</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 font-mono">{c.officer_id.slice(0, 8)}…</TableCell>
                          <TableCell className="text-xs text-slate-300">{c.purpose ?? '—'}</TableCell>
                          <TableCell className="text-xs text-slate-400">{c.provider ?? '—'}</TableCell>
                          <TableCell className="text-xs text-slate-400">{c.retention_days != null ? `${c.retention_days}d` : '—'}</TableCell>
                          <TableCell className="text-xs text-slate-400 tabular-nums">{fmtTs(c.consented_at)}</TableCell>
                          <TableCell className="text-xs text-slate-400 tabular-nums">{fmtTs(c.revoked_at)}</TableCell>
                          <TableCell className="text-xs text-slate-500 max-w-[140px] truncate">{c.revocation_reason ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Render Audit Log */}
        <TabsContent value="renders" className="mt-3">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-0">
              {rendersLoading ? (
                <p className="text-sm text-slate-500 p-4">Loading render records…</p>
              ) : renders.length === 0 ? (
                <p className="text-sm text-slate-500 p-4">No synthetic render records found for this organisation.</p>
              ) : (
                <ScrollArea className="max-h-[380px]">
                  <Table data-testid="render-audit-table">
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400 text-xs">Synthetic</TableHead>
                        <TableHead className="text-slate-400 text-xs">Voice Twin</TableHead>
                        <TableHead className="text-slate-400 text-xs">Provider</TableHead>
                        <TableHead className="text-slate-400 text-xs">Language</TableHead>
                        <TableHead className="text-slate-400 text-xs">Latency</TableHead>
                        <TableHead className="text-slate-400 text-xs">Duration</TableHead>
                        <TableHead className="text-slate-400 text-xs">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renders.map((r) => (
                        <TableRow key={r.id} className="border-slate-800 hover:bg-slate-800/40">
                          <TableCell>
                            {r.is_synthetic ? (
                              <Badge className="text-[9px] py-0 px-1.5 bg-violet-900/60 text-violet-300 border border-violet-700/50 hover:bg-violet-900/60">Synthetic</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-slate-500">Original</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.voice_profile_id ? (
                              <Badge className="text-[9px] py-0 px-1.5 bg-cyan-900/60 text-cyan-300 border border-cyan-700/50 hover:bg-cyan-900/60" data-testid="render-voice-twin-badge">Voice Twin</Badge>
                            ) : (
                              <span className="text-[10px] text-slate-600">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400">{r.provider}</TableCell>
                          <TableCell className="text-xs text-slate-300 uppercase">{r.target_language}</TableCell>
                          <TableCell className="text-xs text-slate-400 tabular-nums">
                            {r.render_latency_ms != null ? `${r.render_latency_ms} ms` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 tabular-nums">
                            {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 tabular-nums">{fmtTs(r.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Latency Dashboard — Ticket Group E.3 */}
        <TabsContent value="latency" className="mt-3">
          {latencyStats === null ? (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <p className="text-sm text-slate-500">No render latency data available for this organisation.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Percentile stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="latency-stats">
                {[
                  { label: 'Mean', value: latencyStats.mean, color: 'text-slate-200' },
                  { label: 'p50', value: latencyStats.p50, color: 'text-green-400' },
                  { label: 'p95', value: latencyStats.p95, color: 'text-amber-400' },
                  { label: 'p99', value: latencyStats.p99, color: 'text-orange-400' },
                  { label: 'Max', value: latencyStats.max, color: 'text-red-400' },
                ].map(({ label, value, color }) => (
                  <Card key={label} className="bg-slate-900 border-slate-800">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <span className={`text-xl font-bold tabular-nums ${color}`}>{value} ms</span>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Latency histogram */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-amber-400" />
                    Render Latency Distribution (ms buckets)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={latencyHistogram} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}
                        labelStyle={{ color: '#94a3b8' }}
                        itemStyle={{ color: '#fbbf24' }}
                      />
                      <Bar dataKey="count" fill="#d97706" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Latency trend (last 50 renders) */}
              {latencyTrend.length > 1 && (
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-green-400" />
                      Render Latency Trend — Last {latencyTrend.length} Renders
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={latencyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <XAxis dataKey="ts" tick={false} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} unit=" ms" />
                        <Tooltip
                          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}
                          labelFormatter={() => 'Render'}
                          formatter={(v: number) => [`${v} ms`, 'Latency']}
                        />
                        <ReferenceLine y={latencyStats.p95} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'p95', fill: '#f59e0b', fontSize: 10 }} />
                        <Line type="monotone" dataKey="latency" stroke="#34d399" dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
