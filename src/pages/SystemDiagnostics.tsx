import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import bobFailureSummaryRaw from '../../data/bob-failure-summary.json?raw'
import bobResponseScoresRaw from '../../data/bob-response-scores.jsonl?raw'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Activity, Database, Server, Shield, RefreshCw, CheckCircle, XCircle, AlertTriangle, Stethoscope, Wrench, Loader2, Clock3, Languages } from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { checkProxyHealth, checkInferenceHealth, checkPttHealth } from '@/lib/proxyServices'

interface IntegrityResults {
  processed: number
  duplicates_deleted: number
  invalid_plates_marked: number
  issues: Array<{
    table: string
    issue_type: string
    severity: string
    record_id: string
    plate_number?: string
    description: string
    action_taken?: string
  }>
}

type BobFailureSummarySnapshot = {
  generatedAt?: string
  windowHours?: number
  totalEntries?: number
  lowScoreCount?: number
  topFailureReasons?: Array<{ key?: string; count?: number }>
  recommendations?: string[]
}

type BobScoreEntry = {
  timestamp?: string
  target?: string
  channel?: string
  score?: number
  failureReasons?: string[]
  positiveSignals?: string[]
}

function parseFailureSummarySnapshot(raw: string): BobFailureSummarySnapshot | null {
  try {
    return JSON.parse(raw) as BobFailureSummarySnapshot
  } catch {
    return null
  }
}

function parseScoreEntries(raw: string): BobScoreEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-300)
    .map((line) => {
      try {
        return JSON.parse(line) as BobScoreEntry
      } catch {
        return null
      }
    })
    .filter((entry): entry is BobScoreEntry => Boolean(entry))
}

const bobFailureSummarySnapshot = parseFailureSummarySnapshot(bobFailureSummaryRaw)
const bobScoreEntriesSnapshot = parseScoreEntries(bobResponseScoresRaw)

const bobScoreSnapshot = (() => {
  const entries = bobScoreEntriesSnapshot
  const scoredEntries = entries.filter((entry) => typeof entry.score === 'number')
  const avgScore = scoredEntries.length
    ? Math.round((scoredEntries.reduce((sum, entry) => sum + Number(entry.score || 0), 0) / scoredEntries.length) * 10) / 10
    : null
  const lowScoreEntries = scoredEntries.filter((entry) => Number(entry.score || 0) <= 4)
  const rewardedEntries = entries.filter((entry) => Number(entry.score || 0) >= 8).length
  const failureCounts = new Map<string, number>()
  const channelCounts = new Map<string, { count: number; avg: number }>()

  for (const entry of entries) {
    for (const failure of entry.failureReasons || []) {
      failureCounts.set(failure, (failureCounts.get(failure) || 0) + 1)
    }
    if (entry.channel) {
      const prev = channelCounts.get(entry.channel) || { count: 0, avg: 0 }
      const nextCount = prev.count + 1
      const nextAvg = typeof entry.score === 'number'
        ? ((prev.avg * prev.count) + entry.score) / nextCount
        : prev.avg
      channelCounts.set(entry.channel, { count: nextCount, avg: nextAvg })
    }
  }

  const topFailures = Array.from(failureCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
  const topChannels = Array.from(channelCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4)

  return {
    totalEntries: entries.length,
    avgScore,
    lowScoreCount: lowScoreEntries.length,
    rewardedEntries,
    topFailures,
    topChannels,
    latestTimestamp: entries[entries.length - 1]?.timestamp || bobFailureSummarySnapshot?.generatedAt || null,
  }
})()

function IntegrityResultsDisplay({ results }: { results: IntegrityResults }) {
  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{results.processed}</div>
          <div className="text-sm text-gray-600">Records Processed</div>
        </div>
        
        <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-green-600">{results.duplicates_deleted}</div>
          <div className="text-sm text-gray-600">Duplicates Removed</div>
        </div>
        
        <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
          <div className="text-2xl font-bold text-orange-600">{results.invalid_plates_marked}</div>
          <div className="text-sm text-gray-600">Invalid Plates</div>
        </div>
      </div>

      {/* Issues Table */}
      {results.issues && results.issues.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-[#1E1E1E] px-4 py-2 font-semibold">
            Issues Found ({results.issues.length})
          </div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {results.issues.map((issue, idx) => (
              <div key={idx} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={issue.severity === 'critical' ? 'destructive' : 'secondary'}>
                    {issue.severity}
                  </Badge>
                  <span className="text-sm font-medium">{issue.table}</span>
                  <span className="text-xs text-gray-500">• {issue.issue_type}</span>
                </div>
                {issue.plate_number && (
                  <div className="text-sm font-mono text-blue-600">{issue.plate_number}</div>
                )}
                <div className="text-sm text-gray-600">{issue.description}</div>
                {issue.action_taken && (
                  <div className="text-xs text-green-600 mt-1">✓ {issue.action_taken}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EndpointHealthSummary({ endpointHealth }: { endpointHealth: any }) {
  if (!endpointHealth?.endpoints?.length) return null

  return (
    <div className="pt-1">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Endpoint failover</div>
      <div>{Number(endpointHealth.healthyCount || 0)}/{Number(endpointHealth.totalEndpoints || 0)} healthy</div>
      {endpointHealth.endpoints.slice(0, 3).map((endpoint: any, index: number) => (
        <div key={`${endpoint.url}-${index}`} className="text-[11px] text-gray-600 leading-snug">
          {endpoint.status === 'healthy' ? 'OK' : endpoint.status === 'degraded' ? 'WARN' : 'DOWN'} · {endpoint.latencyMs ?? '--'}ms · {String(endpoint.url || '').replace(/^https?:\/\//, '')}
        </div>
      ))}
    </div>
  )
}

export default function SystemDiagnostics() {
  const { user } = useAuthStore()
  const [testResults, setTestResults] = useState<any>(null)
  const [doctorPlaybookRunning, setDoctorPlaybookRunning] = useState<'ollama_recovery' | 'ptt_token_path_repair' | 'edge_auth_alignment' | null>(null)

  // Check user role
  const isMaster = user?.role === 'master' || user?.role === 'grand_master'

  // Bob Integration: Check Proxy Server Health
  const { data: proxyHealth, isLoading: proxyLoading, refetch: refetchProxy } = useQuery({
    queryKey: ['proxy-health'],
    queryFn: () => checkProxyHealth(),
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Bob Integration: Check Inference Service Health
  const { data: inferenceHealth, isLoading: inferenceLoading, refetch: refetchInference } = useQuery({
    queryKey: ['inference-health'],
    queryFn: () => checkInferenceHealth(),
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const { data: pttHealth, isLoading: pttLoading, refetch: refetchPtt } = useQuery({
    queryKey: ['ptt-health'],
    queryFn: () => checkPttHealth(),
    refetchInterval: 30000,
  })

  const refetchRailway = () => {
    refetchProxy()
    refetchInference()
    refetchPtt()
    void refetchDoctorHealth()
    void refetchDoctorTimeline()
    void refetchEndpointHealth()
  }

  const {
    data: doctorHealth,
    isLoading: doctorHealthLoading,
    refetch: refetchDoctorHealth,
  } = useQuery({
    queryKey: ['doctor-health-diagnostics'],
    queryFn: async () => {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'doctor_health' })
      if (error) throw new Error(String(error))
      return data
    },
    refetchInterval: 45_000,
  })

  const {
    data: doctorTimeline,
    isLoading: doctorTimelineLoading,
    refetch: refetchDoctorTimeline,
  } = useQuery({
    queryKey: ['doctor-timeline-diagnostics'],
    queryFn: async () => {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'doctor_timeline', limit: 8 })
      if (error) throw new Error(String(error))
      return (data as any)?.entries || []
    },
    refetchInterval: 45_000,
  })

  const { data: endpointHealth, refetch: refetchEndpointHealth } = useQuery({
    queryKey: ['inference-endpoint-health-diagnostics'],
    queryFn: async () => {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'inference_endpoint_health' })
      if (error) throw new Error(String(error))
      return data as any
    },
    refetchInterval: 45_000,
  })

  const { data: radioAudit } = useQuery({
    queryKey: ['radio-audit-diagnostics'],
    queryFn: async () => {
      const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
      const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
      if (!baseUrl || !anonKey) return null

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || ''
      if (!token) return null

      const res = await fetch(`${baseUrl}/functions/v1/radio-audit?since_hours=24`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        throw new Error(`radio-audit failed (${res.status})`)
      }

      return await res.json() as Record<string, any>
    },
    enabled: isMaster,
    refetchInterval: 45_000,
  })

  const inferenceConfig = ((inferenceHealth as any)?.config ?? {}) as Record<string, any>
  const inferenceCapabilities = ((inferenceHealth as any)?.capabilities ?? {}) as Record<string, any>
  const translationEnabled = inferenceCapabilities.translation === true
  const translationModel = String(inferenceCapabilities.translation_model || inferenceConfig.TRANSLATION_MODEL || 'unknown')
  const translationLocal = inferenceCapabilities.translation_local_ollama_enabled === true
  const whisperCliStatus = String((inferenceHealth as any)?.models?.whisper_cli || 'unknown')
  const whisperModelStatus = String((inferenceHealth as any)?.models?.whisper_model || 'unknown')
  const radioPipeline = (inferenceHealth as any)?.radioPipeline ?? null
  const radioPipelineMode = String(radioPipeline?.processor_mode || 'unknown')
  const radioProcessorEnabled = radioPipeline?.processor_enabled === true
  const radioMetrics = (radioPipeline?.metrics ?? {}) as Record<string, any>
  const radioLastLatencyMs = Number.isFinite(Number(radioMetrics.last_latency_ms))
    ? Number(radioMetrics.last_latency_ms)
    : null
  const radioConfidenceRollups = ((radioAudit as any)?.transcript_pipeline?.confidence_rollups_recent?.top_transmissions ?? []) as Array<Record<string, any>>

  const runDoctorPlaybook = async (playbook: 'ollama_recovery' | 'ptt_token_path_repair' | 'edge_auth_alignment', dryRun = false) => {
    setDoctorPlaybookRunning(playbook)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'doctor_playbook_run',
        playbook,
        dry_run: dryRun,
      })
      if (error) throw new Error(String(error))
      toast.success(`${playbook} completed`)
      if ((data as any)?.remediation?.length) {
        toast.message(`Doctor returned ${(data as any).remediation.length} remediation item(s)`)
      }
      await refetchDoctorHealth()
      await refetchDoctorTimeline()
    } catch (err: any) {
      toast.error(err?.message || `Playbook ${playbook} failed`)
    } finally {
      setDoctorPlaybookRunning(null)
    }
  }

  // Check database stats
  const { data: dbStats, isLoading: dbLoading } = useQuery({
    queryKey: ['database-stats'],
    queryFn: async () => {
      const [observations, vehicles, breaches, zones, users] = await Promise.all([
        supabase.from('observations').select('observation_id', { count: 'exact', head: true }),
        supabase.from('canonical_vehicles').select('vehicle_id', { count: 'exact', head: true }),
        supabase.from('breach_alerts').select('id', { count: 'exact', head: true }),
        supabase.from('zones').select('id', { count: 'exact', head: true }),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
      ])

      return {
        observations: observations.count || 0,
        vehicles: vehicles.count || 0,
        breaches: breaches.count || 0,
        zones: zones.count || 0,
        users: users.count || 0,
      }
    },
  })

  // Run integrity check
  const integrityCheckMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await edgeFunctions.checkDataIntegrity({ comprehensive: true })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setTestResults(data)
      toast.success('Integrity check complete')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Integrity check failed')
    },
  })

  if (!isMaster) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Master role required.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <AppLayout title="System Diagnostics" description="Monitor system health and run integrity checks" showBackButton>
      <div className="flex justify-end mb-6">
        <Button onClick={() => refetchRailway()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Database */}
        <Card>
          <CardHeader className="pb-3">
            <Database className="h-8 w-8 text-blue-600 mb-2" />
            <CardTitle className="text-lg">Database</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="default" className="mb-2">
              <CheckCircle className="h-3 w-3 mr-1" />
              Healthy
            </Badge>
            {dbStats && (
              <div className="text-sm text-gray-600 space-y-1">
                <div>{dbStats.observations.toLocaleString()} observations</div>
                <div>{dbStats.vehicles.toLocaleString()} vehicles</div>
                <div>{dbStats.zones} zones</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Proxy Server */}
        <Card>
          <CardHeader className="pb-3">
            <Server className="h-8 w-8 text-green-600 mb-2" />
            <CardTitle className="text-lg">Proxy Server</CardTitle>
          </CardHeader>
          <CardContent>
            {proxyLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : proxyHealth?.status === 'online' ? (
              <>
                <Badge variant="default">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Online
                </Badge>
                {proxyHealth.latency_ms && (
                  <div className="text-xs text-gray-600 mt-1">
                    Latency: {proxyHealth.latency_ms}ms
                  </div>
                )}
              </>
            ) : proxyHealth?.status === 'degraded' ? (
              <>
                <Badge variant="secondary">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Degraded
                </Badge>
                <div className="text-xs text-red-600 mt-1">
                  {proxyHealth.error}
                </div>
              </>
            ) : (
              <>
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
                {proxyHealth?.error && (
                  <div className="text-xs text-red-600 mt-1">
                    {proxyHealth.error}
                  </div>
                )}
              </>
            )}
            <div className="text-xs text-gray-600 mt-2">
              NZSCV / Vehicle Data Gateway
            </div>
          </CardContent>
        </Card>

        {/* Inference Server */}
        <Card>
          <CardHeader className="pb-3">
            <Activity className="h-8 w-8 text-purple-600 mb-2" />
            <CardTitle className="text-lg">Inference Service</CardTitle>
            <CardTitle className="text-lg">Bob Inference</CardTitle>
          </CardHeader>
          <CardContent>
            {inferenceLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : inferenceHealth?.status === 'online' ? (
              <>
                <Badge variant="default">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Online
                </Badge>
                {inferenceHealth.latency_ms && (
                  <div className="text-xs text-gray-600 mt-1">
                    Latency: {inferenceHealth.latency_ms}ms
                  </div>
                )}
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div className="flex items-center gap-1">
                    <Languages className="h-3 w-3" />
                    Translation: {translationEnabled ? (translationLocal ? 'local model ready' : 'enabled with fallback path') : 'not advertised'}
                  </div>
                  <div>Translation model: {translationModel}</div>
                  <div>Whisper: CLI {whisperCliStatus} · model {whisperModelStatus}</div>
                  <div>Radio pipeline: {radioProcessorEnabled ? `active (${radioPipelineMode})` : `standby (${radioPipelineMode})`}</div>
                  <div>
                    Radio events: {Number(radioMetrics.processed_events || 0)} processed · {Number(radioMetrics.failed_events || 0)} failed
                    {radioLastLatencyMs !== null ? ` · last latency ${radioLastLatencyMs}ms` : ''}
                  </div>
                  {radioConfidenceRollups.length > 0 && (
                    <div className="pt-1">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Top low-confidence transmissions (24h)</div>
                      {radioConfidenceRollups.slice(0, 3).map((row) => (
                        <div key={String(row.transmission_id)} className="text-[11px] text-gray-600 leading-snug">
                          {(row.speaker_name || 'Unknown speaker')} · {String(row.channel_id || 'unknown channel')} · {Number(row.low_confidence_pct || 0)}% low-confidence ({Number(row.low_confidence_segments || 0)}/{Number(row.scored_segment_count || 0)})
                        </div>
                      ))}
                    </div>
                  )}
                  <EndpointHealthSummary endpointHealth={endpointHealth} />
                </div>
              </>
            ) : inferenceHealth?.status === 'degraded' ? (
              <>
                <Badge variant="secondary">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Degraded
                </Badge>
                <div className="text-xs text-red-600 mt-1">
                  {inferenceHealth.error}
                </div>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div>Translation model: {translationModel}</div>
                  <div>Whisper: CLI {whisperCliStatus} · model {whisperModelStatus}</div>
                  <div>Radio pipeline: {radioProcessorEnabled ? `active (${radioPipelineMode})` : `standby (${radioPipelineMode})`}</div>
                  <div>
                    Radio events: {Number(radioMetrics.processed_events || 0)} processed · {Number(radioMetrics.failed_events || 0)} failed
                    {radioLastLatencyMs !== null ? ` · last latency ${radioLastLatencyMs}ms` : ''}
                  </div>
                  {radioConfidenceRollups.length > 0 && (
                    <div className="pt-1">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Top low-confidence transmissions (24h)</div>
                      {radioConfidenceRollups.slice(0, 3).map((row) => (
                        <div key={String(row.transmission_id)} className="text-[11px] text-gray-600 leading-snug">
                          {(row.speaker_name || 'Unknown speaker')} · {String(row.channel_id || 'unknown channel')} · {Number(row.low_confidence_pct || 0)}% low-confidence ({Number(row.low_confidence_segments || 0)}/{Number(row.scored_segment_count || 0)})
                        </div>
                      ))}
                    </div>
                  )}
                  <EndpointHealthSummary endpointHealth={endpointHealth} />
                </div>
              </>
            ) : (
              <>
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
                {inferenceHealth?.error && (
                  <div className="text-xs text-red-600 mt-1">
                    {inferenceHealth.error}
                  </div>
                )}
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div>Translation model: {translationModel}</div>
                  <div>Whisper: CLI {whisperCliStatus} · model {whisperModelStatus}</div>
                  <div>Radio pipeline: {radioProcessorEnabled ? `active (${radioPipelineMode})` : `standby (${radioPipelineMode})`}</div>
                  <div>
                    Radio events: {Number(radioMetrics.processed_events || 0)} processed · {Number(radioMetrics.failed_events || 0)} failed
                    {radioLastLatencyMs !== null ? ` · last latency ${radioLastLatencyMs}ms` : ''}
                  </div>
                  {radioConfidenceRollups.length > 0 && (
                    <div className="pt-1">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Top low-confidence transmissions (24h)</div>
                      {radioConfidenceRollups.slice(0, 3).map((row) => (
                        <div key={String(row.transmission_id)} className="text-[11px] text-gray-600 leading-snug">
                          {(row.speaker_name || 'Unknown speaker')} · {String(row.channel_id || 'unknown channel')} · {Number(row.low_confidence_pct || 0)}% low-confidence ({Number(row.low_confidence_segments || 0)}/{Number(row.scored_segment_count || 0)})
                        </div>
                      ))}
                    </div>
                  )}
                  <EndpointHealthSummary endpointHealth={endpointHealth} />
                </div>
              </>
            )}
            <div className="text-xs text-gray-600 mt-2">
              YOLOv8 Vehicle Detection, translation, and speech readiness
            </div>
          </CardContent>
        </Card>

        {/* PTT Signaling */}
        <Card>
          <CardHeader className="pb-3">
            <Server className="h-8 w-8 text-cyan-600 mb-2" />
            <CardTitle className="text-lg">PTT Signaling</CardTitle>
          </CardHeader>
          <CardContent>
            {pttLoading ? (
              <Badge variant="secondary">Checking...</Badge>
            ) : pttHealth?.status === 'online' ? (
              <>
                <Badge variant="default">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Online
                </Badge>
                {pttHealth.wsUrl && (
                  <div className="text-xs text-gray-600 mt-1 break-all">
                    {pttHealth.wsUrl}
                  </div>
                )}
              </>
            ) : pttHealth?.status === 'degraded' ? (
              <>
                <Badge variant="secondary">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Degraded
                </Badge>
                {pttHealth?.error && (
                  <div className="text-xs text-red-600 mt-1">{pttHealth.error}</div>
                )}
                {pttHealth.wsUrl && (
                  <div className="text-xs text-gray-600 mt-1 break-all">{pttHealth.wsUrl}</div>
                )}
              </>
            ) : (
              <>
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
                {pttHealth?.error && (
                  <div className="text-xs text-red-600 mt-1">{pttHealth.error}</div>
                )}
                {pttHealth?.wsUrl && (
                  <div className="text-xs text-gray-600 mt-1 break-all">{pttHealth.wsUrl}</div>
                )}
              </>
            )}
            <div className="text-xs text-gray-600 mt-2">
              Radio signaling server and WebSocket endpoint health
            </div>
          </CardContent>
        </Card>

        {/* Authentication */}
        <Card>
          <CardHeader className="pb-3">
            <Shield className="h-8 w-8 text-orange-600 mb-2" />
            <CardTitle className="text-lg">Authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="default">
              <CheckCircle className="h-3 w-3 mr-1" />
              Active
            </Badge>
            <div className="text-sm text-gray-600 mt-2">
              {dbStats?.users || 0} users
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Integrity Checks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Data Integrity</CardTitle>
              <CardDescription>
                Run comprehensive data integrity checks
              </CardDescription>
            </div>
            <Button
              onClick={() => integrityCheckMutation.mutate()}
              disabled={integrityCheckMutation.isPending}
            >
              <Activity className="h-4 w-4 mr-2" />
              {integrityCheckMutation.isPending ? 'Running...' : 'Run Check'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {testResults ? (
            <IntegrityResultsDisplay results={testResults} />
          ) : (
            <div className="text-center py-8 text-gray-600">
              Click "Run Check" to verify data integrity
            </div>
          )}
        </CardContent>
      </Card>

      {/* Doctor Control Room */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4" /> Doctor Control Room
              </CardTitle>
              <CardDescription>
                Cross-area health across Supabase, RunPod, Vercel, and GitHub with timeline-backed self-healing.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => { void refetchDoctorHealth(); void refetchDoctorTimeline() }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh Doctor
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={doctorHealth?.doctor_score >= 90 ? 'default' : doctorHealth?.doctor_score >= 75 ? 'secondary' : 'destructive'}>
              Score: {typeof doctorHealth?.doctor_score === 'number' ? doctorHealth.doctor_score : '--'}
            </Badge>
            {doctorHealth?.status && <Badge variant="outline">{String(doctorHealth.status).toUpperCase()}</Badge>}
            <Badge variant="outline">
              Auto-Heal: {doctorHealth?.auto_heal?.enabled ? 'ON' : 'OFF'}
            </Badge>
            {(doctorHealthLoading || doctorTimelineLoading) && (
              <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading</Badge>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Cross-Area Coverage</div>
              <div className="text-sm">Supabase: {doctorHealth?.components?.cross_area?.supabase?.mode || 'unknown'}</div>
              <div className="text-sm">Proxy/Inference: {doctorHealth?.components?.cross_area?.railway?.mode || 'unknown'}</div>
              <div className="text-sm">Vercel: {doctorHealth?.components?.cross_area?.vercel?.mode || 'unknown'}</div>
              <div className="text-sm">GitHub: {doctorHealth?.components?.cross_area?.github?.mode || 'unknown'}</div>
            </div>
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Active Risks</div>
              {Array.isArray(doctorHealth?.active_risks) && doctorHealth.active_risks.length > 0 ? (
                doctorHealth.active_risks.slice(0, 4).map((risk: any) => (
                  <div key={String(risk.id)} className="text-sm">
                    <span className="font-medium">{String(risk.id)}</span> · {String(risk.severity)}
                  </div>
                ))
              ) : (
                <div className="text-sm text-green-700 dark:text-green-400">No active risks detected</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Button variant="outline" size="sm" disabled={doctorPlaybookRunning !== null} onClick={() => void runDoctorPlaybook('ollama_recovery')}>
              {doctorPlaybookRunning === 'ollama_recovery' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
              Run Ollama Recovery
            </Button>
            <Button variant="outline" size="sm" disabled={doctorPlaybookRunning !== null} onClick={() => void runDoctorPlaybook('ptt_token_path_repair', true)}>
              {doctorPlaybookRunning === 'ptt_token_path_repair' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
              Check PTT Token Path
            </Button>
            <Button variant="outline" size="sm" disabled={doctorPlaybookRunning !== null} onClick={() => void runDoctorPlaybook('edge_auth_alignment', true)}>
              {doctorPlaybookRunning === 'edge_auth_alignment' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
              Check Edge Auth Alignment
            </Button>
          </div>

          <div className="rounded border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Clock3 className="h-3 w-3" /> Doctor Timeline</div>
            {Array.isArray(doctorTimeline) && doctorTimeline.length > 0 ? (
              doctorTimeline.map((entry: any) => (
                <div key={String(entry.id || entry.at)} className="text-xs border-b last:border-b-0 pb-2 last:pb-0">
                  <div className="font-medium">{String(entry.playbook || 'unknown')} · {entry.success ? 'success' : 'failed'}</div>
                  <div className="text-muted-foreground">{String(entry.trigger || 'manual')} · {new Date(String(entry.at)).toLocaleString('en-NZ')}</div>
                  <div className="text-muted-foreground">{String(entry.summary || '')}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground">No doctor runs recorded yet.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bob Quality Snapshot</CardTitle>
          <CardDescription>
            Build-time snapshot from local Bob scoring artifacts for recent quality and failure patterns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Entries Parsed</div>
              <div className="text-2xl font-semibold">{bobScoreSnapshot.totalEntries}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Average Score</div>
              <div className="text-2xl font-semibold">{bobScoreSnapshot.avgScore ?? '--'}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">Low Scores</div>
              <div className="text-2xl font-semibold">{bobScoreSnapshot.lowScoreCount}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-muted-foreground">High-Confidence Runs</div>
              <div className="text-2xl font-semibold">{bobScoreSnapshot.rewardedEntries}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {bobScoreSnapshot.latestTimestamp && (
              <span>Latest entry: {new Date(String(bobScoreSnapshot.latestTimestamp)).toLocaleString('en-NZ')}</span>
            )}
            {bobFailureSummarySnapshot?.windowHours ? <span>Window: {bobFailureSummarySnapshot.windowHours}h</span> : null}
            {bobFailureSummarySnapshot?.generatedAt ? <span>Summary generated: {new Date(bobFailureSummarySnapshot.generatedAt).toLocaleString('en-NZ')}</span> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Top Failure Reasons</div>
              {bobScoreSnapshot.topFailures.length > 0 ? (
                bobScoreSnapshot.topFailures.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-sm">
                    <span>{reason}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))
              ) : (
                <div className="text-sm text-green-700 dark:text-green-400">No repeated failure reasons in the parsed snapshot.</div>
              )}
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Most Active Channels</div>
              {bobScoreSnapshot.topChannels.length > 0 ? (
                bobScoreSnapshot.topChannels.map(([channel, stats]) => (
                  <div key={channel} className="flex items-center justify-between text-sm gap-3">
                    <span>{channel}</span>
                    <span className="text-muted-foreground">{stats.count} runs · avg {Math.round(stats.avg * 10) / 10}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No channel activity recorded.</div>
              )}
            </div>
          </div>

          {Array.isArray(bobFailureSummarySnapshot?.recommendations) && bobFailureSummarySnapshot!.recommendations!.length > 0 && (
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Current Recommendations</div>
              {bobFailureSummarySnapshot!.recommendations!.slice(0, 3).map((recommendation) => (
                <div key={recommendation} className="text-sm">{recommendation}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Errors (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>
            System errors and warnings from the last 24 hours
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-600">
            No recent errors
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
