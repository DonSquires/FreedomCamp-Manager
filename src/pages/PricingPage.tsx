/**
 * PricingPage – Per-client service pricing management.
 *
 * Allows admins to configure:
 *   • Hourly charge rate (billed to client) and pay rate (paid to officer)
 *   • Per-service flat fee (e.g. per call-out)
 *   • Distance / travel charges (per km, call-out fee, free km threshold)
 *   • Minimum billable hours per engagement
 *
 * Data stored in public.service_pricing table.
 * Uses a card-per-client layout with expandable service rows.
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Building2,
  DollarSign,
  Plus,
  Edit2,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  freedom_camping:      'Freedom Camping',
  guarding:             'Guarding',
  parking:              'Parking Enforcement',
  noise_control:        'Noise Control',
  patrol:               'General Patrol',
  alarm_response:       'Alarm Response',
  ems:                  'Electronic Monitoring (EMS)',
  access_control:       'Access Control',
  building_checks:      'Building Checks',
  person_of_interest:   'Person of Interest',
  vehicle_of_interest:  'Vehicle of Interest',
  identity_verification:'Identity Verification',
  investigation:        'Investigation',
  dispatch:             'Dispatch',
  site_risk_assessment: 'Site Risk Assessment',
  escort:               'Escort',
  key_holding:          'Key Holding',
}

const ALL_SERVICE_TYPES = Object.keys(SERVICE_LABELS)

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricingRow {
  id: string
  provider_organization_id: string
  client_organization_id: string
  service_type: string
  hourly_charge_rate: number | null
  hourly_pay_rate: number | null
  per_service_charge: number | null
  per_service_pay: number | null
  minimum_hours: number | null
  travel_charge_enabled: boolean
  travel_charge_per_km: number | null
  travel_call_out_fee: number | null
  travel_free_km: number | null
  currency: string
  notes: string | null
  is_active: boolean
}

interface PricingFormState {
  service_type: string
  hourly_charge_rate: string
  hourly_pay_rate: string
  per_service_charge: string
  per_service_pay: string
  minimum_hours: string
  travel_charge_enabled: boolean
  travel_charge_per_km: string
  travel_call_out_fee: string
  travel_free_km: string
  notes: string
}

const EMPTY_FORM: PricingFormState = {
  service_type: '',
  hourly_charge_rate: '',
  hourly_pay_rate: '',
  per_service_charge: '',
  per_service_pay: '',
  minimum_hours: '',
  travel_charge_enabled: false,
  travel_charge_per_km: '',
  travel_call_out_fee: '',
  travel_free_km: '',
  notes: '',
}

function numOrNull(s: string): number | null {
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function fmtRate(n: number | null | undefined, suffix = '/hr'): string | null {
  if (n == null) return null
  return `$${n.toFixed(2)}${suffix}`
}

// ─── Client pricing card ──────────────────────────────────────────────────────

function ClientPricingCard({
  client,
  providerOrgId,
  rows,
  onAdd,
  onEdit,
}: {
  client: { id: string; name: string }
  providerOrgId: string
  rows: PricingRow[]
  onAdd: (clientId: string) => void
  onEdit: (row: PricingRow) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const activeRows = rows.filter((r) => r.is_active)

  return (
    <Card className="bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40">
            <Building2 className="h-4 w-4 text-blue-700 dark:text-blue-300" />
          </div>
          <div>
            <p className="font-semibold text-sm text-gray-900 dark:text-white">{client.name}</p>
            <p className="text-xs text-muted-foreground">
              {activeRows.length} service{activeRows.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={(e) => { e.stopPropagation(); onAdd(client.id) }}
          >
            <Plus className="h-3 w-3" />
            Add Rate
          </Button>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="pt-0 px-4 pb-4">
          {activeRows.length === 0 ? (
            <div className="py-6 text-center border-t border-gray-100 dark:border-gray-800">
              <DollarSign className="h-6 w-6 text-gray-300 mx-auto mb-1.5" />
              <p className="text-sm text-muted-foreground">No rates configured for this client yet.</p>
              <Button size="sm" variant="outline" className="mt-2 text-xs gap-1" onClick={() => onAdd(client.id)}>
                <Plus className="h-3 w-3" />
                Add First Rate
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
              {activeRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between py-2.5 gap-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 -mx-1 px-1 rounded transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {SERVICE_LABELS[row.service_type] ?? row.service_type}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {row.hourly_charge_rate != null && (
                        <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                          Charge: {fmtRate(row.hourly_charge_rate)}
                        </span>
                      )}
                      {row.hourly_pay_rate != null && (
                        <span className="text-xs text-blue-700 dark:text-blue-400">
                          Pay: {fmtRate(row.hourly_pay_rate)}
                        </span>
                      )}
                      {row.per_service_charge != null && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          Per call-out: {fmtRate(row.per_service_charge, '')}
                        </span>
                      )}
                      {row.minimum_hours != null && (
                        <span className="text-xs text-muted-foreground">
                          Min {row.minimum_hours}h
                        </span>
                      )}
                      {row.travel_charge_enabled && (
                        <span className="flex items-center gap-1 text-xs text-purple-700 dark:text-purple-400">
                          <Car className="h-3 w-3" />
                          Travel: {fmtRate(row.travel_charge_per_km, '/km')}
                          {row.travel_free_km != null && ` (${row.travel_free_km}km free)`}
                        </span>
                      )}
                    </div>
                    {row.notes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-xs">{row.notes}</p>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => onEdit(row)}>
                    <Edit2 className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PricingPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [showDialog, setShowDialog] = useState(false)
  const [editRow, setEditRow] = useState<PricingRow | null>(null)
  const [activeClientId, setActiveClientId] = useState<string | null>(null)
  const [form, setForm] = useState<PricingFormState>(EMPTY_FORM)

  const providerOrgId = user?.organization_id ?? ''

  // Load client orgs
  const { data: clients = [] } = useQuery({
    queryKey: ['pricing-clients'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id, name')
        .eq('organization_type', 'client')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Load all pricing rows for this provider
  const { data: allRows = [], isLoading } = useQuery({
    queryKey: ['service-pricing', providerOrgId],
    queryFn: async () => {
      if (!providerOrgId) return []
      const { data, error } = await (supabase as any)
        .from('service_pricing')
        .select('*')
        .eq('provider_organization_id', providerOrgId)
        .eq('is_active', true)
        .order('service_type')
      if (error) {
        console.warn('service_pricing query:', error.message)
        return []
      }
      return data ?? []
    },
    enabled: !!providerOrgId,
  })

  const rowsByClient = (clientId: string) =>
    (allRows as PricingRow[]).filter((r) => r.client_organization_id === clientId)

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<PricingRow>) => {
      if (editRow) {
        const { error } = await (supabase as any)
          .from('service_pricing')
          .update({ ...payload, updated_by: user?.id })
          .eq('id', editRow.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('service_pricing')
          .insert({ ...payload, created_by: user?.id, updated_by: user?.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-pricing'] })
      setShowDialog(false)
      setEditRow(null)
      setForm(EMPTY_FORM)
      toast.success(editRow ? 'Pricing updated' : 'Pricing added')
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to save pricing'),
  })

  const handleOpenAdd = useCallback((clientId: string) => {
    setEditRow(null)
    setActiveClientId(clientId)
    setForm(EMPTY_FORM)
    setShowDialog(true)
  }, [])

  const handleOpenEdit = useCallback((row: PricingRow) => {
    setEditRow(row)
    setActiveClientId(row.client_organization_id)
    setForm({
      service_type:          row.service_type,
      hourly_charge_rate:    row.hourly_charge_rate?.toString() ?? '',
      hourly_pay_rate:       row.hourly_pay_rate?.toString() ?? '',
      per_service_charge:    row.per_service_charge?.toString() ?? '',
      per_service_pay:       row.per_service_pay?.toString() ?? '',
      minimum_hours:         row.minimum_hours?.toString() ?? '',
      travel_charge_enabled: row.travel_charge_enabled,
      travel_charge_per_km:  row.travel_charge_per_km?.toString() ?? '',
      travel_call_out_fee:   row.travel_call_out_fee?.toString() ?? '',
      travel_free_km:        row.travel_free_km?.toString() ?? '',
      notes:                 row.notes ?? '',
    })
    setShowDialog(true)
  }, [])

  const handleSave = () => {
    if (!form.service_type) { toast.error('Please select a service type'); return }
    if (!activeClientId) { toast.error('No client selected'); return }
    saveMutation.mutate({
      provider_organization_id: providerOrgId,
      client_organization_id:   activeClientId,
      service_type:             form.service_type,
      hourly_charge_rate:       numOrNull(form.hourly_charge_rate),
      hourly_pay_rate:          numOrNull(form.hourly_pay_rate),
      per_service_charge:       numOrNull(form.per_service_charge),
      per_service_pay:          numOrNull(form.per_service_pay),
      minimum_hours:            numOrNull(form.minimum_hours),
      travel_charge_enabled:    form.travel_charge_enabled,
      travel_charge_per_km:     form.travel_charge_enabled ? numOrNull(form.travel_charge_per_km) : null,
      travel_call_out_fee:      form.travel_charge_enabled ? numOrNull(form.travel_call_out_fee) : null,
      travel_free_km:           form.travel_charge_enabled ? numOrNull(form.travel_free_km) : null,
      notes:                    form.notes.trim() || null,
      currency:                 'NZD',
      is_active:                true,
    })
  }

  const activeClientName = clients.find((c: any) => c.id === activeClientId)?.name ?? ''

  return (
    <AppLayout title="Service Pricing" description="Per-client per-service rate configuration">
      <div className="space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40">
              <DollarSign className="h-6 w-6 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Service Pricing</h1>
              <p className="text-sm text-muted-foreground">
                Hourly rates, per-service fees and travel charges per client
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs self-start sm:self-auto">
            <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
            {(allRows as PricingRow[]).length} rate{(allRows as PricingRow[]).length !== 1 ? 's' : ''} configured
          </Badge>
        </div>

        {/* ── Per-client cards ─────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading pricing configuration…</div>
        ) : clients.length === 0 ? (
          <div className="py-10 text-center">
            <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No client organisations found. Add clients in the CRM first.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map((client: any) => (
              <ClientPricingCard
                key={client.id}
                client={client}
                providerOrgId={providerOrgId}
                rows={rowsByClient(client.id)}
                onAdd={handleOpenAdd}
                onEdit={handleOpenEdit}
              />
            ))}
          </div>
        )}

      </div>

      {/* ── Add / Edit dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditRow(null) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRow ? 'Edit Service Rate' : 'Add Service Rate'}</DialogTitle>
            <DialogDescription className="text-xs">
              {activeClientName} — configure the pricing for a specific service type
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">

            {/* Service type */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Service Type *</Label>
              <Select
                value={form.service_type}
                onValueChange={(v) => setForm((f) => ({ ...f, service_type: v }))}
                disabled={!!editRow}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select service type…" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_SERVICE_TYPES.map((st) => (
                    <SelectItem key={st} value={st}>{SERVICE_LABELS[st]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Hourly rates */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Hourly Rates</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Charge Rate (client billed)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-6 h-9"
                      value={form.hourly_charge_rate}
                      onChange={(e) => setForm((f) => ({ ...f, hourly_charge_rate: e.target.value }))}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Per hour billed to client</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Pay Rate (officer paid)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-6 h-9"
                      value={form.hourly_pay_rate}
                      onChange={(e) => setForm((f) => ({ ...f, hourly_pay_rate: e.target.value }))}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Per hour paid to officer</p>
                </div>
              </div>
            </div>

            {/* Per-service flat fee */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Per-Service Flat Fee</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Call-out Charge (client)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-6 h-9"
                      value={form.per_service_charge}
                      onChange={(e) => setForm((f) => ({ ...f, per_service_charge: e.target.value }))}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Flat fee per job/call-out</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum Billable Hours</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    placeholder="1.0"
                    className="h-9"
                    value={form.minimum_hours}
                    onChange={(e) => setForm((f) => ({ ...f, minimum_hours: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">Min hours charged per job</p>
                </div>
              </div>
            </div>

            {/* Travel charges */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Travel / Distance Charges</p>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Enable</Label>
                  <Switch
                    checked={form.travel_charge_enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, travel_charge_enabled: v }))}
                  />
                </div>
              </div>
              {form.travel_charge_enabled && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rate per km</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-6 h-9"
                        value={form.travel_charge_per_km}
                        onChange={(e) => setForm((f) => ({ ...f, travel_charge_per_km: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Call-out travel fee</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-6 h-9"
                        value={form.travel_call_out_fee}
                        onChange={(e) => setForm((f) => ({ ...f, travel_call_out_fee: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Free km included</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      className="h-9"
                      value={form.travel_free_km}
                      onChange={(e) => setForm((f) => ({ ...f, travel_free_km: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                placeholder="Internal notes about this pricing arrangement…"
                className="text-sm resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editRow ? 'Save Changes' : 'Add Rate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
