/**
 * PublicFreedomCampingMap (B-10)
 *
 * Public-facing page — no login required.
 * Shows freedom camping zones with their status (open / restricted / closed),
 * rules, and bylaw references so campers can self-service compliance info.
 *
 * Route: /public/zone-map
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  MapPin,
  Moon,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  Info,
  Car,
  Sun,
  ExternalLink,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface PublicZone {
  id: string
  name: string
  description: string | null
  zone_type: string | null
  is_active: boolean | null
  day_visit_only: boolean | null
  max_consecutive_nights: number | null
  nights_per_month: number | null
  self_contained_required: boolean | null
  allowed_days: string[] | null
  bylaw_reference: string | null
  bylaw_clause: string | null
  bylaw_source_url: string | null
  zone_features: string[] | null
  seasonal_open_month: number | null
  seasonal_close_month: number | null
  land_manager: string | null
  land_managing_agency: string | null
  location_lat: number | null
  location_lng: number | null
}

// Freedom camping zone_type values used in the DB
const FREEDOM_CAMP_TYPES = new Set([
  'freedom_camp',
  'freedom_camping',
  'freedom_camping_zone',
  'camping',
])

function isFreedomCampingZone(z: PublicZone): boolean {
  return FREEDOM_CAMP_TYPES.has((z.zone_type ?? '').toLowerCase())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function seasonalStatus(zone: PublicZone): 'open' | 'restricted' | 'closed' {
  if (!zone.is_active) return 'closed'
  const now = new Date()
  const month = now.getMonth() + 1  // 1-indexed
  const open = zone.seasonal_open_month
  const close = zone.seasonal_close_month
  if (open && close) {
    if (open <= close) {
      if (month < open || month > close) return 'restricted'
    } else {
      // Wraps year-end e.g. Oct–Feb
      if (month > close && month < open) return 'restricted'
    }
  }
  return 'open'
}

function statusConfig(status: 'open' | 'restricted' | 'closed') {
  if (status === 'open')       return { label: 'Open',       icon: CheckCircle, className: 'bg-green-100 text-green-800 border-green-200',  iconCls: 'text-green-600'  }
  if (status === 'restricted') return { label: 'Restricted', icon: AlertTriangle, className: 'bg-amber-100 text-amber-800 border-amber-300', iconCls: 'text-amber-600'  }
  return                              { label: 'Closed',     icon: XCircle,      className: 'bg-red-100 text-red-800 border-red-200',         iconCls: 'text-red-600'    }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PublicFreedomCampingMap() {
  const [search, setSearch] = useState('')

  const { data: zones = [], isLoading } = useQuery<PublicZone[]>({
    queryKey: ['public-freedom-camping-zones'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('zones')
        .select(
          'id, name, description, zone_type, is_active, day_visit_only, ' +
          'max_consecutive_nights, nights_per_month, self_contained_required, ' +
          'allowed_days, bylaw_reference, bylaw_clause, bylaw_source_url, ' +
          'zone_features, seasonal_open_month, seasonal_close_month, ' +
          'land_manager, land_managing_agency, location_lat, location_lng',
        )
        .or('zone_type.eq.freedom_camp,zone_type.eq.freedom_camping,zone_type.eq.freedom_camping_zone,zone_type.eq.camping')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return (data ?? []).filter((z: PublicZone) => isFreedomCampingZone(z))
    },
    staleTime: 5 * 60_000,   // 5 min cache — VOC: "updated within 5 min of enforcement change"
  })

  const filtered = zones.filter(z =>
    !search || z.name.toLowerCase().includes(search.toLowerCase()) ||
    (z.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Header */}
      <header className="bg-white border-b border-green-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <MapPin className="h-6 w-6 text-green-700 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-green-900">Freedom Camping Zone Map</h1>
            <p className="text-xs text-green-700">Check zone rules before you camp • No login required</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Disclaimer */}
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            Zone rules are updated regularly but may not reflect real-time enforcement action.
            Always check on-site signage and comply with any notices issued by officers.
            Freedom Camping Act 2011 and local bylaws apply.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search zones…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Zone count */}
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading zones…' : `${filtered.length} zone${filtered.length !== 1 ? 's' : ''} found`}
        </p>

        {/* Zone cards */}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No zones match your search.
          </div>
        )}

        <div className="space-y-4">
          {filtered.map(zone => {
            const status = seasonalStatus(zone)
            const sc = statusConfig(status)
            const StatusIcon = sc.icon

            return (
              <Card key={zone.id} className="shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-green-700 shrink-0" />
                      {zone.name}
                    </CardTitle>
                    <Badge className={`text-xs border ${sc.className} flex items-center gap-1`}>
                      <StatusIcon className={`h-3.5 w-3.5 ${sc.iconCls}`} />
                      {sc.label}
                    </Badge>
                  </div>
                  {zone.description && (
                    <p className="text-sm text-muted-foreground mt-1">{zone.description}</p>
                  )}
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Rules grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {zone.day_visit_only && (
                      <div className="flex items-center gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-amber-800 font-medium">
                        <Sun className="h-3.5 w-3.5 shrink-0" />
                        Day visits only
                      </div>
                    )}
                    {!zone.day_visit_only && zone.max_consecutive_nights != null && (
                      <div className="flex items-center gap-1.5 rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-blue-800">
                        <Moon className="h-3.5 w-3.5 shrink-0" />
                        Max {zone.max_consecutive_nights} consecutive night{zone.max_consecutive_nights !== 1 ? 's' : ''}
                      </div>
                    )}
                    {zone.nights_per_month != null && (
                      <div className="flex items-center gap-1.5 rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-blue-800">
                        <Moon className="h-3.5 w-3.5 shrink-0" />
                        Max {zone.nights_per_month} nights/month
                      </div>
                    )}
                    {zone.self_contained_required && (
                      <div className="flex items-center gap-1.5 rounded bg-purple-50 border border-purple-200 px-2 py-1.5 text-purple-800 font-medium">
                        <Car className="h-3.5 w-3.5 shrink-0" />
                        Self-contained only
                      </div>
                    )}
                    {zone.seasonal_open_month && zone.seasonal_close_month && (
                      <div className="flex items-center gap-1.5 rounded bg-gray-50 border border-gray-200 px-2 py-1.5 text-gray-700">
                        <Sun className="h-3.5 w-3.5 shrink-0" />
                        Season: {MONTHS[zone.seasonal_open_month - 1]}–{MONTHS[zone.seasonal_close_month - 1]}
                      </div>
                    )}
                  </div>

                  {/* Allowed days */}
                  {zone.allowed_days && zone.allowed_days.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Allowed days: <span className="font-medium text-foreground">{zone.allowed_days.join(', ')}</span>
                    </p>
                  )}

                  {/* Land manager */}
                  {(zone.land_manager || zone.land_managing_agency) && (
                    <p className="text-xs text-muted-foreground">
                      Managed by: <span className="font-medium text-foreground">{zone.land_managing_agency ?? zone.land_manager}</span>
                    </p>
                  )}

                  {/* Bylaw reference */}
                  {(zone.bylaw_reference || zone.bylaw_clause) && (
                    <p className="text-xs text-muted-foreground">
                      Bylaw: <span className="font-medium text-foreground">
                        {[zone.bylaw_reference, zone.bylaw_clause].filter(Boolean).join(' — ')}
                      </span>
                      {zone.bylaw_source_url && (
                        <a href={zone.bylaw_source_url} target="_blank" rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center gap-0.5 text-green-700 hover:underline">
                          View bylaw <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </p>
                  )}

                  {/* GPS link */}
                  {zone.location_lat != null && zone.location_lng != null && (
                    <a
                      href={`https://maps.google.com/?q=${zone.location_lat},${zone.location_lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-green-700 hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      View on Google Maps
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pt-4 pb-8 border-t">
          Data provided by FieldOps Manager · Freedom Camping Act 2011 applies ·
          {' '}<a href="/public/noise-complaint" className="text-green-700 hover:underline">Report a noise issue</a>
          {' '}·{' '}<a href="/dispute" className="text-green-700 hover:underline">Dispute a notice</a>
        </footer>
      </main>
    </div>
  )
}
