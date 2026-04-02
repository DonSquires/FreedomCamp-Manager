import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface Patrol {
  id: string
  organization_id: string
  assigned_to: string | null
  zone_id: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  notes: string | null
  created_at: string
  zone_name?: string | null
}

interface PatrolScheduleZone {
  id: string
  zone_id: string
  patrol_id: string
  visit_order: number
  estimated_duration_minutes: number | null
  completed_at: string | null
  zone_name?: string | null
}

export default function CleanPatrols() {
  const { user } = useAuthStore()
  const [tab, setTab] = useState<'active' | 'history' | 'schedule'>('active')
  const [patrols, setPatrols] = useState<Patrol[]>([])
  const [schedules, setSchedules] = useState<PatrolScheduleZone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orgId = user?.organization_id ?? undefined
  const role = user?.role ?? undefined
  const canEdit = role === 'admin' || role === 'master' || role === 'grand_master'

  async function fetchPatrols() {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const statusFilter = tab === 'active' ? 'active' : undefined
      let query = supabase
        .from('patrols')
        .select('*, zones(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (statusFilter) query = query.eq('status', statusFilter)
      const { data, error: err } = await query
      if (err) throw err
      setPatrols(((data ?? []) as any[]).map(p => ({ ...p, zone_name: p.zones?.name ?? null })))
    } catch (e: any) {
      setError(e.message ?? 'Failed to load patrols')
    } finally {
      setLoading(false)
    }
  }

  async function fetchSchedules() {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('patrol_schedule_zones')
        .select('id, patrol_id, zone_id, visit_order, estimated_duration_minutes, completed_at, patrols!inner(organization_id), zones(name)')
        .eq('patrols.organization_id', orgId)
        .order('visit_order', { ascending: true })
      if (err) throw err
      setSchedules(((data ?? []) as any[]).map(s => ({ ...s, zone_name: s.zones?.name ?? null })))
    } catch (e: any) {
      setError(e.message ?? 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'schedule') {
      fetchSchedules()
    } else {
      fetchPatrols()
    }
  }, [tab, orgId]) // eslint-disable-line

  async function endPatrol(patrolId: string) {
    if (!confirm('End this patrol?')) return
    const { error: err } = await supabase
      .from('patrols')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', patrolId)
    if (err) { alert(err.message); return }
    fetchPatrols()
  }

  function statusBadge(status: string) {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      completed: 'bg-gray-100 text-gray-700',
      cancelled: 'bg-red-100 text-red-700',
      scheduled: 'bg-blue-100 text-blue-700',
    }
    return map[status] ?? 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Patrols</h1>
        <span className="text-sm text-gray-500">{patrols.length} records</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['active', 'history', 'schedule'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'schedule' ? 'Weekly Schedule' : t === 'active' ? 'Active Patrols' : 'History'}
          </button>
        ))}
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : tab === 'schedule' ? (
        /* Schedule view */
        <div className="space-y-3">
          {schedules.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No schedule configured</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Day</th>
                    <th className="px-4 py-3 text-left">Zone</th>
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Officers Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {schedules.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">Visit #{s.visit_order}</td>
                      <td className="px-4 py-3 text-gray-700">{s.zone_name ?? s.zone_id}</td>
                      <td className="px-4 py-3 text-gray-600">{s.estimated_duration_minutes ? `${s.estimated_duration_minutes} mins` : '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{s.completed_at ? 'Completed' : 'Pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Patrol list */
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Zone</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-left">Ended</th>
                <th className="px-4 py-3 text-left">Notes</th>
                {canEdit && tab === 'active' && <th className="px-4 py-3 text-left">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {patrols.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No patrols found</td></tr>
              ) : patrols.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{p.zone_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(p.status)}`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{p.started_at ? new Date(p.started_at).toLocaleString('en-NZ') : '—'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{p.ended_at ? new Date(p.ended_at).toLocaleString('en-NZ') : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{p.notes ?? '—'}</td>
                  {canEdit && tab === 'active' && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => endPatrol(p.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        End patrol
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
