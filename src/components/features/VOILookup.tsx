/**
 * VOILookup — Vehicle of Interest quick-lookup.
 *
 * Available to ALL rostered field officers regardless of location (no geofence
 * restriction).  Officers enter a plate (full or partial) and the component
 * shows any matching VOI records for their organisation.
 *
 * Used in: FieldOfficerPortal, SiteGuardPortal, ParkingOfficerPortal, NoiseOfficerPortal
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Car, AlertTriangle, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VOIRecord {
  id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_color: string | null
  vehicle_year: number | null
  description: string | null
  status: string
  reason: string | null
  photos: string[]
  active: boolean
  expires_at: string | null
  notes: string | null
  linked_person: { full_name: string } | null
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  voi:        { label: 'Vehicle of Interest',  className: 'bg-blue-100 text-blue-700 border-blue-200' },
  banned:     { label: 'Banned',               className: 'bg-red-100 text-red-700 border-red-200' },
  trespassed: { label: 'Trespass Order',        className: 'bg-orange-100 text-orange-700 border-orange-200' },
}

// ─── Component ────────────────────────────────────────────────────────────────

interface VOILookupProps {
  /** If true, the component renders as an inline panel (no extra padding).  Default false = card style. */
  inline?: boolean
}

export function VOILookup({ inline = false }: VOILookupProps) {
  const { user } = useAuthStore()
  const [plate, setPlate]       = useState('')
  const [submitted, setSubmitted] = useState('')

  function handleSearch() {
    const clean = plate.trim().toUpperCase().replace(/\s/g, '')
    if (clean.length < 2) { return }
    setSubmitted(clean)
  }

  const { data: results = [], isFetching } = useQuery<VOIRecord[]>({
    queryKey: ['voi_lookup', user?.organization_id, submitted],
    queryFn: async () => {
      if (!user?.organization_id || !submitted) return []
      const { data, error } = await (supabase as any)
        .from('vehicles_of_interest')
        .select(`
          id, plate_number, vehicle_make, vehicle_model, vehicle_color,
          vehicle_year, description, status, reason, photos, active,
          expires_at, notes,
          linked_person:persons_of_interest!linked_person_id(full_name)
        `)
        .eq('organization_id', user.organization_id)
        .eq('active', true)
        .ilike('plate_number', `%${submitted}%`)
        .order('plate_number')
        .limit(20)
      if (error) return []
      return (data ?? []).map((v: any) => ({
        ...v,
        linked_person: Array.isArray(v.linked_person) ? v.linked_person[0] ?? null : v.linked_person,
      })) as VOIRecord[]
    },
    enabled: !!submitted && !!user?.organization_id,
  })

  const hasResult = submitted.length > 0

  return (
    <div className={inline ? '' : 'rounded-xl border bg-white dark:bg-gray-900 shadow-sm'}>
      {/* Search bar */}
      <div className={`flex gap-2 ${inline ? '' : 'p-3 border-b'}`}>
        <div className="relative flex-1">
          <Car className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            className="pl-8 uppercase font-mono text-sm"
            placeholder="Enter plate number…"
            value={plate}
            onChange={e => setPlate(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
          />
        </div>
        <Button
          size="sm"
          onClick={handleSearch}
          disabled={plate.trim().length < 2}
          className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
        >
          <Search className="h-4 w-4" />
        </Button>
        {submitted && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setPlate(''); setSubmitted('') }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Results */}
      {hasResult && (
        <div className={inline ? 'mt-2' : 'p-3 space-y-2'}>
          {isFetching ? (
            <p className="text-sm text-gray-400 text-center py-3">Searching…</p>
          ) : results.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3">
              <Car className="h-4 w-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-700 font-medium">
                No flagged records found for "{submitted}"
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                <p className="text-sm font-semibold text-red-700">
                  {results.length} flagged record{results.length !== 1 ? 's' : ''} found
                </p>
              </div>
              {results.map(voi => {
                const cfg = STATUS_CONFIG[voi.status] ?? STATUS_CONFIG.voi
                const expired = voi.expires_at && voi.expires_at < new Date().toISOString()
                return (
                  <div
                    key={voi.id}
                    className={`rounded-lg border p-3 ${expired ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {voi.photos?.[0] ? (
                          <img
                            src={voi.photos[0]}
                            alt={voi.plate_number}
                            className="w-10 h-7 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-7 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <Car className="h-4 w-4 text-gray-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-sm font-mono tracking-wider">{voi.plate_number}</p>
                          <p className="text-xs text-gray-500">
                            {[voi.vehicle_year, voi.vehicle_make, voi.vehicle_model, voi.vehicle_color]
                              .filter(Boolean).join(' ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className={`text-xs ${cfg.className}`}>
                          {cfg.label}
                        </Badge>
                        {expired && (
                          <Badge variant="outline" className="text-xs border-gray-200 text-gray-400">
                            Expired
                          </Badge>
                        )}
                      </div>
                    </div>

                    {voi.reason && (
                      <p className="text-xs text-gray-600 mt-2 pl-12">{voi.reason}</p>
                    )}

                    {voi.linked_person && (
                      <p className="text-xs text-orange-600 font-medium mt-1 pl-12 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Linked person: {voi.linked_person.full_name}
                      </p>
                    )}

                    {voi.expires_at && (
                      <p className="text-xs text-gray-400 mt-1 pl-12">
                        {expired ? 'Expired' : 'Expires'}{' '}
                        {format(parseISO(voi.expires_at), 'd MMM yyyy')}
                      </p>
                    )}

                    {voi.notes && (
                      <p className="text-xs text-gray-500 mt-1 pl-12 italic">{voi.notes}</p>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
