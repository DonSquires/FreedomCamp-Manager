import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  Users,
  Search,
  Plus,
  User,
  Car,
  MapPin,
  Calendar,
  Edit,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface Person {
  id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  notes: string | null
  created_at: string
}

// Display helper
function displayName(p: { first_name: string | null; last_name: string | null }): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || '(No name)'
}

interface PersonObservation {
  id: string
  recorded_at: string
  officer_notes: string | null
  zone: { name: string } | null
  observed_by_user: { first_name: string; last_name: string } | null
}

interface PersonVehicleLink {
  plate_number: string
  relationship_type: string | null
  linked_at: string
}

const BLANK_FORM = {
  first_name: '',
  last_name: '',
  date_of_birth: '',
  notes: '',
}

export default function PersonRecords() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Person | null>(null)
  const [viewTarget, setViewTarget] = useState<Person | null>(null)
  const [form, setForm] = useState(BLANK_FORM)

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id

  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['person-records', orgId, search],
    queryFn: async () => {
      let q = (supabase
        .from('person_records') as any)
        .select('id, first_name, last_name, date_of_birth, notes, created_at')
        .order('last_name', { ascending: true })
        .limit(200)

      if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as Person[]
    },
    enabled: !!user,
  })

  // Fetch observations for selected person
  const { data: selectedObs = [] } = useQuery({
    queryKey: ['person-observations', viewTarget?.id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('person_observations') as any)
        .select(`
          id, recorded_at, officer_notes,
          zone:zones!zone_id(name),
          observed_by_user:user_profiles!person_observations_recorded_by_fkey(first_name, last_name)
        `)
        .eq('person_id', viewTarget!.id)
        .order('recorded_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data || []) as unknown as PersonObservation[]
    },
    enabled: !!viewTarget,
  })

  // Fetch vehicle links for selected person
  const { data: vehicleLinks = [] } = useQuery({
    queryKey: ['person-vehicle-links', viewTarget?.id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('person_vehicle_links' as any) as any)
        .select('plate_number, relationship_type, linked_at')
        .eq('person_id', viewTarget!.id)
        .order('linked_at', { ascending: false })
      if (error) throw error
      return (data || []) as PersonVehicleLink[]
    },
    enabled: !!viewTarget,
  })

  // Fetch canonical_homeless status for all plates linked to the selected person
  const { data: canonicalHomelessMap = {} } = useQuery({
    queryKey: ['person-canonical-homeless', viewTarget?.id, vehicleLinks.map(v => v.plate_number).join(',')],
    queryFn: async () => {
      const plates = vehicleLinks.map(v => v.plate_number).filter(Boolean)
      if (plates.length === 0) return {}
      const { data, error } = await supabase
        .from('canonical_homeless')
        .select('plate_number, status, confirmed_at')
        .in('plate_number', plates)
      if (error) throw error
      return Object.fromEntries((data || []).map(r => [r.plate_number, r]))
    },
    enabled: !!viewTarget && vehicleLinks.length > 0,
  })

  const savePerson = useMutation({
    mutationFn: async (isEdit: boolean) => {
      const payload = {
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        date_of_birth: form.date_of_birth || null,
        notes: form.notes || null,
      }
      if (isEdit && editTarget) {
        const { error } = await (supabase.from('person_records') as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editTarget.id)
        if (error) throw error
      } else {
        const { error } = await (supabase.from('person_records') as any)
          .insert({ ...payload, organization_id: orgId || null })
        if (error) throw error
      }
    },
    onSuccess: (_, isEdit) => {
      toast.success(isEdit ? 'Person updated' : 'Person created')
      setIsCreateOpen(false)
      setEditTarget(null)
      setForm(BLANK_FORM)
      queryClient.invalidateQueries({ queryKey: ['person-records'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const handleEdit = (p: Person) => {
    setEditTarget(p)
    setForm({
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      date_of_birth: p.date_of_birth || '',
      notes: p.notes || '',
    })
    setIsCreateOpen(true)
  }

  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role || '')

  const stats = {
    total: persons.length,
  }

  const FormDialog = () => (
    <Dialog open={isCreateOpen} onOpenChange={open => { if (!open) { setIsCreateOpen(false); setEditTarget(null); setForm(BLANK_FORM) } }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editTarget ? 'Edit Person' : 'Add Person Record'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input
                value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                placeholder="First name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input
                value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                placeholder="Last name"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Date of Birth</Label>
            <Input
              type="date"
              value={form.date_of_birth}
              onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Additional notes…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditTarget(null); setForm(BLANK_FORM) }}>Cancel</Button>
          <Button
            onClick={() => savePerson.mutate(!!editTarget)}
            disabled={!form.first_name.trim() || savePerson.isPending}
          >
            {savePerson.isPending ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Person'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return (
    <AppLayout title="Person Records" description="Manage canonical person records and observations">
      <GlobalFilterRibbon />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 mb-6">
        {[
          { label: 'Total Records', value: stats.total, icon: <Users className="h-5 w-5 text-blue-600" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {isAdmin && (
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Person
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : persons.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No person records found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {persons.map(p => {
            return (
              <Card key={p.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{displayName(p)}</span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Added {formatDateTime(p.created_at)}
                        </span>
                      </div>
                      {p.notes && <p className="text-xs text-muted-foreground line-clamp-1">{p.notes}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setViewTarget(p)}>
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        View
                      </Button>
                      {isAdmin && (
                        <Button size="sm" variant="outline" onClick={() => handleEdit(p)}>
                          <Edit className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <FormDialog />

      {/* View person dialog */}
      <Dialog open={!!viewTarget} onOpenChange={() => setViewTarget(null)}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {viewTarget ? displayName(viewTarget) : ''}
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="observations">
            <TabsList>
              <TabsTrigger value="observations">Observations ({selectedObs.length})</TabsTrigger>
              <TabsTrigger value="vehicles">Linked Vehicles ({vehicleLinks.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="observations" className="mt-3 max-h-64 overflow-y-auto space-y-2">
              {selectedObs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No observations recorded</p>
              ) : selectedObs.map(o => (
                <div key={o.id} className="border rounded p-2 text-sm">
                  <div className="flex items-center gap-2">
                    {o.zone && <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" />{o.zone.name}</span>}
                    <span className="text-muted-foreground">{formatDateTime(o.recorded_at)}</span>
                  </div>
                  {o.officer_notes && <p className="mt-1 text-muted-foreground line-clamp-2">{o.officer_notes}</p>}
                </div>
              ))}
            </TabsContent>
            <TabsContent value="vehicles" className="mt-3 max-h-64 overflow-y-auto space-y-2">
              {vehicleLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No linked vehicles</p>
              ) : vehicleLinks.map(v => {
                const homeless = (canonicalHomelessMap as any)[v.plate_number]
                return (
                  <div key={v.plate_number} className="border rounded p-2 text-sm flex items-center gap-2 flex-wrap">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono font-bold">{v.plate_number}</span>
                    {v.relationship_type && <Badge variant="outline" className="text-xs">{v.relationship_type}</Badge>}
                    {homeless && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          homeless.status === 'confirmed' ? 'bg-orange-50 text-orange-700 border-orange-300' :
                          homeless.status === 'suspected' ? 'bg-amber-50 text-amber-700 border-amber-300' :
                          homeless.status === 'cleared' ? 'bg-green-50 text-green-700 border-green-300' :
                          'bg-gray-50 text-gray-600 border-gray-300'
                        }`}
                      >
                        🏕️ Homeless: {homeless.status}
                      </Badge>
                    )}
                  </div>
                )
              })}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
            {isAdmin && (
              <Button onClick={() => { setViewTarget(null); handleEdit(viewTarget!) }}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
