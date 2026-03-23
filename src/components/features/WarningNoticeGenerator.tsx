/**
 * WarningNoticeGenerator Component
 * Generate and print formal warning notices via generate-warning-notice edge function.
 */

import { formatDate } from '@/lib/utils'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/authStore'
import { edgeFunctions } from '@/lib/edgeFunctions'
import {
  FileText,
  Send,
  Download,
  Eye,
  Calendar,
  MapPin,
  AlertTriangle,
  Printer,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

interface WarningNoticeGeneratorProps {
  plateNumber: string
  zoneId: string
  zoneName: string
  breachType: string
  breachReason: string
  observationId?: string
  breachAlertId?: string
  onGenerated?: (actionId: string, warningNumber: string) => void
}

export function WarningNoticeGenerator({
  plateNumber,
  zoneId,
  zoneName,
  breachType,
  breachReason,
  observationId,
  breachAlertId,
  onGenerated,
}: WarningNoticeGeneratorProps) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'physical'>('physical')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [noticeHtml, setNoticeHtml] = useState<string | null>(null)
  const [warningNumber, setWarningNumber] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // ── Issue + generate ───────────────────────────────────────────────────────
  const handleIssue = async () => {
    if (deliveryMethod === 'email' && !recipientEmail.trim()) {
      toast.error('Recipient email is required for email delivery')
      return
    }
    if (!user?.id) {
      toast.error('Not authenticated')
      return
    }

    setIsPending(true)
    try {
      const result = await edgeFunctions.generateWarningNotice({
        plate_number: plateNumber,
        zone_id: zoneId,
        breach_type: breachType,
        breach_reason: breachReason,
        issued_by: user.id,
        observation_id: observationId,
        breach_alert_id: breachAlertId,
        recipient_name: recipientName || undefined,
        recipient_email: recipientEmail || undefined,
        additional_notes: additionalNotes || undefined,
        delivery_method: deliveryMethod,
      })

      if (result.error) throw new Error(result.error)

      const data = result.data as { action_id: string; warning_number: string; html: string }
      setNoticeHtml(data.html)
      setWarningNumber(data.warning_number)
      toast.success(`Warning notice ${data.warning_number} issued`)
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      onGenerated?.(data.action_id, data.warning_number)

      // Auto-open preview after issue
      setPreviewOpen(true)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to issue warning notice')
    } finally {
      setIsPending(false)
    }
  }

  // ── Preview in new window (print-ready) ──────────────────────────────────
  const openPrintWindow = (mode: 'open' | 'print') => {
    if (!noticeHtml) {
      toast.error('Generate the notice first')
      return
    }
    const win = window.open('', '_blank')
    if (!win) {
      toast.error('Allow popups for this site and try again')
      return
    }
    win.document.open()
    win.document.write(noticeHtml)
    win.document.close()
    const finish = () => {
      win.focus()
      if (mode === 'print') {
        window.setTimeout(() => { win.focus(); win.print() }, 250)
      }
    }
    if (win.document.readyState === 'complete') { finish(); return }
    win.onload = finish
  }

  // ── Download as HTML file ─────────────────────────────────────────────────
  const handleDownload = () => {
    if (!noticeHtml) {
      toast.error('Generate the notice first')
      return
    }
    const blob = new Blob([noticeHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `warning-notice-${warningNumber ?? plateNumber}-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Warning notice downloaded')
  }

  const isIssued = !!noticeHtml

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-amber-500" />
            Issue Warning Notice
            {warningNumber && <Badge variant="outline" className="ml-auto font-mono text-xs">{warningNumber}</Badge>}
          </CardTitle>
          <CardDescription>
            Formal first-step enforcement — Freedom Camping Act 2011
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Notice summary */}
          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">Warning Notice</span>
              <Badge className="bg-amber-100 text-amber-800 border-amber-300">First-step enforcement</Badge>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-muted-foreground">Vehicle:</span>
                <span className="font-mono font-semibold">{plateNumber}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-muted-foreground">Zone:</span>
                <span className="font-medium">{zoneName}</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-muted-foreground">Breach: </span>
                  <span className="font-medium">{breachType.replace(/_/g, ' ')}</span>
                  <div className="text-muted-foreground text-xs mt-0.5 leading-snug">{breachReason}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-muted-foreground">Issue Date:</span>
                <span>{formatDate(new Date().toISOString())}</span>
              </div>
            </div>
          </div>

          {/* Delivery method */}
          <div className="space-y-1.5">
            <Label>Delivery Method</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={deliveryMethod === 'physical' ? 'default' : 'outline'}
                onClick={() => setDeliveryMethod('physical')}
                className="flex-1"
                disabled={isPending || isIssued}
              >
                Physical Copy
              </Button>
              <Button
                type="button"
                variant={deliveryMethod === 'email' ? 'default' : 'outline'}
                onClick={() => setDeliveryMethod('email')}
                className="flex-1"
                disabled={isPending || isIssued}
              >
                Email
              </Button>
            </div>
          </div>

          {/* Recipient details */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="warn-recipient-name">Recipient Name (Optional)</Label>
              <Input
                id="warn-recipient-name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Vehicle owner name"
                disabled={isPending || isIssued}
              />
            </div>
            {deliveryMethod === 'email' && (
              <div>
                <Label htmlFor="warn-recipient-email">
                  Recipient Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="warn-recipient-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="owner@example.com"
                  disabled={isPending || isIssued}
                />
              </div>
            )}
          </div>

          {/* Additional notes */}
          <div>
            <Label htmlFor="warn-notes">Additional Notes (Optional)</Label>
            <textarea
              id="warn-notes"
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Any additional context or instructions..."
              disabled={isPending || isIssued}
              className="w-full min-h-20 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary text-sm disabled:opacity-60"
            />
          </div>

          {/* Actions */}
          {!isIssued ? (
            <div className="flex gap-2 pt-2 border-t">
              <Button
                onClick={handleIssue}
                disabled={isPending}
                className="flex-1 bg-amber-600 hover:bg-amber-700"
              >
                {isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                ) : (
                  <><Send className="h-4 w-4 mr-2" />{deliveryMethod === 'email' ? 'Issue & Email Warning' : 'Issue Warning Notice'}</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 pt-2 border-t">
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-200 font-medium">
                ✅ Warning notice {warningNumber} issued successfully
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPreviewOpen(true)}>
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </Button>
                <Button variant="outline" className="flex-1" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button className="flex-1" onClick={() => openPrintWindow('print')}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              Warning Notice Preview — {warningNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <iframe
              srcDoc={noticeHtml ?? ''}
              className="w-full h-[70vh] border rounded-lg"
              title="Warning Notice Preview"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button variant="outline" onClick={() => openPrintWindow('open')}>
              <Eye className="h-4 w-4 mr-2" />
              Open in Tab
            </Button>
            <Button onClick={() => openPrintWindow('print')}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

