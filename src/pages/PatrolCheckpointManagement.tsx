/**
 * PatrolCheckpointManagement — Admin page for creating and managing QR/NFC patrol checkpoints.
 * Supports Lone Worker Protocol (Health & Safety at Work Act 2015).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { QrCode, Plus, Edit, Trash2, MapPin, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PatrolCheckpoint {
  id: string
  organization_id: string
  zone_id: string | null
  name: string
  description: string | null
  location_lat: number | null
  location_lng: number | null
  qr_code: string
  nfc_tag_id: string | null
  is_active: boolean
  required_on_patrol: boolean
  check_in_radius_metres: number
  created_by: string | null
  created_at: string
  updated_at: string
  zone?: { id: string; name: string } | null
}

interface CheckpointFormState {
  name: string
  description: string
  location_lat: string
  location_lng: string
  qr_code: string
  nfc_tag_id: string
  is_active: boolean
  required_on_patrol: boolean
  check_in_radius_metres: number
  zone_id: string
}

const emptyForm = (): CheckpointFormState => ({
  name: '',
  description: '',
  location_lat: '',
  location_lng: '',
  qr_code: crypto.randomUUID(),
  nfc_tag_id: '',
  is_active: true,
  required_on_patrol: false,
  check_in_radius_metres: 50,
  zone_id: '',
})

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PatrolCheckpointManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [selected, setSelected] = useState<PatrolCheckpoint | null>(null)
  const [form, setForm] = useState<CheckpointFormState>(emptyForm())
  const [search, setSearch] = useState('')

  // ─── Data ─────────────────────────────────────────────────────────────────

  const { data: checkpoints = [], isLoading } = useQuery({
    queryKey: ['patrol_checkpoints', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('patrol_checkpoints' as any) as any)
        .select('*, zone:zones(id, name)')
        .eq('organization_id', user!.organization_id!)
        .order('name')
      if (error) throw error
      return data as PatrolCheckpoint[]
    },
    enabled: !!user?.organization_id,
  })

  const { data: zones = [] } = useQuery({
    queryKey: ['zones_list', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', user!.organization_id!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
    enabled: !!user?.organization_id,
  })

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (f: CheckpointFormState) => {
      const { error } = await (supabase.from('patrol_checkpoints' as any) as any).insert({
        organization_id: user!.organization_id!,
        name: f.name.trim(),
        description: f.description.trim() || null,
        location_lat: f.location_lat ? parseFloat(f.location_lat) : null,
        location_lng: f.location_lng ? parseFloat(f.location_lng) : null,
        qr_code: f.qr_code.trim(),
        nfc_tag_id: f.nfc_tag_id.trim() || null,
        is_active: f.is_active,
        required_on_patrol: f.required_on_patrol,
        check_in_radius_metres: f.check_in_radius_metres,
        zone_id: f.zone_id || null,
        created_by: user!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrol_checkpoints'] })
      toast.success('Checkpoint created')
      setShowCreate(false)
      setForm(emptyForm())
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to create checkpoint'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, f }: { id: string; f: CheckpointFormState }) => {
      const { error } = await (supabase.from('patrol_checkpoints' as any) as any)
        .update({
          name: f.name.trim(),
          description: f.description.trim() || null,
          location_lat: f.location_lat ? parseFloat(f.location_lat) : null,
          location_lng: f.location_lng ? parseFloat(f.location_lng) : null,
          qr_code: f.qr_code.trim(),
          nfc_tag_id: f.nfc_tag_id.trim() || null,
          is_active: f.is_active,
          required_on_patrol: f.required_on_patrol,
          check_in_radius_metres: f.check_in_radius_metres,
          zone_id: f.zone_id || null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrol_checkpoints'] })
      toast.success('Checkpoint updated')
      setShowEdit(false)
      setSelected(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to update checkpoint'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('patrol_checkpoints' as any) as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrol_checkpoints'] })
      toast.success('Checkpoint deleted')
      setShowDelete(false)
      setSelected(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to delete checkpoint'),
  })

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function openCreate() {
    setForm(emptyForm())
    setShowCreate(true)
  }

  function openEdit(cp: PatrolCheckpoint) {
    setSelected(cp)
    setForm({
      name: cp.name,
      description: cp.description ?? '',
      location_lat: cp.location_lat != null ? String(cp.location_lat) : '',
      location_lng: cp.location_lng != null ? String(cp.location_lng) : '',
      qr_code: cp.qr_code,
      nfc_tag_id: cp.nfc_tag_id ?? '',
      is_active: cp.is_active,
      required_on_patrol: cp.required_on_patrol,
      check_in_radius_metres: cp.check_in_radius_metres,
      zone_id: cp.zone_id ?? '',
    })
    setShowEdit(true)
  }

  function openDelete(cp: PatrolCheckpoint) {
    setSelected(cp)
    setShowDelete(true)
  }

  const filtered = checkpoints.filter(cp =>
    cp.name.toLowerCase().includes(search.toLowerCase()) ||
    (cp.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // ─── Form dialog content (shared for create/edit) ──────────────────────────

  function CheckpointForm() {
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="cp-name">Name *</Label>
          <Input
            id="cp-name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Gate A, Shelter Block 2"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cp-desc">Description</Label>
          <Input
            id="cp-desc"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Optional description or instructions"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="cp-lat">Latitude</Label>
            <Input
              id="cp-lat"
              type="number"
              step="any"
              value={form.location_lat}
              onChange={e => setForm(f => ({ ...f, location_lat: e.target.value }))}
              placeholder="-36.8485"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cp-lng">Longitude</Label>
            <Input
              id="cp-lng"
              type="number"
              step="any"
              value={form.location_lng}
              onChange={e => setForm(f => ({ ...f, location_lng: e.target.value }))}
              placeholder="174.7633"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cp-radius">Check-in Radius (metres)</Label>
          <Input
            id="cp-radius"
            type="number"
            min={10}
            max={500}
            value={form.check_in_radius_metres}
            onChange={e => setForm(f => ({ ...f, check_in_radius_metres: parseInt(e.target.value) || 50 }))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cp-zone">Zone (optional)</Label>
          <select
            id="cp-zone"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={form.zone_id}
            onChange={e => setForm(f => ({ ...f, zone_id: e.target.value }))}
          >
            <option value="">— No zone —</option>
            {zones.map(z => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cp-qr">QR Code Payload</Label>
          <Input
            id="cp-qr"
            value={form.qr_code}
            onChange={e => setForm(f => ({ ...f, qr_code: e.target.value }))}
            placeholder="UUID or URL"
          />
          <p className="text-xs text-muted-foreground">
            Auto-generated UUID. Change only if using custom QR codes or URLs.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cp-nfc">NFC Tag ID (optional)</Label>
          <Input
            id="cp-nfc"
            value={form.nfc_tag_id}
            onChange={e => setForm(f => ({ ...f, nfc_tag_id: e.target.value }))}
            placeholder="NFC tag UID"
          />
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              id="cp-active"
              checked={form.is_active}
              onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
            />
            <Label htmlFor="cp-active">Active</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="cp-required"
              checked={form.required_on_patrol}
              onCheckedChange={v => setForm(f => ({ ...f, required_on_patrol: v }))}
            />
            <Label htmlFor="cp-required">Required on patrol</Label>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Patrol Checkpoints"
      description="Manage QR/NFC checkpoints for officer lone-worker patrol verification"
    >
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{checkpoints.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">
                {checkpoints.filter(c => c.is_active).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Required</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">
                {checkpoints.filter(c => c.required_on_patrol).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Inactive</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-gray-400">
                {checkpoints.filter(c => !c.is_active).length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search checkpoints…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Button onClick={openCreate} className="ml-auto gap-2">
            <Plus className="h-4 w-4" />
            Add Checkpoint
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Radius</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {search ? 'No checkpoints match your search.' : 'No checkpoints yet. Click "Add Checkpoint" to create one.'}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(cp => (
                  <TableRow key={cp.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <QrCode className="h-4 w-4 text-indigo-500 shrink-0" />
                        {cp.name}
                      </div>
                      {cp.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{cp.description}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {cp.zone ? (
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3" />
                          {cp.zone.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cp.location_lat != null && cp.location_lng != null
                        ? `${cp.location_lat.toFixed(5)}, ${cp.location_lng.toFixed(5)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{cp.check_in_radius_metres}m</TableCell>
                    <TableCell>
                      {cp.is_active ? (
                        <Badge variant="outline" className="text-green-700 border-green-300 gap-1">
                          <CheckCircle className="h-3 w-3" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500 border-gray-300 gap-1">
                          <XCircle className="h-3 w-3" /> Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {cp.required_on_patrol ? (
                        <Badge variant="secondary">Required</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Optional</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(cp.updated_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(cp)}
                        className="mr-1"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDelete(cp)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Patrol Checkpoint</DialogTitle>
            <DialogDescription>
              Create a new QR/NFC checkpoint for officer route verification.
            </DialogDescription>
          </DialogHeader>
          <CheckpointForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Checkpoint'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Checkpoint</DialogTitle>
            <DialogDescription>Update checkpoint details.</DialogDescription>
          </DialogHeader>
          <CheckpointForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button
              onClick={() => selected && updateMutation.mutate({ id: selected.id, f: form })}
              disabled={!form.name.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Checkpoint</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selected?.name}</strong>? All visit records
              for this checkpoint will also be deleted (cascade) and this cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => selected && deleteMutation.mutate(selected.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
