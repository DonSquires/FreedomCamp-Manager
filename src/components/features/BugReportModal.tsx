import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface BugReport {
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  steps_to_reproduce?: string
  expected_behaviour?: string
  actual_behaviour?: string
  page?: string
}

interface BugReportModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (report: BugReport) => Promise<void>
  currentPage?: string
}

const CATEGORIES = ['UI/Display', 'Data Incorrect', 'Feature Not Working', 'Performance', 'Login/Auth', 'Other']
const SEVERITIES: BugReport['severity'][] = ['low', 'medium', 'high', 'critical']

export function BugReportModal({ open, onClose, onSubmit, currentPage }: BugReportModalProps) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<BugReport>({
    title: '',
    description: '',
    severity: 'medium',
    category: 'Other',
    steps_to_reproduce: '',
    expected_behaviour: '',
    actual_behaviour: '',
    page: currentPage ?? '',
  })

  const set = (field: keyof BugReport) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required.')
      return
    }
    setLoading(true)
    try {
      await onSubmit(form)
      toast.success('Bug report submitted. Thank you!')
      onClose()
    } catch {
      toast.error('Failed to submit bug report. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const labelCls = 'block text-sm font-medium mb-1'

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a Bug</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Title <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.title} onChange={set('title')} placeholder="Brief summary of the issue" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <select className={inputCls} value={form.category} onChange={set('category')}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Severity</label>
              <select className={inputCls} value={form.severity} onChange={set('severity')}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Description <span className="text-red-500">*</span></label>
            <textarea className={inputCls} rows={3} value={form.description} onChange={set('description')} placeholder="Describe what went wrong" required />
          </div>
          <div>
            <label className={labelCls}>Steps to Reproduce</label>
            <textarea className={inputCls} rows={2} value={form.steps_to_reproduce} onChange={set('steps_to_reproduce')} placeholder="1. Go to... 2. Click..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Expected Behaviour</label>
              <textarea className={inputCls} rows={2} value={form.expected_behaviour} onChange={set('expected_behaviour')} />
            </div>
            <div>
              <label className={labelCls}>Actual Behaviour</label>
              <textarea className={inputCls} rows={2} value={form.actual_behaviour} onChange={set('actual_behaviour')} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Page</label>
            <input className={inputCls} value={form.page} onChange={set('page')} placeholder="e.g. /admin/vehicles" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Submitting…' : 'Submit Report'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
