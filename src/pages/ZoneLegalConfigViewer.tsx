/**
 * ZoneLegalConfigViewer — B-78
 *
 * Admin viewer for zone_legal_config — legal and enforcement configuration per zone.
 *
 * Features:
 *  - List of configured zones on the left / table row
 *  - Detail panel: enforcement details, stay limits, org contact block, payment info
 *  - Search: legal_description / land_act / enforcement_authority
 *  - KPI row: Total Configs / With Fine / SC Required / Zones Without Config (visual indicator)
 *
 * Route: /zone-legal-config — admin/master
 */

import { useState } from 'react'
import {
  Scale, Search, RefreshCw, AlertCircle, Loader2,
  Building2, DollarSign, Moon, ShieldCheck,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ZoneLegal = Database['public']['Tables']['zone_legal_config']['Row']

// ─── Component ───────────────────────────────────────────────────────────────

export default function ZoneLegalConfigViewer() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState<ZoneLegal | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: configs = [], isLoading, error, refetch } = useQuery<ZoneLegal[]>({
    queryKey: ['zone-legal-config', orgId],
    queryFn: async () => {
      let q = supabase.from('zone_legal_config').select('*').order('zone_id')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = configs.filter(c => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      c.zone_id?.toLowerCase().includes(s) ||
      c.legal_description?.toLowerCase().includes(s) ||
      c.land_act?.toLowerCase().includes(s) ||
      c.enforcement_authority?.toLowerCase().includes(s) ||
      c.enforcement_type?.toLowerCase().includes(s)
    )
  })

  const total     = configs.length
  const withFine  = configs.filter(c => c.fine_amount != null && c.fine_amount > 0).length
  const scReq     = configs.filter(c => c.self_contained_required).length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Scale className="h-7 w-7 text-slate-700 dark:text-slate-300" />
            <div>
              <h1 className="text-2xl font-bold">Zone Legal Config</h1>
              <p className="text-sm text-muted-foreground">Legal and enforcement configuration per zone</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Configs',       value: total,    icon: Scale,      colour: 'text-slate-600' },
            { label: 'With Fine',           value: withFine, icon: DollarSign, colour: withFine > 0 ? 'text-amber-600' : 'text-muted-foreground' },
            { label: 'Self-Contained Req.', value: scReq,    icon: ShieldCheck, colour: 'text-blue-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Zone, act, enforcement type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No zone legal configs found.</div>
        ) : (
          <div className="flex gap-4">
            {/* Config list */}
            <div className="flex-1 min-w-0">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zone ID</TableHead>
                        <TableHead>Land Act</TableHead>
                        <TableHead>Enforcement</TableHead>
                        <TableHead>Max Nights</TableHead>
                        <TableHead>Fine</TableHead>
                        <TableHead>SC Req</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(c => (
                        <TableRow
                          key={c.id}
                          className={`cursor-pointer hover:bg-muted/40 ${selected?.id === c.id ? 'bg-muted/60' : ''}`}
                          onClick={() => setSelected(selected?.id === c.id ? null : c)}
                        >
                          <TableCell className="font-mono text-xs font-semibold">{c.zone_id}</TableCell>
                          <TableCell className="text-sm">{c.land_act}</TableCell>
                          <TableCell className="text-sm capitalize">{c.enforcement_type?.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-center">
                            {c.max_stay_nights != null ? (
                              <span className="flex items-center gap-1 justify-center text-sm">
                                <Moon className="h-3.5 w-3.5 text-blue-400" />
                                {c.max_stay_nights}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {c.fine_amount != null ? (
                              <span className="text-amber-600 font-semibold">${c.fine_amount}</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            {c.self_contained_required ? (
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">Yes</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="w-80 flex-shrink-0 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Scale className="h-4 w-4 text-slate-600" />
                      Zone {selected.zone_id}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">

                    {/* Enforcement */}
                    <div>
                      <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Enforcement</p>
                      <div className="space-y-1">
                        {[
                          { label: 'Type',      value: selected.enforcement_type },
                          { label: 'Authority', value: selected.enforcement_authority },
                          { label: 'Land Act',  value: selected.land_act },
                          { label: 'Land Owner',value: selected.land_owner },
                          { label: 'Fine',      value: selected.fine_amount != null ? `$${selected.fine_amount}` : null },
                          { label: 'Trespass Duration', value: selected.trespass_duration_years != null ? `${selected.trespass_duration_years} years` : null },
                          { label: 'Vacate Hours',      value: selected.vacate_hours != null ? `${selected.vacate_hours}h` : null },
                        ].map(({ label, value }) => value ? (
                          <div key={label} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="text-right capitalize">{value.toString().replace(/_/g, ' ')}</span>
                          </div>
                        ) : null)}
                      </div>
                    </div>

                    {/* Stay Limits */}
                    <div>
                      <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Stay Limits</p>
                      <div className="space-y-1">
                        {[
                          { label: 'Max Stay Nights',        value: selected.max_stay_nights != null ? `${selected.max_stay_nights} nights` : null },
                          { label: 'Max Consecutive Nights', value: selected.max_consecutive_nights != null ? `${selected.max_consecutive_nights} nights` : null },
                          { label: 'Self-Contained Req.',    value: selected.self_contained_required ? 'Yes' : 'No' },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="text-right">{value ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Organisation */}
                    <div>
                      <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
                        <Building2 className="inline h-3.5 w-3.5 mr-1" />
                        Organisation
                      </p>
                      <div className="space-y-0.5 text-xs">
                        {[
                          selected.org_office_name,
                          selected.org_street_address,
                          selected.org_building,
                          `${selected.org_city} ${selected.org_postcode}`,
                          selected.org_po_box ? `PO Box ${selected.org_po_box}` : null,
                          selected.org_country,
                        ].filter(Boolean).map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                        {selected.org_phone && <p className="mt-1">Ph: {selected.org_phone}</p>}
                        {selected.org_email && <p>Email: {selected.org_email}</p>}
                        {selected.org_website && (
                          <a href={selected.org_website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {selected.org_website}
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Payment */}
                    {(selected.payment_bank_account || selected.payment_online_url) && (
                      <div>
                        <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
                          <DollarSign className="inline h-3.5 w-3.5 mr-1" />
                          Payment
                        </p>
                        <div className="space-y-1 text-xs">
                          {selected.payment_bank_account && <p>Bank: {selected.payment_bank_account}</p>}
                          {selected.payment_online_url && (
                            <a href={selected.payment_online_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                              Pay online
                            </a>
                          )}
                          {selected.payment_instructions && (
                            <p className="text-muted-foreground">{selected.payment_instructions}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Legal Description */}
                    {selected.legal_description && (
                      <div>
                        <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-1">Legal Description</p>
                        <p className="text-xs">{selected.legal_description}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
