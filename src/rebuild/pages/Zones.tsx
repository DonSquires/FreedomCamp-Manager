import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface Zone {
  id: string
  organization_id: string
  name: string
  zone_type: string | null
  is_active: boolean | null
  max_consecutive_nights: number | null
  nights_per_month: number | null
  updated_at: string | null
}

export default function CleanZones() {
  const { user } = useAuthStore()
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // Edit modal
  const [editing, setEditing] = useState<Zone | null>(null)
  const [form, setForm] = useState<Partial<Zone>>({})
  const [saving, setSaving] = useState(false)

  const orgId = user?.organization_id ?? undefined
  const role = user?.role ?? undefined
  const canEdit = role === 'admin' || role === 'master' || role === 'grand_master'

  async function fetchZones() {
    setLoading(true)
    setError(null)
    try {
      let query = supabase.from('zones').select('*').order('name', { ascending: true })
      if (orgId) query = query.eq('organization_id', orgId)
      if (typeFilter) query = query.eq('zone_type', typeFilter)
      if (search) query = query.ilike('name', `%${search}%`)
      const { data, error: err } = await query
      if (err) throw err
      setZones(data as unknown as Zone[])
    } catch (e: any) {
      setError(e.message ?? 'Failed to load zones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchZones() }, [orgId, typeFilter]) // eslint-disable-line

  function openEdit(z: Zone) {
    setEditing(z)
    setForm({
      name: z.name,
      zone_type: z.zone_type,
      is_active: z.is_active,
      max_consecutive_nights: z.max_consecutive_nights,
      nights_per_month: z.nights_per_month,
    })
  }

  async function saveZone() {
    if (!editing) return
    setSaving(true)
    const { error: err } = await supabase
      .from('zones')
      .update({
        name: form.name,
        zone_type: form.zone_type,
        is_active: form.is_active,
        max_consecutive_nights: form.max_consecutive_nights ?? null,
        nights_per_month: form.nights_per_month ?? null,
      })
      .eq('id', editing.id)
    setSaving(false)
    if (err) { alert(err.message); return }
    setEditing(null)
    fetchZones()
  }

  const zoneTypes = Array.from(new Set(zones.map(z => z.zone_type).filter(Boolean) as string[]))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Zone Management</h1>
        <span className="text-sm text-gray-500">{zones.length} zones</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <form onSubmit={e => { e.preventDefault(); fetchZones() }} className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search zone name…"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Search</button>
        </form>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value) }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none"
        >
          <option value="">All types</option>
          {zoneTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {/* Grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : zones.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No zones found</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {zones.map(z => (
            <div key={z.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{z.name}</h3>
                  <span className="text-xs text-gray-500">{z.zone_type ?? 'General'}</span>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  z.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {z.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>
                  <span className="text-gray-400">Max consecutive nights</span>
                  <p className="font-medium">{z.max_consecutive_nights ?? 'Unlimited'}</p>
                </div>
                <div>
                  <span className="text-gray-400">Max nights/month</span>
                  <p className="font-medium">{z.nights_per_month ?? 'Unlimited'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-gray-400">Updated {z.updated_at ? new Date(z.updated_at).toLocaleDateString('en-NZ') : '—'}</span>
                {canEdit && (
                  <button onClick={() => openEdit(z)} className="text-xs text-blue-600 hover:underline">Edit</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Edit Zone</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone name</label>
                <input
                  type="text"
                  value={form.name ?? ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone type</label>
                <input
                  type="text"
                  value={form.zone_type ?? ''}
                  onChange={e => setForm(f => ({ ...f, zone_type: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active ?? false}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                />
                Active zone
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max consecutive nights</label>
                  <input
                    type="number"
                    value={form.max_consecutive_nights ?? ''}
                    onChange={e => setForm(f => ({ ...f, max_consecutive_nights: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max nights/month</label>
                  <input
                    type="number"
                    value={form.nights_per_month ?? ''}
                    onChange={e => setForm(f => ({ ...f, nights_per_month: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button onClick={saveZone} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
