/**
 * PublicPayByPlate.tsx — B-29 Pay-by-Plate Integration
 *
 * Public page accessible at /public/pay-by-plate (no login required).
 *
 * Allows motorists to pay for their parking stay using their plate number
 * and zone selection. Integrates with the initiate-parking-payment edge
 * function which calls PayByPhone NZ when configured, or returns a mock
 * payment URL in development / degraded mode.
 *
 * Flow:
 *   1. Enter plate number + select zone → view zone details + fee
 *   2. Choose duration → calculate total
 *   3. Optionally enter contact details for receipt
 *   4. Submit → redirect to PayByPhone NZ payment page (or mock confirmation)
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ParkingSquare,
  Car,
  MapPin,
  Clock,
  CreditCard,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Zone {
  id: string
  name: string
  fee_nzd: number | null
  max_vehicles: number | null
  description?: string | null
}

interface PaymentResult {
  payment_id: string
  payment_url: string
  amount_nzd: number
  provider: string
}

const DURATION_OPTIONS = [
  { value: 30,   label: '30 minutes' },
  { value: 60,   label: '1 hour' },
  { value: 90,   label: '1.5 hours' },
  { value: 120,  label: '2 hours' },
  { value: 180,  label: '3 hours' },
  { value: 240,  label: '4 hours' },
  { value: 480,  label: '8 hours' },
  { value: 720,  label: '12 hours' },
  { value: 1440, label: '24 hours' },
]

const DEFAULT_HOURLY_RATE = 2.00

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicPayByPlate() {
  const [plate, setPlate] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [durationMins, setDurationMins] = useState(60)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<PaymentResult | null>(null)

  // ── Fetch active zones with fees ───────────────────────────────────────────
  const { data: zones = [], isLoading: zonesLoading } = useQuery<Zone[]>({
    queryKey: ['public-parking-zones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, fee_nzd, max_vehicles, description')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      // Return zones that have a fee set (parking zones) or all active zones
      return (data ?? []) as Zone[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const selectedZone = useMemo(() => zones.find(z => z.id === zoneId), [zones, zoneId])
  const hourlyRate = selectedZone?.fee_nzd ?? DEFAULT_HOURLY_RATE
  const totalAmount = Math.round((hourlyRate * durationMins / 60) * 100) / 100

  const normalisedPlate = plate.toUpperCase().replace(/\s+/g, '')
  const isValidPlate = normalisedPlate.length >= 2 && normalisedPlate.length <= 8
  const canSubmit = isValidPlate && !!zoneId && durationMins > 0

  // ── Submit payment ─────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const resp = await edgeFunctions.initiateParkingPayment({
        plate_number: normalisedPlate,
        zone_id: zoneId,
        duration_mins: durationMins,
        contact_email: email.trim() || undefined,
        contact_phone: phone.trim() || undefined,
      })

      if (resp.error) {
        throw new Error(typeof resp.error === 'string' ? resp.error : 'Payment initiation failed')
      }

      const data = resp.data as PaymentResult
      setResult(data)

      // If provider returns a real payment URL, open in a new tab
      if (data.provider !== 'mock') {
        window.open(data.payment_url, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      toast.error('Payment initiation failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Post-payment confirmation ──────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-xl">Payment Session Created</CardTitle>
            <CardDescription>
              Your parking payment session has been initiated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Reference</span>
                <span className="font-mono font-medium">{result.payment_id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plate</span>
                <span className="font-medium">{normalisedPlate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Zone</span>
                <span className="font-medium">{selectedZone?.name ?? zoneId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">{DURATION_OPTIONS.find(d => d.value === durationMins)?.label ?? `${durationMins} min`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold text-base">NZ${result.amount_nzd.toFixed(2)}</span>
              </div>
            </div>

            {result.provider === 'mock' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-700">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  <strong>Preview mode:</strong> Live payment processing is not yet configured for this zone.
                  Please contact the parking authority to complete payment.
                </p>
              </div>
            ) : (
              <Button className="w-full" onClick={() => window.open(result.payment_url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Complete Payment with PayByPhone
              </Button>
            )}

            <Button variant="outline" className="w-full" onClick={() => setResult(null)}>
              Pay for another vehicle
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Payment form ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center pt-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <ParkingSquare className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Pay by Plate</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Enter your plate number and zone to pay for your parking.
          </p>
        </div>

        {/* Vehicle & Zone */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4" /> Vehicle & Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plate">Number Plate *</Label>
              <Input
                id="plate"
                value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                maxLength={8}
                className="uppercase text-lg tracking-widest font-mono"
              />
              {plate && !isValidPlate && (
                <p className="text-xs text-destructive">Plate must be 2–8 characters</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="zone">Parking Zone *</Label>
              {zonesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading zones…
                </div>
              ) : (
                <Select value={zoneId} onValueChange={setZoneId}>
                  <SelectTrigger id="zone">
                    <SelectValue placeholder="Select your parking zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.name}
                        {z.fee_nzd != null && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            (NZ${z.fee_nzd}/hr)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedZone && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm space-y-1">
                <p className="font-medium text-blue-900 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {selectedZone.name}
                </p>
                {selectedZone.description && (
                  <p className="text-blue-700 text-xs">{selectedZone.description}</p>
                )}
                <p className="text-blue-700 text-xs">
                  Rate: <strong>NZ${hourlyRate.toFixed(2)}/hour</strong>
                  {selectedZone.max_vehicles != null && (
                    <> · Capacity: {selectedZone.max_vehicles} vehicles</>
                  )}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Duration & Payment */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Duration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>How long do you need?</Label>
              <div className="grid grid-cols-3 gap-2">
                {DURATION_OPTIONS.filter(d => d.value <= 240).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setDurationMins(opt.value)}
                    className={`rounded-lg border p-2.5 text-sm text-center transition-colors ${
                      durationMins === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-border bg-background hover:border-blue-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Label className="shrink-0 text-xs text-muted-foreground">Or select:</Label>
                <Select
                  value={String(durationMins)}
                  onValueChange={v => setDurationMins(Number(v))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map(d => (
                      <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {zoneId && (
              <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
                <span className="text-sm font-medium">Total</span>
                <span className="text-xl font-bold">NZ${totalAmount.toFixed(2)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Optional contact details */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Receipt (optional)
            </CardTitle>
            <CardDescription className="text-xs">
              Provide your email or phone to receive a payment confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Mobile Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+64 21 000 0000"
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <Button
          className="w-full h-12 text-base"
          disabled={!canSubmit || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? (
            <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Processing…</>
          ) : (
            <><CreditCard className="h-5 w-5 mr-2" /> Pay NZ${totalAmount.toFixed(2)}</>
          )}
        </Button>

        {/* Footer links */}
        <div className="text-center text-xs text-muted-foreground pb-8 space-x-3">
          <a href="/public/parking-appeal" className="underline underline-offset-2 hover:text-foreground">
            Appeal a Ticket
          </a>
          <span>·</span>
          <a href="/public/zone-map" className="underline underline-offset-2 hover:text-foreground">
            Zone Map
          </a>
          <span>·</span>
          <a href="/public/noise-complaint" className="underline underline-offset-2 hover:text-foreground">
            Noise Complaint
          </a>
        </div>
      </div>
    </div>
  )
}
