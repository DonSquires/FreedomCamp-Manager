/**
 * PublicNoiseComplaintPortal (B-13)
 *
 * Public-facing page — no login required.
 * Residents can:
 *   1. Submit a noise complaint (gets back a reference number).
 *   2. Check the status of an existing complaint by reference number.
 *
 * Route: /public/noise-complaint
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Volume2,
  Search,
  Send,
  CheckCircle,
  Clock,
  AlertTriangle,
  Info,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────
type NoiseType = 'music' | 'party' | 'machinery' | 'animals' | 'construction' | 'vehicle' | 'other'
type ComplaintStatus = 'received' | 'acknowledged' | 'assigned' | 'on_scene' | 'resolved' | 'no_action_taken'

interface StatusResult {
  reference: string
  status: ComplaintStatus
  status_message: string | null
  created_at: string
  updated_at: string
  address: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<ComplaintStatus, { label: string; icon: typeof Clock; className: string }> = {
  received:          { label: 'Received',          icon: Clock,         className: 'bg-blue-100 text-blue-800 border-blue-200'   },
  acknowledged:      { label: 'Acknowledged',      icon: CheckCircle,   className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  assigned:          { label: 'Officer Assigned',  icon: CheckCircle,   className: 'bg-purple-100 text-purple-800 border-purple-200' },
  on_scene:          { label: 'Officer On Scene',  icon: CheckCircle,   className: 'bg-cyan-100 text-cyan-800 border-cyan-200'    },
  resolved:          { label: 'Resolved',          icon: CheckCircle,   className: 'bg-green-100 text-green-800 border-green-200' },
  no_action_taken:   { label: 'No Action Taken',   icon: AlertTriangle, className: 'bg-gray-100 text-gray-700 border-gray-200'    },
}

const NOISE_TYPE_LABELS: Record<NoiseType, string> = {
  music:        'Music / Loud Audio',
  party:        'Party / Social Gathering',
  machinery:    'Machinery / Power Tools',
  animals:      'Animals (dogs, roosters, etc.)',
  construction: 'Construction / Building Work',
  vehicle:      'Vehicle (engine revving, exhausts)',
  other:        'Other',
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PublicNoiseComplaintPortal() {
  // Form state
  const [address, setAddress] = useState('')
  const [suburb, setSuburb] = useState('')
  const [description, setDescription] = useState('')
  const [noiseType, setNoiseType] = useState<NoiseType | ''>('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submittedRef, setSubmittedRef] = useState<string | null>(null)

  // Status check state
  const [lookupRef, setLookupRef] = useState('')
  const [lookupResult, setLookupResult] = useState<StatusResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<'submit' | 'status'>('submit')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim() || !description.trim()) {
      toast.error('Address and description are required')
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await (supabase as any)
        .from('public_noise_complaints')
        .insert({
          address:                address.trim(),
          suburb:                 suburb.trim() || null,
          complaint_description:  description.trim(),
          noise_type:             noiseType || null,
          complainant_name:       name.trim() || null,
          complainant_email:      email.trim() || null,
          complainant_phone:      phone.trim() || null,
        })
        .select('reference')
        .single()

      if (error) throw error

      setSubmittedRef(data.reference)
      toast.success('Complaint submitted successfully')
    } catch (err: any) {
      toast.error(err?.message ?? 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLookup = async () => {
    const ref = lookupRef.trim().toUpperCase()
    if (!ref) { toast.error('Please enter a reference number'); return }

    setLookingUp(true)
    setLookupResult(null)
    setLookupError(null)
    try {
      const { data, error } = await (supabase as any)
        .from('public_noise_complaints')
        .select('reference, status, status_message, created_at, updated_at, address')
        .eq('reference', ref)
        .single()

      if (error || !data) {
        setLookupError('No complaint found with that reference number.')
        return
      }
      setLookupResult(data as StatusResult)
    } catch (err: any) {
      setLookupError(err?.message ?? 'Lookup failed. Please try again.')
    } finally {
      setLookingUp(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      {/* Header */}
      <header className="bg-white border-b border-orange-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Volume2 className="h-6 w-6 text-orange-700 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-orange-900">Noise Complaint Portal</h1>
            <p className="text-xs text-orange-700">Report a noise issue in your area • No login required</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Disclaimer */}
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            For <strong>emergencies or immediate threats</strong> call <strong>111</strong>.
            This portal is for non-emergency noise complaints outside business hours.
            Your contact details are optional and will only be used to follow up on your complaint.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={activeTab === 'submit' ? 'default' : 'outline'}
            onClick={() => setActiveTab('submit')}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Submit Complaint
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'status' ? 'default' : 'outline'}
            onClick={() => setActiveTab('status')}
            className="gap-1.5"
          >
            <Search className="h-3.5 w-3.5" />
            Check Status
          </Button>
        </div>

        {/* ── Submit tab ──────────────────────────────────────────────────── */}
        {activeTab === 'submit' && !submittedRef && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-orange-600" />
                Report a Noise Issue
              </CardTitle>
              <CardDescription>Fields marked * are required.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="address">Address of noise source *</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="address"
                      className="pl-9"
                      placeholder="e.g. 12 Example Street"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="suburb">Suburb / Area</Label>
                  <Input
                    id="suburb"
                    placeholder="e.g. Napier Hill"
                    value={suburb}
                    onChange={e => setSuburb(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="noise-type">Type of noise</Label>
                  <Select value={noiseType} onValueChange={(v) => setNoiseType(v as NoiseType)}>
                    <SelectTrigger id="noise-type">
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(NOISE_TYPE_LABELS) as [NoiseType, string][]).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description">Describe the noise issue *</Label>
                  <Textarea
                    id="description"
                    placeholder="Please describe what you can hear, when it started, and any other relevant details…"
                    rows={4}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    required
                    minLength={10}
                  />
                </div>

                <p className="text-xs text-muted-foreground font-medium pt-1">
                  Your contact details (optional — only used for follow-up)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" placeholder="021 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                  </div>
                </div>

                <Button type="submit" disabled={submitting} className="w-full gap-2">
                  <Send className="h-4 w-4" />
                  {submitting ? 'Submitting…' : 'Submit Complaint'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Submission success ───────────────────────────────────────────── */}
        {activeTab === 'submit' && submittedRef && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="pt-6 text-center space-y-3">
              <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
              <h2 className="text-lg font-semibold text-green-900">Complaint Received</h2>
              <p className="text-sm text-green-800">Your reference number is:</p>
              <p className="text-2xl font-mono font-bold text-green-900 tracking-widest">{submittedRef}</p>
              <p className="text-xs text-green-700 max-w-sm mx-auto">
                Save this reference number. You can use it to check the status of your complaint on this page.
              </p>
              <div className="flex gap-2 justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLookupRef(submittedRef)
                    setActiveTab('status')
                  }}
                  className="gap-1.5 border-green-300 text-green-800"
                >
                  <Search className="h-3.5 w-3.5" />
                  Check Status
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSubmittedRef(null)
                    setAddress(''); setSuburb(''); setDescription('')
                    setNoiseType(''); setName(''); setEmail(''); setPhone('')
                  }}
                  className="gap-1.5 border-green-300 text-green-800"
                >
                  Submit Another
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Status check tab ────────────────────────────────────────────── */}
        {activeTab === 'status' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4 text-orange-600" />
                Check Complaint Status
              </CardTitle>
              <CardDescription>Enter your reference number (e.g. NCC-2026-000001).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="NCC-2026-000001"
                  value={lookupRef}
                  onChange={e => setLookupRef(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleLookup()}
                  className="font-mono"
                />
                <Button onClick={handleLookup} disabled={lookingUp} className="gap-1.5 shrink-0">
                  <Search className="h-4 w-4" />
                  {lookingUp ? 'Searching…' : 'Check'}
                </Button>
              </div>

              {lookupError && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {lookupError}
                </div>
              )}

              {lookupResult && (() => {
                const sc = STATUS_CONFIG[lookupResult.status]
                const StatusIcon = sc.icon
                return (
                  <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-mono font-bold text-sm">{lookupResult.reference}</span>
                      <Badge className={`text-xs border ${sc.className} flex items-center gap-1`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {sc.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Address:</span> {lookupResult.address}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Submitted:</span>{' '}
                      {new Date(lookupResult.created_at).toLocaleString('en-NZ', {
                        timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short',
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Last updated:</span>{' '}
                      {new Date(lookupResult.updated_at).toLocaleString('en-NZ', {
                        timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short',
                      })}
                    </p>
                    {lookupResult.status_message && (
                      <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-700">
                        <span className="font-medium">Message from officer:</span>{' '}
                        {lookupResult.status_message}
                      </div>
                    )}
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pt-4 pb-8 border-t">
          FieldOps Manager · For emergencies call 111 ·
          {' '}<a href="/public/zone-map" className="text-orange-700 hover:underline">Freedom camping zone map</a>
          {' '}·{' '}<a href="/dispute" className="text-orange-700 hover:underline">Dispute a notice</a>
        </footer>
      </main>
    </div>
  )
}
