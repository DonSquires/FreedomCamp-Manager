import { useState, useRef } from 'react'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Search, Plus, User, Car, FileText, Eye, Edit, Trash2,
  ShieldAlert, Camera, AlertTriangle, MapPin, Calendar, Ban, X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import {
  usePersonsOfInterest,
  useVehiclesOfInterest,
  useTrespassNotices,
  type PersonOfInterest,
  type VehicleOfInterest,
  type TrespassNotice,
} from '@/hooks/usePointsOfInterest'
import { uploadFile, generateFilePath } from '@/lib/fileUpload'

// ── Status badge helpers ─────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  poi: { label: 'Person of Interest', variant: 'secondary' },
  voi: { label: 'Vehicle of Interest', variant: 'secondary' },
  banned: { label: 'Banned', variant: 'destructive' },
  trespassed: { label: 'Trespassed', variant: 'destructive' },
}

const NOTICE_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { label: 'Active', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'outline' },
  withdrawn: { label: 'Withdrawn', variant: 'secondary' },
  appealed: { label: 'Appealed', variant: 'default' },
}

// ── Blank forms ──────────────────────────────────────────────────────────────

const BLANK_PERSON: Partial<PersonOfInterest> = {
  full_name: '', date_of_birth: null, description: '', gender: '', ethnicity: '',
  height_cm: null, weight_kg: null, distinguishing_features: '', contact_phone: '',
  contact_email: '', address: '', status: 'poi', reason: '', photos: [], notes: '',
  privacy_notice_given: false, active: true, expires_at: null,
}

const BLANK_VEHICLE: Partial<VehicleOfInterest> = {
  plate_number: '', vehicle_make: '', vehicle_model: '', vehicle_color: '',
  vehicle_year: null, description: '', status: 'voi', reason: '', photos: [], notes: '',
  linked_person_id: null, active: true, expires_at: null,
}

const BLANK_NOTICE: Partial<TrespassNotice> = {
  person_id: null, vehicle_id: null, notice_type: 'written', trespass_from: '',
  trespass_reason: '', legal_basis: 'Trespass Act 1980, Section 3 & 4',
  duration_days: 730, served_method: 'in_person', witness_name: '', witness_present: false,
  photos: [], notes: '', privacy_notice_given: false,
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PointsOfInterest() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master'

  const [tab, setTab] = useState('persons')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  // Persons state
  const [showPersonDialog, setShowPersonDialog] = useState(false)
  const [editPerson, setEditPerson] = useState<Partial<PersonOfInterest>>(BLANK_PERSON)
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null)
  const [viewPerson, setViewPerson] = useState<PersonOfInterest | null>(null)

  // Vehicles state
  const [showVehicleDialog, setShowVehicleDialog] = useState(false)
  const [editVehicle, setEditVehicle] = useState<Partial<VehicleOfInterest>>(BLANK_VEHICLE)
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)

  // Trespass notice state
  const [showNoticeDialog, setShowNoticeDialog] = useState(false)
  const [editNotice, setEditNotice] = useState<Partial<TrespassNotice>>(BLANK_NOTICE)

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoTarget, setPhotoTarget] = useState<'person' | 'vehicle' | 'notice'>('person')

  // Queries
  const { persons, isLoading: loadingPersons, createPerson, updatePerson, deletePerson } =
    usePersonsOfInterest({ search: tab === 'persons' ? search : '', status: tab === 'persons' ? statusFilter : '' })
  const { vehicles, isLoading: loadingVehicles, createVehicle, updateVehicle, deleteVehicle } =
    useVehiclesOfInterest({ search: tab === 'vehicles' ? search : '', status: tab === 'vehicles' ? statusFilter : '' })
  const { notices, isLoading: loadingNotices, createNotice, updateNotice } =
    useTrespassNotices({ status: tab === 'notices' ? statusFilter : '' })

  // ── Photo upload handler ─────────────────────────────────────────────────

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !user?.id) return
    setUploadingPhoto(true)
    const newUrls: string[] = []
    for (const file of Array.from(files)) {
      const path = generateFilePath(user.id, file.name, 'poi')
      const result = await uploadFile({ bucket: 'evidence', path, file })
      if (result.url) newUrls.push(result.url)
    }
    if (photoTarget === 'person') {
      setEditPerson(p => ({ ...p, photos: [...(p.photos || []), ...newUrls] }))
    } else if (photoTarget === 'vehicle') {
      setEditVehicle(v => ({ ...v, photos: [...(v.photos || []), ...newUrls] }))
    } else {
      setEditNotice(n => ({ ...n, photos: [...(n.photos || []), ...newUrls] }))
    }
    setUploadingPhoto(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Person handlers ──────────────────────────────────────────────────────

  const openNewPerson = () => {
    setEditPerson({ ...BLANK_PERSON })
    setEditingPersonId(null)
    setShowPersonDialog(true)
  }

  const openEditPerson = (p: PersonOfInterest) => {
    setEditPerson({ ...p })
    setEditingPersonId(p.id)
    setShowPersonDialog(true)
  }

  const savePerson = () => {
    if (!editPerson.full_name) return
    if (editingPersonId) {
      updatePerson.mutate({ id: editingPersonId, ...editPerson } as PersonOfInterest)
    } else {
      createPerson.mutate(editPerson)
    }
    setShowPersonDialog(false)
  }

  // ── Vehicle handlers ─────────────────────────────────────────────────────

  const openNewVehicle = () => {
    setEditVehicle({ ...BLANK_VEHICLE })
    setEditingVehicleId(null)
    setShowVehicleDialog(true)
  }

  const openEditVehicle = (v: VehicleOfInterest) => {
    setEditVehicle({ ...v })
    setEditingVehicleId(v.id)
    setShowVehicleDialog(true)
  }

  const saveVehicle = () => {
    if (!editVehicle.plate_number) return
    if (editingVehicleId) {
      updateVehicle.mutate({ id: editingVehicleId, ...editVehicle } as VehicleOfInterest)
    } else {
      createVehicle.mutate(editVehicle)
    }
    setShowVehicleDialog(false)
  }

  // ── Trespass notice handler ──────────────────────────────────────────────

  const openNewNotice = (personId?: string, vehicleId?: string) => {
    setEditNotice({ ...BLANK_NOTICE, person_id: personId || null, vehicle_id: vehicleId || null })
    setShowNoticeDialog(true)
  }

  const saveNotice = () => {
    if (!editNotice.trespass_reason) return
    createNotice.mutate(editNotice)
    setShowNoticeDialog(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Points of Interest" description="Manage persons & vehicles of interest, trespass notices">
      {/* Privacy banner */}
      <Card className="border-amber-300 bg-amber-50 mb-4">
        <CardContent className="py-3 px-4 flex items-start gap-2 text-sm text-amber-800">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>NZ Privacy Act 2020 Compliance</strong> — Personal information collected here must comply with Information Privacy Principles (IPPs).
            Ensure: (1) lawful purpose for collection (IPP 1), (2) collect directly from the individual where possible (IPP 2),
            (3) inform the individual of collection & purpose (IPP 3), (4) do not collect more than necessary (IPP 4).
            Data is restricted to authorised users within your organisation only.
          </div>
        </CardContent>
      </Card>

      {/* Hidden file input for photo uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handlePhotoUpload}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <TabsList>
            <TabsTrigger value="persons" className="gap-1"><User className="h-3.5 w-3.5" /> Persons</TabsTrigger>
            <TabsTrigger value="vehicles" className="gap-1"><Car className="h-3.5 w-3.5" /> Vehicles</TabsTrigger>
            <TabsTrigger value="notices" className="gap-1"><FileText className="h-3.5 w-3.5" /> Trespass Notices</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 w-48"
              />
            </div>
            <Select value={statusFilter || 'all'} onValueChange={value => setStatusFilter(value === 'all' ? '' : value)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {tab === 'persons' && <>
                  <SelectItem value="poi">Person of Interest</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                  <SelectItem value="trespassed">Trespassed</SelectItem>
                </>}
                {tab === 'vehicles' && <>
                  <SelectItem value="voi">Vehicle of Interest</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                  <SelectItem value="trespassed">Trespassed</SelectItem>
                </>}
                {tab === 'notices' && <>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="withdrawn">Withdrawn</SelectItem>
                  <SelectItem value="appealed">Appealed</SelectItem>
                </>}
              </SelectContent>
            </Select>
            {tab === 'persons' && (
              <Button size="sm" onClick={openNewPerson}><Plus className="h-4 w-4 mr-1" /> Add Person</Button>
            )}
            {tab === 'vehicles' && (
              <Button size="sm" onClick={openNewVehicle}><Plus className="h-4 w-4 mr-1" /> Add Vehicle</Button>
            )}
            {tab === 'notices' && (
              <Button size="sm" onClick={() => openNewNotice()}><Plus className="h-4 w-4 mr-1" /> Issue Notice</Button>
            )}
          </div>
        </div>

        {/* ── Persons Tab ──────────────────────────────────────────────── */}
        <TabsContent value="persons">
          {loadingPersons ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
          ) : persons.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No persons of interest found</CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {persons.map(p => (
                <Card key={p.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {p.photos?.length ? (
                          <img src={p.photos[0]} alt="" className="h-14 w-14 rounded-lg object-cover border" />
                        ) : (
                          <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center">
                            <User className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{p.full_name}</span>
                            <Badge variant={STATUS_CONFIG[p.status]?.variant || 'secondary'}>
                              {STATUS_CONFIG[p.status]?.label || p.status}
                            </Badge>
                          </div>
                          {p.reason && <p className="text-sm text-muted-foreground mt-0.5">{p.reason}</p>}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {p.date_of_birth && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> DOB: {p.date_of_birth}</span>}
                            {p.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {p.address}</span>}
                            {p.creator && <span>Added by {p.creator.first_name} {p.creator.last_name}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => setViewPerson(p)} title="View details">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEditPerson(p)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openNewNotice(p.id)} title="Issue trespass notice">
                          <Ban className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => deletePerson.mutate(p.id)} title="Delete">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Vehicles Tab ─────────────────────────────────────────────── */}
        <TabsContent value="vehicles">
          {loadingVehicles ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
          ) : vehicles.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No vehicles of interest found</CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {vehicles.map(v => (
                <Card key={v.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {v.photos?.length ? (
                          <img src={v.photos[0]} alt="" className="h-14 w-14 rounded-lg object-cover border" />
                        ) : (
                          <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center">
                            <Car className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-lg">{v.plate_number}</span>
                            <Badge variant={STATUS_CONFIG[v.status]?.variant || 'secondary'}>
                              {STATUS_CONFIG[v.status]?.label || v.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {[v.vehicle_color, v.vehicle_make, v.vehicle_model, v.vehicle_year].filter(Boolean).join(' · ') || 'No vehicle details'}
                          </p>
                          {v.reason && <p className="text-sm text-muted-foreground mt-0.5">{v.reason}</p>}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {v.linked_person && <span className="flex items-center gap-1"><User className="h-3 w-3" /> Linked: {v.linked_person.full_name}</span>}
                            {v.creator && <span>Added by {v.creator.first_name} {v.creator.last_name}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => openEditVehicle(v)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openNewNotice(undefined, v.id)} title="Issue trespass notice">
                          <Ban className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => deleteVehicle.mutate(v.id)} title="Delete">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Trespass Notices Tab ──────────────────────────────────────── */}
        <TabsContent value="notices">
          {loadingNotices ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
          ) : notices.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No trespass notices found</CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {notices.map(n => (
                <Card key={n.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4" />
                          <span className="font-semibold">
                            {n.notice_type === 'verbal' ? 'Verbal Warning' : n.notice_type === 'written' ? 'Written Notice' : 'Permanent Notice'}
                          </span>
                          <Badge variant={NOTICE_STATUS[n.status]?.variant || 'secondary'}>
                            {NOTICE_STATUS[n.status]?.label || n.status}
                          </Badge>
                          {n.reference_number && <span className="text-xs text-muted-foreground font-mono">#{n.reference_number}</span>}
                        </div>
                        <p className="text-sm">{n.trespass_reason}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          {n.person && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {n.person.full_name}</span>}
                          {n.vehicle && <span className="flex items-center gap-1 font-mono"><Car className="h-3 w-3" /> {n.vehicle.plate_number}</span>}
                          {n.zone && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {n.zone.name}</span>}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Issued: {new Date(n.issued_at).toLocaleDateString('en-NZ')}
                          </span>
                          {n.expires_at && (
                            <span>Expires: {new Date(n.expires_at).toLocaleDateString('en-NZ')}</span>
                          )}
                          {n.issuer && <span>By: {n.issuer.first_name} {n.issuer.last_name}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {n.status === 'active' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateNotice.mutate({ id: n.id, status: 'withdrawn' })}
                          >
                            Withdraw
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── View Person Detail Dialog ──────────────────────────────────── */}
      <Dialog open={!!viewPerson} onOpenChange={() => setViewPerson(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Person Details</DialogTitle></DialogHeader>
          {viewPerson && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base">{viewPerson.full_name}</span>
                <Badge variant={STATUS_CONFIG[viewPerson.status]?.variant}>{STATUS_CONFIG[viewPerson.status]?.label}</Badge>
              </div>
              {viewPerson.photos?.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {viewPerson.photos.map((url, i) => (
                    <img key={i} src={url} alt="" className="h-20 w-20 rounded-lg object-cover border" />
                  ))}
                </div>
              )}
              {viewPerson.date_of_birth && <p><strong>Date of Birth:</strong> {viewPerson.date_of_birth}</p>}
              {viewPerson.gender && <p><strong>Gender:</strong> {viewPerson.gender}</p>}
              {viewPerson.ethnicity && <p><strong>Ethnicity:</strong> {viewPerson.ethnicity}</p>}
              {viewPerson.height_cm && <p><strong>Height:</strong> {viewPerson.height_cm} cm</p>}
              {viewPerson.weight_kg && <p><strong>Weight:</strong> {viewPerson.weight_kg} kg</p>}
              {viewPerson.distinguishing_features && <p><strong>Distinguishing Features:</strong> {viewPerson.distinguishing_features}</p>}
              {viewPerson.address && <p><strong>Address:</strong> {viewPerson.address}</p>}
              {viewPerson.reason && <p><strong>Reason:</strong> {viewPerson.reason}</p>}
              {viewPerson.notes && <p><strong>Notes:</strong> {viewPerson.notes}</p>}
              {viewPerson.privacy_notice_given && <p className="text-green-700">✓ Privacy notice given to individual</p>}
              {viewPerson.privacy_lawful_purpose && <p className="text-xs text-muted-foreground">Lawful purpose: {viewPerson.privacy_lawful_purpose}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Person Dialog ───────────────────────────────────── */}
      <Dialog open={showPersonDialog} onOpenChange={setShowPersonDialog}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPersonId ? 'Edit Person of Interest' : 'Add Person of Interest'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Full Name *</Label>
                <Input value={editPerson.full_name || ''} onChange={e => setEditPerson(p => ({ ...p, full_name: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="space-y-1">
                <Label>Date of Birth</Label>
                <Input type="date" value={editPerson.date_of_birth || ''} onChange={e => setEditPerson(p => ({ ...p, date_of_birth: e.target.value || null }))} />
              </div>
              <div className="space-y-1">
                <Label>Gender</Label>
                <Select value={editPerson.gender || ''} onValueChange={v => setEditPerson(p => ({ ...p, gender: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Ethnicity</Label>
                <Input value={editPerson.ethnicity || ''} onChange={e => setEditPerson(p => ({ ...p, ethnicity: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Status *</Label>
                <Select value={editPerson.status || 'poi'} onValueChange={v => setEditPerson(p => ({ ...p, status: v as PersonOfInterest['status'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="poi">Person of Interest</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                    <SelectItem value="trespassed">Trespassed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Height (cm)</Label>
                <Input type="number" value={editPerson.height_cm ?? ''} onChange={e => setEditPerson(p => ({ ...p, height_cm: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              <div className="space-y-1">
                <Label>Weight (kg)</Label>
                <Input type="number" value={editPerson.weight_kg ?? ''} onChange={e => setEditPerson(p => ({ ...p, weight_kg: e.target.value ? Number(e.target.value) : null }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Distinguishing Features</Label>
              <Textarea value={editPerson.distinguishing_features || ''} onChange={e => setEditPerson(p => ({ ...p, distinguishing_features: e.target.value }))} rows={2} placeholder="Tattoos, scars, markings…" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={editPerson.contact_phone || ''} onChange={e => setEditPerson(p => ({ ...p, contact_phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={editPerson.contact_email || ''} onChange={e => setEditPerson(p => ({ ...p, contact_email: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={editPerson.address || ''} onChange={e => setEditPerson(p => ({ ...p, address: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>Reason for Flagging *</Label>
              <Textarea value={editPerson.reason || ''} onChange={e => setEditPerson(p => ({ ...p, reason: e.target.value }))} rows={2} placeholder="Why this person is of interest…" />
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={editPerson.notes || ''} onChange={e => setEditPerson(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>

            {/* Photos */}
            <div className="space-y-1">
              <Label>Photos</Label>
              <div className="flex gap-2 flex-wrap">
                {(editPerson.photos || []).map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt="" className="h-16 w-16 rounded object-cover border" />
                    <button
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                      onClick={() => setEditPerson(p => ({ ...p, photos: (p.photos || []).filter((_, j) => j !== i) }))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm" className="h-16 w-16"
                  disabled={uploadingPhoto}
                  onClick={() => { setPhotoTarget('person'); fileInputRef.current?.click() }}
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Privacy compliance */}
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="py-2 px-3 space-y-2">
                <p className="text-xs font-medium text-blue-800">NZ Privacy Act 2020 Compliance</p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="privacy_notice"
                    checked={editPerson.privacy_notice_given || false}
                    onCheckedChange={(c: boolean) => setEditPerson(p => ({ ...p, privacy_notice_given: !!c }))}
                  />
                  <Label htmlFor="privacy_notice" className="text-xs">Individual was informed of collection and its purpose (IPP 3)</Label>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowPersonDialog(false)}>Cancel</Button>
              <Button onClick={savePerson} disabled={!editPerson.full_name || createPerson.isPending || updatePerson.isPending}>
                {editingPersonId ? 'Update' : 'Add Person'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Vehicle Dialog ──────────────────────────────────── */}
      <Dialog open={showVehicleDialog} onOpenChange={setShowVehicleDialog}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVehicleId ? 'Edit Vehicle of Interest' : 'Add Vehicle of Interest'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Plate Number *</Label>
                <Input
                  value={editVehicle.plate_number || ''}
                  onChange={e => setEditVehicle(v => ({ ...v, plate_number: e.target.value.toUpperCase() }))}
                  placeholder="ABC123"
                  className="font-mono uppercase"
                  maxLength={8}
                />
              </div>
              <div className="space-y-1">
                <Label>Status *</Label>
                <Select value={editVehicle.status || 'voi'} onValueChange={v => setEditVehicle(p => ({ ...p, status: v as VehicleOfInterest['status'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="voi">Vehicle of Interest</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                    <SelectItem value="trespassed">Trespassed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Make</Label>
                <Input value={editVehicle.vehicle_make || ''} onChange={e => setEditVehicle(v => ({ ...v, vehicle_make: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Model</Label>
                <Input value={editVehicle.vehicle_model || ''} onChange={e => setEditVehicle(v => ({ ...v, vehicle_model: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Color</Label>
                <Input value={editVehicle.vehicle_color || ''} onChange={e => setEditVehicle(v => ({ ...v, vehicle_color: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Year</Label>
                <Input type="number" value={editVehicle.vehicle_year ?? ''} onChange={e => setEditVehicle(v => ({ ...v, vehicle_year: e.target.value ? Number(e.target.value) : null }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Reason for Flagging *</Label>
              <Textarea value={editVehicle.reason || ''} onChange={e => setEditVehicle(v => ({ ...v, reason: e.target.value }))} rows={2} />
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={editVehicle.notes || ''} onChange={e => setEditVehicle(v => ({ ...v, notes: e.target.value }))} rows={2} />
            </div>

            {/* Link to POI */}
            {persons.length > 0 && (
              <div className="space-y-1">
                <Label>Link to Person of Interest</Label>
                <Select
                  value={editVehicle.linked_person_id || 'none'}
                  onValueChange={v => setEditVehicle(p => ({ ...p, linked_person_id: v === 'none' ? null : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {persons.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Photos */}
            <div className="space-y-1">
              <Label>Photos</Label>
              <div className="flex gap-2 flex-wrap">
                {(editVehicle.photos || []).map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt="" className="h-16 w-16 rounded object-cover border" />
                    <button
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                      onClick={() => setEditVehicle(v => ({ ...v, photos: (v.photos || []).filter((_, j) => j !== i) }))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm" className="h-16 w-16"
                  disabled={uploadingPhoto}
                  onClick={() => { setPhotoTarget('vehicle'); fileInputRef.current?.click() }}
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowVehicleDialog(false)}>Cancel</Button>
              <Button onClick={saveVehicle} disabled={!editVehicle.plate_number || createVehicle.isPending || updateVehicle.isPending}>
                {editingVehicleId ? 'Update' : 'Add Vehicle'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Issue Trespass Notice Dialog ────────────────────────────────── */}
      <Dialog open={showNoticeDialog} onOpenChange={setShowNoticeDialog}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Issue Trespass Notice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Card className="border-red-200 bg-red-50">
              <CardContent className="py-2 px-3 text-xs text-red-800">
                <strong>NZ Trespass Act 1980</strong> — A written trespass notice must identify the land from which the person is trespassed,
                be given to the person directly or posted, and is valid for a maximum of 2 years. Breach of a trespass notice is an offence
                under s.11 (max fine $1,000 or 3 months imprisonment).
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Notice Type *</Label>
                <Select value={editNotice.notice_type || 'written'} onValueChange={v => setEditNotice(n => ({ ...n, notice_type: v as TrespassNotice['notice_type'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verbal">Verbal Warning</SelectItem>
                    <SelectItem value="written">Written Notice</SelectItem>
                    <SelectItem value="permanent">Permanent Notice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Duration (days)</Label>
                <Input type="number" value={editNotice.duration_days ?? 730} onChange={e => setEditNotice(n => ({ ...n, duration_days: Number(e.target.value) }))} max={730} />
                <p className="text-xs text-muted-foreground">Max 730 days (2 years) per NZ Trespass Act</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Trespass From (Location / Land Description) *</Label>
              <Input value={editNotice.trespass_from || ''} onChange={e => setEditNotice(n => ({ ...n, trespass_from: e.target.value }))} placeholder="Description of land or zone" />
            </div>

            <div className="space-y-1">
              <Label>Reason for Trespass *</Label>
              <Textarea value={editNotice.trespass_reason || ''} onChange={e => setEditNotice(n => ({ ...n, trespass_reason: e.target.value }))} rows={3} placeholder="Reason for issuing trespass notice…" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Served Method</Label>
                <Select value={editNotice.served_method || 'in_person'} onValueChange={v => setEditNotice(n => ({ ...n, served_method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_person">In Person</SelectItem>
                    <SelectItem value="posted">Posted / Mail</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="left_on_vehicle">Left on Vehicle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Reference Number</Label>
                <Input value={editNotice.reference_number || ''} onChange={e => setEditNotice(n => ({ ...n, reference_number: e.target.value }))} placeholder="TN-001" />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Witness</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="witness"
                    checked={editNotice.witness_present || false}
                    onCheckedChange={(c: boolean) => setEditNotice(n => ({ ...n, witness_present: !!c }))}
                  />
                  <Label htmlFor="witness" className="text-sm">Witness present</Label>
                </div>
                {editNotice.witness_present && (
                  <Input
                    value={editNotice.witness_name || ''}
                    onChange={e => setEditNotice(n => ({ ...n, witness_name: e.target.value }))}
                    placeholder="Witness name"
                    className="flex-1"
                  />
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={editNotice.notes || ''} onChange={e => setEditNotice(n => ({ ...n, notes: e.target.value }))} rows={2} />
            </div>

            {/* Photos */}
            <div className="space-y-1">
              <Label>Evidence Photos</Label>
              <div className="flex gap-2 flex-wrap">
                {(editNotice.photos || []).map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt="" className="h-16 w-16 rounded object-cover border" />
                    <button
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                      onClick={() => setEditNotice(n => ({ ...n, photos: (n.photos || []).filter((_, j) => j !== i) }))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm" className="h-16 w-16"
                  disabled={uploadingPhoto}
                  onClick={() => { setPhotoTarget('notice'); fileInputRef.current?.click() }}
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Privacy compliance */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="privacy_tn"
                checked={editNotice.privacy_notice_given || false}
                onCheckedChange={(c: boolean) => setEditNotice(n => ({ ...n, privacy_notice_given: !!c }))}
              />
              <Label htmlFor="privacy_tn" className="text-xs">Individual was informed of trespass notice and their rights (NZ Privacy Act IPP 3)</Label>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowNoticeDialog(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={saveNotice}
                disabled={!editNotice.trespass_reason || createNotice.isPending}
              >
                Issue Trespass Notice
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
