/**
 * EvidencePackages — B-23
 *
 * Structured evidence package manager.
 * Lists all noise assessments and incidents that have attached evidence
 * (photos, notes), with inline IncidentEvidenceBundle / NoiseEvidenceBundle
 * components for review and one-click download.
 *
 * Filterable by type, date range, and free-text search.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Package,
  Camera,
  FileText,
  MapPin,
  Calendar,
  Search,
  ChevronDown,
  ChevronRight,
  Volume2,
  Shield,
  Download,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { NoiseEvidenceBundle } from '@/components/features/NoiseEvidenceBundle'
import { IncidentEvidenceBundle } from '@/components/features/IncidentEvidenceBundle'
import { nzNow } from '@/lib/timezone'
import { format, subDays } from 'date-fns'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type NoiseRow = Pick<
  Database['public']['Tables']['noise_assessments']['Row'],
  | 'id'
  | 'address'
  | 'assessed_at'
  | 'noise_source'
  | 'noise_type'
  | 'noise_level_db'
  | 'recommended_action'
  | 'photos'
  | 'address_photo_url'
  | 'organization_id'
  | 'officer_id'
>

type IncidentRow = Pick<
  Database['public']['Tables']['incidents']['Row'],
  | 'id'
  | 'incident_type'
  | 'severity'
  | 'description'
  | 'location_address'
  | 'created_at'
  | 'status'
  | 'evidence_count'
  | 'primary_evidence_url'
  | 'plate_number'
  | 'organization_id'
>

type PackageType = 'all' | 'noise' | 'incident'

interface PackageItem {
  id: string
  type: 'noise' | 'incident'
  title: string
  subtitle: string | null
  date: string
  photoCount: number
  severity: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sevColour(severity: string | null): string {
  if (severity === 'high' || severity === 'critical') return 'text-red-600 border-red-300'
  if (severity === 'medium') return 'text-amber-600 border-amber-300'
  return 'text-muted-foreground'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EvidencePackages() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const today      = format(nzNow(), 'yyyy-MM-dd')
  const thirtyAgo  = format(subDays(nzNow(), 30), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom]     = useState(thirtyAgo)
  const [dateTo, setDateTo]         = useState(today)
  const [typeFilter, setTypeFilter] = useState<PackageType>('all')
  const [search, setSearch]         = useState('')
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())

  // ── Noise assessments with evidence ───────────────────────────────────────
  const { data: noiseRows = [] } = useQuery<NoiseRow[]>({
    queryKey: ['evidence-packages-noise', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase
        .from('noise_assessments')
        .select(`
          id, address, assessed_at, noise_source, noise_type,
          noise_level_db, recommended_action, photos, address_photo_url,
          organization_id, officer_id
        `)
        .eq('organization_id', orgId)
        .gte('assessed_at', `${dateFrom}T00:00:00`)
        .lte('assessed_at', `${dateTo}T23:59:59`)
        .order('assessed_at', { ascending: false })
        .limit(200)
      // Only those with at least one photo
      return ((data ?? []) as NoiseRow[]).filter(r => (r.photos?.length ?? 0) > 0 || r.address_photo_url)
    },
    enabled: !!orgId,
  })

  // ── Incidents with evidence ────────────────────────────────────────────────
  const { data: incidentRows = [] } = useQuery<IncidentRow[]>({
    queryKey: ['evidence-packages-incidents', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase
        .from('incidents')
        .select(`
          id, incident_type, severity, description, location_address,
          created_at, status, evidence_count, primary_evidence_url,
          plate_number, organization_id
        `)
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(200)
      // Only those with primary evidence or evidence_count > 0
      return ((data ?? []) as IncidentRow[]).filter(r =>
        r.primary_evidence_url || (r.evidence_count ?? 0) > 0
      )
    },
    enabled: !!orgId,
  })

  // ── Unified + filtered list ────────────────────────────────────────────────
  const items = useMemo<PackageItem[]>(() => {
    const noise: PackageItem[] = noiseRows.map(r => ({
      id: r.id,
      type: 'noise',
      title: r.address,
      subtitle: [r.noise_source, r.noise_type, r.noise_level_db != null ? `${r.noise_level_db}dB` : null]
        .filter(Boolean).join(' · '),
      date: r.assessed_at,
      photoCount: (r.photos?.length ?? 0) + (r.address_photo_url ? 1 : 0),
      severity: null,
    }))

    const incidents: PackageItem[] = incidentRows.map(r => ({
      id: r.id,
      type: 'incident',
      title: r.incident_type ?? 'Incident',
      subtitle: r.location_address ?? r.description ?? null,
      date: r.created_at ?? '',
      photoCount: r.evidence_count ?? (r.primary_evidence_url ? 1 : 0),
      severity: r.severity,
    }))

    let all = [...noise, ...incidents].sort((a, b) => b.date.localeCompare(a.date))

    if (typeFilter === 'noise')    all = all.filter(i => i.type === 'noise')
    if (typeFilter === 'incident') all = all.filter(i => i.type === 'incident')

    if (search.trim()) {
      const q = search.toLowerCase()
      all = all.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.subtitle ?? '').toLowerCase().includes(q)
      )
    }

    return all
  }, [noiseRows, incidentRows, typeFilter, search])

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6 text-primary" />
              Evidence Packages
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Structured evidence bundles for noise assessments and incidents — view, download, or print to PDF
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs mb-1 block">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Type</Label>
                <Select value={typeFilter} onValueChange={v => setTypeFilter(v as PackageType)}>
                  <SelectTrigger className="w-36 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="noise">Noise Assessments</SelectItem>
                    <SelectItem value="incident">Incidents</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-32">
                <Label className="text-xs mb-1 block">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-8 text-sm"
                    placeholder="Address, type, source…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Packages</p>
              <p className="text-2xl font-bold">{items.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Volume2 className="h-3 w-3" /> Noise
              </p>
              <p className="text-2xl font-bold">{items.filter(i => i.type === 'noise').length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Shield className="h-3 w-3" /> Incidents
              </p>
              <p className="text-2xl font-bold">{items.filter(i => i.type === 'incident').length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Camera className="h-3 w-3" /> Total Photos
              </p>
              <p className="text-2xl font-bold">{items.reduce((s, i) => s + i.photoCount, 0)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Package list */}
        {items.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-25" />
            <p className="text-sm">No evidence packages found for the selected filters.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <Collapsible key={item.id} open={expanded.has(item.id)} onOpenChange={() => toggleExpanded(item.id)}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="pb-3 pt-4 px-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          {item.type === 'noise'
                            ? <Volume2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                            : <Shield className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-sm truncate">{item.title}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${item.type === 'noise' ? 'text-amber-600 border-amber-300' : sevColour(item.severity)}`}
                              >
                                {item.type === 'noise' ? 'Noise' : (item.severity ?? item.type)}
                              </Badge>
                            </div>
                            {item.subtitle && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.subtitle}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1">
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                {item.date ? formatDateTime(item.date) : '—'}
                              </span>
                              {item.photoCount > 0 && (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Camera className="h-3 w-3" />
                                  {item.photoCount} photo{item.photoCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {expanded.has(item.id)
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="px-4 pb-4 pt-0 border-t">
                      {item.type === 'noise'
                        ? <NoiseEvidenceBundle assessmentId={item.id} className="mt-3" />
                        : <IncidentEvidenceBundle incidentId={item.id} className="mt-3" />}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
