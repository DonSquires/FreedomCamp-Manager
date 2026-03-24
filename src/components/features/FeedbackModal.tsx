/**
 * FeedbackModal
 *
 * Enhanced report dialog for bugs, feature requests, and performance issues.
 * Auto-captures rich context (navigation history, console errors, browser info)
 * via getFeedbackSnapshot() and shows the user a "what we'll send" preview
 * before submitting.
 *
 * Saves to the bug_reports table.  Grand-master users can review and trigger
 * AI-assisted fix analysis from Platform.tsx.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Bug, Lightbulb, Zap, ChevronDown, ChevronUp,
  Navigation, AlertTriangle, Monitor, CheckCircle2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { getFeedbackSnapshot, clearCapturedErrors, type FeedbackSnapshot } from '@/hooks/useFeedbackCapture'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FeedbackType = 'bug' | 'feature' | 'performance'
export type Severity = 'low' | 'medium' | 'high' | 'critical'

const TYPE_CONFIG: Record<FeedbackType, { label: string; icon: React.ReactNode; color: string; issueType: string }> = {
  bug:         { label: 'Bug Report',       icon: <Bug className="h-4 w-4" />,       color: 'bg-red-100 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700',     issueType: 'bug' },
  feature:     { label: 'Feature Request',  icon: <Lightbulb className="h-4 w-4" />, color: 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700', issueType: 'feature_request' },
  performance: { label: 'Performance Issue',icon: <Zap className="h-4 w-4" />,       color: 'bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-900/30 dark:border-orange-700', issueType: 'performance' },
}

const SEVERITY_COLORS: Record<Severity, string> = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-yellow-100 text-yellow-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

const inputCls = 'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

// ── Component ─────────────────────────────────────────────────────────────────

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const { user } = useAuthStore()

  const [type, setType] = useState<FeedbackType>('bug')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [stepsToReproduce, setStepsToReproduce] = useState('')
  const [expectedBehaviour, setExpectedBehaviour] = useState('')
  const [actualBehaviour, setActualBehaviour] = useState('')
  const [showContextPreview, setShowContextPreview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Snapshot captured once when the modal opens; re-captured on submit for freshness
  const snapshot: FeedbackSnapshot = getFeedbackSnapshot()

  const handleClose = () => {
    if (loading) return
    setType('bug')
    setSeverity('medium')
    setTitle('')
    setDescription('')
    setStepsToReproduce('')
    setExpectedBehaviour('')
    setActualBehaviour('')
    setShowContextPreview(false)
    setSubmitted(false)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required.')
      return
    }
    if (!user?.id) {
      toast.error('You must be logged in to submit feedback.')
      return
    }

    setLoading(true)
    // Capture a fresh snapshot at submission time
    const finalSnapshot = getFeedbackSnapshot()

    try {
      const { error } = await supabase.from('bug_reports').insert({
        user_id: user.id,
        organization_id: user.organization_id ?? null,
        user_role: user.role,
        title: title.trim(),
        description: description.trim(),
        severity,
        issue_type: TYPE_CONFIG[type].issueType,
        steps_to_reproduce: stepsToReproduce.trim() || null,
        expected_behavior: expectedBehaviour.trim() || null,
        actual_behavior: actualBehaviour.trim() || null,
        current_page: finalSnapshot.currentPage,
        browser_info: {
          ...finalSnapshot.browserInfo,
          navigationHistory: finalSnapshot.navigationHistory,
        } as any,
        console_errors: finalSnapshot.consoleErrors as any,
        app_version: finalSnapshot.appVersion,
        status: 'open',
        admin_notified: false,
      })

      if (error) throw error

      clearCapturedErrors()
      setSubmitted(true)
      toast.success('Report submitted — thank you!')
    } catch (err: any) {
      toast.error('Failed to submit report', { description: err.message })
    } finally {
      setLoading(false)
    }
  }

  // ── Submitted state ───────────────────────────────────────────────────────

  if (submitted) {
    return (
      <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-base">Report Received</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your {TYPE_CONFIG[type].label.toLowerCase()} has been sent to the platform team.
                They can see everything you were doing at the time.
              </p>
            </div>
            <Button onClick={handleClose} className="w-full">Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  const recentErrors = snapshot.consoleErrors.filter(e => e.level === 'error' || e.level === 'unhandled')

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Send Feedback</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Type selector */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_CONFIG) as FeedbackType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                  type === t
                    ? TYPE_CONFIG[t].color
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {TYPE_CONFIG[t].icon}
                {TYPE_CONFIG[t].label}
              </button>
            ))}
          </div>

          {/* Title */}
          <div>
            <label className={labelCls}>Title <span className="text-red-500">*</span></label>
            <input
              className={inputCls}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={type === 'bug' ? 'Brief summary of the issue' : type === 'feature' ? 'What you\'d like to see' : 'What is slow or unresponsive'}
              required
            />
          </div>

          {/* Severity (bugs + performance only) */}
          {type !== 'feature' && (
            <div>
              <label className={labelCls}>Severity</label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high', 'critical'] as Severity[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(s)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                      severity === s
                        ? SEVERITY_COLORS[s] + ' border-current'
                        : 'border-gray-200 dark:border-gray-700 text-muted-foreground hover:border-gray-300'
                    }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label className={labelCls}>Description <span className="text-red-500">*</span></label>
            <textarea
              className={inputCls}
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={type === 'feature' ? 'Describe the feature and how it would help…' : 'Describe what happened…'}
              required
            />
          </div>

          {/* Bug-specific fields */}
          {type === 'bug' && (
            <>
              <div>
                <label className={labelCls}>Steps to Reproduce</label>
                <textarea className={inputCls} rows={2} value={stepsToReproduce} onChange={e => setStepsToReproduce(e.target.value)} placeholder="1. Go to…  2. Click…  3. See error…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Expected</label>
                  <textarea className={inputCls} rows={2} value={expectedBehaviour} onChange={e => setExpectedBehaviour(e.target.value)} placeholder="What should have happened" />
                </div>
                <div>
                  <label className={labelCls}>Actual</label>
                  <textarea className={inputCls} rows={2} value={actualBehaviour} onChange={e => setActualBehaviour(e.target.value)} placeholder="What actually happened" />
                </div>
              </div>
            </>
          )}

          {/* Context preview — what will be sent */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => setShowContextPreview(v => !v)}
            >
              <span className="flex items-center gap-2">
                <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                Context we'll automatically include
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                  {snapshot.navigationHistory.length} pages · {recentErrors.length} error{recentErrors.length !== 1 ? 's' : ''}
                </Badge>
              </span>
              {showContextPreview
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>

            {showContextPreview && (
              <div className="px-3 py-2 space-y-3 text-xs">

                {/* Current page */}
                <div>
                  <p className="font-medium text-muted-foreground flex items-center gap-1 mb-1">
                    <Navigation className="h-3 w-3" /> Current page
                  </p>
                  <code className="block bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 font-mono">
                    {snapshot.currentPage || '/'}
                  </code>
                </div>

                {/* Navigation breadcrumb */}
                {snapshot.navigationHistory.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-1">Recent navigation (last {snapshot.navigationHistory.length} pages)</p>
                    <div className="space-y-0.5">
                      {snapshot.navigationHistory.slice(-6).reverse().map((n, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className={`font-mono ${i === 0 ? 'text-violet-600 font-semibold' : 'text-muted-foreground'}`}>{n.path}</span>
                          <span className="text-muted-foreground/60 ml-auto shrink-0">
                            {new Date(n.timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Console errors */}
                {recentErrors.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground flex items-center gap-1 mb-1">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                      Console errors ({recentErrors.length})
                    </p>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {recentErrors.slice(-5).map((e, i) => (
                        <div key={i} className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1">
                          <span className="font-mono text-red-700 dark:text-red-300 break-all">{e.message.slice(0, 200)}</span>
                          {e.stack && <p className="text-red-500/70 mt-0.5 font-mono break-all">{e.stack.slice(0, 120)}…</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Browser info */}
                <div>
                  <p className="font-medium text-muted-foreground mb-1">Browser / Device</p>
                  <div className="text-muted-foreground space-y-0.5">
                    <p>Screen: {snapshot.browserInfo.screenResolution} · Viewport: {snapshot.browserInfo.viewportSize}</p>
                    <p className="truncate">{snapshot.browserInfo.userAgent.slice(0, 80)}</p>
                  </div>
                </div>

              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading} className="bg-violet-600 hover:bg-violet-700 text-white">
              {loading ? 'Sending…' : 'Send Report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
