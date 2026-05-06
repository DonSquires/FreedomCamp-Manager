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

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { estimateEtaMinutes, haversineKm } from '@/lib/geo'
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
  MapPin,
  Trash2,
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
  biosecurity_inspection: 'Biosecurity Inspection',
  smoke_complaint_ooh:    'Smoke Complaint (OOH)',
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
  radius_pricing_zones: RadiusPricingZone[] | null
  base_office_lat: number | null
  base_office_lng: number | null
  currency: string
  notes: string | null
  is_active: boolean
}

interface RadiusPricingZone {
  label: string
  max_km: number
  flat_fee: number
  per_km_charge: number
}

const EMPTY_ZONE: RadiusPricingZone = { label: '', max_km: 50, flat_fee: 0, per_km_charge: 0 }

// Services that benefit from radius-based distance pricing
const RADIUS_PRICING_SERVICES = new Set(['biosecurity_inspection', 'smoke_complaint_ooh', 'patrol', 'alarm_response', 'escort'])

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
  radius_pricing_enabled: boolean
  radius_pricing_zones: RadiusPricingZone[]
  base_office_lat: string
  base_office_lng: string
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
  radius_pricing_enabled: false,
  radius_pricing_zones: [{ label: '0–50 km', max_km: 50, flat_fee: 0, per_km_charge: 0 }],
  base_office_lat: '',
  base_office_lng: '',
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

function formatCurrency(n: number): string {
  if (!isFinite(n)) return '$0.00'
  return `$${n.toFixed(2)}`
}

interface PatrolCostFormState {
  selectedPricingId: string
  guardsOnShift: string
  shiftHours: string
  billableHours: string
  chargeRatePerHour: string
  wagePerHour: string
  checksCompleted: string
  timeOnSiteMinsPerCheck: string
  travelMinsBetweenChecks: string
  overheadTravelMins: string
  travelKmTotal: string
  fuelLitresPer100Km: string
  fuelCostPerLitre: string
  vehicleCostPerKm: string
  overheadCostPerHour: string
  perCheckCharge: string
  fixedShiftCharge: string
  billedTravelPerKm: string
  billedTravelCallOutFee: string
  targetProfitMarginPct: string
}

interface QuoteSiteLine {
  id: string
  clientSiteId: string
  siteName: string
  patrolsPerMonth: string
  checksPerPatrol: string
  onSiteMinsPerPatrol: string
  travelMinsPerPatrol: string
  travelKmPerPatrol: string
  quotedRatePerPatrol: string
}

interface ClientDiscountFormState {
  enabled: boolean
  type: 'percent' | 'fixed'
  value: string
  notes: string
}

interface ClientSiteOption {
  id: string
  name: string | null
  address: string | null
  gps_lat: number | null
  gps_lng: number | null
}

interface SavedQuoteTemplate {
  id: string
  name: string
  selectedPricingId: string
  patrolCostForm: PatrolCostFormState
  quoteSites: QuoteSiteLine[]
  clientDiscount: ClientDiscountFormState
  updatedAt: string
}

const EMPTY_PATROL_COST_FORM: PatrolCostFormState = {
  selectedPricingId: '__none__',
  guardsOnShift: '1',
  shiftHours: '8',
  billableHours: '8',
  chargeRatePerHour: '85',
  wagePerHour: '35',
  checksCompleted: '24',
  timeOnSiteMinsPerCheck: '10',
  travelMinsBetweenChecks: '8',
  overheadTravelMins: '30',
  travelKmTotal: '90',
  fuelLitresPer100Km: '10',
  fuelCostPerLitre: '2.90',
  vehicleCostPerKm: '0.42',
  overheadCostPerHour: '18',
  perCheckCharge: '0',
  fixedShiftCharge: '0',
  billedTravelPerKm: '0',
  billedTravelCallOutFee: '0',
  targetProfitMarginPct: '39',
}

const createEmptyQuoteSiteLine = (): QuoteSiteLine => ({
  id: crypto.randomUUID(),
  clientSiteId: '__manual__',
  siteName: '',
  patrolsPerMonth: '30',
  checksPerPatrol: '1',
  onSiteMinsPerPatrol: '10',
  travelMinsPerPatrol: '8',
  travelKmPerPatrol: '6',
  quotedRatePerPatrol: '',
})

const EMPTY_CLIENT_DISCOUNT: ClientDiscountFormState = {
  enabled: false,
  type: 'percent',
  value: '',
  notes: '',
}

function buildTemplateStorageKey(providerOrgId: string): string {
  return `pricing-quote-templates:${providerOrgId || 'unknown'}`
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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showDialog, setShowDialog] = useState(false)
  const [editRow, setEditRow] = useState<PricingRow | null>(null)
  const [activeClientId, setActiveClientId] = useState<string | null>(null)
  const [form, setForm] = useState<PricingFormState>(EMPTY_FORM)
  const [patrolCostForm, setPatrolCostForm] = useState<PatrolCostFormState>(EMPTY_PATROL_COST_FORM)
  const [quoteSites, setQuoteSites] = useState<QuoteSiteLine[]>([createEmptyQuoteSiteLine()])
  const [clientDiscount, setClientDiscount] = useState<ClientDiscountFormState>(EMPTY_CLIENT_DISCOUNT)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplates, setSavedTemplates] = useState<SavedQuoteTemplate[]>([])

  const providerOrgId = user?.organization_id ?? ''

  useEffect(() => {
    if (typeof window === 'undefined' || !providerOrgId) {
      setSavedTemplates([])
      return
    }

    try {
      const raw = window.localStorage.getItem(buildTemplateStorageKey(providerOrgId))
      const parsedTemplates = raw ? JSON.parse(raw) as SavedQuoteTemplate[] : []
      setSavedTemplates(Array.isArray(parsedTemplates) ? parsedTemplates : [])
    } catch {
      setSavedTemplates([])
    }
  }, [providerOrgId])

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
    const hasRadius = Array.isArray(row.radius_pricing_zones) && row.radius_pricing_zones.length > 0
    setForm({
      service_type:           row.service_type,
      hourly_charge_rate:     row.hourly_charge_rate?.toString() ?? '',
      hourly_pay_rate:        row.hourly_pay_rate?.toString() ?? '',
      per_service_charge:     row.per_service_charge?.toString() ?? '',
      per_service_pay:        row.per_service_pay?.toString() ?? '',
      minimum_hours:          row.minimum_hours?.toString() ?? '',
      travel_charge_enabled:  row.travel_charge_enabled,
      travel_charge_per_km:   row.travel_charge_per_km?.toString() ?? '',
      travel_call_out_fee:    row.travel_call_out_fee?.toString() ?? '',
      travel_free_km:         row.travel_free_km?.toString() ?? '',
      radius_pricing_enabled: hasRadius,
      radius_pricing_zones:   hasRadius
        ? (row.radius_pricing_zones as RadiusPricingZone[])
        : [{ label: '0–50 km', max_km: 50, flat_fee: 0, per_km_charge: 0 }],
      base_office_lat:        row.base_office_lat?.toString() ?? '',
      base_office_lng:        row.base_office_lng?.toString() ?? '',
      notes:                  row.notes ?? '',
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
      radius_pricing_zones:     form.radius_pricing_enabled && form.radius_pricing_zones.length > 0
                                  ? form.radius_pricing_zones
                                  : null,
      base_office_lat:          form.radius_pricing_enabled ? numOrNull(form.base_office_lat) : null,
      base_office_lng:          form.radius_pricing_enabled ? numOrNull(form.base_office_lng) : null,
      notes:                    form.notes.trim() || null,
      currency:                 'NZD',
      is_active:                true,
    })
  }

  const activeClientName = clients.find((c: any) => c.id === activeClientId)?.name ?? ''

  const pricingOptions = useMemo(() => {
    const rows = (allRows as PricingRow[])
      .filter((r) => r.is_active)
      .map((r) => {
        const clientName = clients.find((c: any) => c.id === r.client_organization_id)?.name ?? 'Unknown client'
        return {
          id: r.id,
          label: `${clientName} - ${SERVICE_LABELS[r.service_type] ?? r.service_type}`,
          row: r,
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
    return rows
  }, [allRows, clients])

  const selectedPricing = useMemo(
    () => pricingOptions.find((o) => o.id === patrolCostForm.selectedPricingId)?.row ?? null,
    [patrolCostForm.selectedPricingId, pricingOptions]
  )

  const quoteClientOrgId = selectedPricing?.client_organization_id ?? ''

  const { data: clientSites = [] } = useQuery<ClientSiteOption[]>({
    queryKey: ['pricing-quote-client-sites', quoteClientOrgId],
    queryFn: async () => {
      if (!quoteClientOrgId) return []
      const { data, error } = await (supabase as any)
        .from('client_sites')
        .select('id, name, address, gps_lat, gps_lng')
        .eq('organization_id', quoteClientOrgId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as ClientSiteOption[]
    },
    enabled: !!quoteClientOrgId,
  })

  const saveTemplateToStorage = useCallback((nextTemplates: SavedQuoteTemplate[]) => {
    setSavedTemplates(nextTemplates)
    if (typeof window === 'undefined' || !providerOrgId) return
    window.localStorage.setItem(buildTemplateStorageKey(providerOrgId), JSON.stringify(nextTemplates))
  }, [providerOrgId])

  const createTenderProposalMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id || !user.organization_id) throw new Error('User session unavailable')
      if (!selectedPricing) throw new Error('Select a pricing row first')

      const clientName = clients.find((c: any) => c.id === selectedPricing.client_organization_id)?.name ?? 'Client'
      const serviceLabel = SERVICE_LABELS[selectedPricing.service_type] ?? selectedPricing.service_type

      const { data, error } = await ((supabase as any).from('tender_documents') as any)
        .insert({
          organization_id: user.organization_id,
          owner_id: user.id,
          title: `${clientName} ${serviceLabel} Quote`,
          document_type: 'proposal',
          issuing_body: clientName,
          description: `Generated from pricing model for ${clientName}`,
          status: 'staged',
          extracted_text: quoteDraft,
        })
        .select('id')
        .single()

      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (data) => {
      toast.success('Proposal created in Tender Workspace')
      navigate(`/tender-workspace/${data.id}`)
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create proposal'),
  })

  const parsed = useMemo(() => {
    const toNum = (v: string, fallback = 0) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }

    return {
      guardsOnShift: Math.max(1, toNum(patrolCostForm.guardsOnShift, 1)),
      shiftHours: Math.max(0.1, toNum(patrolCostForm.shiftHours, 0.1)),
      billableHours: Math.max(0.1, toNum(patrolCostForm.billableHours, 0.1)),
      chargeRatePerHour: Math.max(0, toNum(patrolCostForm.chargeRatePerHour)),
      wagePerHour: Math.max(0, toNum(patrolCostForm.wagePerHour)),
      checksCompleted: Math.max(0, toNum(patrolCostForm.checksCompleted)),
      timeOnSiteMinsPerCheck: Math.max(0, toNum(patrolCostForm.timeOnSiteMinsPerCheck)),
      travelMinsBetweenChecks: Math.max(0, toNum(patrolCostForm.travelMinsBetweenChecks)),
      overheadTravelMins: Math.max(0, toNum(patrolCostForm.overheadTravelMins)),
      travelKmTotal: Math.max(0, toNum(patrolCostForm.travelKmTotal)),
      fuelLitresPer100Km: Math.max(0, toNum(patrolCostForm.fuelLitresPer100Km)),
      fuelCostPerLitre: Math.max(0, toNum(patrolCostForm.fuelCostPerLitre)),
      vehicleCostPerKm: Math.max(0, toNum(patrolCostForm.vehicleCostPerKm)),
      overheadCostPerHour: Math.max(0, toNum(patrolCostForm.overheadCostPerHour)),
      perCheckCharge: Math.max(0, toNum(patrolCostForm.perCheckCharge)),
      fixedShiftCharge: Math.max(0, toNum(patrolCostForm.fixedShiftCharge)),
      billedTravelPerKm: Math.max(0, toNum(patrolCostForm.billedTravelPerKm)),
      billedTravelCallOutFee: Math.max(0, toNum(patrolCostForm.billedTravelCallOutFee)),
      targetProfitMarginPct: Math.min(95, Math.max(1, toNum(patrolCostForm.targetProfitMarginPct, 39))),
    }
  }, [patrolCostForm])

  const economics = useMemo(() => {
    const wagesCost = parsed.guardsOnShift * parsed.wagePerHour * parsed.shiftHours
    const fuelCost = (parsed.travelKmTotal / 100) * parsed.fuelLitresPer100Km * parsed.fuelCostPerLitre
    const vehicleRunningCost = parsed.travelKmTotal * parsed.vehicleCostPerKm
    const overheadCost = parsed.shiftHours * parsed.overheadCostPerHour
    const totalCost = wagesCost + fuelCost + vehicleRunningCost + overheadCost

    const hourlyRevenue = parsed.billableHours * parsed.chargeRatePerHour
    const checksRevenue = parsed.checksCompleted * parsed.perCheckCharge
    const travelRevenue = parsed.travelKmTotal * parsed.billedTravelPerKm + parsed.billedTravelCallOutFee
    const totalRevenue = hourlyRevenue + checksRevenue + travelRevenue + parsed.fixedShiftCharge

    const grossProfit = totalRevenue - totalCost
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

    const breakEvenHourlyRate = totalCost / parsed.billableHours
    const targetMarginRatio = parsed.targetProfitMarginPct / 100
    const targetRevenueAtMargin = totalCost / (1 - targetMarginRatio)
    const targetHourlyRateAtMargin = targetRevenueAtMargin / parsed.billableHours
    const revenueGapToTarget = targetRevenueAtMargin - totalRevenue

    const totalOnSiteMins = parsed.checksCompleted * parsed.timeOnSiteMinsPerCheck
    const totalTravelBetweenMins = Math.max(0, parsed.checksCompleted - 1) * parsed.travelMinsBetweenChecks
    const totalTravelMins = totalTravelBetweenMins + parsed.overheadTravelMins
    const totalOperationalMins = totalOnSiteMins + totalTravelMins
    const onSiteRatioPct = totalOperationalMins > 0 ? (totalOnSiteMins / totalOperationalMins) * 100 : 0
    const travelRatioPct = totalOperationalMins > 0 ? (totalTravelMins / totalOperationalMins) * 100 : 0

    const costPerCheck = parsed.checksCompleted > 0 ? totalCost / parsed.checksCompleted : 0
    const revenuePerCheck = parsed.checksCompleted > 0 ? totalRevenue / parsed.checksCompleted : 0

    return {
      wagesCost,
      fuelCost,
      vehicleRunningCost,
      overheadCost,
      totalCost,
      totalRevenue,
      grossProfit,
      grossMarginPct,
      breakEvenHourlyRate,
      targetRevenueAtMargin,
      targetHourlyRateAtMargin,
      revenueGapToTarget,
      totalOnSiteMins,
      totalTravelMins,
      totalOperationalMins,
      onSiteRatioPct,
      travelRatioPct,
      costPerCheck,
      revenuePerCheck,
    }
  }, [parsed])

  const siteQuoteLines = useMemo(() => {
    const labourAndOverheadPerHour = parsed.guardsOnShift * parsed.wagePerHour + parsed.overheadCostPerHour
    const labourAndOverheadPerMinute = labourAndOverheadPerHour / 60
    const fuelCostPerKm = (parsed.fuelLitresPer100Km / 100) * parsed.fuelCostPerLitre
    const runningCostPerKm = fuelCostPerKm + parsed.vehicleCostPerKm
    const targetMarginRatio = parsed.targetProfitMarginPct / 100

    return quoteSites.map((site) => {
      const patrolsPerMonth = Math.max(0, Number(site.patrolsPerMonth) || 0)
      const checksPerPatrol = Math.max(0, Number(site.checksPerPatrol) || 0)
      const onSiteMinsPerPatrol = Math.max(0, Number(site.onSiteMinsPerPatrol) || 0)
      const travelMinsPerPatrol = Math.max(0, Number(site.travelMinsPerPatrol) || 0)
      const travelKmPerPatrol = Math.max(0, Number(site.travelKmPerPatrol) || 0)
      const directCostPerPatrol = ((onSiteMinsPerPatrol + travelMinsPerPatrol) * labourAndOverheadPerMinute) + (travelKmPerPatrol * runningCostPerKm)
      const expectedRatePerPatrol = targetMarginRatio < 1 ? directCostPerPatrol / (1 - targetMarginRatio) : directCostPerPatrol
      const quotedRatePerPatrol = site.quotedRatePerPatrol === '' ? expectedRatePerPatrol : Math.max(0, Number(site.quotedRatePerPatrol) || 0)
      const expectedMonthlyRevenue = expectedRatePerPatrol * patrolsPerMonth
      const quotedMonthlyRevenue = quotedRatePerPatrol * patrolsPerMonth
      const monthlyCost = directCostPerPatrol * patrolsPerMonth
      const monthlyProfit = quotedMonthlyRevenue - monthlyCost
      const monthlyMarginPct = quotedMonthlyRevenue > 0 ? (monthlyProfit / quotedMonthlyRevenue) * 100 : 0

      return {
        ...site,
        patrolsPerMonth,
        checksPerPatrol,
        onSiteMinsPerPatrol,
        travelMinsPerPatrol,
        travelKmPerPatrol,
        directCostPerPatrol,
        expectedRatePerPatrol,
        quotedRatePerPatrol,
        expectedMonthlyRevenue,
        quotedMonthlyRevenue,
        monthlyCost,
        monthlyProfit,
        monthlyMarginPct,
      }
    })
  }, [parsed, quoteSites])

  const quoteSummary = useMemo(() => {
    const subtotalExpected = siteQuoteLines.reduce((sum, line) => sum + line.expectedMonthlyRevenue, 0)
    const subtotalQuoted = siteQuoteLines.reduce((sum, line) => sum + line.quotedMonthlyRevenue, 0)
    const totalMonthlyCost = siteQuoteLines.reduce((sum, line) => sum + line.monthlyCost, 0)
    const discountRaw = Math.max(0, Number(clientDiscount.value) || 0)
    const discountAmount = !clientDiscount.enabled
      ? 0
      : clientDiscount.type === 'percent'
        ? subtotalQuoted * (discountRaw / 100)
        : Math.min(discountRaw, subtotalQuoted)
    const discountedRevenue = Math.max(0, subtotalQuoted - discountAmount)
    const discountedProfit = discountedRevenue - totalMonthlyCost
    const discountedMarginPct = discountedRevenue > 0 ? (discountedProfit / discountedRevenue) * 100 : 0
    const totalAllocatedChecks = siteQuoteLines.reduce((sum, line) => sum + (line.checksPerPatrol * line.patrolsPerMonth), 0)
    const totalAllocatedMinutes = siteQuoteLines.reduce((sum, line) => sum + ((line.onSiteMinsPerPatrol + line.travelMinsPerPatrol) * line.patrolsPerMonth), 0)
    const totalAllocatedKm = siteQuoteLines.reduce((sum, line) => sum + (line.travelKmPerPatrol * line.patrolsPerMonth), 0)

    return {
      subtotalExpected,
      subtotalQuoted,
      totalMonthlyCost,
      discountAmount,
      discountedRevenue,
      discountedProfit,
      discountedMarginPct,
      totalAllocatedChecks,
      totalAllocatedMinutes,
      totalAllocatedKm,
    }
  }, [clientDiscount, siteQuoteLines])

  const quoteDraft = useMemo(() => {
    const clientName = selectedPricing
      ? clients.find((c: any) => c.id === selectedPricing.client_organization_id)?.name ?? 'Unknown client'
      : 'Unassigned client'
    const serviceLabel = selectedPricing ? (SERVICE_LABELS[selectedPricing.service_type] ?? selectedPricing.service_type) : 'Patrol service'
    const discountLabel = clientDiscount.enabled
      ? clientDiscount.type === 'percent'
        ? `${clientDiscount.value || '0'}% discount`
        : `${formatCurrency(Number(clientDiscount.value) || 0)} discount`
      : 'No discount'

    const siteLines = siteQuoteLines.map((line) => {
      const siteLabel = line.siteName || 'Unnamed site'
      return `- ${siteLabel}: ${line.patrolsPerMonth} patrols/month, expected ${formatCurrency(line.expectedRatePerPatrol)}/patrol, quoted ${formatCurrency(line.quotedRatePerPatrol)}/patrol, monthly quote ${formatCurrency(line.quotedMonthlyRevenue)}`
    }).join('\n')

    return [
      `Quote Draft: ${clientName} - ${serviceLabel}`,
      `Target margin: ${parsed.targetProfitMarginPct.toFixed(1)}%`,
      `Shift model: ${parsed.guardsOnShift} guard(s), ${parsed.shiftHours.toFixed(2)}h shift, ${parsed.billableHours.toFixed(2)} billable hours`,
      `Cost assumptions: wage ${formatCurrency(parsed.wagePerHour)}/hr, overhead ${formatCurrency(parsed.overheadCostPerHour)}/hr, fuel ${formatCurrency(parsed.fuelCostPerLitre)}/L, vehicle ${formatCurrency(parsed.vehicleCostPerKm)}/km`,
      'Site pricing:',
      siteLines || '- No sites added',
      `Subtotal expected monthly revenue: ${formatCurrency(quoteSummary.subtotalExpected)}`,
      `Subtotal quoted monthly revenue: ${formatCurrency(quoteSummary.subtotalQuoted)}`,
      `Client discount: ${discountLabel}`,
      `Discounted monthly revenue: ${formatCurrency(quoteSummary.discountedRevenue)}`,
      `Monthly operating cost: ${formatCurrency(quoteSummary.totalMonthlyCost)}`,
      `Monthly profit: ${formatCurrency(quoteSummary.discountedProfit)}`,
      `Margin after discount: ${quoteSummary.discountedMarginPct.toFixed(1)}%`,
      `Allocated service volume: ${quoteSummary.totalAllocatedChecks} checks/month, ${(quoteSummary.totalAllocatedMinutes / 60).toFixed(1)} operational hours/month, ${quoteSummary.totalAllocatedKm.toFixed(1)} km/month`,
      'Bob instruction: Use this pricing basis to generate a reality-based patrol quote and explain any gap between expected rate and quoted rate per site.',
    ].join('\n')
  }, [clientDiscount, clients, parsed, quoteSummary, selectedPricing, siteQuoteLines])

  const handleSaveTemplate = useCallback(() => {
    if (!templateName.trim()) {
      toast.error('Enter a template name')
      return
    }

    const nextTemplate: SavedQuoteTemplate = {
      id: crypto.randomUUID(),
      name: templateName.trim(),
      selectedPricingId: patrolCostForm.selectedPricingId,
      patrolCostForm,
      quoteSites,
      clientDiscount,
      updatedAt: new Date().toISOString(),
    }

    saveTemplateToStorage([
      nextTemplate,
      ...savedTemplates.filter((template) => template.name.toLowerCase() !== nextTemplate.name.toLowerCase()),
    ])
    setTemplateName('')
    toast.success('Quote template saved')
  }, [clientDiscount, patrolCostForm, quoteSites, saveTemplateToStorage, savedTemplates, templateName])

  const handleLoadTemplate = useCallback((template: SavedQuoteTemplate) => {
    setPatrolCostForm(template.patrolCostForm)
    setQuoteSites(template.quoteSites.length > 0 ? template.quoteSites : [createEmptyQuoteSiteLine()])
    setClientDiscount(template.clientDiscount)
    toast.success('Quote template loaded')
  }, [])

  const handleDeleteTemplate = useCallback((templateId: string) => {
    saveTemplateToStorage(savedTemplates.filter((template) => template.id !== templateId))
    toast.success('Quote template deleted')
  }, [saveTemplateToStorage, savedTemplates])

  const autofillSiteTravel = useCallback((siteLineId: string, siteId: string) => {
    const selectedSite = clientSites.find((item) => item.id === siteId)
    if (!selectedSite) return

    const baseLat = selectedPricing?.base_office_lat
    const baseLng = selectedPricing?.base_office_lng
    if (baseLat == null || baseLng == null || selectedSite.gps_lat == null || selectedSite.gps_lng == null) {
      return
    }

    const oneWayKm = haversineKm(baseLat, baseLng, selectedSite.gps_lat, selectedSite.gps_lng)
    const roundTripKm = oneWayKm * 2
    const roundTripMins = estimateEtaMinutes(oneWayKm) * 2

    setQuoteSites((prev) => prev.map((row) => row.id === siteLineId ? {
      ...row,
      travelKmPerPatrol: roundTripKm.toFixed(1),
      travelMinsPerPatrol: String(roundTripMins),
      siteName: selectedSite.name ?? row.siteName,
    } : row))
  }, [clientSites, selectedPricing?.base_office_lat, selectedPricing?.base_office_lng])

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

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Patrol Cost and Margin Planner</CardTitle>
            <CardDescription>
              Model cost per site/check, full shift operating cost, break-even charge rate, and your target margin against actual pricing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5 lg:col-span-2">
                <Label className="text-xs">Prefill from configured pricing (optional)</Label>
                <Select
                  value={patrolCostForm.selectedPricingId}
                  onValueChange={(value) => {
                    const matched = pricingOptions.find((p) => p.id === value)
                    if (!matched) {
                      setPatrolCostForm((prev) => ({ ...prev, selectedPricingId: '__none__' }))
                      setQuoteSites([createEmptyQuoteSiteLine()])
                      return
                    }
                    const row = matched.row
                    setPatrolCostForm((prev) => ({
                      ...prev,
                      selectedPricingId: value,
                      chargeRatePerHour: row.hourly_charge_rate != null ? String(row.hourly_charge_rate) : prev.chargeRatePerHour,
                      wagePerHour: row.hourly_pay_rate != null ? String(row.hourly_pay_rate) : prev.wagePerHour,
                      fixedShiftCharge: row.per_service_charge != null ? String(row.per_service_charge) : prev.fixedShiftCharge,
                      billedTravelPerKm: row.travel_charge_per_km != null ? String(row.travel_charge_per_km) : prev.billedTravelPerKm,
                      billedTravelCallOutFee: row.travel_call_out_fee != null ? String(row.travel_call_out_fee) : prev.billedTravelCallOutFee,
                    }))
                    setQuoteSites([createEmptyQuoteSiteLine()])
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select client + service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No prefill</SelectItem>
                    {pricingOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Target Profit Margin %</Label>
                <Input
                  type="number"
                  min="1"
                  max="95"
                  step="0.5"
                  className="h-9"
                  value={patrolCostForm.targetProfitMarginPct}
                  onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, targetProfitMarginPct: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Guards on Shift</Label>
                <Input type="number" min="1" step="1" value={patrolCostForm.guardsOnShift} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, guardsOnShift: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Shift Hours</Label>
                <Input type="number" min="0" step="0.25" value={patrolCostForm.shiftHours} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, shiftHours: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Billable Hours</Label>
                <Input type="number" min="0" step="0.25" value={patrolCostForm.billableHours} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, billableHours: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Checks / Sites Visited</Label>
                <Input type="number" min="0" step="1" value={patrolCostForm.checksCompleted} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, checksCompleted: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Charge Rate $/hr</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.chargeRatePerHour} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, chargeRatePerHour: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Guard Wage $/hr</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.wagePerHour} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, wagePerHour: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Overhead $/hr</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.overheadCostPerHour} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, overheadCostPerHour: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fixed Shift Charge $</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.fixedShiftCharge} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, fixedShiftCharge: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Travel KM (Total)</Label>
                <Input type="number" min="0" step="0.1" value={patrolCostForm.travelKmTotal} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, travelKmTotal: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fuel L / 100km</Label>
                <Input type="number" min="0" step="0.1" value={patrolCostForm.fuelLitresPer100Km} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, fuelLitresPer100Km: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fuel $ / Litre</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.fuelCostPerLitre} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, fuelCostPerLitre: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vehicle Running $ / KM</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.vehicleCostPerKm} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, vehicleCostPerKm: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">On-site Mins per Check</Label>
                <Input type="number" min="0" step="1" value={patrolCostForm.timeOnSiteMinsPerCheck} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, timeOnSiteMinsPerCheck: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Travel Mins between Checks</Label>
                <Input type="number" min="0" step="1" value={patrolCostForm.travelMinsBetweenChecks} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, travelMinsBetweenChecks: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Overhead Travel Mins</Label>
                <Input type="number" min="0" step="1" value={patrolCostForm.overheadTravelMins} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, overheadTravelMins: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Per Check Charge $</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.perCheckCharge} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, perCheckCharge: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Billed Travel $ / KM</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.billedTravelPerKm} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, billedTravelPerKm: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Billed Travel Call-out $</Label>
                <Input type="number" min="0" step="0.01" value={patrolCostForm.billedTravelCallOutFee} onChange={(e) => setPatrolCostForm((prev) => ({ ...prev, billedTravelCallOutFee: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 pt-1">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Total Shift Cost</p>
                <p className="text-lg font-semibold">{formatCurrency(economics.totalCost)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Cost per Check/Site</p>
                <p className="text-lg font-semibold">{formatCurrency(economics.costPerCheck)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Break-even Rate ($/hr)</p>
                <p className="text-lg font-semibold">{formatCurrency(economics.breakEvenHourlyRate)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Actual Margin</p>
                <p className={`text-lg font-semibold ${economics.grossMarginPct >= parsed.targetProfitMarginPct ? 'text-green-600' : 'text-amber-600'}`}>
                  {economics.grossMarginPct.toFixed(1)}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Cost Stack</p>
                <p className="text-sm">Wages: <span className="font-medium">{formatCurrency(economics.wagesCost)}</span></p>
                <p className="text-sm">Fuel: <span className="font-medium">{formatCurrency(economics.fuelCost)}</span></p>
                <p className="text-sm">Vehicle: <span className="font-medium">{formatCurrency(economics.vehicleRunningCost)}</span></p>
                <p className="text-sm">Overheads: <span className="font-medium">{formatCurrency(economics.overheadCost)}</span></p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Revenue and Profitability</p>
                <p className="text-sm">Total revenue: <span className="font-medium">{formatCurrency(economics.totalRevenue)}</span></p>
                <p className="text-sm">Gross profit: <span className={`font-medium ${economics.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(economics.grossProfit)}</span></p>
                <p className="text-sm">Revenue/check: <span className="font-medium">{formatCurrency(economics.revenuePerCheck)}</span></p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Time Split and Throughput</p>
                <p className="text-sm">On-site: <span className="font-medium">{(economics.totalOnSiteMins / 60).toFixed(2)} h ({economics.onSiteRatioPct.toFixed(1)}%)</span></p>
                <p className="text-sm">Travel: <span className="font-medium">{(economics.totalTravelMins / 60).toFixed(2)} h ({economics.travelRatioPct.toFixed(1)}%)</span></p>
                <p className="text-sm">Total tracked ops time: <span className="font-medium">{(economics.totalOperationalMins / 60).toFixed(2)} h</span></p>
              </div>
            </div>

            <div className="rounded-lg border border-dashed p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Target Margin Check</p>
              <p className="text-sm">
                To hit <span className="font-medium">{parsed.targetProfitMarginPct.toFixed(1)}%</span> margin, required shift revenue is{' '}
                <span className="font-medium">{formatCurrency(economics.targetRevenueAtMargin)}</span> and required hourly charge is{' '}
                <span className="font-medium">{formatCurrency(economics.targetHourlyRateAtMargin)}</span>.
              </p>
              <p className={`text-sm font-medium ${economics.revenueGapToTarget <= 0 ? 'text-green-600' : 'text-amber-700'}`}>
                {economics.revenueGapToTarget <= 0
                  ? `${formatCurrency(Math.abs(economics.revenueGapToTarget))} above target revenue`
                  : `${formatCurrency(economics.revenueGapToTarget)} below target revenue`}
              </p>
            </div>

            {selectedPricing && (
              <p className="text-xs text-muted-foreground">
                Prefill source: {SERVICE_LABELS[selectedPricing.service_type] ?? selectedPricing.service_type} pricing row.
              </p>
            )}

            <div className="space-y-3 border-t pt-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Site Quote Builder</p>
                <p className="text-xs text-muted-foreground">Add each site, compare expected rate against quoted rate, then apply an optional client discount to see the real margin.</p>
              </div>

              <div className="rounded-lg border border-dashed p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Template Name</Label>
                    <Input value={templateName} placeholder="e.g. Nelson City Council standard patrol" onChange={(e) => setTemplateName(e.target.value)} />
                  </div>
                  <Button type="button" size="sm" onClick={handleSaveTemplate}>Save Template</Button>
                </div>
                {savedTemplates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Saved templates</p>
                    {savedTemplates.slice(0, 5).map((template) => (
                      <div key={template.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{template.name}</p>
                          <p className="text-xs text-muted-foreground">Updated {new Date(template.updatedAt).toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button type="button" size="sm" variant="outline" onClick={() => handleLoadTemplate(template)}>Load</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteTemplate(template.id)}>Delete</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {quoteSites.map((site) => {
                  const calculated = siteQuoteLines.find((line) => line.id === site.id)
                  return (
                    <div key={site.id} className="rounded-lg border p-3 space-y-3">
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                        <div className="space-y-1.5 lg:col-span-2">
                          <Label className="text-xs">Client Site</Label>
                          <Select
                            value={site.clientSiteId}
                            onValueChange={(value) => {
                              const matchedSite = clientSites.find((item) => item.id === value)
                              setQuoteSites((prev) => prev.map((row) => row.id === site.id ? {
                                ...row,
                                clientSiteId: value,
                                siteName: matchedSite?.name ?? row.siteName,
                              } : row))
                              autofillSiteTravel(site.id, value)
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select a client site" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__manual__">Manual site entry</SelectItem>
                              {clientSites.map((option) => (
                                <SelectItem key={option.id} value={option.id}>{option.name ?? option.address ?? 'Unnamed site'}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5 lg:col-span-2">
                          <Label className="text-xs">Site Name / Quote Label</Label>
                          <Input
                            value={site.siteName}
                            placeholder="e.g. Civic Centre"
                            onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, siteName: e.target.value } : row))}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Patrols / Month</Label>
                          <Input type="number" min="0" step="1" value={site.patrolsPerMonth} onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, patrolsPerMonth: e.target.value } : row))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Checks / Patrol</Label>
                          <Input type="number" min="0" step="1" value={site.checksPerPatrol} onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, checksPerPatrol: e.target.value } : row))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">On-site Mins</Label>
                          <Input type="number" min="0" step="1" value={site.onSiteMinsPerPatrol} onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, onSiteMinsPerPatrol: e.target.value } : row))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Travel Mins</Label>
                          <Input type="number" min="0" step="1" value={site.travelMinsPerPatrol} onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, travelMinsPerPatrol: e.target.value } : row))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Travel KM</Label>
                          <Input type="number" min="0" step="0.1" value={site.travelKmPerPatrol} onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, travelKmPerPatrol: e.target.value } : row))} />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">Expected Rate / Patrol</Label>
                          <div className="h-10 rounded-md border bg-muted/30 px-3 flex items-center text-sm font-medium">
                            {formatCurrency(calculated?.expectedRatePerPatrol ?? 0)}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Quoted Rate / Patrol</Label>
                          <Input type="number" min="0" step="0.01" placeholder={(calculated?.expectedRatePerPatrol ?? 0).toFixed(2)} value={site.quotedRatePerPatrol} onChange={(e) => setQuoteSites((prev) => prev.map((row) => row.id === site.id ? { ...row, quotedRatePerPatrol: e.target.value } : row))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Quoted Monthly</Label>
                          <div className="h-10 rounded-md border bg-muted/30 px-3 flex items-center text-sm font-medium">
                            {formatCurrency(calculated?.quotedMonthlyRevenue ?? 0)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setQuoteSites((prev) => prev.length === 1 ? [createEmptyQuoteSiteLine()] : prev.filter((row) => row.id !== site.id))}
                        >
                          Remove Site
                        </Button>
                      </div>

                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                        <span>Monthly cost: {formatCurrency(calculated?.monthlyCost ?? 0)}</span>
                        <span>Monthly profit: {formatCurrency(calculated?.monthlyProfit ?? 0)}</span>
                        <span>Margin: {(calculated?.monthlyMarginPct ?? 0).toFixed(1)}%</span>
                        {selectedPricing?.base_office_lat != null && selectedPricing?.base_office_lng != null && site.clientSiteId !== '__manual__' && (
                          <span>GPS travel auto-filled from base office when coordinates are available</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setQuoteSites((prev) => [...prev, createEmptyQuoteSiteLine()])}
                >
                  <Plus className="h-3 w-3" />
                  Add Site Rate
                </Button>
              </div>

              <div className="rounded-lg border border-dashed p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Optional Client Discount</p>
                    <p className="text-xs text-muted-foreground">Apply a negotiated discount and recalculate the true margin.</p>
                  </div>
                  <Switch checked={clientDiscount.enabled} onCheckedChange={(enabled) => setClientDiscount((prev) => ({ ...prev, enabled }))} />
                </div>

                {clientDiscount.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Discount Type</Label>
                      <Select value={clientDiscount.type} onValueChange={(value: 'percent' | 'fixed') => setClientDiscount((prev) => ({ ...prev, type: value }))}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percent">Percent</SelectItem>
                          <SelectItem value="fixed">Fixed amount</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Discount Value</Label>
                      <Input type="number" min="0" step="0.01" value={clientDiscount.value} onChange={(e) => setClientDiscount((prev) => ({ ...prev, value: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Discount Notes</Label>
                      <Input value={clientDiscount.notes} placeholder="e.g. multi-site volume discount" onChange={(e) => setClientDiscount((prev) => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Expected Subtotal</p>
                    <p className="font-semibold">{formatCurrency(quoteSummary.subtotalExpected)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Quoted Subtotal</p>
                    <p className="font-semibold">{formatCurrency(quoteSummary.subtotalQuoted)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Discount</p>
                    <p className="font-semibold">{formatCurrency(quoteSummary.discountAmount)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Final Monthly Quote</p>
                    <p className="font-semibold">{formatCurrency(quoteSummary.discountedRevenue)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Margin After Discount</p>
                    <p className={`font-semibold ${quoteSummary.discountedMarginPct >= parsed.targetProfitMarginPct ? 'text-green-600' : 'text-amber-700'}`}>{quoteSummary.discountedMarginPct.toFixed(1)}%</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Quote Draft for Bob or Client Proposal</p>
                    <p className="text-xs text-muted-foreground">Copy this into Bob or the tender workspace to generate a service quote from real operating assumptions.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(quoteDraft)
                        toast.success('Quote draft copied')
                      }}
                    >
                      Copy Draft
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => createTenderProposalMutation.mutate()}
                      disabled={createTenderProposalMutation.isPending || !selectedPricing}
                    >
                      {createTenderProposalMutation.isPending ? 'Creating…' : 'Create Proposal'}
                    </Button>
                  </div>
                </div>
                <Textarea value={quoteDraft} readOnly rows={12} className="text-xs font-mono" />
              </div>
            </div>
          </CardContent>
        </Card>

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

            {/* Radius pricing zones (for distance-based services) */}
            {RADIUS_PRICING_SERVICES.has(form.service_type) && (
              <div className="space-y-3 border border-dashed rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-600" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Distance Pricing Zones</p>
                  </div>
                  <Switch
                    checked={form.radius_pricing_enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, radius_pricing_enabled: v }))}
                  />
                </div>
                {form.radius_pricing_enabled && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">Set radius bands from your base office. Each band applies to jobs within that distance. Evaluated in order of max_km.</p>
                    {/* Base office coords */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Base Office Lat</Label>
                        <Input
                          type="number" step="0.000001" placeholder="-41.2865"
                          className="h-8 text-xs"
                          value={form.base_office_lat}
                          onChange={(e) => setForm((f) => ({ ...f, base_office_lat: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Base Office Lng</Label>
                        <Input
                          type="number" step="0.000001" placeholder="174.7762"
                          className="h-8 text-xs"
                          value={form.base_office_lng}
                          onChange={(e) => setForm((f) => ({ ...f, base_office_lng: e.target.value }))}
                        />
                      </div>
                    </div>
                    {/* Zone bands */}
                    <div className="space-y-2">
                      {form.radius_pricing_zones.map((zone, idx) => (
                        <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-1.5 items-end">
                          <div className="space-y-1">
                            {idx === 0 && <Label className="text-[10px]">Band Label</Label>}
                            <Input
                              className="h-8 text-xs" placeholder="e.g. 0–50 km"
                              value={zone.label}
                              onChange={(e) => {
                                const zones = [...form.radius_pricing_zones]
                                zones[idx] = { ...zones[idx], label: e.target.value }
                                setForm((f) => ({ ...f, radius_pricing_zones: zones }))
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            {idx === 0 && <Label className="text-[10px]">Max km</Label>}
                            <Input
                              type="number" min="1" step="1" className="h-8 text-xs"
                              value={zone.max_km}
                              onChange={(e) => {
                                const zones = [...form.radius_pricing_zones]
                                zones[idx] = { ...zones[idx], max_km: parseFloat(e.target.value) || 0 }
                                setForm((f) => ({ ...f, radius_pricing_zones: zones }))
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            {idx === 0 && <Label className="text-[10px]">Flat fee $</Label>}
                            <Input
                              type="number" min="0" step="0.01" className="h-8 text-xs"
                              value={zone.flat_fee}
                              onChange={(e) => {
                                const zones = [...form.radius_pricing_zones]
                                zones[idx] = { ...zones[idx], flat_fee: parseFloat(e.target.value) || 0 }
                                setForm((f) => ({ ...f, radius_pricing_zones: zones }))
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            {idx === 0 && <Label className="text-[10px]">$/km</Label>}
                            <Input
                              type="number" min="0" step="0.01" className="h-8 text-xs"
                              value={zone.per_km_charge}
                              onChange={(e) => {
                                const zones = [...form.radius_pricing_zones]
                                zones[idx] = { ...zones[idx], per_km_charge: parseFloat(e.target.value) || 0 }
                                setForm((f) => ({ ...f, radius_pricing_zones: zones }))
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center text-red-400 hover:text-red-600"
                            onClick={() => setForm((f) => ({ ...f, radius_pricing_zones: f.radius_pricing_zones.filter((_, i) => i !== idx) }))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1 mt-1"
                        onClick={() => setForm((f) => ({ ...f, radius_pricing_zones: [...f.radius_pricing_zones, { ...EMPTY_ZONE }] }))}
                      >
                        <Plus className="h-3 w-3" /> Add band
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
