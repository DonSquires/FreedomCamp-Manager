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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  Users,
  Search,
  Plus,
  User,
  Car,
  MapPin,
  Calendar,
  Edit,
  Home,
  Phone,
  Mail,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface Person {
  id: string
  full_name: string
  date_of_birth: string | null
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  homeless_status: string | null
  notes: string | null
  created_at: string
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

const HOMELESS_STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  suspected:  { label: 'Suspected',  variant: 'secondary' },
  confirmed:  { label: 'Confirmed',  variant: 'default' },
  cleared:    { label: 'Cleared',    variant: 'outline' },
  unknown:    { label: 'Unknown',    variant: 'outline' },
}

const BLANK_FORM = {
  full_name: '',
  date_of_birth: '',
  contact_email: '',
  contact_phone: '',
  address: '',
  homeless_status: '',
  notes: '',
}

export default function PersonRecords() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [homelessFilter, setHomelessFilter] = useState('all')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Person | null>(null)
  const [viewTarget, setViewTarget] = useState<Person | null>(null)
  const [form, setForm] = useState(BLANK_FORM)

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id

  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['person-records', orgId, homelessFilter, search],
    queryFn: async () => {
      let q = (supabase
        .from('person_records') as any)
        .select('id, full_name, date_of_birth, contact_email, contact_phone, address, homeless_status, notes, created_at')
        .order('full_name')
        .limit(200)

      if (homelessFilter !== 'all') q = q.eq('homeless_status', homelessFilter)
      if (search) q = q.ilike('full_name', `%${search}%`)

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
        full_name: form.full_name.trim(),
        date_of_birth: form.date_of_birth || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        address: form.address || null,
        homeless_status: form.homeless_status || null,
        notes: form.notes || null,
      }
      if (isEdit && editTarget) {
        const { error } = await (supabase.from('person_records') as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editTarget.id)
        if (error) throw error
      } else {
        const { error } = await (supabase.from('person_records') as any)
          .insert(payload)
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
      full_name: p.full_name,
      date_of_birth: p.date_of_birth || '',
      contact_email: p.contact_email || '',
      contact_phone: p.contact_phone || '',
      address: p.address || '',
      homeless_status: p.homeless_status || '',
      notes: p.notes || '',
    })
    setIsCreateOpen(true)
  }

  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role || '')

  const stats = {
    total: persons.length,
    homeless: persons.filter(p => p.homeless_status === 'confirmed').length,
    suspected: persons.filter(p => p.homeless_status === 'suspected').length,
  }

  const FormDialog = () => (
    <Dialog open={isCreateOpen} onOpenChange={open => { if (!open) { setIsCreateOpen(false); setEditTarget(null); setForm(BLANK_FORM) } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editTarget ? 'Edit Person' : 'Add Person Record'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Full Name *</Label>
            <Input
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Full name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input
                type="date"
                value={form.date_of_birth}
                onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Homeless Status</Label>
              <Select
                value={form.homeless_status || 'none'}
                onValueChange={v => setForm(f => ({ ...f, homeless_status: v === 'none' ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unknown" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unknown</SelectItem>
                  <SelectItem value="suspected">Suspected</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="cleared">Cleared</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Contact Phone</Label>
            <Input
              value={form.contact_phone}
              onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
              placeholder="+64 21 xxx xxxx"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact Email</Label>
            <Input
              type="email"
              value={form.contact_email}
              onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
              placeholder="email@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Last known address"
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
            disabled={!form.full_name.trim() || savePerson.isPending}
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
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Records', value: stats.total, icon: <Users className="h-5 w-5 text-blue-600" /> },
          { label: 'Homeless Confirmed', value: stats.homeless, icon: <Home className="h-5 w-5 text-orange-500" /> },
          { label: 'Suspected', value: stats.suspected, icon: <User className="h-5 w-5 text-yellow-500" /> },
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
        <Select value={homelessFilter} onValueChange={setHomelessFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed homeless</SelectItem>
            <SelectItem value="suspected">Suspected</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
          </SelectContent>
        </Select>
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
            const hMeta = p.homeless_status ? HOMELESS_STATUS_META[p.homeless_status] : null
            return (
              <Card key={p.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{p.full_name}</span>
                        {hMeta && <Badge variant={hMeta.variant} className="text-xs">{hMeta.label}</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {p.contact_phone && (
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{p.contact_phone}</span>
                        )}
                        {p.contact_email && (
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{p.contact_email}</span>
                        )}
                        {p.address && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.address}</span>
                        )}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {viewTarget?.full_name}
            </DialogTitle>
            {viewTarget?.homeless_status && (
              <DialogDescription>
                Homeless status: {viewTarget.homeless_status}
              </DialogDescription>
            )}
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
