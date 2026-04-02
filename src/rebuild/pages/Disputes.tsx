import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface DisputeIntake {
  id: string
  organization_id: string | null
  claimant_name: string | null
  claimant_email: string | null
  claimant_phone: string | null
  message: string
  evidence_statement: string | null
  hardship_context: string | null
  plate_number: string | null
  source_reference: string | null
  source_type: string
  status: string
  assigned_to: string | null
  admin_notes: string | null
  submitted_at: string
  updated_at: string
}

const STATUS_OPTIONS = ['open', 'under_review', 'resolved', 'dismissed']

function statusBadge(s: string) {
  const map: Record<string, string> = {
    open: 'bg-yellow-100 text-yellow-800',
    under_review: 'bg-blue-100 text-blue-800',
    resolved: 'bg-green-100 text-green-800',
    dismissed: 'bg-gray-100 text-gray-700',
  }
  return map[s] ?? 'bg-gray-100 text-gray-700'
}

export default function CleanDisputes() {
  const { user } = useAuthStore()
  const [disputes, setDisputes] = useState<DisputeIntake[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<DisputeIntake | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const orgId = user?.organization_id ?? undefined
  const role = user?.role ?? undefined
  const canResolve = role === 'admin' || role === 'master' || role === 'grand_master'

  async function fetchDisputes() {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('dispute_intake')
        .select('*')
        .eq('organization_id', orgId)
        .order('submitted_at', { ascending: false })
      if (statusFilter) query = query.eq('status', statusFilter)
      const { data, error: err } = await query
      if (err) throw err
      setDisputes((data ?? []) as DisputeIntake[])
    } catch (e: any) {
      setError(e.message ?? 'Failed to load disputes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDisputes() }, [orgId, statusFilter]) // eslint-disable-line

  function openDispute(d: DisputeIntake) {
    setSelected(d)
    setResolutionNotes(d.admin_notes ?? '')
    setNewStatus(d.status)
  }

  async function saveDispute() {
    if (!selected) return
    setSaving(true)
    const update: Partial<DisputeIntake> = {
      status: newStatus,
      admin_notes: resolutionNotes || null,
    }
    const { error: err } = await supabase
      .from('dispute_intake')
      .update(update)
      .eq('id', selected.id)
    setSaving(false)
    if (err) { alert(err.message); return }
    setSelected(null)
    fetchDisputes()
  }

  const openCount = disputes.filter(d => d.status === 'open').length
  const underReviewCount = disputes.filter(d => d.status === 'under_review').length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Disputes</h1>
        <div className="flex gap-4 text-sm">
          <span className="text-yellow-700">{openCount} open</span>
          <span className="text-blue-700">{underReviewCount} under review</span>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {['', ...STATUS_OPTIONS].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors capitalize ${
              statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No disputes found</div>
      ) : (
        <div className="space-y-3">
          {disputes.map(d => (
            <div
              key={d.id}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => openDispute(d)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>
                      {d.status.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-400">{new Date(d.submitted_at).toLocaleDateString('en-NZ')}</span>
                  </div>
                  <p className="font-medium text-gray-900 truncate">{d.message}</p>
                  {d.evidence_statement && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{d.evidence_statement}</p>}
                </div>
                <div className="text-right text-xs text-gray-400 flex-shrink-0">
                  {d.claimant_name && <p className="font-medium text-gray-700">{d.claimant_name}</p>}
                  {d.claimant_email && <p>{d.claimant_email}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Dispute Detail</h2>

            <div className="space-y-2 text-sm">
              <div><span className="text-gray-500">Message:</span> <span className="text-gray-900 font-medium">{selected.message}</span></div>
              {selected.evidence_statement && <div><span className="text-gray-500">Evidence statement:</span> <p className="text-gray-700 mt-1">{selected.evidence_statement}</p></div>}
              {selected.hardship_context && <div><span className="text-gray-500">Hardship context:</span> <p className="text-gray-700 mt-1">{selected.hardship_context}</p></div>}
              {selected.claimant_name && <div><span className="text-gray-500">Submitted by:</span> <span className="text-gray-700">{selected.claimant_name}</span></div>}
              {selected.claimant_email && <div><span className="text-gray-500">Email:</span> <span className="text-gray-700">{selected.claimant_email}</span></div>}
              {selected.claimant_phone && <div><span className="text-gray-500">Phone:</span> <span className="text-gray-700">{selected.claimant_phone}</span></div>}
              <div><span className="text-gray-500">Submitted:</span> <span className="text-gray-700">{new Date(selected.submitted_at).toLocaleString('en-NZ')}</span></div>
            </div>

            {canResolve && (
              <div className="border-t pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Resolution notes</label>
                  <textarea
                    value={resolutionNotes}
                    onChange={e => setResolutionNotes(e.target.value)}
                    rows={3}
                    placeholder="Internal notes on resolution…"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setSelected(null)} className="px-4 py-2 border rounded text-sm">Cancel</button>
                  <button onClick={saveDispute} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Update dispute'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
