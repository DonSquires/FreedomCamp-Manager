/**
 * ClientPortal — Clean Rebuild surface
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  MapPin, ShieldCheck, MessageSquare, CheckCircle2, XCircle, Clock,
} from 'lucide-react'

type SiteRow = {
  id: string
  name: string
  address: string | null
  is_active: boolean
  site_type: string
  zone_id: string | null
  zone: { name: string } | null
}

type PatrolRow = {
  id: string
  started_at: string | null
  ended_at: string | null
  status: string | null
  patrol_date: string | null
  zone: { name: string } | null
}

type DisputeRow = {
  id: string
  submitted_at: string
  status: string
  source_type: string
  message: string
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function MySitesTab({ orgId }: { orgId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cp-sites', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_sites')
        .select('id, name, address, is_active, site_type, zone_id, zone:zones(name)')
        .eq('organization_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as SiteRow[]
    },
    enabled: !!orgId,
  })

  const sites: SiteRow[] = (data as SiteRow[]) ?? []

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-muted-foreground">Loading your sites…</p>}
      {!isLoading && sites.length === 0 && (
        <p className="text-sm text-muted-foreground">No sites configured for your account.</p>
      )}
      {sites.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.address ?? 'Address not set'}
                  {s.zone?.name ? ` · Zone: ${s.zone.name}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs capitalize">{s.site_type}</Badge>
              {s.is_active
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : <XCircle className="h-4 w-4 text-slate-400" />}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ServiceTab({ orgId }: { orgId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cp-patrols', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patrols')
        .select('id, started_at, ended_at, status, patrol_date, zone:zones(name)')
        .eq('organization_id', orgId)
        .order('started_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as PatrolRow[]
    },
    enabled: !!orgId,
  })

  const patrols: PatrolRow[] = (data as PatrolRow[]) ?? []
  const completedCount = patrols.filter((p) => p.status === 'completed').length
  const activeCount = patrols.filter((p) => p.status === 'active' || p.status === 'in_progress').length

  const statusBg: Record<string, string> = {
    completed:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    active:      'bg-blue-50 text-blue-700 border-blue-200',
    in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
    scheduled:   'bg-amber-50 text-amber-700 border-amber-200',
    cancelled:   'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total patrols" value={patrols.length} icon={ShieldCheck} />
        <StatCard label="Completed" value={completedCount} icon={CheckCircle2} />
        <StatCard label="Active now" value={activeCount} icon={Clock} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading service history…</p>}
      {!isLoading && patrols.length === 0 && (
        <p className="text-sm text-muted-foreground">No patrol records found.</p>
      )}

      <div className="space-y-2">
        {patrols.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {p.patrol_date ?? 'Patrol'}
                  {p.zone?.name ? ` · ${p.zone.name}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.started_at
                    ? new Date(p.started_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
                    : '—'}
                  {p.ended_at
                    ? ` → ${new Date(p.ended_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}`
                    : ''}
                </div>
              </div>
              {p.status && (
                <Badge className={`text-xs border shrink-0 ${statusBg[p.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                  {p.status}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function DisputesTab({ orgId }: { orgId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cp-disputes', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dispute_intake')
        .select('id, submitted_at, status, source_type, message')
        .eq('organization_id', orgId)
        .order('submitted_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as DisputeRow[]
    },
    enabled: !!orgId,
  })

  const disputes: DisputeRow[] = (data as DisputeRow[]) ?? []

  const statusBg: Record<string, string> = {
    open:      'bg-blue-50 text-blue-700 border-blue-200',
    resolved:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    closed:    'bg-slate-100 text-slate-500 border-slate-200',
    escalated: 'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-muted-foreground">Loading disputes…</p>}
      {!isLoading && disputes.length === 0 && (
        <p className="text-sm text-muted-foreground">No disputes on record.</p>
      )}
      {disputes.map((d) => (
        <Card key={d.id}>
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium capitalize">
                {d.source_type.replace(/_/g, ' ')}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={`text-xs border ${statusBg[d.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                  {d.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(d.submitted_at).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })}
                </span>
              </div>
            </div>
            {d.message && (
              <p className="text-xs text-muted-foreground line-clamp-2">{d.message}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function RebuildClientPortalPage() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Client Portal</h1>
        <p className="text-sm text-muted-foreground">
          Your sites · Service history · Disputes
        </p>
      </div>

      <Tabs defaultValue="sites">
        <TabsList className="mb-4">
          <TabsTrigger value="sites">
            <MapPin className="h-4 w-4 mr-1.5" />My Sites
          </TabsTrigger>
          <TabsTrigger value="service">
            <ShieldCheck className="h-4 w-4 mr-1.5" />Service
          </TabsTrigger>
          <TabsTrigger value="disputes">
            <MessageSquare className="h-4 w-4 mr-1.5" />Disputes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sites"><MySitesTab orgId={orgId} /></TabsContent>
        <TabsContent value="service"><ServiceTab orgId={orgId} /></TabsContent>
        <TabsContent value="disputes"><DisputesTab orgId={orgId} /></TabsContent>
      </Tabs>
    </div>
  )
}
