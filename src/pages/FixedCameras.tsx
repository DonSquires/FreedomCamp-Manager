/**
 * FixedCameras — B-27 Fixed Camera Support
 *
 * Admin dashboard for managing fixed CCTV / ALPR / traffic cameras
 * associated with the organisation's zones and sites.
 *
 * Features:
 *   - List all cameras with status badges and zone associations
 *   - Add / edit cameras (name, type, GPS, stream URL, zone link)
 *   - Manually update status (active / offline / maintenance / decommissioned)
 *   - Filter by camera type, status, and zone
 *   - Summary stat cards: total, active, offline, ALPR count
 */

import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Camera,
  Plus,
  Pencil,
  RefreshCw,
  MapPin,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Video,
  ScanLine,
  TrafficCone,
  AlertTriangle,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type FixedCamera = Database['public']['Tables']['fixed_cameras']['Row']

type CameraType = 'cctv' | 'alpr' | 'traffic' | 'body_worn' | 'other'
type CameraStatus = 'active' | 'offline' | 'maintenance' | 'decommissioned'

interface ZoneOption { id: string; name: string }

const CAMERA_TYPES: { value: CameraType; label: string }[] = [
  { value: 'cctv',      label: 'CCTV' },
  { value: 'alpr',      label: 'ALPR (Plate Recognition)' },
  { value: 'traffic',   label: 'Traffic Camera' },
  { value: 'body_worn', label: 'Body Worn' },
  { value: 'other',     label: 'Other' },
]

const CAMERA_STATUSES: { value: CameraStatus; label: string }[] = [
  { value: 'active',          label: 'Active' },
  { value: 'offline',         label: 'Offline' },
  { value: 'maintenance',     label: 'Maintenance' },
  { value: 'decommissioned',  label: 'Decommissioned' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    active:         { cls: 'bg-green-100 text-green-800 border-green-300',   icon: <Wifi className="h-3 w-3" /> },
    offline:        { cls: 'bg-red-100 text-red-800 border-red-300',         icon: <WifiOff className="h-3 w-3" /> },
    maintenance:    { cls: 'bg-amber-100 text-amber-800 border-amber-300',   icon: <Wrench className="h-3 w-3" /> },
    decommissioned: { cls: 'bg-gray-100 text-gray-600 border-gray-300',      icon: <X className="h-3 w-3" /> },
  }
  return map[status] ?? map['offline']
}

function typeIcon(type: string) {
  const map: Record<string, React.ReactNode> = {
    cctv:      <Video className="h-4 w-4 text-blue-500" />,
    alpr:      <ScanLine className="h-4 w-4 text-purple-500" />,
    traffic:   <TrafficCone className="h-4 w-4 text-amber-500" />,
    body_worn: <Camera className="h-4 w-4 text-gray-500" />,
    other:     <Camera className="h-4 w-4 text-muted-foreground" />,
  }
  return map[type] ?? map['other']
}

// ─── Empty form state ─────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  camera_type: 'cctv' as CameraType,
  status: 'active' as CameraStatus,
  address: '',
  latitude: '',
  longitude: '',
  zone_id: '',
  stream_url: '',
  snapshot_url: '',
  notes: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FixedCameras() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const orgId = user?.organization_id ?? ''

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; camera?: FixedCamera } | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)

  // ── Fetch cameras ──────────────────────────────────────────────────────────
  const { data: cameras = [], isFetching, refetch } = useQuery<FixedCamera[]>({
    queryKey: ['fixed-cameras', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixed_cameras')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
  })

  // ── Fetch zones for dropdown ───────────────────────────────────────────────
  const { data: zones = [] } = useQuery<ZoneOption[]>({
    queryKey: ['zones-options', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as ZoneOption[]
    },
    enabled: !!orgId,
  })

  // ── Status update mutation ─────────────────────────────────────────────────
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CameraStatus }) => {
      const { error } = await supabase
        .from('fixed_cameras')
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed-cameras'] }) },
    onError:   (e) => { toast.error('Failed to update status: ' + (e as Error).message) },
  })

  // ── Filter cameras ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = cameras
    if (typeFilter !== 'all')   list = list.filter(c => c.camera_type === typeFilter)
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.address ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [cameras, typeFilter, statusFilter, search])

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   cameras.length,
    active:  cameras.filter(c => c.status === 'active').length,
    offline: cameras.filter(c => c.status === 'offline').length,
    alpr:    cameras.filter(c => c.camera_type === 'alpr').length,
  }), [cameras])

  // ── Dialog helpers ─────────────────────────────────────────────────────────
  function openAdd() {
    setForm({ ...EMPTY_FORM })
    setDialog({ mode: 'add' })
  }

  function openEdit(camera: FixedCamera) {
    setForm({
      name:         camera.name,
      camera_type:  camera.camera_type as CameraType,
      status:       camera.status as CameraStatus,
      address:      camera.address ?? '',
      latitude:     camera.latitude != null ? String(camera.latitude) : '',
      longitude:    camera.longitude != null ? String(camera.longitude) : '',
      zone_id:      camera.zone_id ?? '',
      stream_url:   camera.stream_url ?? '',
      snapshot_url: camera.snapshot_url ?? '',
      notes:        camera.notes ?? '',
    })
    setDialog({ mode: 'edit', camera })
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Camera name is required'); return }
    setSaving(true)
    try {
      const payload = {
        organization_id: orgId,
        name:         form.name.trim(),
        camera_type:  form.camera_type,
        status:       form.status,
        address:      form.address.trim() || null,
        latitude:     form.latitude ? parseFloat(form.latitude) : null,
        longitude:    form.longitude ? parseFloat(form.longitude) : null,
        zone_id:      form.zone_id || null,
        stream_url:   form.stream_url.trim() || null,
        snapshot_url: form.snapshot_url.trim() || null,
        notes:        form.notes.trim() || null,
      }

      if (dialog?.mode === 'edit' && dialog.camera) {
        const { error } = await supabase
          .from('fixed_cameras')
          .update(payload)
          .eq('id', dialog.camera.id)
        if (error) throw error
        toast.success('Camera updated')
      } else {
        const { error } = await supabase.from('fixed_cameras').insert(payload)
        if (error) throw error
        toast.success('Camera added')
      }
      qc.invalidateQueries({ queryKey: ['fixed-cameras'] })
      setDialog(null)
    } catch (e) {
      toast.error('Save failed: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Camera className="h-6 w-6 text-blue-500" />
              Fixed Cameras
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage CCTV, ALPR, and traffic cameras linked to your zones and sites.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" />
              Add Camera
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Cameras</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-green-600">{stats.active}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Offline</p>
              <p className="text-2xl font-bold text-red-600">{stats.offline}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">ALPR Cameras</p>
              <p className="text-2xl font-bold text-purple-600">{stats.alpr}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input
              placeholder="Search by name or address…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {CAMERA_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {CAMERA_STATUSES.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Camera table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Camera List
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filtered.length} of {cameras.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Camera className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No cameras found.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={openAdd}>
                  <Plus className="h-4 w-4 mr-1" /> Add your first camera
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(camera => {
                    const { cls, icon } = statusBadge(camera.status)
                    const zone = zones.find(z => z.id === camera.zone_id)
                    return (
                      <TableRow key={camera.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {typeIcon(camera.camera_type)}
                            <span className="font-medium">{camera.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm capitalize">{camera.camera_type.replace('_', ' ')}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${cls} text-xs flex items-center gap-1 w-fit`}>
                            {icon} {camera.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {zone ? (
                            <span className="flex items-center gap-1 text-sm">
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                              {zone.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {camera.address ?? (camera.latitude != null ? `${camera.latitude?.toFixed(4)}, ${camera.longitude?.toFixed(4)}` : '—')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {camera.last_seen_at ? formatDateTime(camera.last_seen_at) : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {camera.status !== 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-green-600"
                                onClick={() => updateStatusMutation.mutate({ id: camera.id, status: 'active' })}
                              >
                                Set Active
                              </Button>
                            )}
                            {camera.status === 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-amber-600"
                                onClick={() => updateStatusMutation.mutate({ id: camera.id, status: 'offline' })}
                              >
                                Mark Offline
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7"
                              onClick={() => openEdit(camera)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add / Edit Dialog */}
        <Dialog open={!!dialog} onOpenChange={() => setDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{dialog?.mode === 'edit' ? 'Edit Camera' : 'Add Fixed Camera'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>Camera Name *</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Car Park North CCTV-1"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Camera Type</Label>
                  <Select value={form.camera_type} onValueChange={v => setForm(f => ({ ...f, camera_type: v as CameraType }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMERA_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as CameraStatus }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMERA_STATUSES.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Address</Label>
                  <Input
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="Street address or landmark"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Latitude</Label>
                  <Input
                    type="number"
                    value={form.latitude}
                    onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                    placeholder="-41.2866"
                    step="any"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Longitude</Label>
                  <Input
                    type="number"
                    value={form.longitude}
                    onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                    placeholder="174.7756"
                    step="any"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Linked Zone</Label>
                  <Select value={form.zone_id} onValueChange={v => setForm(f => ({ ...f, zone_id: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select zone (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— No zone —</SelectItem>
                      {zones.map(z => (
                        <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Stream URL (RTSP / HLS)</Label>
                  <Input
                    value={form.stream_url}
                    onChange={e => setForm(f => ({ ...f, stream_url: e.target.value }))}
                    placeholder="rtsp://camera.local/stream1 (internal only)"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Snapshot URL</Label>
                  <Input
                    value={form.snapshot_url}
                    onChange={e => setForm(f => ({ ...f, snapshot_url: e.target.value }))}
                    placeholder="https://camera.local/snapshot.jpg"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Installation notes, maintenance history…"
                    rows={2}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : dialog?.mode === 'edit' ? 'Save Changes' : 'Add Camera'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  )
}
