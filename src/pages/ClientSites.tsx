/**
 * ClientSites — Zoho CRM / Wilsar-inspired site registry.
 * Stores client service locations with contacts, GPS, site type, and SLA defaults.
 * Jobs created in the DispatchConsole can be linked to these sites for history.
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useZones } from '@/hooks/useZones'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { useOrganizations } from '@/hooks/useOrganizations'
import { useSitePermissions } from '@/hooks/useSitePermissions'
import { forwardGeocode } from '@/lib/geocoding'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Building2, Plus, MapPin, Phone, Mail, Clock, Search,
  Edit, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { toast } from 'sonner'

interface OrgOption {
  id: string
  name: string
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function readSupabaseAccessTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null

  const storages: Storage[] = [window.localStorage, window.sessionStorage]
  for (const storage of storages) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

      const raw = storage.getItem(key)
      if (!raw) continue

      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
          return parsed.access_token
        }
      } catch {
        // Ignore malformed auth storage values.
      }
    }
  }

  return null
}

async function fetchPostgrest<T>(pathWithQuery: string, timeoutMs = 15000): Promise<T> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing')
  }

  let accessToken = readSupabaseAccessTokenFromStorage()
  if (!accessToken) {
    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      Math.min(2000, timeoutMs),
      'Session lookup'
    )

    accessToken = session?.access_token ?? null
  }

  if (!accessToken) {
    throw new Error('Session expired. Please sign in again')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${supabaseUrl}${pathWithQuery}`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      let message = 'Failed to load data'
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          message = parsed?.message || parsed?.error_description || parsed?.hint || raw
        } catch {
          message = raw
        }
      }
      throw new Error(message)
    }

    return raw ? JSON.parse(raw) as T : ([] as unknown as T)
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientSite {
  id: string
  organization_id: string
  zone_id: string | null
  name: string
  site_code: string | null
  site_type: string
  address: string | null
  city: string | null
  gps_lat: number | null
  gps_lng: number | null
  access_instructions: string | null
  hazards: string | null
  special_instructions: string | null
  notes: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  default_response_minutes: number
  priority_override: string | null
  default_pay_rate: number | null
  default_charge_rate: number | null
  overtime_pay_multiplier: number | null
  m365_customer_id: string | null
  m365_contract_ref: string | null
  m365_cost_centre: string | null
  contract_start_date: string | null
  contract_end_date: string | null
  invoice_frequency: string | null
  purchase_order_number: string | null
  is_active: boolean
  created_at: string
  zone: { name: string } | null
}

interface SiteForm {
  name: string; site_code: string; site_type: string
  address: string; city: string; gps_lat: string; gps_lng: string
  zone_id: string
  access_instructions: string; hazards: string; special_instructions: string; notes: string
  contact_name: string; contact_phone: string; contact_email: string
  emergency_contact_name: string; emergency_contact_phone: string
  default_response_minutes: number; priority_override: string
  default_pay_rate: string; default_charge_rate: string; overtime_pay_multiplier: string
  m365_customer_id: string; m365_contract_ref: string; m365_cost_centre: string
  contract_start_date: string; contract_end_date: string
  invoice_frequency: string; purchase_order_number: string
}

const SITE_TYPE_LABELS: Record<string, string> = {
  general: 'General', freedom_camping: 'Freedom Camping', guarding: 'Guarding Post',
  parking: 'Parking', noise_control: 'Noise Control', event: 'Event Site', infrastructure: 'Infrastructure',
  research: 'Research', bus_hub: 'Bus Hub', government: 'Government', commercial: 'Commercial',
}

function emptyForm(): SiteForm {
  return {
    name: '', site_code: '', site_type: 'general',
    address: '', city: '', gps_lat: '', gps_lng: '', zone_id: '',
    access_instructions: '', hazards: '', special_instructions: '', notes: '',
    contact_name: '', contact_phone: '', contact_email: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    default_response_minutes: 60, priority_override: '',
    default_pay_rate: '', default_charge_rate: '', overtime_pay_multiplier: '1.5',
    m365_customer_id: '', m365_contract_ref: '', m365_cost_centre: '',
    contract_start_date: '', contract_end_date: '',
    invoice_frequency: 'monthly', purchase_order_number: '',
  }
}

function siteFormFromRecord(s: ClientSite): SiteForm {
  return {
    name: s.name, site_code: s.site_code ?? '', site_type: s.site_type,
    address: s.address ?? '', city: s.city ?? '',
    gps_lat: s.gps_lat?.toString() ?? '', gps_lng: s.gps_lng?.toString() ?? '',
    zone_id: s.zone_id ?? '',
    access_instructions: s.access_instructions ?? '', hazards: s.hazards ?? '',
    special_instructions: s.special_instructions ?? '', notes: s.notes ?? '',
    contact_name: s.contact_name ?? '', contact_phone: s.contact_phone ?? '',
    contact_email: s.contact_email ?? '',
    emergency_contact_name: s.emergency_contact_name ?? '',
    emergency_contact_phone: s.emergency_contact_phone ?? '',
    default_response_minutes: s.default_response_minutes,
    priority_override: s.priority_override ?? '',
    default_pay_rate: s.default_pay_rate?.toString() ?? '',
    default_charge_rate: s.default_charge_rate?.toString() ?? '',
    overtime_pay_multiplier: s.overtime_pay_multiplier?.toString() ?? '1.5',
    m365_customer_id: s.m365_customer_id ?? '',
    m365_contract_ref: s.m365_contract_ref ?? '',
    m365_cost_centre: s.m365_cost_centre ?? '',
    contract_start_date: s.contract_start_date ?? '',
    contract_end_date: s.contract_end_date ?? '',
    invoice_frequency: s.invoice_frequency ?? 'monthly',
    purchase_order_number: s.purchase_order_number ?? '',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClientSites() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const orgId = user?.organization_id
  const isSuperUser = user?.role === 'master' || user?.role === 'grand_master'

  const [search, setSearch]           = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [typeFilter, setTypeFilter]   = useState('all')
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [dialogMode, setDialogMode]   = useState<'create' | 'edit' | null>(null)
  const [editTarget, setEditTarget]   = useState<ClientSite | null>(null)
  const [form, setForm]               = useState<SiteForm>(emptyForm())
  const [viewSite, setViewSite]       = useState<ClientSite | null>(null)

  const { orgIds, isLoading: orgIdsLoading } = useClientOrgIds()
  const { data: organizations = [] } = useQuery<OrgOption[]>({
    queryKey: ['organizations', 'client-sites-picker'],
    queryFn: async () => {
      const query = new URLSearchParams({
        select: 'id,name',
        is_active: 'eq.true',
        order: 'name.asc',
      })

      return fetchPostgrest<OrgOption[]>(`/rest/v1/organizations?${query.toString()}`)
    },
    enabled: !!orgId,
  })
  const zoneOrganizationId = dialogMode === 'edit'
    ? (editTarget?.organization_id || selectedOrgId || orgId)
    : (selectedOrgId || orgId)
  const { data: zones = [] } = useZones({ organizationId: zoneOrganizationId })
  const { canView, canEdit, isLoading: permissionsLoading } = useSitePermissions()
  const canManageIdentity = isSuperUser || permissionsLoading || canEdit('identity')

  const availableOrganizations = organizations.filter((org) => {
    if (orgIds === null) return true
    return orgIds.includes(org.id)
  })
  const queryOrgId = searchParams.get('orgId') ?? ''
  const queryOrgName = availableOrganizations.find((org) => org.id === queryOrgId)?.name ?? ''

  useEffect(() => {
    const orgIdParam = searchParams.get('orgId')
    if (!orgIdParam) return

    const orgAllowed = availableOrganizations.some((org) => org.id === orgIdParam)
    if (!orgAllowed) return

    setSelectedOrgId((current) => (current === orgIdParam ? current : orgIdParam))
  }, [searchParams, availableOrganizations])

  function clearCrmOrgContext() {
    setSelectedOrgId('')
    if (!queryOrgId) return
    const next = new URLSearchParams(searchParams)
    next.delete('orgId')
    setSearchParams(next)
  }

  // ── Fetch sites ─────────────────────────────────────────────────────────────
  const { data: sites = [], isLoading } = useQuery<ClientSite[]>({
    queryKey: ['client-sites', orgId, orgIds, selectedOrgId, showInactive, typeFilter],
    queryFn: async () => {
      const query = new URLSearchParams({
        select: '*,zone:zones!zone_id(name)',
        order: 'name.asc',
      })

      if (!showInactive) query.set('is_active', 'eq.true')
      if (typeFilter !== 'all') query.set('site_type', `eq.${typeFilter}`)

      if (selectedOrgId) {
        query.set('organization_id', `eq.${selectedOrgId}`)
      } else if (orgIds !== null) {
        if (orgIds.length === 0) return []
        query.set('organization_id', `in.(${orgIds.join(',')})`)
      }

      return fetchPostgrest<ClientSite[]>(`/rest/v1/client_sites?${query.toString()}`)
    },
    enabled: !!orgId && !orgIdsLoading,
  })

  const filtered = sites.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      (s.address ?? '').toLowerCase().includes(q) ||
      (s.site_code ?? '').toLowerCase().includes(q) ||
      (s.contact_name ?? '').toLowerCase().includes(q)
    )
  })

  // ── Save mutation (create + edit) ────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async ({ f, id }: { f: SiteForm; id?: string }) => {
      const targetOrgId = id
        ? (editTarget?.organization_id || selectedOrgId || orgId)
        : (selectedOrgId || orgId)

      const parsedLat = f.gps_lat ? Number.parseFloat(f.gps_lat) : null
      const parsedLng = f.gps_lng ? Number.parseFloat(f.gps_lng) : null

      const addressChanged = id
        ? ((editTarget?.address ?? '').trim() !== f.address.trim())
        : !!f.address.trim()
      const cityChanged = id
        ? ((editTarget?.city ?? '').trim() !== f.city.trim())
        : !!f.city.trim()

      let resolvedLat = Number.isFinite(parsedLat) ? parsedLat : null
      let resolvedLng = Number.isFinite(parsedLng) ? parsedLng : null
      let geocodeSource: string | null = null

      const hasAddress = !!(f.address.trim() || f.city.trim())
      const shouldLookupAddress = hasAddress && (addressChanged || cityChanged || resolvedLat === null || resolvedLng === null)
      if (canEdit('location') && shouldLookupAddress) {
        const geocoded = await forwardGeocode(f.address, f.city)
        if (geocoded) {
          resolvedLat = geocoded.latitude
          resolvedLng = geocoded.longitude
          geocodeSource = geocoded.source ?? 'lookup'
        }
      }

      let resolvedZoneId = f.zone_id || null
      const shouldSyncGeofence = canEdit('identity') && canEdit('location') && !!targetOrgId && resolvedLat !== null && resolvedLng !== null && (addressChanged || cityChanged || !id)
      if (shouldSyncGeofence) {
        if (resolvedZoneId) {
          const { error: zoneUpdateError } = await (supabase as any)
            .from('zones')
            .update({ location_lat: resolvedLat, location_lng: resolvedLng, is_active: true })
            .eq('id', resolvedZoneId)
          if (zoneUpdateError) throw zoneUpdateError
        } else {
          const { data: createdZone, error: zoneInsertError } = await (supabase as any)
            .from('zones')
            .insert({
              organization_id: targetOrgId,
              name: `${f.name.trim() || 'Client Site'} Geofence`,
              zone_type: 'general',
              location_lat: resolvedLat,
              location_lng: resolvedLng,
              is_active: true,
            })
            .select('id')
            .single()
          if (zoneInsertError) throw zoneInsertError
          resolvedZoneId = createdZone?.id ?? null
        }
      }

      // Build full payload, then strip field groups the user cannot edit.
      // This prevents bypassing UI restrictions through dev-tool tricks.
      const full: any = {
        organization_id:        targetOrgId,
        created_by:             user?.id,
        name:                   f.name,
        site_code:              f.site_code || null,
        site_type:              f.site_type,
        zone_id:                resolvedZoneId,
        address:                f.address || null,
        city:                   f.city || null,
        gps_lat:                resolvedLat,
        gps_lng:                resolvedLng,
        access_instructions:    f.access_instructions || null,
        hazards:                f.hazards || null,
        special_instructions:   f.special_instructions || null,
        notes:                  f.notes || null,
        contact_name:           f.contact_name || null,
        contact_phone:          f.contact_phone || null,
        contact_email:          f.contact_email || null,
        emergency_contact_name: f.emergency_contact_name || null,
        emergency_contact_phone:f.emergency_contact_phone || null,
        default_response_minutes: f.default_response_minutes,
        priority_override:      f.priority_override || null,
        default_pay_rate:       f.default_pay_rate ? parseFloat(f.default_pay_rate) : null,
        default_charge_rate:    f.default_charge_rate ? parseFloat(f.default_charge_rate) : null,
        overtime_pay_multiplier: f.overtime_pay_multiplier ? parseFloat(f.overtime_pay_multiplier) : 1.5,
        m365_customer_id:       f.m365_customer_id || null,
        m365_contract_ref:      f.m365_contract_ref || null,
        m365_cost_centre:       f.m365_cost_centre || null,
        contract_start_date:    f.contract_start_date || null,
        contract_end_date:      f.contract_end_date || null,
        invoice_frequency:      f.invoice_frequency || 'monthly',
        purchase_order_number:  f.purchase_order_number || null,
      }

      // Map each field group to its payload keys and remove groups the user can't edit
      const groupFields: Record<string, string[]> = {
        identity:    ['name', 'site_code', 'site_type', 'zone_id'],
        location:    ['address', 'city', 'gps_lat', 'gps_lng'],
        operational: ['access_instructions', 'hazards', 'special_instructions'],
        contacts:    ['contact_name', 'contact_phone', 'contact_email', 'emergency_contact_name', 'emergency_contact_phone'],
        sla:         ['default_response_minutes', 'priority_override'],
        notes:       ['notes'],
        financial:   ['default_pay_rate', 'default_charge_rate', 'overtime_pay_multiplier', 'contract_start_date', 'contract_end_date', 'invoice_frequency', 'purchase_order_number'],
        accounting:  ['m365_customer_id', 'm365_contract_ref', 'm365_cost_centre'],
      }

      const payload: any = id
        ? {} // on edit: only include fields the user can change
        : { organization_id: targetOrgId, created_by: user?.id } // on create: always include org fields

      for (const [group, fields] of Object.entries(groupFields)) {
        if (canEdit(group as any)) {
          for (const k of fields) { payload[k] = full[k] }
        }
      }

      if (id) {
        await edgeFunctions.upsertClientSite({
          site_id: id,
          payload,
        })
      } else {
        if (!payload.organization_id) {
          throw new Error('Please select an organisation before creating a site')
        }
        await edgeFunctions.upsertClientSite({
          payload,
        })
      }

      return { geocodeSource, resolvedZoneId, siteName: f.name.trim() }
    },
    onSuccess: (result) => {
      const displayName = result?.siteName || 'Site'
      if (dialogMode === 'create') {
        toast.success(`Site created: ${displayName}`)
      } else {
        toast.success(`Site updated: ${displayName}`)
      }
      if (result?.geocodeSource) {
        toast.success(`Address lookup resolved geofence coordinates (${result.geocodeSource})`)
      }
      if (result?.resolvedZoneId && !form.zone_id) {
        toast.success('Auto-created and linked a zone geofence for this site')
      }
      qc.invalidateQueries({ queryKey: ['client-sites'] })
      qc.invalidateQueries({ queryKey: ['client-sites-lookup'] })
      qc.invalidateQueries({ queryKey: ['zones'] })
      setDialogMode(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Save failed'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await edgeFunctions.setClientSiteActive({
        site_id: id,
        is_active: active,
      })
    },
    onSuccess: () => { toast.success('Site updated'); qc.invalidateQueries({ queryKey: ['client-sites'] }) },
  })

  function openCreate() { setForm(emptyForm()); setEditTarget(null); setDialogMode('create') }
  function openEdit(s: ClientSite) {
    setForm(siteFormFromRecord(s))
    setEditTarget(s)
    setSelectedOrgId(s.organization_id)
    setDialogMode('edit')
  }
  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Site name is required'); return }
    saveMutation.mutate({ f: form, id: editTarget?.id })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Client Sites
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Service location registry — link sites to dispatch jobs, zones and patrols
            </p>
          </div>
          {canManageIdentity && (
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Add Site</Button>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(SITE_TYPE_LABELS).map(([k, v]) => {
            const count = sites.filter(s => s.site_type === k).length
            if (count === 0) return null
            return (
              <Card key={k} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setTypeFilter(typeFilter === k ? 'all' : k)}>
                <CardContent className="pt-3 pb-2">
                  <p className="text-xs text-muted-foreground">{v}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {(isSuperUser || availableOrganizations.length > 1) && (
            <Select value={selectedOrgId || 'all'} onValueChange={(v) => setSelectedOrgId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 w-64">
                <SelectValue placeholder="All organisations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organisations</SelectItem>
                {availableOrganizations.map(org => (
                  <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 h-9" placeholder="Search sites…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(SITE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Show inactive
          </label>
        </div>

        {queryOrgId && selectedOrgId === queryOrgId && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-blue-50 border-blue-300 text-blue-700">
              Filtered from CRM: {queryOrgName || queryOrgId}
            </Badge>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearCrmOrgContext}>
              Clear CRM filter
            </Button>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Type</TableHead>
                  {canView('location') && <TableHead><MapPin className="inline h-3.5 w-3.5 mr-1" />Address</TableHead>}
                  {canView('contacts') && <TableHead><Phone className="inline h-3.5 w-3.5 mr-1" />Contact</TableHead>}
                  {canView('sla') && <TableHead><Clock className="inline h-3.5 w-3.5 mr-1" />SLA</TableHead>}
                  {canView('financial') && <TableHead>Pay / Charge</TableHead>}
                  {canView('accounting') && <TableHead>M365</TableHead>}
                  <TableHead>Status</TableHead>
                  {canManageIdentity && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No sites found. Add one with "Add Site".</TableCell></TableRow>
                )}
                {filtered.map(s => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setViewSite(s)}>
                    <TableCell>
                      <div className="font-medium text-sm">{s.name}</div>
                      {s.site_code && <div className="text-xs text-muted-foreground font-mono">{s.site_code}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{SITE_TYPE_LABELS[s.site_type] ?? s.site_type}</Badge></TableCell>
                    {canView('location') && (
                      <TableCell className="text-sm">{s.address ? `${s.address}${s.city ? ', ' + s.city : ''}` : <span className="text-muted-foreground">—</span>}</TableCell>
                    )}
                    {canView('contacts') && (
                      <TableCell className="text-sm">
                        {s.contact_name ? (
                          <div>
                            <div>{s.contact_name}</div>
                            {s.contact_phone && <div className="text-xs text-muted-foreground">{s.contact_phone}</div>}
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {canView('sla') && (
                      <TableCell className="text-sm">{s.default_response_minutes}m</TableCell>
                    )}
                    {canView('financial') && (
                      <TableCell className="text-xs">
                        {s.default_pay_rate != null || s.default_charge_rate != null ? (
                          <div className="space-y-0.5">
                            {s.default_pay_rate != null && <div className="text-muted-foreground">Pay: <span className="text-foreground font-medium">${s.default_pay_rate}/hr</span></div>}
                            {s.default_charge_rate != null && <div className="text-muted-foreground">Charge: <span className="text-foreground font-medium">${s.default_charge_rate}/hr</span></div>}
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {canView('accounting') && (
                      <TableCell className="text-xs">
                        {s.m365_customer_id ? (
                          <div className="font-mono text-muted-foreground">{s.m365_customer_id}</div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant="outline" className={s.is_active ? 'border-green-300 text-green-700' : 'border-gray-300 text-gray-400'}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManageIdentity && (
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate({ id: s.id, active: !s.is_active })}>
                            {s.is_active ? <ToggleLeft className="h-4 w-4 text-muted-foreground" /> : <ToggleRight className="h-4 w-4 text-green-600" />}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── Create / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!dialogMode} onOpenChange={v => { if (!v) setDialogMode(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? 'Add Client Site' : `Edit – ${editTarget?.name}`}</DialogTitle>
            <DialogDescription>Service location details, contacts, and SLA defaults.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-5">

            {/* Identity — always visible in the dialog if the user got here */}
            {canView('identity') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                  <Label>Site Name <span className="text-destructive">*</span></Label>
                  <Input disabled={!canEdit('identity')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kairākau Beach Reserve" />
                </div>
                <div className="space-y-1.5">
                  <Label>Site Code</Label>
                  <Input disabled={!canEdit('identity')} value={form.site_code} onChange={e => setForm(f => ({ ...f, site_code: e.target.value }))} placeholder="Optional ref code" />
                </div>
                <div className="space-y-1.5">
                  <Label>Site Type</Label>
                  <Select disabled={!canEdit('identity')} value={form.site_type} onValueChange={v => setForm(f => ({ ...f, site_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(SITE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Zone</Label>
                  <Select disabled={!canEdit('identity')} value={form.zone_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, zone_id: v === '__none__' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Location */}
            {canView('location') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Street Address</Label>
                  <Input disabled={!canEdit('location')} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street address" />
                </div>
                <div className="space-y-1.5">
                  <Label>City / Town</Label>
                  <Input disabled={!canEdit('location')} value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>GPS Lat / Lng</Label>
                  <div className="flex gap-2">
                    <Input disabled={!canEdit('location')} placeholder="-39.123" value={form.gps_lat} onChange={e => setForm(f => ({ ...f, gps_lat: e.target.value }))} />
                    <Input disabled={!canEdit('location')} placeholder="176.456" value={form.gps_lng} onChange={e => setForm(f => ({ ...f, gps_lng: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            {/* Operational notes */}
            {canView('operational') && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Access Instructions</Label>
                  <Textarea disabled={!canEdit('operational')} rows={2} value={form.access_instructions} onChange={e => setForm(f => ({ ...f, access_instructions: e.target.value }))} placeholder="Gate code, access roads, parking…" />
                </div>
                <div className="space-y-1.5">
                  <Label>Known Hazards</Label>
                  <Textarea disabled={!canEdit('operational')} rows={2} value={form.hazards} onChange={e => setForm(f => ({ ...f, hazards: e.target.value }))} placeholder="WHS hazards officers should be aware of…" />
                </div>
                <div className="space-y-1.5">
                  <Label>Special Instructions</Label>
                  <Textarea disabled={!canEdit('operational')} rows={2} value={form.special_instructions} onChange={e => setForm(f => ({ ...f, special_instructions: e.target.value }))} />
                </div>
              </div>
            )}

            {/* Notes — officers can edit this group */}
            {canView('notes') && (
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea disabled={!canEdit('notes')} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="General site notes…" />
              </div>
            )}

            {/* Contacts */}
            {canView('contacts') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Primary Contact</Label><Input disabled={!canEdit('contacts')} placeholder="Full name" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Contact Phone</Label><Input disabled={!canEdit('contacts')} type="tel" value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} /></div>
                <div className="space-y-1.5 col-span-2 md:col-span-1"><Label>Contact Email</Label><Input disabled={!canEdit('contacts')} type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Emergency Contact</Label><Input disabled={!canEdit('contacts')} placeholder="After-hours name" value={form.emergency_contact_name} onChange={e => setForm(f => ({ ...f, emergency_contact_name: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Emergency Phone</Label><Input disabled={!canEdit('contacts')} type="tel" value={form.emergency_contact_phone} onChange={e => setForm(f => ({ ...f, emergency_contact_phone: e.target.value }))} /></div>
              </div>
            )}

            {/* SLA */}
            {canView('sla') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Default Response SLA (mins)</Label>
                  <Input disabled={!canEdit('sla')} type="number" min="5" value={form.default_response_minutes} onChange={e => setForm(f => ({ ...f, default_response_minutes: parseInt(e.target.value) || 60 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority Override</Label>
                  <Select disabled={!canEdit('sla')} value={form.priority_override || '__none__'} onValueChange={v => setForm(f => ({ ...f, priority_override: v === '__none__' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Use job priority" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Use job priority</SelectItem>
                      {['low','normal','high','urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Pay rates / charge rates */}
            {canView('financial') && (
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Pay &amp; Charge Rates (NZD/hr)</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Officer Pay Rate</Label>
                    <Input disabled={!canEdit('financial')} type="number" min="0" step="0.01" placeholder="e.g. 28.50" value={form.default_pay_rate} onChange={e => setForm(f => ({ ...f, default_pay_rate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Client Charge Rate</Label>
                    <Input disabled={!canEdit('financial')} type="number" min="0" step="0.01" placeholder="e.g. 45.00" value={form.default_charge_rate} onChange={e => setForm(f => ({ ...f, default_charge_rate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>OT Multiplier</Label>
                    <Input disabled={!canEdit('financial')} type="number" min="1" step="0.25" placeholder="1.5" value={form.overtime_pay_multiplier} onChange={e => setForm(f => ({ ...f, overtime_pay_multiplier: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="space-y-1.5">
                    <Label>Contract Start</Label>
                    <Input disabled={!canEdit('financial')} type="date" value={form.contract_start_date} onChange={e => setForm(f => ({ ...f, contract_start_date: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contract End</Label>
                    <Input disabled={!canEdit('financial')} type="date" value={form.contract_end_date} onChange={e => setForm(f => ({ ...f, contract_end_date: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Frequency</Label>
                    <Select disabled={!canEdit('financial')} value={form.invoice_frequency} onValueChange={v => setForm(f => ({ ...f, invoice_frequency: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="fortnightly">Fortnightly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="on_completion">On Completion</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Purchase Order No.</Label>
                    <Input disabled={!canEdit('financial')} placeholder="Client PO number" value={form.purchase_order_number} onChange={e => setForm(f => ({ ...f, purchase_order_number: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            {/* Microsoft 365 / Business Central accounting link */}
            {canView('accounting') && (
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Microsoft 365 Accounting Link</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>M365 Customer ID</Label>
                    <Input disabled={!canEdit('accounting')} placeholder="e.g. C00042" value={form.m365_customer_id} onChange={e => setForm(f => ({ ...f, m365_customer_id: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contract / Project Ref</Label>
                    <Input disabled={!canEdit('accounting')} placeholder="M365 project code" value={form.m365_contract_ref} onChange={e => setForm(f => ({ ...f, m365_contract_ref: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Cost Centre</Label>
                    <Input disabled={!canEdit('accounting')} placeholder="Cost centre code" value={form.m365_cost_centre} onChange={e => setForm(f => ({ ...f, m365_cost_centre: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {dialogMode === 'create' ? 'Create Site' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── View Site Detail Dialog ───────────────────────────────────────────── */}
      {viewSite && (
        <Dialog open onOpenChange={() => setViewSite(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{viewSite.name}</DialogTitle>
              <DialogDescription>
                <Badge variant="outline" className="text-xs mr-2">{SITE_TYPE_LABELS[viewSite.site_type]}</Badge>
                {viewSite.site_code && <span className="font-mono text-xs">{viewSite.site_code}</span>}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {canView('location') && viewSite.address && (
                <div className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" /><span>{viewSite.address}{viewSite.city ? ', ' + viewSite.city : ''}</span></div>
              )}
              {canView('contacts') && viewSite.contact_name && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Primary Contact</p>
                  <p>{viewSite.contact_name}</p>
                  {viewSite.contact_phone && <p className="text-muted-foreground">{viewSite.contact_phone}</p>}
                  {viewSite.contact_email && <p className="text-muted-foreground">{viewSite.contact_email}</p>}
                </div>
              )}
              {canView('contacts') && viewSite.emergency_contact_name && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Emergency Contact</p>
                  <p>{viewSite.emergency_contact_name}</p>
                  {viewSite.emergency_contact_phone && <p className="text-muted-foreground">{viewSite.emergency_contact_phone}</p>}
                </div>
              )}
              {canView('operational') && viewSite.access_instructions && <div><p className="text-xs text-muted-foreground mb-0.5">Access</p><p>{viewSite.access_instructions}</p></div>}
              {canView('operational') && viewSite.hazards && <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 rounded p-2"><p className="text-xs font-medium text-yellow-800 dark:text-yellow-300 mb-0.5">⚠ Hazards</p><p className="text-yellow-900 dark:text-yellow-200">{viewSite.hazards}</p></div>}
              {canView('operational') && viewSite.special_instructions && <div><p className="text-xs text-muted-foreground mb-0.5">Special Instructions</p><p>{viewSite.special_instructions}</p></div>}
              {canView('notes') && viewSite.notes && <div><p className="text-xs text-muted-foreground mb-0.5">Notes</p><p>{viewSite.notes}</p></div>}
              {/* Rates */}
              {canView('financial') && (viewSite.default_pay_rate != null || viewSite.default_charge_rate != null) && (
                <div className="bg-muted/40 rounded-lg p-3 space-y-1 text-xs">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide mb-1">Rates (NZD/hr)</p>
                  {viewSite.default_pay_rate != null && <div className="flex justify-between"><span className="text-muted-foreground">Officer pay</span><span className="font-semibold">${viewSite.default_pay_rate}/hr</span></div>}
                  {viewSite.default_charge_rate != null && <div className="flex justify-between"><span className="text-muted-foreground">Client charge</span><span className="font-semibold">${viewSite.default_charge_rate}/hr</span></div>}
                  {viewSite.invoice_frequency && <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="capitalize">{viewSite.invoice_frequency.replace('_',' ')}</span></div>}
                  {viewSite.purchase_order_number && <div className="flex justify-between"><span className="text-muted-foreground">PO#</span><span>{viewSite.purchase_order_number}</span></div>}
                </div>
              )}
              {/* M365 */}
              {canView('accounting') && (viewSite.m365_customer_id || viewSite.m365_contract_ref) && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded p-3 space-y-1 text-xs">
                  <p className="font-medium text-blue-800 dark:text-blue-300 uppercase tracking-wide mb-1">Microsoft 365</p>
                  {viewSite.m365_customer_id && <div className="flex justify-between"><span className="text-muted-foreground">Customer ID</span><span className="font-mono">{viewSite.m365_customer_id}</span></div>}
                  {viewSite.m365_contract_ref && <div className="flex justify-between"><span className="text-muted-foreground">Contract Ref</span><span className="font-mono">{viewSite.m365_contract_ref}</span></div>}
                  {viewSite.m365_cost_centre && <div className="flex justify-between"><span className="text-muted-foreground">Cost Centre</span><span className="font-mono">{viewSite.m365_cost_centre}</span></div>}
                </div>
              )}
              {canView('sla') && (
                <div className="flex justify-between text-xs text-muted-foreground border-t pt-2">
                  <span>SLA: {viewSite.default_response_minutes}m response</span>
                  {viewSite.zone && <span>Zone: {viewSite.zone.name}</span>}
                </div>
              )}
            </div>
            <DialogFooter>
              {canManageIdentity && (
                <Button variant="outline" onClick={() => { setViewSite(null); openEdit(viewSite) }}>
                  <Edit className="h-4 w-4 mr-1.5" /> Edit
                </Button>
              )}
              <Button onClick={() => setViewSite(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AppLayout>
  )
}
