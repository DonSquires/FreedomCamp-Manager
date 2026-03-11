import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Clock, Download, FileText, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'

const REPORT_TIMEOUT_MS = 90000
const EMAIL_TIMEOUT_MS = 45000

function downloadHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

async function getValidAccessToken(): Promise<string> {
  const { data: sessionData, error: sessionError } = await withTimeout(
    supabase.auth.getSession(),
    12000,
    'Reading auth session timed out'
  )

  if (sessionError) throw new Error(sessionError.message || 'Failed to read session')

  if (sessionData.session?.access_token) {
    return sessionData.session.access_token
  }

  const { data: refreshData, error: refreshError } = await withTimeout(
    supabase.auth.refreshSession(),
    12000,
    'Refreshing auth session timed out'
  )

  if (refreshError || !refreshData.session?.access_token) {
    throw new Error(refreshError?.message || 'No active session. Please sign in again.')
  }

  return refreshData.session.access_token
}

function buildErrorMessage(status: number, payload: any): string {
  const parts = [
    payload?.error,
    payload?.message,
    payload?.code ? `code=${payload.code}` : null,
    payload?.details,
    payload?.hint,
  ].filter(Boolean)

  return `HTTP ${status}: ${parts.length ? parts.join(' | ') : 'Request failed'}`
}

export default function Reports() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()

  const effectiveOrganizationId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null

  const reportDateTo = dateTo || new Date().toISOString().slice(0, 10)
  const reportDateFrom =
    dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [generating, setGenerating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState(user?.email || '')
  const [sendingEmail, setSendingEmail] = useState(false)

  const handleGenerateCompliance = async () => {
    if (generating) return

    setGenerating(true)

    try {
      const token = await getValidAccessToken()

      const response = await withTimeout(
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-dashboard-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            report_type: 'compliance',
            organization_id: effectiveOrganizationId || undefined,
            zone_id: zoneId || undefined,
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        }),
        REPORT_TIMEOUT_MS,
        'Report generation timed out'
      )

      const text = await response.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = { message: text }
      }

      if (!response.ok) {
        throw new Error(buildErrorMessage(response.status, payload))
      }

      if (!payload?.html) {
        throw new Error('Report generated but html payload was missing')
      }

      setPreviewHtml(payload.html)
      setPreviewOpen(true)
      toast.success('Compliance report generated')
    } catch (error: any) {
      toast.error('Failed to generate compliance report', {
        description: error?.message || 'Unknown error',
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleSendEmail = async () => {
    if (!emailRecipient.trim()) {
      toast.error('Recipient email is required')
      return
    }

    setSendingEmail(true)

    try {
      const token = await getValidAccessToken()

      const response = await withTimeout(
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-report-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            report_type: 'compliance',
            recipient_email: emailRecipient.trim(),
            organization_id: effectiveOrganizationId || undefined,
            zone_id: zoneId || undefined,
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        }),
        EMAIL_TIMEOUT_MS,
        'Email send timed out'
      )

      const text = await response.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = { message: text }
      }

      if (!response.ok) {
        throw new Error(buildErrorMessage(response.status, payload))
      }

      toast.success(`Report sent to ${emailRecipient.trim()}`)
      setEmailDialogOpen(false)
    } catch (error: any) {
      toast.error('Failed to send report email', {
        description: error?.message || 'Unknown error',
      })
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <>
      <AppLayout title="Reports" description="Stabilization mode: compliance report only" showBackButton>
        <GlobalFilterRibbon />

        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle>Reporting Stabilization Mode</CardTitle>
            <CardDescription>
              Only Compliance Report generation and email are enabled while we restore reliability.
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <FileText className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Compliance Report</CardTitle>
              <CardDescription>Detailed compliance statistics and trends</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600 mb-4">
                <li>- Compliance rate by zone</li>
                <li>- Breach type breakdown</li>
                <li>- Monthly trends</li>
                <li>- Top violators</li>
              </ul>

              <Button onClick={handleGenerateCompliance} className="w-full mb-2" disabled={generating}>
                {generating ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Generate Compliance Report
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setEmailRecipient(user?.email || '')
                  setEmailDialogOpen(true)
                }}
                disabled={generating}
              >
                <Mail className="h-4 w-4 mr-2" />
                Send by Email
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Filters</CardTitle>
              <CardDescription>These filters are used for generation and email.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p><strong>From:</strong> {reportDateFrom}</p>
              <p><strong>To:</strong> {reportDateTo}</p>
              <p><strong>Organization:</strong> {effectiveOrganizationId || 'All available to user'}</p>
              <p><strong>Zone:</strong> {zoneId || 'All zones'}</p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="w-[98vw] max-w-[98vw] h-[96vh] flex flex-col p-4">
          <DialogHeader>
            <DialogTitle>Compliance Report Preview</DialogTitle>
            <DialogDescription>In-app preview. Use the report's own Download PDF button.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 border rounded-md overflow-hidden bg-white">
            <iframe title="Compliance report preview" className="w-full h-full" srcDoc={previewHtml} />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!previewHtml) return
                downloadHtml(previewHtml, `compliance-report-${reportDateFrom}-to-${reportDateTo}.html`)
              }}
            >
              Download HTML Copy
            </Button>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailDialogOpen} onOpenChange={(open) => { if (!open) setSendingEmail(false); setEmailDialogOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-600" />
              Send Compliance Report by Email
            </DialogTitle>
            <DialogDescription>
              Sends compliance report for {reportDateFrom} to {reportDateTo}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="report-email-recipient">Recipient email address</Label>
              <Input
                id="report-email-recipient"
                type="email"
                placeholder="e.g. manager@example.com"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                disabled={sendingEmail}
                autoFocus
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setSendingEmail(false); setEmailDialogOpen(false) }}>
              Cancel
            </Button>
            <Button onClick={handleSendEmail} disabled={sendingEmail || !emailRecipient.trim()}>
              {sendingEmail ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Report
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
