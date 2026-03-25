/**
 * ClientSites — Zoho CRM / Wilsar-inspired site registry.
 * Stores client service locations with contacts, GPS, site type, and SLA defaults.
 * Jobs created in the DispatchConsole can be linked to these sites for history.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useZones } from '@/hooks/useZones'
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
  Edit, ToggleLeft, ToggleRight, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'

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
}

const SITE_TYPE_LABELS: Record<string, string> = {
  general: 'General', freedom_camping: 'Freedom Camping', guarding: 'Guarding Post',
  parking: 'Parking', noise_control: 'Noise Control', event: 'Event Site', infrastructure: 'Infrastructure',
}

function emptyForm(): SiteForm {
  return {
    name: '', site_code: '', site_type: 'general',
    address: '', city: '', gps_lat: '', gps_lng: '', zone_id: '',
    access_instructions: '', hazards: '', special_instructions: '', notes: '',
    contact_name: '', contact_phone: '', contact_email: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    default_response_minutes: 60, priority_override: '',
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
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClientSites() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const orgId = user?.organization_id

  const [search, setSearch]           = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [typeFilter, setTypeFilter]   = useState('all')
  const [dialogMode, setDialogMode]   = useState<'create' | 'edit' | null>(null)
  const [editTarget, setEditTarget]   = useState<ClientSite | null>(null)
  const [form, setForm]               = useState<SiteForm>(emptyForm())
  const [viewSite, setViewSite]       = useState<ClientSite | null>(null)

  const { data: zones = [] } = useZones({ organizationId: orgId })

  // ── Fetch sites ─────────────────────────────────────────────────────────────
  const { data: sites = [], isLoading } = useQuery<ClientSite[]>({
    queryKey: ['client-sites', orgId, showInactive, typeFilter],
    queryFn: async () => {
      let q = supabase
        .from('client_sites')
        .select('*, zone:zones!zone_id(name)')
        .eq('organization_id', orgId ?? '')
        .order('name')
      if (!showInactive) q = q.eq('is_active', true)
      if (typeFilter !== 'all') q = q.eq('site_type', typeFilter)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as ClientSite[]
    },
    enabled: !!orgId,
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
      const payload: any = {
        organization_id:        orgId,
        created_by:             user?.id,
        name:                   f.name,
        site_code:              f.site_code || null,
        site_type:              f.site_type,
        address:                f.address || null,
        city:                   f.city || null,
        gps_lat:                f.gps_lat ? parseFloat(f.gps_lat) : null,
        gps_lng:                f.gps_lng ? parseFloat(f.gps_lng) : null,
        zone_id:                f.zone_id || null,
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
      }
      if (id) {
        const { error } = await supabase.from('client_sites').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('client_sites').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(dialogMode === 'create' ? 'Site created' : 'Site updated')
      qc.invalidateQueries({ queryKey: ['client-sites'] })
      qc.invalidateQueries({ queryKey: ['client-sites-lookup'] })
      setDialogMode(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Save failed'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('client_sites').update({ is_active: active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Site updated'); qc.invalidateQueries({ queryKey: ['client-sites'] }) },
  })

  function openCreate() { setForm(emptyForm()); setEditTarget(null); setDialogMode('create') }
  function openEdit(s: ClientSite) { setForm(siteFormFromRecord(s)); setEditTarget(s); setDialogMode('edit') }
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
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Add Site</Button>
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

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead><MapPin className="inline h-3.5 w-3.5 mr-1" />Address</TableHead>
                  <TableHead><Phone className="inline h-3.5 w-3.5 mr-1" />Contact</TableHead>
                  <TableHead><Clock className="inline h-3.5 w-3.5 mr-1" />SLA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No sites found. Add one with "Add Site".</TableCell></TableRow>
                )}
                {filtered.map(s => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setViewSite(s)}>
                    <TableCell>
                      <div className="font-medium text-sm">{s.name}</div>
                      {s.site_code && <div className="text-xs text-muted-foreground font-mono">{s.site_code}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{SITE_TYPE_LABELS[s.site_type] ?? s.site_type}</Badge></TableCell>
                    <TableCell className="text-sm">{s.address ? `${s.address}${s.city ? ', ' + s.city : ''}` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">
                      {s.contact_name ? (
                        <div>
                          <div>{s.contact_name}</div>
                          {s.contact_phone && <div className="text-xs text-muted-foreground">{s.contact_phone}</div>}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{s.default_response_minutes}m</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={s.is_active ? 'border-green-300 text-green-700' : 'border-gray-300 text-gray-400'}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
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

            {/* Identity */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 md:col-span-1">
                <Label>Site Name <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kairākau Beach Reserve" />
              </div>
              <div className="space-y-1.5">
                <Label>Site Code</Label>
                <Input value={form.site_code} onChange={e => setForm(f => ({ ...f, site_code: e.target.value }))} placeholder="Optional ref code" />
              </div>
              <div className="space-y-1.5">
                <Label>Site Type</Label>
                <Select value={form.site_type} onValueChange={v => setForm(f => ({ ...f, site_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SITE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Zone</Label>
                <Select value={form.zone_id} onValueChange={v => setForm(f => ({ ...f, zone_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Location */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Street Address</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street address" />
              </div>
              <div className="space-y-1.5">
                <Label>City / Town</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>GPS Lat / Lng</Label>
                <div className="flex gap-2">
                  <Input placeholder="-39.123" value={form.gps_lat} onChange={e => setForm(f => ({ ...f, gps_lat: e.target.value }))} />
                  <Input placeholder="176.456" value={form.gps_lng} onChange={e => setForm(f => ({ ...f, gps_lng: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Operational notes */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Access Instructions</Label>
                <Textarea rows={2} value={form.access_instructions} onChange={e => setForm(f => ({ ...f, access_instructions: e.target.value }))} placeholder="Gate code, access roads, parking…" />
              </div>
              <div className="space-y-1.5">
                <Label>Known Hazards</Label>
                <Textarea rows={2} value={form.hazards} onChange={e => setForm(f => ({ ...f, hazards: e.target.value }))} placeholder="WHS hazards officers should be aware of…" />
              </div>
              <div className="space-y-1.5">
                <Label>Special Instructions</Label>
                <Textarea rows={2} value={form.special_instructions} onChange={e => setForm(f => ({ ...f, special_instructions: e.target.value }))} />
              </div>
            </div>

            {/* Contacts */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Primary Contact</Label><Input placeholder="Full name" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Contact Phone</Label><Input type="tel" value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} /></div>
              <div className="space-y-1.5 col-span-2 md:col-span-1"><Label>Contact Email</Label><Input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Emergency Contact</Label><Input placeholder="After-hours name" value={form.emergency_contact_name} onChange={e => setForm(f => ({ ...f, emergency_contact_name: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Emergency Phone</Label><Input type="tel" value={form.emergency_contact_phone} onChange={e => setForm(f => ({ ...f, emergency_contact_phone: e.target.value }))} /></div>
            </div>

            {/* SLA */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Default Response SLA (mins)</Label>
                <Input type="number" min="5" value={form.default_response_minutes} onChange={e => setForm(f => ({ ...f, default_response_minutes: parseInt(e.target.value) || 60 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Priority Override</Label>
                <Select value={form.priority_override} onValueChange={v => setForm(f => ({ ...f, priority_override: v }))}>
                  <SelectTrigger><SelectValue placeholder="Use job priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Use job priority</SelectItem>
                    {['low','normal','high','urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

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
              {viewSite.address && (
                <div className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" /><span>{viewSite.address}{viewSite.city ? ', ' + viewSite.city : ''}</span></div>
              )}
              {viewSite.contact_name && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Primary Contact</p>
                  <p>{viewSite.contact_name}</p>
                  {viewSite.contact_phone && <p className="text-muted-foreground">{viewSite.contact_phone}</p>}
                  {viewSite.contact_email && <p className="text-muted-foreground">{viewSite.contact_email}</p>}
                </div>
              )}
              {viewSite.emergency_contact_name && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Emergency Contact</p>
                  <p>{viewSite.emergency_contact_name}</p>
                  {viewSite.emergency_contact_phone && <p className="text-muted-foreground">{viewSite.emergency_contact_phone}</p>}
                </div>
              )}
              {viewSite.access_instructions && <div><p className="text-xs text-muted-foreground mb-0.5">Access</p><p>{viewSite.access_instructions}</p></div>}
              {viewSite.hazards && <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 rounded p-2"><p className="text-xs font-medium text-yellow-800 dark:text-yellow-300 mb-0.5">⚠ Hazards</p><p className="text-yellow-900 dark:text-yellow-200">{viewSite.hazards}</p></div>}
              {viewSite.special_instructions && <div><p className="text-xs text-muted-foreground mb-0.5">Special Instructions</p><p>{viewSite.special_instructions}</p></div>}
              <div className="flex justify-between text-xs text-muted-foreground border-t pt-2">
                <span>SLA: {viewSite.default_response_minutes}m response</span>
                {viewSite.zone && <span>Zone: {viewSite.zone.name}</span>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setViewSite(null); openEdit(viewSite) }}>
                <Edit className="h-4 w-4 mr-1.5" /> Edit
              </Button>
              <Button onClick={() => setViewSite(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AppLayout>
  )
}
