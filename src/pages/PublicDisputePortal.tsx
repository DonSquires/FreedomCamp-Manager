import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { AlertTriangle, Search, Send, ShieldCheck } from 'lucide-react'

type LookupResult = {
  case_type: 'notice_to_vacate' | 'infringement'
  case: {
    reference: string
    plate_number: string
    status: string
    issued_at: string
    due_date?: string
    vacate_deadline?: string
    zone_name?: string | null
    reason?: string | null
    legal_basis?: string | null
    nights_stayed?: number | null
    offence_date?: string | null
    offence_location?: string | null
  }
  evidence: {
    photo_url?: string | null
  }
}

export default function PublicDisputePortal() {
  const [reference, setReference] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [caseData, setCaseData] = useState<LookupResult | null>(null)

  const [claimantName, setClaimantName] = useState('')
  const [claimantEmail, setClaimantEmail] = useState('')
  const [claimantPhone, setClaimantPhone] = useState('')
  const [message, setMessage] = useState('')
  const [requestHomelessReview, setRequestHomelessReview] = useState(false)
  const [hardshipContext, setHardshipContext] = useState('')
  const [evidenceStatement, setEvidenceStatement] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = useMemo(() => {
    return !!caseData && message.trim().length >= 10
  }, [caseData, message])

  const lookup = async () => {
    if (!reference.trim()) {
      toast.error('Please enter a notice reference')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('public-case-lookup', {
        body: {
          reference: reference.trim(),
          plate_number: plateNumber.trim().toUpperCase() || undefined,
        },
      })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Lookup failed')

      setCaseData(data as LookupResult)
      toast.success('Notice found')
    } catch (err: any) {
      setCaseData(null)
      toast.error(err?.message || 'Could not find a matching notice')
    } finally {
      setLoading(false)
    }
  }

  const submit = async () => {
    if (!canSubmit || !caseData) return

    setSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('submit-dispute-intake', {
        body: {
          source_type: caseData.case_type,
          source_reference: caseData.case.reference,
          plate_number: caseData.case.plate_number,
          claimant_name: claimantName || undefined,
          claimant_email: claimantEmail || undefined,
          claimant_phone: claimantPhone || undefined,
          message: message.trim(),
          request_homeless_review: requestHomelessReview,
          hardship_context: hardshipContext || undefined,
          evidence_statement: evidenceStatement || undefined,
        },
      })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Submission failed')

      toast.success(`Dispute submitted. Reference: ${data.dispute_id}`)
      setMessage('')
      setHardshipContext('')
      setEvidenceStatement('')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit dispute')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Notice Review and Dispute Portal
            </CardTitle>
            <CardDescription>
              View notice evidence and contact the team to dispute an infringement, Notice to Vacate, or request homeless/hardship review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Notice Reference *</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="e.g. INF-2026-001234" />
              </div>
              <div className="space-y-1.5">
                <Label>Plate Number (optional but recommended)</Label>
                <Input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} placeholder="ABC123" />
              </div>
            </div>
            <Button onClick={lookup} disabled={loading}>
              <Search className="h-4 w-4 mr-2" />
              {loading ? 'Looking up…' : 'Find Notice'}
            </Button>
          </CardContent>
        </Card>

        {caseData && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Notice Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><strong>Type:</strong> {caseData.case_type === 'notice_to_vacate' ? 'Notice to Vacate' : 'Infringement'}</p>
                <p><strong>Reference:</strong> {caseData.case.reference}</p>
                <p><strong>Plate:</strong> {caseData.case.plate_number}</p>
                <p><strong>Status:</strong> {caseData.case.status}</p>
                {caseData.case.zone_name && <p><strong>Zone:</strong> {caseData.case.zone_name}</p>}
                {caseData.case.reason && <p><strong>Reason:</strong> {caseData.case.reason}</p>}
                {caseData.case.legal_basis && <p><strong>Legal Basis:</strong> {caseData.case.legal_basis}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
                <CardDescription>Evidence recorded at the time of the notice.</CardDescription>
              </CardHeader>
              <CardContent>
                {caseData.evidence?.photo_url ? (
                  <div className="space-y-3">
                    <img src={caseData.evidence.photo_url} alt="Evidence" className="max-h-80 rounded border" />
                    <a className="text-sm text-blue-700 underline" href={caseData.evidence.photo_url} target="_blank" rel="noreferrer">
                      Open full-size evidence image
                    </a>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                    <p>No photo evidence is linked to this reference in the portal yet. You can still submit your dispute and request full evidence review.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Submit Dispute / Review Request</CardTitle>
                <CardDescription>Provide enough detail for the team to assess your request quickly.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Your Name</Label>
                    <Input value={claimantName} onChange={(e) => setClaimantName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={claimantEmail} onChange={(e) => setClaimantEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={claimantPhone} onChange={(e) => setClaimantPhone(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Dispute Details *</Label>
                  <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Explain why you are disputing this notice and what outcome you seek." />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox id="homeless-review" checked={requestHomelessReview} onCheckedChange={(v) => setRequestHomelessReview(Boolean(v))} />
                  <Label htmlFor="homeless-review">Request homeless / hardship status review</Label>
                </div>

                {requestHomelessReview && (
                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Hardship Context</Label>
                      <Textarea rows={3} value={hardshipContext} onChange={(e) => setHardshipContext(e.target.value)} placeholder="Brief context about housing hardship/current circumstances." />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Evidence You Want Reviewed</Label>
                      <Textarea rows={3} value={evidenceStatement} onChange={(e) => setEvidenceStatement(e.target.value)} placeholder="Documents/records/photos and why they matter." />
                    </div>
                  </div>
                )}

                <Button onClick={submit} disabled={!canSubmit || submitting}>
                  <Send className="h-4 w-4 mr-2" />
                  {submitting ? 'Submitting…' : 'Submit to Compliance Team'}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
