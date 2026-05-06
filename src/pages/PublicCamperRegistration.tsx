/**
 * PublicCamperRegistration.tsx (B-17)
 *
 * Self-service camper stay registration portal.
 * Accessible unauthenticated at /public/register.
 *
 * Allows campers to register their intended stay at a freedom camping zone:
 *   1. Browse/select an active zone
 *   2. Enter vehicle, party, and date details
 *   3. Receive a confirmation code (e.g. CR-2026-A3F7)
 *   4. Look up an existing registration by confirmation code
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  Car, CheckCircle2, ClipboardList, Moon, MapPin, Search, Send, Users,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublicZoneOption {
  id: string
  name: string
  description: string | null
  max_consecutive_nights: number | null
  self_contained_required: boolean | null
  max_vehicles: number | null
  fee_nzd: string | null
  has_toilets: boolean
  has_water: boolean
  has_dump_station: boolean
  has_shower: boolean
  has_rubbish: boolean
}

const VEHICLE_TYPES = [
  { value: 'self_contained', label: 'Self-contained vehicle (CSC certified)' },
  { value: 'campervan',      label: 'Campervan / motorhome (not CSC)' },
  { value: 'motorhome',      label: 'Motorhome' },
  { value: 'car',            label: 'Car (with tent or sleeping in vehicle)' },
  { value: 'tent',           label: 'Tent camping' },
  { value: 'other',          label: 'Other' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicCamperRegistration() {
  const [tab, setTab] = useState<'register' | 'lookup'>('register')

  // ── Zone selection + search ──────────────────────────────────────────────────
  const [zoneSearch, setZoneSearch] = useState('')
  const [selectedZoneId, setSelectedZoneId] = useState<string>('')

  const { data: zones = [], isLoading: zonesLoading } = useQuery<PublicZoneOption[]>({
    queryKey: ['public-zones-register'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('zones')
        .select('id, name, description, max_consecutive_nights, self_contained_required, max_vehicles, fee_nzd, has_toilets, has_water, has_dump_station, has_shower, has_rubbish')
        .eq('is_active', true)
        .or('zone_type.eq.freedom_camp,zone_type.eq.freedom_camping,zone_type.eq.freedom_camping_zone,zone_type.eq.camping')
        .order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

  const filteredZones = useMemo(() =>
    zones.filter(z => !zoneSearch || z.name.toLowerCase().includes(zoneSearch.toLowerCase())),
    [zones, zoneSearch]
  )
  const selectedZone = zones.find(z => z.id === selectedZoneId) ?? null

  // ── Registration form ────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0]

  const [plateNumber,      setPlateNumber]      = useState('')
  const [vehicleType,      setVehicleType]      = useState<string>('')
  const [isSelfContained,  setIsSelfContained]  = useState(false)
  const [contactName,      setContactName]      = useState('')
  const [contactEmail,     setContactEmail]     = useState('')
  const [contactPhone,     setContactPhone]     = useState('')
  const [partySize,        setPartySize]        = useState('1')
  const [arrivalDate,      setArrivalDate]      = useState(today)
  const [departureDate,    setDepartureDate]    = useState(tomorrow)
  const [notes,            setNotes]            = useState('')
  const [submitting,       setSubmitting]       = useState(false)
  const [confirmed,        setConfirmed]        = useState<{ code: string; zoneName: string; nights: number } | null>(null)

  const nights = useMemo(() => {
    const diff = (new Date(departureDate).getTime() - new Date(arrivalDate).getTime()) / 86_400_000
    return Math.max(0, Math.round(diff))
  }, [arrivalDate, departureDate])

  const canRegister = !!selectedZoneId && !!arrivalDate && !!departureDate && nights >= 0

  const handleRegister = async () => {
    if (!canRegister) return
    setSubmitting(true)
    try {
      const { data, error } = await edgeFunctions.submitCamperRegistration({
        zone_id:          selectedZoneId,
        plate_number:     plateNumber  || undefined,
        vehicle_type:     vehicleType as any || undefined,
        is_self_contained: isSelfContained,
        contact_name:     contactName  || undefined,
        contact_email:    contactEmail || undefined,
        contact_phone:    contactPhone || undefined,
        party_size:       parseInt(partySize) || 1,
        arrival_date:     arrivalDate,
        departure_date:   departureDate,
        notes:            notes        || undefined,
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Registration failed')

      setConfirmed({ code: data.confirmation_code, zoneName: data.zone_name, nights: data.nights })
      toast.success('Registration confirmed!')
    } catch (err: any) {
      toast.error(err?.message || 'Could not complete registration')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Lookup ───────────────────────────────────────────────────────────────────
  const [lookupCode,   setLookupCode]   = useState('')
  const [lookupResult, setLookupResult] = useState<any>(null)
  const [looking,      setLooking]      = useState(false)

  const handleLookup = async () => {
    if (!lookupCode.trim()) { toast.error('Enter a confirmation code'); return }
    setLooking(true)
    setLookupResult(null)
    try {
      const { data, error } = await (supabase as any)
        .from('camper_registrations')
        .select('*, zones(name)')
        .eq('confirmation_code', lookupCode.trim().toUpperCase())
        .single()
      if (error || !data) throw new Error('No registration found for that code.')
      setLookupResult(data)
      toast.success('Registration found')
    } catch (err: any) {
      toast.error(err?.message || 'Not found')
    } finally {
      setLooking(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start gap-3">
          <ClipboardList className="h-7 w-7 text-green-700 mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-green-900">Freedom Camping Registration</h1>
            <p className="text-sm text-green-700 mt-0.5">
              Register your stay at a freedom camping zone. All registrations are voluntary but
              help councils manage zone capacity and ensure camper welfare.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="register">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Register Stay
            </TabsTrigger>
            <TabsTrigger value="lookup">
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Look Up Registration
            </TabsTrigger>
          </TabsList>

          {/* ── Register Tab ──────────────────────────────────────────────── */}
          <TabsContent value="register" className="mt-4 space-y-4">

            {confirmed ? (
              /* Success state */
              <Card className="border-green-300 bg-green-50">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center gap-3 text-center text-green-900">
                    <CheckCircle2 className="h-12 w-12 text-green-600" />
                    <h2 className="text-lg font-semibold">Registration Confirmed</h2>
                    <p className="text-sm max-w-md">
                      You're registered for <strong>{confirmed.zoneName}</strong> — {confirmed.nights} night{confirmed.nights !== 1 ? 's' : ''}.
                    </p>
                    <div className="mt-2 rounded-lg border-2 border-green-400 bg-white px-6 py-3 text-center">
                      <p className="text-xs text-green-700 mb-1 font-medium uppercase tracking-wide">Your confirmation code</p>
                      <p className="text-3xl font-mono font-bold text-green-800 tracking-widest">{confirmed.code}</p>
                      <p className="text-xs text-green-600 mt-1">Keep this code — enforcement officers may ask for it</p>
                    </div>
                    <Button
                      variant="outline"
                      className="mt-3 border-green-400 text-green-800"
                      onClick={() => {
                        setConfirmed(null)
                        setSelectedZoneId('')
                        setPlateNumber('')
                        setVehicleType('')
                        setIsSelfContained(false)
                        setContactName('')
                        setContactEmail('')
                        setContactPhone('')
                        setPartySize('1')
                        setArrivalDate(today)
                        setDepartureDate(tomorrow)
                        setNotes('')
                      }}
                    >
                      Register Another Stay
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Zone selection */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-green-700" />
                      Select Zone
                    </CardTitle>
                    <CardDescription>Choose the freedom camping zone you'll be staying at.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search zones…"
                        value={zoneSearch}
                        onChange={(e) => setZoneSearch(e.target.value)}
                        className="pl-9"
                        disabled={zonesLoading}
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                      {zonesLoading && <p className="text-sm text-muted-foreground col-span-2">Loading zones…</p>}
                      {!zonesLoading && filteredZones.length === 0 && (
                        <p className="text-sm text-muted-foreground col-span-2">No zones found.</p>
                      )}
                      {filteredZones.map(z => (
                        <button
                          key={z.id}
                          onClick={() => setSelectedZoneId(z.id)}
                          className={[
                            'text-left rounded-lg border px-3 py-2 text-sm transition-colors',
                            selectedZoneId === z.id
                              ? 'border-green-500 bg-green-50 ring-1 ring-green-400'
                              : 'hover:border-green-300 hover:bg-green-50/50',
                          ].join(' ')}
                        >
                          <p className="font-medium">{z.name}</p>
                          {z.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{z.description}</p>}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {z.max_consecutive_nights != null && (
                              <span className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                                <Moon className="h-3 w-3" />{z.max_consecutive_nights}n max
                              </span>
                            )}
                            {z.self_contained_required && (
                              <span className="inline-flex items-center gap-0.5 text-xs bg-purple-50 text-purple-700 rounded px-1.5 py-0.5">
                                <Car className="h-3 w-3" />CSC req.
                              </span>
                            )}
                            {z.fee_nzd && (
                              <span className="text-xs bg-amber-50 text-amber-700 rounded px-1.5 py-0.5">
                                NZD ${Number(z.fee_nzd).toFixed(0)}/night
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Dates + party */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Moon className="h-4 w-4 text-green-700" />
                      Dates &amp; Party
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label>Arrival Date *</Label>
                        <Input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} min={today} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Departure Date *</Label>
                        <Input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} min={arrivalDate || today} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Party Size</Label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={partySize}
                          onChange={(e) => setPartySize(e.target.value)}
                        />
                      </div>
                    </div>
                    {nights > 0 && (
                      <div className="flex items-center gap-1.5 text-sm text-green-800 bg-green-50 rounded px-3 py-1.5">
                        <Moon className="h-4 w-4" />
                        <span>{nights} night{nights !== 1 ? 's' : ''}</span>
                        {selectedZone?.max_consecutive_nights != null && nights > selectedZone.max_consecutive_nights && (
                          <Badge className="ml-2 bg-red-100 text-red-800 border-red-200 text-xs">
                            Exceeds {selectedZone.max_consecutive_nights}n limit
                          </Badge>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Vehicle + contact */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Car className="h-4 w-4 text-green-700" />
                      Vehicle &amp; Contact
                    </CardTitle>
                    <CardDescription>Optional — helps councils manage zone safety.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Plate Number</Label>
                        <Input
                          value={plateNumber}
                          onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                          placeholder="ABC123"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Vehicle Type</Label>
                        <Select value={vehicleType} onValueChange={setVehicleType}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type…" />
                          </SelectTrigger>
                          <SelectContent>
                            {VEHICLE_TYPES.map(vt => (
                              <SelectItem key={vt.value} value={vt.value}>{vt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="self-contained"
                        checked={isSelfContained}
                        onCheckedChange={(v) => setIsSelfContained(Boolean(v))}
                      />
                      <Label htmlFor="self-contained" className="font-normal">
                        Vehicle is self-contained (holds a valid Camping Ground Warrant or CSC certificate)
                      </Label>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label>Your Name</Label>
                        <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Email</Label>
                        <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Phone</Label>
                        <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="02x xxx xxxx" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Notes (optional)</Label>
                      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional info for compliance officers." />
                    </div>
                  </CardContent>
                </Card>

                <Button
                  onClick={handleRegister}
                  disabled={!canRegister || submitting}
                  className="w-full bg-green-700 hover:bg-green-800"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {submitting ? 'Registering…' : 'Register Stay'}
                </Button>
              </>
            )}
          </TabsContent>

          {/* ── Lookup Tab ────────────────────────────────────────────────── */}
          <TabsContent value="lookup" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Look Up Your Registration</CardTitle>
                <CardDescription>Enter your confirmation code to check your registration details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={lookupCode}
                    onChange={(e) => setLookupCode(e.target.value.toUpperCase())}
                    placeholder="e.g. CR-2026-A3F7"
                    className="font-mono"
                  />
                  <Button onClick={handleLookup} disabled={looking}>
                    <Search className="h-4 w-4 mr-1" />
                    {looking ? 'Searching…' : 'Find'}
                  </Button>
                </div>

                {lookupResult && (
                  <div className="rounded-lg border bg-white p-4 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-green-900">{lookupResult.zones?.name ?? '—'}</p>
                      <Badge className={
                        lookupResult.status === 'active' ? 'bg-green-100 text-green-800' :
                        lookupResult.status === 'departed' ? 'bg-gray-100 text-gray-600' :
                        'bg-red-100 text-red-700'
                      }>
                        {lookupResult.status}
                      </Badge>
                    </div>
                    <p className="font-mono text-lg font-bold text-green-800">{lookupResult.confirmation_code}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <p><span className="font-medium text-foreground">Arrival:</span> {lookupResult.arrival_date}</p>
                      <p><span className="font-medium text-foreground">Departure:</span> {lookupResult.departure_date}</p>
                      <p><span className="font-medium text-foreground">Nights:</span> {lookupResult.nights}</p>
                      <p><span className="font-medium text-foreground">Party:</span> {lookupResult.party_size} person{lookupResult.party_size !== 1 ? 's' : ''}</p>
                      {lookupResult.plate_number && (
                        <p><span className="font-medium text-foreground">Plate:</span> {lookupResult.plate_number}</p>
                      )}
                      {lookupResult.vehicle_type && (
                        <p><span className="font-medium text-foreground">Vehicle:</span> {lookupResult.vehicle_type.replace(/_/g, ' ')}</p>
                      )}
                    </div>
                    {lookupResult.is_self_contained && (
                      <p className="flex items-center gap-1.5 text-xs text-purple-700">
                        <Car className="h-3 w-3" /> Self-contained vehicle registered
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pb-8 border-t pt-4">
          <a href="/public/zone-map" className="text-green-700 hover:underline">Zone Map</a>
          {' · '}
          <a href="/public/noise-complaint" className="text-green-700 hover:underline">Noise Complaint</a>
          {' · '}
          <a href="/dispute" className="text-green-700 hover:underline">Dispute a Notice</a>
          {' · '}
          <a href="/public/parking-appeal" className="text-green-700 hover:underline">Parking Appeal</a>
        </footer>
      </div>
    </div>
  )
}
