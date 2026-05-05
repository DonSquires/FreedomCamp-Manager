/**
 * PublicNoiseComplaintPortal (B-13 + B-11)
 *
 * Public-facing page — no login required.
 * Residents can:
 *   1. Submit a noise complaint (gets back a reference number).
 *   2. Check the status of an existing complaint by reference number.
 *
 * B-11: Multi-language support — EN / Māori / Mandarin / Hindi
 *       Auto-detects from browser; user can override via switcher.
 *
 * Route: /public/noise-complaint
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePublicLocale } from '@/hooks/usePublicLocale'
import type { Locale } from '@/lib/publicLocale'
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
  Globe,
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

const LOCALE_LABELS: Record<Locale, string> = { en: 'EN', mi: 'MĀ', zh: '中', hi: 'हि' }

const STATUS_CLASSES: Record<ComplaintStatus, { icon: typeof Clock; className: string }> = {
  received:        { icon: Clock,         className: 'bg-blue-100 text-blue-800 border-blue-200'      },
  acknowledged:    { icon: CheckCircle,   className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  assigned:        { icon: CheckCircle,   className: 'bg-purple-100 text-purple-800 border-purple-200' },
  on_scene:        { icon: CheckCircle,   className: 'bg-cyan-100 text-cyan-800 border-cyan-200'       },
  resolved:        { icon: CheckCircle,   className: 'bg-green-100 text-green-800 border-green-200'    },
  no_action_taken: { icon: AlertTriangle, className: 'bg-gray-100 text-gray-700 border-gray-200'       },
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PublicNoiseComplaintPortal() {
  const { t, locale, setLocale } = usePublicLocale()

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

  // Translated noise type labels (derived from current locale)
  const NOISE_TYPE_LABELS: Record<NoiseType, string> = {
    music:        t.nc.noiseMusic,
    party:        t.nc.noiseParty,
    machinery:    t.nc.noiseMachinery,
    animals:      t.nc.noiseAnimals,
    construction: t.nc.noiseConstruction,
    vehicle:      t.nc.noiseVehicle,
    other:        t.nc.noiseOther,
  }

  // Translated status labels (derived from current locale)
  const STATUS_LABELS: Record<ComplaintStatus, string> = {
    received:        t.nc.statusReceived,
    acknowledged:    t.nc.statusAcknowledged,
    assigned:        t.nc.statusAssigned,
    on_scene:        t.nc.statusOnScene,
    resolved:        t.nc.statusResolved,
    no_action_taken: t.nc.statusNoAction,
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim() || !description.trim()) {
      toast.error(t.nc.errorRequired)
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
      toast.success(t.nc.toastSuccess)
    } catch (err: any) {
      toast.error(err?.message ?? t.nc.errorSubmitFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const handleLookup = async () => {
    const ref = lookupRef.trim().toUpperCase()
    if (!ref) { toast.error(t.nc.enterRef); return }

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
        setLookupError(t.nc.errorNoComplaint)
        return
      }
      setLookupResult(data as StatusResult)
    } catch (err: any) {
      setLookupError(err?.message ?? t.nc.errorLookupFailed)
    } finally {
      setLookingUp(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      {/* Header */}
      <header className="bg-white border-b border-orange-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Volume2 className="h-6 w-6 text-orange-700 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-orange-900">{t.nc.title}</h1>
              <p className="text-xs text-orange-700">{t.nc.subtitle}</p>
            </div>
          </div>
          {/* Language switcher */}
          <div className="flex items-center gap-1">
            <Globe className="h-3.5 w-3.5 text-orange-600 mr-0.5" />
            {(['en', 'mi', 'zh', 'hi'] as Locale[]).map(l => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={[
                  'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                  locale === l ? 'bg-orange-700 text-white' : 'text-orange-700 hover:bg-orange-100',
                ].join(' ')}
                aria-label={t.lang[l]}
                title={t.lang[l]}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Disclaimer */}
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            {t.nc.emergencyLine1}{' '}
            <strong>{t.nc.emergencyBold1}</strong>{' '}
            {t.nc.emergencyLine2}{' '}
            <strong>{t.nc.emergencyNumber}</strong>.{' '}
            {t.nc.emergencyLine3}
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
            {t.nc.tabSubmit}
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'status' ? 'default' : 'outline'}
            onClick={() => setActiveTab('status')}
            className="gap-1.5"
          >
            <Search className="h-3.5 w-3.5" />
            {t.nc.tabStatus}
          </Button>
        </div>

        {/* ── Submit tab ──────────────────────────────────────────────────── */}
        {activeTab === 'submit' && !submittedRef && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-orange-600" />
                {t.nc.formTitle}
              </CardTitle>
              <CardDescription>{t.nc.formRequired}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="address">{t.nc.labelAddress}</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="address"
                      className="pl-9"
                      placeholder={t.nc.placeholderAddress}
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="suburb">{t.nc.labelSuburb}</Label>
                  <Input
                    id="suburb"
                    placeholder={t.nc.placeholderSuburb}
                    value={suburb}
                    onChange={e => setSuburb(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="noise-type">{t.nc.labelNoiseType}</Label>
                  <Select value={noiseType} onValueChange={(v) => setNoiseType(v as NoiseType)}>
                    <SelectTrigger id="noise-type">
                      <SelectValue placeholder={t.nc.placeholderNoiseType} />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(NOISE_TYPE_LABELS) as [NoiseType, string][]).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description">{t.nc.labelDescription}</Label>
                  <Textarea
                    id="description"
                    placeholder={t.nc.placeholderDescription}
                    rows={4}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    required
                    minLength={10}
                  />
                </div>

                <p className="text-xs text-muted-foreground font-medium pt-1">
                  {t.nc.contactOptional}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">{t.nc.labelName}</Label>
                    <Input id="name" placeholder={t.nc.placeholderName} value={name} onChange={e => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">{t.nc.labelPhone}</Label>
                    <Input id="phone" type="tel" placeholder="021 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="email">{t.nc.labelEmail}</Label>
                    <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                  </div>
                </div>

                <Button type="submit" disabled={submitting} className="w-full gap-2">
                  <Send className="h-4 w-4" />
                  {submitting ? t.nc.btnSubmitting : t.nc.btnSubmit}
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
              <h2 className="text-lg font-semibold text-green-900">{t.nc.successTitle}</h2>
              <p className="text-sm text-green-800">{t.nc.successRefLabel}</p>
              <p className="text-2xl font-mono font-bold text-green-900 tracking-widest">{submittedRef}</p>
              <p className="text-xs text-green-700 max-w-sm mx-auto">{t.nc.successSave}</p>
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
                  {t.nc.btnCheckStatus}
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
                  {t.nc.btnSubmitAnother}
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
                {t.nc.statusTitle}
              </CardTitle>
              <CardDescription>{t.nc.statusDesc}</CardDescription>
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
                  {lookingUp ? t.nc.btnChecking : t.nc.btnCheck}
                </Button>
              </div>

              {lookupError && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {lookupError}
                </div>
              )}

              {lookupResult && (() => {
                const sc = STATUS_CLASSES[lookupResult.status]
                const StatusIcon = sc.icon
                const statusLabel = STATUS_LABELS[lookupResult.status]
                return (
                  <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-mono font-bold text-sm">{lookupResult.reference}</span>
                      <Badge className={`text-xs border ${sc.className} flex items-center gap-1`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {statusLabel}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">{t.nc.addrLabel}</span> {lookupResult.address}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">{t.nc.submittedLabel}</span>{' '}
                      {new Date(lookupResult.created_at).toLocaleString('en-NZ', {
                        timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short',
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">{t.nc.updatedLabel}</span>{' '}
                      {new Date(lookupResult.updated_at).toLocaleString('en-NZ', {
                        timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short',
                      })}
                    </p>
                    {lookupResult.status_message && (
                      <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-700">
                        <span className="font-medium">{t.nc.officerMsgLabel}</span>{' '}
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
          FieldOps Manager · {t.nc.footerEmergency} ·
          {' '}<a href="/public/zone-map" className="text-orange-700 hover:underline">{t.nc.footerZoneMap}</a>
          {' '}·{' '}<a href="/dispute" className="text-orange-700 hover:underline">{t.nc.footerDispute}</a>
        </footer>
      </main>
    </div>
  )
}
