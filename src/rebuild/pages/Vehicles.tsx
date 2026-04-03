import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface CanonicalVehicle {
  vehicle_id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_color: string | null
  is_flagged: boolean | null
  flagged_reason: string | null
  nzscv_last_checked: string | null
  created_at: string | null
}

type SortField = 'plate_number' | 'vehicle_make' | 'created_at'
type SortDir = 'asc' | 'desc'

export default function CleanVehicles() {
  const { user } = useAuthStore()
  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  // Edit modal state
  const [editing, setEditing] = useState<CanonicalVehicle | null>(null)
  const [editFlagReason, setEditFlagReason] = useState('')
  const [editIsFlagged, setEditIsFlagged] = useState(false)
  const [saving, setSaving] = useState(false)

  async function fetchVehicles() {
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order(sortField, { ascending: sortDir === 'asc' })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (flaggedOnly) query = query.eq('is_flagged', true)
      if (search) query = query.ilike('plate_number', `%${search}%`)

      const { data, error: err } = await query
      if (err) throw err
      setVehicles(data as unknown as CanonicalVehicle[])
    } catch (e: any) {
      setError(e.message ?? 'Failed to load vehicles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchVehicles() }, [flaggedOnly, sortField, sortDir, page]) // eslint-disable-line

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(0)
  }

  function openEdit(v: CanonicalVehicle) {
    setEditing(v)
    setEditIsFlagged(!!v.is_flagged)
    setEditFlagReason(v.flagged_reason ?? '')
  }

  async function saveFlag() {
    if (!editing) return
    setSaving(true)
    const { error: err } = await supabase
      .from('canonical_vehicles')
      .update({ is_flagged: editIsFlagged, flagged_reason: editIsFlagged ? editFlagReason : null })
      .eq('vehicle_id', editing.vehicle_id)
    setSaving(false)
    if (err) { alert(err.message); return }
    setEditing(null)
    fetchVehicles()
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(0)
    fetchVehicles()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Vehicle Registry</h1>
        <span className="text-sm text-gray-500">{vehicles.length} records (page {page + 1})</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search plate…"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Search</button>
        </form>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={flaggedOnly} onChange={e => { setFlaggedOnly(e.target.checked); setPage(0) }} />
          Flagged only
        </label>
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100" onClick={() => handleSort('plate_number')}>
                Plate {sortField === 'plate_number' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th className="px-4 py-3 text-left">State</th>
              <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100" onClick={() => handleSort('vehicle_make')}>
                Make/Model {sortField === 'vehicle_make' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th className="px-4 py-3 text-left">Colour</th>
              <th className="px-4 py-3 text-left">Flagged</th>
              <th className="px-4 py-3 text-left">NZSCV Checked</th>
              <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100" onClick={() => handleSort('created_at')}>
                First Seen {sortField === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : vehicles.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No vehicles found</td></tr>
            ) : vehicles.map(v => (
              <tr key={v.vehicle_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-semibold text-gray-900">{v.plate_number}</td>
                <td className="px-4 py-3 text-gray-600">—</td>
                <td className="px-4 py-3 text-gray-700">{[v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{v.vehicle_color ?? '—'}</td>
                <td className="px-4 py-3">
                  {v.is_flagged
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">⚑ {v.flagged_reason ?? 'Flagged'}</span>
                    : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{v.nzscv_last_checked ? new Date(v.nzscv_last_checked).toLocaleDateString('en-NZ') : 'Never'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{v.created_at ? new Date(v.created_at).toLocaleDateString('en-NZ') : '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(v)} className="text-blue-600 hover:underline text-xs">Edit flag</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex gap-3 justify-end">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border rounded text-sm disabled:opacity-40">← Prev</button>
        <button disabled={vehicles.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border rounded text-sm disabled:opacity-40">Next →</button>
      </div>

      {/* Flag edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Edit Flag — {editing.plate_number}</h2>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={editIsFlagged} onChange={e => setEditIsFlagged(e.target.checked)} />
              Mark as flagged
            </label>
            {editIsFlagged && (
              <textarea
                value={editFlagReason}
                onChange={e => setEditFlagReason(e.target.value)}
                placeholder="Flag reason…"
                rows={3}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button onClick={saveFlag} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
