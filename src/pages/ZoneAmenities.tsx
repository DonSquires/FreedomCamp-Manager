/**
 * ZoneAmenities — B-57
 *
 * Dedicated bulk editor for zone facility flags and capacity/fee data.
 *
 * Provides an at-a-glance matrix view of all zones with inline-editable
 * facility toggles and capacity/fee fields — designed for quickly updating
 * amenity information across many zones without opening each zone's full
 * edit dialog.
 *
 * Facilities managed:
 *  - has_toilets, has_water, has_dump_station, has_shower, has_rubbish
 *  - max_vehicles (nullable integer)
 *  - fee_nzd (nullable decimal)
 *
 * Route: /zone-amenities  — admin / admin_officer / master
 * Uses fully typed database.ts zones columns.
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Droplets, Trash2, ShowerHead, Toilet, Fuel,
  Car, DollarSign, Loader2, RefreshCw, Save,
  CheckCircle2, AlertCircle, MapPin, Filter,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ZoneAmenityRow {
  id: string
  name: string
  zone_type: string | null
  is_active: boolean | null
  has_toilets: boolean | null
  has_water: boolean | null
  has_dump_station: boolean | null
  has_shower: boolean | null
  has_rubbish: boolean | null
  max_vehicles: number | null
  fee_nzd: number | null
}

type AmenityPatch = {
  has_toilets?: boolean
  has_water?: boolean
  has_dump_station?: boolean
  has_shower?: boolean
  has_rubbish?: boolean
  max_vehicles?: number | null
  fee_nzd?: number | null
}

// Draft edits keyed by zone id
type DraftMap = Record<string, AmenityPatch>

// ─── Facility columns config ──────────────────────────────────────────────────

const FACILITY_COLS: Array<{
  key: keyof AmenityPatch
  label: string
  shortLabel: string
  Icon: React.ElementType
  colour: string
}> = [
  { key: 'has_toilets',      label: 'Toilets',       shortLabel: 'WC',    Icon: Toilet,    colour: 'text-purple-600' },
  { key: 'has_water',        label: 'Potable Water',  shortLabel: 'Water', Icon: Droplets,  colour: 'text-blue-600'   },
  { key: 'has_dump_station', label: 'Dump Station',   shortLabel: 'Dump',  Icon: Fuel,      colour: 'text-orange-600' },
  { key: 'has_shower',       label: 'Showers',        shortLabel: 'Shower',Icon: ShowerHead,colour: 'text-cyan-600'   },
  { key: 'has_rubbish',      label: 'Rubbish Bins',   shortLabel: 'Bins',  Icon: Trash2,    colour: 'text-green-600'  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function ZoneAmenities() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [showActiveOnly, setShowActiveOnly] = useState(false)
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: zones = [], isLoading, error, refetch } = useQuery<ZoneAmenityRow[]>({
    queryKey: ['zone_amenities', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select(`
          id, name, zone_type, is_active,
          has_toilets, has_water, has_dump_station, has_shower, has_rubbish,
          max_vehicles, fee_nzd
        `)
        .eq('organization_id', orgId as string)
        .order('name')
      if (error) throw error
      return data as ZoneAmenityRow[]
    },
  })

  // ── Mutation: save one zone ────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AmenityPatch }) => {
      const { error } = await (supabase as any)
        .from('zones')
        .update(patch)
        .eq('id', id)
        .eq('organization_id', orgId as string)
      if (error) throw error
    },
    onMutate: ({ id }) => setSavingId(id),
    onSuccess: (_, { id }) => {
      toast.success('Zone amenities saved.')
      setSavingId(null)
      setDrafts(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      qc.invalidateQueries({ queryKey: ['zone_amenities'] })
    },
    onError: (e: Error, { id }) => {
      toast.error(`Save failed: ${e.message}`)
      setSavingId(null)
    },
  })

  // ── Draft helpers ──────────────────────────────────────────────────────────
  const getField = useCallback(
    <K extends keyof ZoneAmenityRow>(zone: ZoneAmenityRow, key: K): ZoneAmenityRow[K] => {
      const draft = drafts[zone.id]
      if (draft && key in draft) return (draft as Record<string, unknown>)[key as string] as ZoneAmenityRow[K]
      return zone[key]
    },
    [drafts],
  )

  const setDraft = (id: string, patch: AmenityPatch) => {
    setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
  }

  const hasDraft = (id: string) => !!drafts[id] && Object.keys(drafts[id]).length > 0

  const saveZone = (zone: ZoneAmenityRow) => {
    const draft = drafts[zone.id]
    if (!draft) return
    saveMutation.mutate({ id: zone.id, patch: draft })
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = zones.filter(z => {
    if (showActiveOnly && !z.is_active) return false
    if (search && !z.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totalDirty = Object.keys(drafts).length

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <TooltipProvider>
        <div className="space-y-6 p-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin className="h-6 w-6 text-teal-600" />
              <div>
                <h1 className="text-2xl font-bold">Zone Amenities Editor</h1>
                <p className="text-sm text-muted-foreground">Update facility flags, capacity, and fees for all zones</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {totalDirty > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {totalDirty} unsaved change{totalDirty !== 1 ? 's' : ''}
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>

          {/* Facility legend */}
          <div className="flex flex-wrap gap-3">
            {FACILITY_COLS.map(col => (
              <span key={col.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <col.Icon className={`h-3.5 w-3.5 ${col.colour}`} />
                {col.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Car className="h-3.5 w-3.5 text-slate-500" /> Max Vehicles
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5 text-slate-500" /> Nightly Fee (NZD)
            </span>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-end gap-4">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Search zone name</Label>
                  <Input
                    placeholder="Filter zones…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="text-sm max-w-xs"
                  />
                </div>
                <div className="flex items-center gap-2 pb-1">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Switch
                    id="active-only"
                    checked={showActiveOnly}
                    onCheckedChange={setShowActiveOnly}
                  />
                  <Label htmlFor="active-only" className="text-sm cursor-pointer">Active zones only</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Matrix table */}
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex items-center gap-2 text-destructive py-8 justify-center">
              <AlertCircle className="h-5 w-5" /> Failed to load zones.
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MapPin className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No zones match your filters.</p>
            </div>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  {filtered.length} zone{filtered.length !== 1 ? 's' : ''} — toggle facilities and set capacity/fee inline, then save each row
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-48 min-w-[10rem]">Zone</th>
                      {FACILITY_COLS.map(col => (
                        <th key={col.key} className="px-3 py-3 text-center font-medium text-muted-foreground">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex flex-col items-center gap-1 cursor-default">
                                <col.Icon className={`h-4 w-4 ${col.colour}`} />
                                <span className="text-[10px]">{col.shortLabel}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{col.label}</TooltipContent>
                          </Tooltip>
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center font-medium text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex flex-col items-center gap-1 cursor-default">
                              <Car className="h-4 w-4 text-slate-500" />
                              <span className="text-[10px]">Max</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Maximum vehicles permitted simultaneously</TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="px-3 py-3 text-center font-medium text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex flex-col items-center gap-1 cursor-default">
                              <DollarSign className="h-4 w-4 text-slate-500" />
                              <span className="text-[10px]">Fee NZD</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Nightly fee in NZD (leave blank for free)</TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((zone, idx) => {
                      const dirty = hasDraft(zone.id)
                      const saving = savingId === zone.id
                      return (
                        <tr
                          key={zone.id}
                          className={[
                            'border-b transition-colors',
                            dirty ? 'bg-amber-50/60 dark:bg-amber-900/10' : idx % 2 === 0 ? '' : 'bg-muted/20',
                          ].join(' ')}
                        >
                          {/* Zone name */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium truncate max-w-[10rem]" title={zone.name}>{zone.name}</span>
                              <div className="flex items-center gap-1">
                                {zone.zone_type && <span className="text-[10px] text-muted-foreground">{zone.zone_type}</span>}
                                {!zone.is_active && <Badge variant="secondary" className="text-[9px] h-4 px-1">Inactive</Badge>}
                              </div>
                            </div>
                          </td>

                          {/* Facility toggles */}
                          {FACILITY_COLS.map(col => {
                            const val = getField(zone, col.key as keyof ZoneAmenityRow) as boolean | null
                            return (
                              <td key={col.key} className="px-3 py-3 text-center">
                                <Switch
                                  checked={val ?? false}
                                  onCheckedChange={v => setDraft(zone.id, { [col.key]: v })}
                                  aria-label={`${zone.name} ${col.label}`}
                                />
                              </td>
                            )
                          })}

                          {/* Max vehicles */}
                          <td className="px-3 py-3">
                            <Input
                              type="number"
                              min={1}
                              placeholder="—"
                              className="w-16 h-7 text-xs text-center"
                              value={
                                drafts[zone.id]?.max_vehicles !== undefined
                                  ? (drafts[zone.id].max_vehicles ?? '')
                                  : (zone.max_vehicles ?? '')
                              }
                              onChange={e => {
                                const v = e.target.value
                                setDraft(zone.id, { max_vehicles: v === '' ? null : parseInt(v) })
                              }}
                            />
                          </td>

                          {/* Fee NZD */}
                          <td className="px-3 py-3">
                            <Input
                              type="number"
                              min={0}
                              step={0.50}
                              placeholder="Free"
                              className="w-20 h-7 text-xs text-center"
                              value={
                                drafts[zone.id]?.fee_nzd !== undefined
                                  ? (drafts[zone.id].fee_nzd ?? '')
                                  : (zone.fee_nzd ?? '')
                              }
                              onChange={e => {
                                const v = e.target.value
                                setDraft(zone.id, { fee_nzd: v === '' ? null : parseFloat(v) })
                              }}
                            />
                          </td>

                          {/* Save button */}
                          <td className="px-4 py-3 text-right">
                            {dirty ? (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => saveZone(zone)}
                                disabled={saving}
                              >
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                Save
                              </Button>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </TooltipProvider>
    </AppLayout>
  )
}
