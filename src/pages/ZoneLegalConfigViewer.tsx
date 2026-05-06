/**
 * ZoneLegalConfigViewer — B-78
 *
 * Split-panel viewer for zone_legal_config — one config per zone.
 *
 * Left panel: list of zone configs (zone_id, org_office_name, enforcement_type)
 * Right panel: full detail for selected config, grouped into sections:
 *   - Enforcement (enforcement_type, authority, land_act, land_owner, fine_amount, max_stay_nights, vacate_hours)
 *   - Stay Rules (max_consecutive_nights, self_contained_required, trespass_duration_years)
 *   - Organisation (org_office_name, street, city, postcode, building, phone, email, website, fax, po_box)
 *   - Payment (payment_bank_account, payment_online_url, payment_instructions)
 *
 * Route: /zone-legal-config — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Scale, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ZoneLegal = Database['public']['Tables']['zone_legal_config']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 border-b border-muted last:border-0">
      <span className="text-muted-foreground text-sm w-48 shrink-0">{label}</span>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ZoneLegalConfigViewer() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: configs = [], isLoading, refetch } = useQuery<ZoneLegal[]>({
    queryKey: ['zone-legal-config', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zone_legal_config')
        .select('*')
        .eq('organization_id', orgId!)
        .order('org_office_name')
      if (error) throw error
      return data ?? []
    },
  })

  const selected = configs.find(c => c.id === selectedId) ?? null

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-purple-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Legal Config</h1>
              <p className="text-sm text-muted-foreground">Legal configuration per freedom camping zone</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : configs.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No zone legal configs found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-220px)]">
            {/* Left: list */}
            <div className="border rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/40 text-sm font-medium">
                {configs.length} config{configs.length !== 1 ? 's' : ''}
              </div>
              <ScrollArea className="h-full">
                {configs.map(c => (
                  <button
                    key={c.id}
                    className={`w-full text-left px-3 py-3 border-b hover:bg-muted/50 transition-colors ${selectedId === c.id ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <p className="font-medium text-sm truncate">{c.org_office_name}</p>
                    <p className="text-xs text-muted-foreground">{c.enforcement_type}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.zone_id}</p>
                  </button>
                ))}
              </ScrollArea>
            </div>

            {/* Right: detail */}
            <div className="md:col-span-2 border rounded-md overflow-hidden">
              {!selected ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <Scale className="h-10 w-10 opacity-30" />
                  <p>Select a config to view details</p>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-5">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">{selected.org_office_name}</h2>
                      <Badge className="bg-purple-100 text-purple-800">{selected.enforcement_type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{selected.legal_description}</p>

                    {/* Enforcement */}
                    <Card>
                      <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">Enforcement</CardTitle></CardHeader>
                      <CardContent className="px-4 pb-3">
                        <Row label="Type"              value={selected.enforcement_type} />
                        <Row label="Authority"         value={selected.enforcement_authority} />
                        <Row label="Land Act"          value={selected.land_act} />
                        <Row label="Land Owner"        value={selected.land_owner} />
                        <Row label="Managing Authority" value={selected.managing_authority} />
                        <Row label="Fine Amount"       value={selected.fine_amount != null ? `$${selected.fine_amount.toFixed(2)}` : null} />
                        <Row label="Max Stay Nights"   value={selected.max_stay_nights} />
                        <Row label="Vacate Hours"      value={selected.vacate_hours} />
                        <Row label="Breach Template"   value={selected.breach_template} />
                        <Row label="Dispute Portal"    value={selected.dispute_portal_url ? <a href={selected.dispute_portal_url} target="_blank" rel="noreferrer" className="underline text-blue-600">{selected.dispute_portal_url}</a> : null} />
                      </CardContent>
                    </Card>

                    {/* Stay Rules */}
                    <Card>
                      <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">Stay Rules</CardTitle></CardHeader>
                      <CardContent className="px-4 pb-3">
                        <Row label="Max Consecutive Nights"  value={selected.max_consecutive_nights} />
                        <Row label="Self Contained Required" value={selected.self_contained_required != null ? (selected.self_contained_required ? 'Yes' : 'No') : null} />
                        <Row label="Trespass Duration (yrs)" value={selected.trespass_duration_years} />
                        <Row label="Objections Email"        value={selected.objections_email} />
                        <Row label="Objections Postal"       value={selected.objections_postal_address} />
                      </CardContent>
                    </Card>

                    {/* Organisation */}
                    <Card>
                      <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">Organisation</CardTitle></CardHeader>
                      <CardContent className="px-4 pb-3">
                        <Row label="Office Name"    value={selected.org_office_name} />
                        <Row label="Building"       value={selected.org_building} />
                        <Row label="Street Address" value={selected.org_street_address} />
                        <Row label="City"           value={selected.org_city} />
                        <Row label="Postcode"       value={selected.org_postcode} />
                        <Row label="Country"        value={selected.org_country} />
                        <Row label="PO Box"         value={selected.org_po_box} />
                        <Row label="Phone"          value={selected.org_phone} />
                        <Row label="Fax"            value={selected.org_fax} />
                        <Row label="Email"          value={selected.org_email} />
                        <Row label="Website"        value={selected.org_website ? <a href={selected.org_website} target="_blank" rel="noreferrer" className="underline text-blue-600">{selected.org_website}</a> : null} />
                      </CardContent>
                    </Card>

                    {/* Payment */}
                    <Card>
                      <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">Payment</CardTitle></CardHeader>
                      <CardContent className="px-4 pb-3">
                        <Row label="Bank Account"    value={selected.payment_bank_account} />
                        <Row label="Online URL"      value={selected.payment_online_url ? <a href={selected.payment_online_url} target="_blank" rel="noreferrer" className="underline text-blue-600">{selected.payment_online_url}</a> : null} />
                        <Row label="Instructions"    value={selected.payment_instructions} />
                      </CardContent>
                    </Card>

                    <p className="text-xs text-muted-foreground">Updated: {fmtDate(selected.updated_at)}</p>
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
