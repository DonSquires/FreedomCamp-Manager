/**
 * SiteGuardPortal
 *
 * Dashboard for a static guard (or guarding-rostered patrol officer) assigned
 * to a specific client site.
 *
 * Features:
 *   • Site info header with geofence status indicator
 *   • POI panel — visible only when officer is inside the site geofence
 *     (site-specific POI) plus org-wide banned/trespass records
 *   • Incident Report form — captures subject details, photos, police
 *     involvement and camera review requests
 *   • Today's incident log with status badges and police/camera flags
 *   • Quick "Trespass Warning" shortcut via PointsOfInterest system
 *
 * Routing: /site-guard?site=<client_site_id>&roster=<roster_shift_id>
 */

import { useState, useRef, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { OfficerShell } from '@/components/features/OfficerShell'
import { FieldSafetyBar } from '@/components/features/FieldSafetyBar'
import { GeofenceWarningBanner } from '@/components/features/GeofenceWarningBanner'
import { useShiftGate } from '@/hooks/useShiftGate'
import { useGeofenceOrgTransition } from '@/hooks/useGeofenceOrgTransition'
import { VOILookup } from '@/components/features/VOILookup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertTriangle, MapPin, ShieldAlert, Users, FileText, Phone,
  Camera, CheckCircle2, Clock, Search, Plus, Eye, Car,
  Siren, X, ChevronRight, Lock, Unlock, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { useSiteGuardDashboard, type NewIncidentData, type SitePOI, type SiteIncident } from '@/hooks/useSiteGuardDashboard'
import { uploadFile } from '@/lib/fileUpload'
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { useSiteToolPermissions } from '@/middleware'

// ─── Constants ────────────────────────────────────────────────────────────────

const INCIDENT_TYPES = [
  { value: 'trespass',             label: 'Trespass' },
  { value: 'suspicious_behaviour', label: 'Suspicious Behaviour' },
  { value: 'assault',              label: 'Assault' },
  { value: 'theft',                label: 'Theft' },
  { value: 'vandalism',            label: 'Vandalism' },
  { value: 'verbal_abuse',         label: 'Verbal Abuse' },
  { value: 'intoxication',         label: 'Intoxication / Drug Use' },
  { value: 'welfare_check',        label: 'Welfare Check' },
  { value: 'anti_social_behaviour',label: 'Anti-Social Behaviour' },
  { value: 'property_damage',      label: 'Property Damage' },
  { value: 'unauthorized_access',  label: 'Unauthorised Access' },
  { value: 'other',                label: 'Other' },
]

const SEVERITY_STYLES: Record<string, string> = {
  low:      'bg-blue-50 text-blue-700 border-blue-200',
  medium:   'bg-yellow-50 text-yellow-700 border-yellow-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
}

const STATUS_STYLES: Record<string, string> = {
  poi:         'bg-blue-50 text-blue-700 border-blue-200',
  banned:      'bg-red-50 text-red-700 border-red-200',
  trespassed:  'bg-orange-50 text-orange-700 border-orange-200',
}

// ─── Empty incident form ───────────────────────────────────────────────────────

function emptyIncident(siteId: string): NewIncidentData {
  return {
    client_site_id: siteId,
    incident_type: '',
    severity: 'medium',
    description: '',
    action_taken: '',
    subject_name: '',
    subject_description: '',
    subject_photos: [],
    police_notified: false,
    police_notified_at: null,
    police_event_number: '',
    police_officer_name: '',
    police_station: '',
    police_notes: '',
    camera_review_requested: false,
    camera_review_notes: '',
    gps_lat: null,
    gps_lng: null,
    location_description: '',
    poi_id: null,
    officer_shift_id: null,
    roster_shift_id: null,
  }
}

// ─── POI Card ─────────────────────────────────────────────────────────────────

function POICard({
  poi,
  onLinkToIncident,
}: {
  poi: SitePOI
  onLinkToIncident?: (poi: SitePOI) => void
}) {
  const isExpired = poi.expires_at && poi.expires_at < new Date().toISOString()
  return (
    <div className={`rounded-2xl border-2 p-3 sm:p-4 bg-white/90 shadow-sm ${isExpired ? 'opacity-60' : ''} ${poi.status === 'banned' ? 'border-red-200' : poi.status === 'trespassed' ? 'border-orange-200' : 'border-blue-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {poi.photos?.[0] ? (
            <img
              src={poi.photos[0]}
              alt={poi.full_name}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
              <Users className="h-5 w-5 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-semibold text-sm">{poi.full_name}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Badge
                variant="outline"
                className={`text-xs ${STATUS_STYLES[poi.status] ?? ''}`}
              >
                {poi.status.charAt(0).toUpperCase() + poi.status.slice(1)}
              </Badge>
              {poi.site_specific && (
                <Badge variant="outline" className="text-xs border-purple-200 text-purple-700 bg-purple-50">
                  Site
                </Badge>
              )}
              {isExpired && (
                <Badge variant="outline" className="text-xs border-gray-200 text-gray-500">
                  Expired
                </Badge>
              )}
            </div>
          </div>
        </div>
        {onLinkToIncident && (
          <Button
            size="sm"
            variant="outline"
            className="flex-shrink-0 text-xs rounded-xl"
            onClick={() => onLinkToIncident(poi)}
          >
            Link
          </Button>
        )}
      </div>
      {poi.reason && (
        <p className="text-xs text-gray-500 mt-1.5 pl-12">{poi.reason}</p>
      )}
      {poi.distinguishing_features && (
        <p className="text-xs text-gray-400 mt-0.5 pl-12">{poi.distinguishing_features}</p>
      )}
      {poi.expires_at && (
        <p className="text-xs text-gray-400 mt-0.5 pl-12">
          Expires {format(parseISO(poi.expires_at), 'd MMM yyyy')}
        </p>
      )}
    </div>
  )
}

// ─── Incident Row ─────────────────────────────────────────────────────────────

function IncidentRow({ incident }: { incident: SiteIncident }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border-2 rounded-2xl overflow-hidden bg-white/90 shadow-sm">
      <button
        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-gray-50 text-left transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs ${SEVERITY_STYLES[incident.severity] ?? ''}`}>
            {incident.severity}
          </Badge>
          <span className="text-sm font-medium">
            {INCIDENT_TYPES.find(t => t.value === incident.incident_type)?.label ?? incident.incident_type}
          </span>
          {incident.subject_name && (
            <span className="text-xs text-gray-500">— {incident.subject_name}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {incident.police_notified && (
            <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">
              <Siren className="h-3 w-3 mr-0.5" />Police
            </Badge>
          )}
          {incident.camera_review_requested && (
            <Badge variant="outline" className="text-xs border-purple-200 text-purple-700 bg-purple-50">
              <Camera className="h-3 w-3 mr-0.5" />Camera
            </Badge>
          )}
          <span className="text-xs text-gray-400">
            {format(parseISO(incident.created_at), 'h:mm a')}
          </span>
          <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {expanded && (
        <div className="p-3 sm:p-4 border-t bg-gray-50 text-sm space-y-2">
          <p>{incident.description}</p>
          {incident.police_notified && (
            <div className="rounded bg-blue-50 border border-blue-200 p-2 text-xs space-y-0.5">
              <p className="font-semibold text-blue-700">Police Involvement</p>
              {incident.police_event_number && <p>Event #: {incident.police_event_number}</p>}
            </div>
          )}
          {incident.camera_review_requested && (
            <div className="rounded bg-purple-50 border border-purple-200 p-2 text-xs">
              <p className="font-semibold text-purple-700">Camera Review: <span className="capitalize">{incident.camera_review_status.replace(/_/g, ' ')}</span></p>
            </div>
          )}
          {incident.poi && (
            <p className="text-xs text-gray-500">Linked POI: <span className="font-medium">{incident.poi.full_name}</span></p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SiteGuardPortal() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  useGeofenceOrgTransition({ enabled: true })
  const queryClient = useQueryClient()
  const { rosteredShift, isLoading: rosteredShiftLoading } = useRosteredShift()

  const { gateApplies, canAccessPortal, canUseFeature, geofenceViolation, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('guarding'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate])

  const clientSiteId = searchParams.get('site')
  const rosterShiftId = searchParams.get('roster')
  const isDirectorOfficerMode = user?.role === 'officer'
  const activeRosterSiteId = rosteredShift?.client_site_id ?? null
  const siteToolPermissions = useSiteToolPermissions(user?.id, activeRosterSiteId)

  const rosterSiteMatches = Boolean(activeRosterSiteId && clientSiteId && activeRosterSiteId === clientSiteId)
  const rosterShiftMatches = Boolean(!rosterShiftId || (rosteredShift?.id && rosterShiftId === rosteredShift.id))

  const directorSiteGuardAllowed = !isDirectorOfficerMode || (
    siteToolPermissions.siteGuard &&
    rosterSiteMatches &&
    rosterShiftMatches
  )

  const {
    site, siteLoading,
    distanceToSite, isInsideFence,
    sitePOI, poiLoading,
    allSitePOI,
    incidents, incidentsLoading,
    createIncident, createLoading,
    linkPoiToIncident,
    triggerEmergencyAssist,
    emergencyAssistLoading,
  } = useSiteGuardDashboard(clientSiteId)

  async function handleEmergencyAssist() {
    try {
      await triggerEmergencyAssist({
        assistType: 'emergency',
        severity: 'critical',
        description: `Emergency assist requested from Site Guard Portal (${site?.name ?? clientSiteId}).`,
      })
      toast.error('Emergency assist request sent to command console', { duration: 6000 })
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to trigger emergency assist')
    }
  }

  // ── Incident form state ───────────────────────────────────────────────────

  const [incidentOpen, setIncidentOpen]   = useState(false)
  const [form, setForm]                   = useState<NewIncidentData>(() =>
    emptyIncident(clientSiteId ?? '')
  )
  const [photoUploading, setPhotoUploading] = useState(false)
  const [poiSearch, setPoiSearch]           = useState('')
  const [linkedPOI, setLinkedPOI]           = useState<SitePOI | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ── POI search ────────────────────────────────────────────────────────────

  const [poiTab, setPoiTab]         = useState<'active' | 'search'>('active')
  const [poiSearchQuery, setPoiSearchQuery] = useState('')

  const filteredPOI = poiTab === 'search'
    ? allSitePOI.filter(p => {
        const q = poiSearchQuery.toLowerCase()
        return p.full_name.toLowerCase().includes(q)
          || p.description?.toLowerCase().includes(q)
          || p.distinguishing_features?.toLowerCase().includes(q)
      })
    : sitePOI

  // ── Photo upload ──────────────────────────────────────────────────────────

  async function handlePhotoUpload(file: File) {
    if (!user?.id) return
    setPhotoUploading(true)
    try {
      const path = `${user.id}/incidents/${Date.now()}_${file.name}`
      const { url, error } = await uploadFile({ bucket: 'evidence', path, file })
      if (error) throw new Error(error)
      setForm(f => ({ ...f, subject_photos: [...f.subject_photos, url] }))
    } catch (e: any) {
      toast.error(e.message ?? 'Photo upload failed')
    } finally {
      setPhotoUploading(false)
    }
  }

  // ── GPS for incident ──────────────────────────────────────────────────────

  function captureGPS() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({
          ...f,
          gps_lat: pos.coords.latitude,
          gps_lng: pos.coords.longitude,
        }))
        toast.success('Location captured')
      },
      () => toast.error('Could not get location')
    )
  }

  // ── Submit incident ───────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!form.incident_type) { toast.error('Please select an incident type'); return }
    if (!form.description.trim()) { toast.error('Please enter a description'); return }
    try {
      await createIncident({
        ...form,
        poi_id: linkedPOI?.id ?? null,
        roster_shift_id: rosterShiftId ?? null,
        police_notified_at: form.police_notified ? new Date().toISOString() : null,
      })
      toast.success('Incident report submitted')
      setIncidentOpen(false)
      setForm(emptyIncident(clientSiteId ?? ''))
      setLinkedPOI(null)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to submit report')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (!clientSiteId) {
    return (
      <OfficerShell title="Site Guard" showBackButton contentClassName="max-w-7xl">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">No site selected.</p>
          <Button className="mt-4 rounded-xl" onClick={() => navigate('/field-officer')}>
            Go to Field Portal
          </Button>
        </div>
      </OfficerShell>
    )
  }

  if (isDirectorOfficerMode && (gateLoading || rosteredShiftLoading || siteToolPermissions.isLoading)) {
    return (
      <OfficerShell title="Site Guard" showBackButton contentClassName="max-w-7xl">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Clock className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Validating rostered site access…</p>
        </div>
      </OfficerShell>
    )
  }

  if (isDirectorOfficerMode && !directorSiteGuardAllowed) {
    return (
      <OfficerShell title="Site Guard" showBackButton contentClassName="max-w-7xl">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldAlert className="h-12 w-12 text-red-300 mb-4" />
          <p className="text-gray-700 font-medium">Access restricted to your active rostered site.</p>
          <p className="text-gray-500 text-sm mt-1">Site-Guard links must match your current shift site and permission scope.</p>
          <Button className="mt-4 rounded-xl" onClick={() => navigate('/field-officer')}>
            Return to Field Portal
          </Button>
        </div>
      </OfficerShell>
    )
  }

  const fenceColour = isInsideFence ? 'text-green-600' : 'text-orange-500'
  const fenceLabel  = isInsideFence ? 'Inside Site' : distanceToSite != null ? `${Math.round(distanceToSite)} m away` : 'Locating…'

  return (
    <OfficerShell
      title={site?.name ?? 'Site Guard'}
      description={site?.address ?? ''}
      showBackButton
      contentClassName="max-w-7xl"
    >      {geofenceViolation && <GeofenceWarningBanner />}      {/* ── Safety bar — always visible ──────────────────────────────────── */}
      <FieldSafetyBar
        zoneId={site?.id ?? null}
        position={null}
        compact
      />

      {/* ── Site header ─────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-2xl border-2 border-slate-200 p-4 bg-gradient-to-br from-white to-slate-50 shadow-sm">
        <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isInsideFence ? 'bg-green-100' : 'bg-orange-100'
          }`}>
            {isInsideFence
              ? <Lock className="h-5 w-5 text-green-600" />
              : <Unlock className="h-5 w-5 text-orange-500" />}
          </div>
          <div>
            <p className="font-semibold text-sm">{site?.name ?? '…'}</p>
            <p className={`text-xs flex items-center gap-1 ${fenceColour}`}>
              <MapPin className="h-3 w-3" />{fenceLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {site?.emergency_contact_phone && (
            <Button size="sm" variant="outline" asChild>
              <a href={`tel:${site.emergency_contact_phone}`}>
                <Phone className="h-4 w-4 text-red-500" />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl border-red-200 text-red-700 hover:bg-red-50"
            onClick={handleEmergencyAssist}
            disabled={emergencyAssistLoading}
          >
            <Siren className="h-4 w-4 mr-1" />
            {emergencyAssistLoading ? 'Sending…' : 'Emergency Assist'}
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
            onClick={() => {
              setForm(emptyIncident(clientSiteId))
              setLinkedPOI(null)
              setIncidentOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Report Incident
          </Button>
        </div>
        </div>
      </div>

      {/* ── Hazards / special instructions ──────────────────────────────── */}
      {(site?.hazards || site?.special_instructions) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800 space-y-1">
            {site.hazards && <p><strong>Hazards:</strong> {site.hazards}</p>}
            {site.special_instructions && <p><strong>Instructions:</strong> {site.special_instructions}</p>}
          </div>
        </div>
      )}

      <Tabs defaultValue="poi">
        <TabsList className="mb-4 grid grid-cols-2 sm:grid-cols-4 h-auto gap-2 bg-transparent p-0">
          <TabsTrigger value="poi" className="rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2">
            <Users className="h-4 w-4 mr-1.5" />
            POI
            {sitePOI.length > 0 && (
              <span className="ml-1.5 bg-red-100 text-red-700 text-xs px-1.5 rounded-full">
                {sitePOI.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="voi" className="rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2">
            <Car className="h-4 w-4 mr-1.5" />
            VOI
          </TabsTrigger>
          <TabsTrigger value="incidents" className="rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2">
            <FileText className="h-4 w-4 mr-1.5" />
            Incidents
            {incidents.length > 0 && (
              <span className="ml-1.5 bg-blue-100 text-blue-700 text-xs px-1.5 rounded-full">
                {incidents.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="info" className="rounded-xl border data-[state=active]:bg-white data-[state=active]:shadow-sm py-2">
            <Building2 className="h-4 w-4 mr-1.5" />
            Site Info
          </TabsTrigger>
        </TabsList>

        {/* ── VOI Tab (available everywhere, no geofence restriction) ─────── */}
        <TabsContent value="voi">
          <p className="text-xs text-gray-400 mb-3">
            Search flagged vehicles — available anywhere, not restricted to site geofence.
          </p>
          <VOILookup inline />
        </TabsContent>

        {/* ── POI Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="poi">
          {!isInsideFence && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-center gap-2 mb-4">
              <Lock className="h-4 w-4 text-orange-500 flex-shrink-0" />
              <p className="text-sm text-orange-700">
                Site-specific POI records are only visible once you are inside the site geofence.
                {distanceToSite != null && ` You are ${Math.round(distanceToSite)} m away.`}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              type="button"
              onClick={() => setPoiTab('active')}
              className={`rounded-xl border-2 px-3 py-2 text-sm font-medium transition-colors ${poiTab === 'active' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
            >
              Active ({sitePOI.length})
            </button>
            <button
              type="button"
              onClick={() => setPoiTab('search')}
              className={`rounded-xl border-2 px-3 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${poiTab === 'search' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
            >
              <Search className="h-3.5 w-3.5" />Search All
            </button>
          </div>

          {poiTab === 'search' && (
            <Input
              placeholder="Search by name, description…"
              value={poiSearchQuery}
              onChange={e => setPoiSearchQuery(e.target.value)}
              className="mb-3"
            />
          )}

          {poiLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
          ) : filteredPOI.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {poiTab === 'active'
                ? isInsideFence ? 'No active POI for this site.' : 'Enter the site geofence to view POI.'
                : 'No results.'}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredPOI.map(poi => (
                <POICard key={poi.id} poi={poi} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Incidents Tab ────────────────────────────────────────────────── */}
        <TabsContent value="incidents">
          {incidentsLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
          ) : incidents.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No incidents reported today.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {incidents.map(inc => (
                <IncidentRow key={inc.id} incident={inc} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Site Info Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="info">
          {site && (
            <div className="space-y-3 text-sm">
              <Card>
                <CardContent className="pt-4 space-y-2">
                  {site.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                      <span>{site.address}</span>
                    </div>
                  )}
                  {site.access_instructions && (
                    <div className="flex items-start gap-2">
                      <Eye className="h-4 w-4 text-gray-400 mt-0.5" />
                      <span>{site.access_instructions}</span>
                    </div>
                  )}
                  {site.contact_phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-gray-400" />
                      <a href={`tel:${site.contact_phone}`} className="text-blue-600 underline">
                        {site.contact_name ? `${site.contact_name}: ` : ''}{site.contact_phone}
                      </a>
                    </div>
                  )}
                  {site.emergency_contact_phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-red-500" />
                      <a href={`tel:${site.emergency_contact_phone}`} className="text-red-600 underline font-medium">
                        Emergency: {site.emergency_contact_phone}
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>
              <p className="text-xs text-gray-400 text-center">
                Geofence radius: {site.geofence_radius_metres} m
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Incident Report Dialog ────────────────────────────────────────── */}
      <Dialog open={incidentOpen} onOpenChange={setIncidentOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-blue-600" />
              Incident Report — {site?.name}
            </DialogTitle>
            <DialogDescription>
              Complete as many fields as possible. Name and photo are optional.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">

            {/* Incident type + severity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Incident Type *</Label>
                <Select value={form.incident_type} onValueChange={v => setForm(f => ({ ...f, incident_type: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['low','medium','high','critical'].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div>
              <Label>Description *</Label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="What happened? Include time, location within site, and any relevant context…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Subject */}
            <Separator />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name (if known)</Label>
                <Input
                  className="mt-0.5 text-sm"
                  placeholder="Unknown"
                  value={form.subject_name}
                  onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Photo(s)</Label>
                <div className="mt-0.5 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={photoUploading}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1" />
                    {photoUploading ? 'Uploading…' : `Add (${form.subject_photos.length})`}
                  </Button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) handlePhotoUpload(file)
                    }}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Physical Description</Label>
              <Textarea
                className="mt-0.5 text-sm"
                rows={2}
                placeholder="Height, build, clothing, distinguishing features…"
                value={form.subject_description}
                onChange={e => setForm(f => ({ ...f, subject_description: e.target.value }))}
              />
            </div>

            {/* Link to POI */}
            {linkedPOI ? (
              <div className="flex items-center justify-between rounded-lg bg-orange-50 border border-orange-200 p-2">
                <p className="text-sm text-orange-700">
                  <span className="font-semibold">Linked POI:</span> {linkedPOI.full_name}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLinkedPOI(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div>
                <Label className="text-xs">Link to Known POI (optional)</Label>
                <div className="relative mt-0.5">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    className="pl-8 text-sm"
                    placeholder="Search POI by name…"
                    value={poiSearch}
                    onChange={e => setPoiSearch(e.target.value)}
                  />
                </div>
                {poiSearch.length > 1 && (
                  <div className="mt-1 border rounded-lg max-h-36 overflow-y-auto">
                    {allSitePOI
                      .filter(p => p.full_name.toLowerCase().includes(poiSearch.toLowerCase()))
                      .map(p => (
                        <button
                          key={p.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                          onClick={() => { setLinkedPOI(p); setPoiSearch('') }}
                        >
                          <span>{p.full_name}</span>
                          <Badge variant="outline" className={`text-xs ${STATUS_STYLES[p.status] ?? ''}`}>
                            {p.status}
                          </Badge>
                        </button>
                      ))}
                    {allSitePOI.filter(p => p.full_name.toLowerCase().includes(poiSearch.toLowerCase())).length === 0 && (
                      <p className="text-xs text-gray-400 p-3">No matching POI found.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action taken */}
            <div>
              <Label>Action Taken</Label>
              <Textarea
                className="mt-1 text-sm"
                rows={2}
                placeholder="What action did you take? e.g. verbal warning, trespass issued, asked to leave…"
                value={form.action_taken}
                onChange={e => setForm(f => ({ ...f, action_taken: e.target.value }))}
              />
            </div>

            {/* Location */}
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={captureGPS}>
                <MapPin className="h-3.5 w-3.5 mr-1" />
                {form.gps_lat ? 'Location captured ✓' : 'Capture Location'}
              </Button>
              <Input
                className="flex-1 text-sm"
                placeholder="Location description (e.g. 'north entrance, platform 3')"
                value={form.location_description}
                onChange={e => setForm(f => ({ ...f, location_description: e.target.value }))}
              />
            </div>

            {/* Police involvement */}
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Siren className="h-4 w-4 text-blue-600" />
                    Police Involvement
                  </p>
                  <p className="text-xs text-gray-400">Were police notified or attended?</p>
                </div>
                <Switch
                  checked={form.police_notified}
                  onCheckedChange={v => setForm(f => ({ ...f, police_notified: v }))}
                />
              </div>

              {form.police_notified && (
                <div className="grid grid-cols-2 gap-3 pl-1">
                  <div>
                    <Label className="text-xs">NZ Police Event Number</Label>
                    <Input
                      className="mt-0.5 text-sm"
                      placeholder="e.g. P23456789"
                      value={form.police_event_number}
                      onChange={e => setForm(f => ({ ...f, police_event_number: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Police Officer Name / Badge</Label>
                    <Input
                      className="mt-0.5 text-sm"
                      placeholder="Name or badge number"
                      value={form.police_officer_name}
                      onChange={e => setForm(f => ({ ...f, police_officer_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Police Station</Label>
                    <Input
                      className="mt-0.5 text-sm"
                      placeholder="e.g. Nelson Police Station"
                      value={form.police_station}
                      onChange={e => setForm(f => ({ ...f, police_station: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Additional Notes</Label>
                    <Input
                      className="mt-0.5 text-sm"
                      placeholder="Any other police details…"
                      value={form.police_notes}
                      onChange={e => setForm(f => ({ ...f, police_notes: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Camera review */}
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Camera className="h-4 w-4 text-purple-600" />
                    Camera Review Required
                  </p>
                  <p className="text-xs text-gray-400">Request admin / client to review CCTV footage</p>
                </div>
                <Switch
                  checked={form.camera_review_requested}
                  onCheckedChange={v => setForm(f => ({ ...f, camera_review_requested: v }))}
                />
              </div>

              {form.camera_review_requested && (
                <Textarea
                  className="text-sm"
                  rows={2}
                  placeholder="Specify camera location, time range, and what to look for…"
                  value={form.camera_review_notes}
                  onChange={e => setForm(f => ({ ...f, camera_review_notes: e.target.value }))}
                />
              )}
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createLoading ? 'Submitting…' : 'Submit Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OfficerShell>
  )
}
