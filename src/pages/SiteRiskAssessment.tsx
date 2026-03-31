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
import { Checkbox } from '@/components/ui/checkbox'
import {
  ClipboardCheck, Plus, Search, Eye, Edit, Camera, MapPin, Calendar,
  AlertTriangle, ShieldCheck, X, CheckCircle, FileText,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import {
  useSiteRiskAssessments,
  HAZARD_CATEGORIES,
  PPE_OPTIONS,
  CHECKLIST_ITEMS,
  type SiteRiskAssessment,
} from '@/hooks/useSiteRiskAssessment'
import { uploadFile, generateFilePath } from '@/lib/fileUpload'

// ── Risk level styling ───────────────────────────────────────────────────────

const RISK_STYLES: Record<string, { label: string; color: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  low: { label: 'Low', color: 'text-green-700 bg-green-50 border-green-200', variant: 'secondary' },
  medium: { label: 'Medium', color: 'text-amber-700 bg-amber-50 border-amber-200', variant: 'default' },
  high: { label: 'High', color: 'text-orange-700 bg-orange-50 border-orange-200', variant: 'destructive' },
  critical: { label: 'Critical', color: 'text-red-700 bg-red-50 border-red-200', variant: 'destructive' },
}

const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  submitted: { label: 'Submitted', variant: 'default' },
  reviewed: { label: 'Reviewed', variant: 'secondary' },
  archived: { label: 'Archived', variant: 'outline' },
}

// ── Blank form ───────────────────────────────────────────────────────────────

function blankAssessment(): Partial<SiteRiskAssessment> {
  return {
    site_name: '',
    site_address: '',
    request_type: 'adhoc',
    overall_risk_level: 'low',
    job_reference: '',
    gps_latitude: null,
    gps_longitude: null,
    // Hazard checkboxes
    hazard_slips_trips_falls: false,
    hazard_working_at_height: false,
    hazard_manual_handling: false,
    hazard_vehicles_traffic: false,
    hazard_electrical: false,
    hazard_fire: false,
    hazard_hazardous_substances: false,
    hazard_confined_spaces: false,
    hazard_noise: false,
    hazard_weather_exposure: false,
    hazard_biological: false,
    hazard_lone_working: false,
    hazard_aggressive_persons: false,
    hazard_animals: false,
    hazard_water_drowning: false,
    hazard_poor_lighting: false,
    hazard_uneven_terrain: false,
    hazard_other: false,
    hazard_other_description: '',
    // Controls
    controls_in_place: '',
    additional_controls: '',
    ppe_required: [],
    // Checklist
    emergency_plan_sighted: false,
    first_aid_available: false,
    communication_coverage: false,
    safe_parking_available: false,
    site_access_clear: false,
    signage_adequate: false,
    // Evidence
    photos: [],
    notes: '',
    status: 'draft',
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SiteRiskAssessmentPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [riskFilter, setRiskFilter] = useState<string>('')

  const [showDialog, setShowDialog] = useState(false)
  const [form, setForm] = useState<Partial<SiteRiskAssessment>>(blankAssessment())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [viewAssessment, setViewAssessment] = useState<SiteRiskAssessment | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const { assessments, isLoading, createAssessment, updateAssessment, submitAssessment, reviewAssessment } =
    useSiteRiskAssessments({ status: statusFilter || undefined, riskLevel: riskFilter || undefined })

  // Filter by search
  const filtered = search
    ? assessments.filter(a =>
        a.site_name.toLowerCase().includes(search.toLowerCase()) ||
        a.site_address?.toLowerCase().includes(search.toLowerCase()) ||
        a.job_reference?.toLowerCase().includes(search.toLowerCase())
      )
    : assessments

  // ── Photo upload ─────────────────────────────────────────────────────────

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !user?.id) return
    setUploadingPhoto(true)
    const newUrls: string[] = []
    for (const file of Array.from(files)) {
      const path = generateFilePath(user.id, file.name, 'risk-assessment')
      const result = await uploadFile({ bucket: 'evidence', path, file })
      if (result.url) newUrls.push(result.url)
    }
    setForm(f => ({ ...f, photos: [...(f.photos || []), ...newUrls] }))
    setUploadingPhoto(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const openNew = () => {
    setForm(blankAssessment())
    setEditingId(null)
    setShowDialog(true)
  }

  const openEdit = (a: SiteRiskAssessment) => {
    setForm({ ...a })
    setEditingId(a.id)
    setShowDialog(true)
  }

  const save = () => {
    if (!form.site_name) return
    if (editingId) {
      updateAssessment.mutate({ id: editingId, ...form } as SiteRiskAssessment)
    } else {
      createAssessment.mutate(form)
    }
    setShowDialog(false)
  }

  // Count active hazards
  const countHazards = (a: SiteRiskAssessment | Partial<SiteRiskAssessment>) =>
    HAZARD_CATEGORIES.filter(h => a[h.key as keyof typeof a]).length

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Site Risk Assessment" description="NZ WorkSafe HSWA 2015 guided risk evaluations">
      {/* NZ WorkSafe banner */}
      <Card className="border-blue-300 bg-blue-50 mb-4">
        <CardContent className="py-3 px-4 flex items-start gap-2 text-sm text-blue-800">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>NZ WorkSafe HSWA 2015</strong> — Site risk assessments follow the Health and Safety at Work Act 2015 requirements.
            Identify hazards, assess risks, and implement controls before commencing work. PCBUs have a primary duty of care to
            ensure worker safety so far as is reasonably practicable.
          </div>
        </CardContent>
      </Card>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search sites…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-48" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="All status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="All risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> New Assessment</Button>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No risk assessments found</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(a => {
            const risk = RISK_STYLES[a.overall_risk_level] || RISK_STYLES.low
            const stat = STATUS_STYLES[a.status] || STATUS_STYLES.draft
            const hazardCount = countHazards(a)
            return (
              <Card key={a.id} className={`hover:shadow-md transition-shadow border-l-4 ${risk.color}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <ClipboardCheck className="h-4 w-4" />
                        <span className="font-semibold">{a.site_name}</span>
                        <Badge variant={risk.variant}>{risk.label} Risk</Badge>
                        <Badge variant={stat.variant}>{stat.label}</Badge>
                      </div>
                      {a.site_address && <p className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {a.site_address}</p>}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(a.assessment_date).toLocaleDateString('en-NZ')}</span>
                        <span>{hazardCount} hazard{hazardCount !== 1 ? 's' : ''} identified</span>
                        {a.request_type !== 'adhoc' && <span className="capitalize">{a.request_type.replace(/_/g, ' ')}</span>}
                        {a.job_reference && <span className="font-mono">Ref: {a.job_reference}</span>}
                        {a.assessor && <span>By: {a.assessor.first_name} {a.assessor.last_name}</span>}
                        {a.zone && <span>Zone: {a.zone.name}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => setViewAssessment(a)} title="View"><Eye className="h-4 w-4" /></Button>
                      {a.status === 'draft' && (
                        <Button variant="ghost" size="icon" onClick={() => openEdit(a)} title="Edit"><Edit className="h-4 w-4" /></Button>
                      )}
                      {a.status === 'draft' && (
                        <Button variant="outline" size="sm" onClick={() => submitAssessment.mutate(a.id)}>Submit</Button>
                      )}
                      {a.status === 'submitted' && isAdmin && (
                        <Button variant="outline" size="sm" onClick={() => reviewAssessment.mutate(a.id)}>Review</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── View Assessment Detail Dialog ──────────────────────────────── */}
      <Dialog open={!!viewAssessment} onOpenChange={() => setViewAssessment(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Risk Assessment Details</DialogTitle></DialogHeader>
          {viewAssessment && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base">{viewAssessment.site_name}</span>
                <Badge variant={RISK_STYLES[viewAssessment.overall_risk_level]?.variant}>
                  {RISK_STYLES[viewAssessment.overall_risk_level]?.label} Risk
                </Badge>
                <Badge variant={STATUS_STYLES[viewAssessment.status]?.variant}>
                  {STATUS_STYLES[viewAssessment.status]?.label}
                </Badge>
              </div>

              {viewAssessment.site_address && <p><strong>Address:</strong> {viewAssessment.site_address}</p>}
              {viewAssessment.job_reference && <p><strong>Job Reference:</strong> {viewAssessment.job_reference}</p>}
              <p><strong>Type:</strong> {viewAssessment.request_type.replace(/_/g, ' ')}</p>
              <p><strong>Date:</strong> {new Date(viewAssessment.assessment_date).toLocaleDateString('en-NZ')}</p>

              {/* Hazards */}
              <div>
                <strong>Hazards Identified:</strong>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {HAZARD_CATEGORIES.filter(h => viewAssessment[h.key as keyof SiteRiskAssessment]).map(h => (
                    <Badge key={h.key} variant="outline" className="text-xs">{h.icon} {h.label}</Badge>
                  ))}
                  {countHazards(viewAssessment) === 0 && <span className="text-muted-foreground">None identified</span>}
                </div>
                {viewAssessment.hazard_other && viewAssessment.hazard_other_description && (
                  <p className="mt-1 text-muted-foreground">Other: {viewAssessment.hazard_other_description}</p>
                )}
              </div>

              {/* Controls */}
              {viewAssessment.controls_in_place && <p><strong>Controls in Place:</strong> {viewAssessment.controls_in_place}</p>}
              {viewAssessment.additional_controls && <p><strong>Additional Controls Needed:</strong> {viewAssessment.additional_controls}</p>}

              {/* PPE */}
              {viewAssessment.ppe_required?.length > 0 && (
                <div>
                  <strong>PPE Required:</strong>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {viewAssessment.ppe_required.map(p => <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>)}
                  </div>
                </div>
              )}

              {/* Checklist */}
              <div>
                <strong>Safety Checklist:</strong>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {CHECKLIST_ITEMS.map(c => (
                    <div key={c.key} className="flex items-center gap-1.5 text-xs">
                      {viewAssessment[c.key as keyof SiteRiskAssessment]
                        ? <CheckCircle className="h-3 w-3 text-green-500" />
                        : <X className="h-3 w-3 text-red-400" />}
                      <span>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Photos */}
              {viewAssessment.photos?.length > 0 && (
                <div>
                  <strong>Photos:</strong>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {viewAssessment.photos.map((url, i) => (
                      <img key={i} src={url} alt="" className="h-24 w-24 rounded-lg object-cover border" />
                    ))}
                  </div>
                </div>
              )}

              {viewAssessment.notes && <p><strong>Notes:</strong> {viewAssessment.notes}</p>}
              {viewAssessment.assessor && <p><strong>Assessed by:</strong> {viewAssessment.assessor.first_name} {viewAssessment.assessor.last_name}</p>}
              {viewAssessment.reviewer && <p><strong>Reviewed by:</strong> {viewAssessment.reviewer.first_name} {viewAssessment.reviewer.last_name}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── New / Edit Assessment Dialog ───────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Risk Assessment' : 'New Site Risk Assessment'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Site info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Site Name *</Label>
                <Input value={form.site_name || ''} onChange={e => setForm(f => ({ ...f, site_name: e.target.value }))} placeholder="Site name" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Site Address</Label>
                <Input value={form.site_address || ''} onChange={e => setForm(f => ({ ...f, site_address: e.target.value }))} placeholder="Full address" />
              </div>
              <div className="space-y-1">
                <Label>Request Type</Label>
                <Select value={form.request_type || 'adhoc'} onValueChange={v => setForm(f => ({ ...f, request_type: v as SiteRiskAssessment['request_type'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adhoc">Ad-hoc</SelectItem>
                    <SelectItem value="organisation_request">Organisation Request</SelectItem>
                    <SelectItem value="service_provider_request">Service Provider Request</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Job Reference</Label>
                <Input value={form.job_reference || ''} onChange={e => setForm(f => ({ ...f, job_reference: e.target.value }))} placeholder="Optional reference" />
              </div>
              <div className="space-y-1">
                <Label>Overall Risk Level *</Label>
                <Select value={form.overall_risk_level || 'low'} onValueChange={v => setForm(f => ({ ...f, overall_risk_level: v as SiteRiskAssessment['overall_risk_level'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">🟢 Low</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="high">🟠 High</SelectItem>
                    <SelectItem value="critical">🔴 Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Hazard Identification */}
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Hazard Identification (NZ WorkSafe Categories)
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 px-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {HAZARD_CATEGORIES.map(h => (
                    <div key={h.key} className="flex items-center gap-2">
                      <Checkbox
                        id={h.key}
                        checked={!!form[h.key as keyof typeof form]}
                        onCheckedChange={(c: boolean) => setForm(f => ({ ...f, [h.key]: !!c }))}
                      />
                      <Label htmlFor={h.key} className="text-xs cursor-pointer">{h.icon} {h.label}</Label>
                    </div>
                  ))}
                </div>
                {form.hazard_other && (
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs">Describe other hazard</Label>
                    <Input value={form.hazard_other_description || ''} onChange={e => setForm(f => ({ ...f, hazard_other_description: e.target.value }))} placeholder="Describe…" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Controls */}
            <div className="space-y-1">
              <Label>Controls Currently in Place</Label>
              <Textarea value={form.controls_in_place || ''} onChange={e => setForm(f => ({ ...f, controls_in_place: e.target.value }))} rows={2} placeholder="Existing safety measures…" />
            </div>
            <div className="space-y-1">
              <Label>Additional Controls Required</Label>
              <Textarea value={form.additional_controls || ''} onChange={e => setForm(f => ({ ...f, additional_controls: e.target.value }))} rows={2} placeholder="Recommended additional measures…" />
            </div>

            {/* PPE */}
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">PPE Required</CardTitle>
              </CardHeader>
              <CardContent className="py-2 px-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {PPE_OPTIONS.map(ppe => (
                    <div key={ppe} className="flex items-center gap-2">
                      <Checkbox
                        id={`ppe-${ppe}`}
                        checked={(form.ppe_required || []).includes(ppe)}
                        onCheckedChange={(c: boolean) => {
                          setForm(f => ({
                            ...f,
                            ppe_required: c
                              ? [...(f.ppe_required || []), ppe]
                              : (f.ppe_required || []).filter(p => p !== ppe),
                          }))
                        }}
                      />
                      <Label htmlFor={`ppe-${ppe}`} className="text-xs cursor-pointer">{ppe}</Label>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Safety Checklist */}
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Safety Checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 px-3">
                <div className="grid grid-cols-2 gap-2">
                  {CHECKLIST_ITEMS.map(c => (
                    <div key={c.key} className="flex items-center gap-2">
                      <Checkbox
                        id={c.key}
                        checked={!!form[c.key as keyof typeof form]}
                        onCheckedChange={(ch: boolean) => setForm(f => ({ ...f, [c.key]: !!ch }))}
                      />
                      <Label htmlFor={c.key} className="text-xs cursor-pointer">{c.label}</Label>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Photos */}
            <div className="space-y-1">
              <Label>Site Photos</Label>
              <div className="flex gap-2 flex-wrap">
                {(form.photos || []).map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt="" className="h-16 w-16 rounded object-cover border" />
                    <button
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                      onClick={() => setForm(f => ({ ...f, photos: (f.photos || []).filter((_, j) => j !== i) }))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm" className="h-16 w-16"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label>Additional Notes</Label>
              <Textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={save} disabled={!form.site_name || createAssessment.isPending || updateAssessment.isPending}>
                {editingId ? 'Update Assessment' : 'Save Assessment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
