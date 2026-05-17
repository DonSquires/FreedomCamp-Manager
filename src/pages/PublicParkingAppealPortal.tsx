/**
 * PublicParkingAppealPortal.tsx
 *
 * Self-serve parking infringement appeals portal (B-15).
 *
 * Accessible unauthenticated at /public/parking-appeal.
 * Allows anyone with a parking infringement number + matching plate to:
 *   1. Look up and verify their notice
 *   2. View offence details and evidence photos
 *   3. Submit an appeal with their grounds
 */
import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { AlertTriangle, Car, CheckCircle2, Loader2, Search, Send, ShieldCheck } from 'lucide-react'
import { edgeFunctions } from '@/lib/edgeFunctions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InfringementLookup {
  id: string
  infringement_number: string
  plate_number: string
  status: string
  offence_description: string
  offence_time: string
  location_address: string
  fine_amount_nzd: string | null
  early_payment_amount: string | null
  early_payment_days: number | null
  due_date: string | null
  evidence_photos: string[] | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_colour: string | null
}

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  issued:         { label: 'Issued',          colour: 'bg-blue-100 text-blue-800'   },
  reminder_sent:  { label: 'Reminder Sent',   colour: 'bg-yellow-100 text-yellow-800' },
  paid:           { label: 'Paid',             colour: 'bg-green-100 text-green-800' },
  disputed:       { label: 'Disputed',         colour: 'bg-orange-100 text-orange-800' },
  withdrawn:      { label: 'Withdrawn',        colour: 'bg-gray-100 text-gray-600'  },
  court_referred: { label: 'Court Referred',  colour: 'bg-red-100 text-red-800'    },
  written_off:    { label: 'Written Off',     colour: 'bg-gray-100 text-gray-500'  },
}

const NON_APPEALABLE = ['paid', 'written_off', 'court_referred', 'withdrawn']

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicParkingAppealPortal() {
  // Lookup state
  const [infNumber, setInfNumber]   = useState('')
  const [plateInput, setPlateInput] = useState('')
  const [looking, setLooking]       = useState(false)
  const [infData, setInfData]       = useState<InfringementLookup | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Appeal form state
  const [appellantName,   setAppellantName]   = useState('')
  const [appellantEmail,  setAppellantEmail]  = useState('')
  const [appellantPhone,  setAppellantPhone]  = useState('')
  const [grounds,         setGrounds]         = useState('')
  const [evidence,        setEvidence]        = useState('')
  const [submitting,      setSubmitting]      = useState(false)
  const [submitted,       setSubmitted]       = useState(false)
  const [appealRef,       setAppealRef]       = useState('')

  const canAppeal = useMemo(() =>
    !!infData && !NON_APPEALABLE.includes(infData.status) && grounds.trim().length >= 10,
    [infData, grounds]
  )

  // ── Lookup ──────────────────────────────────────────────────────────────────
  const handleLookup = async () => {
    if (!infNumber.trim()) {
      toast.error('Please enter your infringement number')
      return
    }
    setLooking(true)
    setInfData(null)
    setLookupError(null)
    try {
      // Use the Supabase anon client directly — anon SELECT policy is applied
      const { supabase } = await import('@/lib/supabase')
      const query = supabase
        .from('parking_infringements')
        .select('id,infringement_number,plate_number,status,offence_description,offence_time,location_address,fine_amount_nzd,early_payment_amount,early_payment_days,due_date,evidence_photos,vehicle_make,vehicle_model,vehicle_colour')
        .eq('infringement_number', infNumber.trim().toUpperCase())

      if (plateInput.trim()) {
        query.eq('plate_number', plateInput.trim().toUpperCase())
      }

      const { data, error } = await query.single()
      if (error || !data) throw new Error('No matching notice found. Check your infringement number and plate.')

      setInfData(data as unknown as InfringementLookup)
      setLookupError(null)
      toast.success('Notice found')
    } catch (err: any) {
      const message = err?.message || 'Could not find a matching notice'
      setLookupError(message)
      toast.error(message)
    } finally {
      setLooking(false)
    }
  }

  // ── Submit appeal ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canAppeal || !infData) return
    setSubmitting(true)
    try {
      const { data, error } = await edgeFunctions.submitParkingAppeal({
        infringement_number: infData.infringement_number,
        plate_number:        infData.plate_number,
        appellant_name:      appellantName  || undefined,
        appellant_email:     appellantEmail || undefined,
        appellant_phone:     appellantPhone || undefined,
        grounds:             grounds.trim(),
        evidence_statement:  evidence       || undefined,
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Submission failed')

      setAppealRef(data.infringement_number)
      setSubmitted(true)
      toast.success('Appeal submitted successfully')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit appeal')
    } finally {
      setSubmitting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Car className="h-5 w-5" />
              Parking Infringement Appeal Portal
            </CardTitle>
            <CardDescription>
              Received a parking infringement notice? Enter your notice number and plate to look up
              your notice and submit a formal appeal. Grounds are reviewed by our compliance team
              within 10 working days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inf-number">Notice / Infringement Number *</Label>
                <Input
                  id="inf-number"
                  value={infNumber}
                  onChange={(e) => setInfNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. PKG-2026-000042"
                  disabled={looking}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plate">Plate Number (recommended)</Label>
                <Input
                  id="plate"
                  value={plateInput}
                  onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
                  placeholder="e.g. ABC123"
                  disabled={looking}
                />
              </div>
            </div>
            <Button onClick={handleLookup} disabled={looking}>
              {looking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              {looking ? 'Searching…' : 'Find My Notice'}
            </Button>

            {lookupError && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">We could not find your notice.</p>
                <p className="text-xs mt-1">
                  {lookupError} Re-check the notice number and plate, then retry. If this keeps happening, contact support.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notice details */}
        {infData && !submitted && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle>Notice Details</CardTitle>
                  {STATUS_LABELS[infData.status] && (
                    <Badge className={STATUS_LABELS[infData.status].colour}>
                      {STATUS_LABELS[infData.status].label}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5">
                  <p><span className="font-medium">Notice No.:</span> {infData.infringement_number}</p>
                  <p><span className="font-medium">Plate:</span> {infData.plate_number}</p>
                  {infData.vehicle_make && (
                    <p>
                      <span className="font-medium">Vehicle:</span>{' '}
                      {[infData.vehicle_colour, infData.vehicle_make, infData.vehicle_model].filter(Boolean).join(' ')}
                    </p>
                  )}
                  <p><span className="font-medium">Offence Time:</span> {new Date(infData.offence_time).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}</p>
                  <p className="md:col-span-2"><span className="font-medium">Location:</span> {infData.location_address}</p>
                  <p className="md:col-span-2"><span className="font-medium">Offence:</span> {infData.offence_description}</p>
                  {infData.fine_amount_nzd && (
                    <p>
                      <span className="font-medium">Fine:</span> NZD ${Number(infData.fine_amount_nzd).toFixed(2)}
                      {infData.early_payment_amount && infData.early_payment_days && (
                        <span className="text-muted-foreground ml-1">
                          (NZD ${Number(infData.early_payment_amount).toFixed(2)} if paid within {infData.early_payment_days} days)
                        </span>
                      )}
                    </p>
                  )}
                  {infData.due_date && (
                    <p><span className="font-medium">Due Date:</span> {new Date(infData.due_date).toLocaleDateString('en-NZ')}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Evidence */}
            {(infData.evidence_photos?.length ?? 0) > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Evidence</CardTitle>
                  <CardDescription>Photos recorded at the time of the infringement.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {infData.evidence_photos!.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt={`Evidence ${i + 1}`}
                          className="h-40 w-auto rounded border object-cover hover:opacity-90 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Non-appealable notice */}
            {NON_APPEALABLE.includes(infData.status) && (
              <Card className="border-amber-300 bg-amber-50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-2 text-amber-900">
                    <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                    <p className="text-sm">
                      This notice has status <strong>{STATUS_LABELS[infData.status]?.label ?? infData.status}</strong> and
                      cannot be appealed online. If you believe this is an error, please contact the compliance team directly.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Appeal form */}
            {!NON_APPEALABLE.includes(infData.status) && (
              <Card>
                <CardHeader>
                  <CardTitle>Submit Your Appeal</CardTitle>
                  <CardDescription>
                    Provide your contact details and the grounds for your appeal. Be as specific as possible.
                    All appeals are reviewed by our compliance team.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label>Your Name</Label>
                      <Input value={appellantName} onChange={(e) => setAppellantName(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email Address</Label>
                      <Input type="email" value={appellantEmail} onChange={(e) => setAppellantEmail(e.target.value)} placeholder="you@example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Phone Number</Label>
                      <Input value={appellantPhone} onChange={(e) => setAppellantPhone(e.target.value)} placeholder="02x xxx xxxx" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Grounds for Appeal *</Label>
                    <Textarea
                      rows={5}
                      value={grounds}
                      onChange={(e) => setGrounds(e.target.value)}
                      placeholder="Describe why you believe this infringement should be withdrawn, reduced, or reconsidered. Include dates, times, and any relevant facts."
                    />
                    {grounds.trim().length > 0 && grounds.trim().length < 10 && (
                      <p className="text-xs text-red-600">Please provide at least 10 characters.</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Supporting Evidence or Documents (optional)</Label>
                    <Textarea
                      rows={3}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      placeholder="List any documents, photos, receipts, or other evidence you can provide and why they are relevant."
                    />
                  </div>

                  <div className="flex items-start gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>
                      By submitting this form you confirm the information is accurate to the best of your knowledge.
                      Your contact details will only be used to respond to this appeal.
                    </p>
                  </div>

                  <Button onClick={handleSubmit} disabled={!canAppeal || submitting}>
                    <Send className="h-4 w-4 mr-2" />
                    {submitting ? 'Submitting…' : 'Submit Appeal'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Success state */}
        {submitted && (
          <Card className="border-green-300 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center gap-3 text-center text-green-900">
                <CheckCircle2 className="h-12 w-12 text-green-600" />
                <h2 className="text-lg font-semibold">Appeal Received</h2>
                <p className="text-sm max-w-md">
                  Your appeal for notice <strong>{appealRef}</strong> has been submitted and is now under review.
                  The compliance team will contact you within 10 working days. Please keep this page reference for your records.
                </p>
                <p className="text-xs text-green-700 mt-1">
                  If you provided an email address, a copy of your submission will be referenced in our system.
                </p>
                <Button
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    setSubmitted(false)
                    setInfData(null)
                    setInfNumber('')
                    setPlateInput('')
                    setGrounds('')
                    setEvidence('')
                    setAppellantName('')
                    setAppellantEmail('')
                    setAppellantPhone('')
                  }}
                >
                  Submit Another Appeal
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
