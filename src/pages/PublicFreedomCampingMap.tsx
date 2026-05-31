/**
 * PublicFreedomCampingMap (B-10 + B-11)
 *
 * Public-facing page — no login required.
 * Shows freedom camping zones with their status (open / restricted / closed),
 * rules, and bylaw references so campers can self-service compliance info.
 *
 * B-11: Multi-language support — EN / Māori / Mandarin / Hindi
 *       Auto-detects from browser; user can override via switcher.
 *
 * Route: /public/zone-map
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tpl } from '@/lib/publicLocale'
import { usePublicLocale } from '@/hooks/usePublicLocale'
import type { Locale } from '@/lib/publicLocale'
import { buildPreferredMapUrlForCoordinates } from '@/lib/inhouseMapping'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
  Globe,
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
  // B-18 amenity fields
  has_toilets: boolean | null
  has_water: boolean | null
  has_dump_station: boolean | null
  has_shower: boolean | null
  has_rubbish: boolean | null
  max_vehicles: number | null
  fee_nzd: string | null
}

const FREEDOM_CAMP_TYPES = new Set([
  'freedom_camp',
  'freedom_camping',
  'freedom_camping_zone',
  'camping',
])

function isFreedomCampingZone(z: PublicZone): boolean {
  return FREEDOM_CAMP_TYPES.has((z.zone_type ?? '').toLowerCase())
}

function seasonalStatus(zone: PublicZone): 'open' | 'restricted' | 'closed' {
  if (!zone.is_active) return 'closed'
  const month = new Date().getMonth() + 1
  const open = zone.seasonal_open_month
  const close = zone.seasonal_close_month
  if (open && close) {
    if (open <= close) {
      if (month < open || month > close) return 'restricted'
    } else {
      if (month > close && month < open) return 'restricted'
    }
  }
  return 'open'
}

const LOCALE_LABELS: Record<Locale, string> = { en: 'EN', mi: 'MĀ', zh: '中', hi: 'हि' }

// ─── Component ────────────────────────────────────────────────────────────────
export default function PublicFreedomCampingMap() {
  const { t, locale, setLocale } = usePublicLocale()
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
          'land_manager, land_managing_agency, location_lat, location_lng, ' +
          'has_toilets, has_water, has_dump_station, has_shower, has_rubbish, max_vehicles, fee_nzd',
        )
        .or('zone_type.eq.freedom_camp,zone_type.eq.freedom_camping,zone_type.eq.freedom_camping_zone,zone_type.eq.camping')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return (data ?? []).filter((z: PublicZone) => isFreedomCampingZone(z))
    },
    staleTime: 5 * 60_000,
  })

  const filtered = zones.filter(z =>
    !search || z.name.toLowerCase().includes(search.toLowerCase()) ||
    (z.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const statusConfig = (status: 'open' | 'restricted' | 'closed') => {
    if (status === 'open')       return { label: t.zm.statusOpen,       icon: CheckCircle,   className: 'bg-green-100 text-green-800 border-green-200', iconCls: 'text-green-600' }
    if (status === 'restricted') return { label: t.zm.statusRestricted, icon: AlertTriangle, className: 'bg-amber-100 text-amber-800 border-amber-300', iconCls: 'text-amber-600' }
    return                              { label: t.zm.statusClosed,     icon: XCircle,       className: 'bg-red-100 text-red-800 border-red-200',       iconCls: 'text-red-600'   }
  }

  const zonesFoundText = filtered.length === 1
    ? t.zm.zonesFoundSingular
    : tpl(t.zm.zonesFoundPlural, { n: filtered.length })

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Header */}
      <header className="bg-white border-b border-green-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-green-700 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-green-900">{t.zm.title}</h1>
              <p className="text-xs text-green-700">{t.zm.subtitle}</p>
            </div>
          </div>
          {/* Language switcher */}
          <div className="flex items-center gap-1">
            <Globe className="h-3.5 w-3.5 text-green-600 mr-0.5" />
            {(['en', 'mi', 'zh', 'hi'] as Locale[]).map(l => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={[
                  'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                  locale === l ? 'bg-green-700 text-white' : 'text-green-700 hover:bg-green-100',
                ].join(' ')}
                aria-label={t.lang[l]}
                title={t.lang[l]}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Disclaimer */}
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{t.zm.disclaimer}</p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.zm.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Zone count */}
        <p className="text-sm text-muted-foreground">
          {isLoading ? t.zm.loading : zonesFoundText}
        </p>

        {/* Zone cards */}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {t.zm.noZones}
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
                        {t.zm.dayVisitOnly}
                      </div>
                    )}
                    {!zone.day_visit_only && zone.max_consecutive_nights != null && (
                      <div className="flex items-center gap-1.5 rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-blue-800">
                        <Moon className="h-3.5 w-3.5 shrink-0" />
                        {tpl(t.zm.maxNights, { n: zone.max_consecutive_nights })}
                        {zone.max_consecutive_nights !== 1 ? t.zm.maxNightsPlural : ''}
                      </div>
                    )}
                    {zone.nights_per_month != null && (
                      <div className="flex items-center gap-1.5 rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-blue-800">
                        <Moon className="h-3.5 w-3.5 shrink-0" />
                        {tpl(t.zm.maxNightsMonth, { n: zone.nights_per_month })}
                      </div>
                    )}
                    {zone.self_contained_required && (
                      <div className="flex items-center gap-1.5 rounded bg-purple-50 border border-purple-200 px-2 py-1.5 text-purple-800 font-medium">
                        <Car className="h-3.5 w-3.5 shrink-0" />
                        {t.zm.selfContained}
                      </div>
                    )}
                    {zone.seasonal_open_month && zone.seasonal_close_month && (
                      <div className="flex items-center gap-1.5 rounded bg-gray-50 border border-gray-200 px-2 py-1.5 text-gray-700">
                        <Sun className="h-3.5 w-3.5 shrink-0" />
                        {tpl(t.zm.season, {
                          from: t.months[zone.seasonal_open_month - 1],
                          to:   t.months[zone.seasonal_close_month - 1],
                        })}
                      </div>
                    )}
                  </div>

                  {/* Allowed days */}
                  {zone.allowed_days && zone.allowed_days.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t.zm.allowedDays}{' '}
                      <span className="font-medium text-foreground">{zone.allowed_days.join(', ')}</span>
                    </p>
                  )}

                  {/* Land manager */}
                  {(zone.land_manager || zone.land_managing_agency) && (
                    <p className="text-xs text-muted-foreground">
                      {t.zm.managedBy}{' '}
                      <span className="font-medium text-foreground">
                        {zone.land_managing_agency ?? zone.land_manager}
                      </span>
                    </p>
                  )}

                  {/* Bylaw reference */}
                  {(zone.bylaw_reference || zone.bylaw_clause) && (
                    <p className="text-xs text-muted-foreground">
                      {t.zm.bylaw}{' '}
                      <span className="font-medium text-foreground">
                        {[zone.bylaw_reference, zone.bylaw_clause].filter(Boolean).join(' — ')}
                      </span>
                      {zone.bylaw_source_url && (
                        <a
                          href={zone.bylaw_source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center gap-0.5 text-green-700 hover:underline"
                        >
                          {t.zm.viewBylaw} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </p>
                  )}

                  {/* GPS link */}
                  {zone.location_lat != null && zone.location_lng != null && (
                    <a
                      href={buildPreferredMapUrlForCoordinates(zone.location_lat, zone.location_lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-green-700 hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {t.zm.viewOnMaps}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}

                  {/* Amenities (B-18) */}
                  {(zone.has_toilets || zone.has_water || zone.has_dump_station || zone.has_shower || zone.has_rubbish || zone.fee_nzd || zone.max_vehicles) && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-green-100">
                      {zone.has_toilets && (
                        <span className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-800 border border-teal-200 rounded px-1.5 py-0.5">🚻 Toilets</span>
                      )}
                      {zone.has_water && (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">💧 Water</span>
                      )}
                      {zone.has_dump_station && (
                        <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">⬇ Dump Station</span>
                      )}
                      {zone.has_shower && (
                        <span className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded px-1.5 py-0.5">🚿 Showers</span>
                      )}
                      {zone.has_rubbish && (
                        <span className="inline-flex items-center gap-1 text-xs bg-slate-50 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5">🗑 Rubbish</span>
                      )}
                      {zone.fee_nzd && (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                          NZD ${Number(zone.fee_nzd).toFixed(0)}/night
                        </span>
                      )}
                      {zone.max_vehicles && (
                        <span className="inline-flex items-center gap-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5">
                          Max {zone.max_vehicles} vehicles
                        </span>
                      )}
                    </div>
                  )}

                  {/* Register stay CTA (B-17) */}
                  <div className="pt-1">
                    <a
                      href={`/public/register?zone=${zone.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-900 hover:underline"
                    >
                      <Car className="h-3.5 w-3.5" />
                      Register your stay at this zone →
                    </a>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pt-4 pb-8 border-t">
          {t.zm.footerData} ·{' '}
          <a href="/public/register" className="text-green-700 hover:underline">Register Stay</a>
          {' '}·{' '}
          <a href="/public/noise-complaint" className="text-green-700 hover:underline">{t.zm.footerNoise}</a>
          {' '}·{' '}
          <a href="/dispute" className="text-green-700 hover:underline">{t.zm.footerDispute}</a>
        </footer>
      </main>
    </div>
  )
}
