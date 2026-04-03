import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Navigate } from 'react-router-dom'

interface OrgSummary {
  id: string
  name: string
  contact_email: string | null
  is_active: boolean
  created_at: string
  user_count?: number
  observation_count?: number
}

export default function CleanPlatform() {
  const { user } = useAuthStore()
  const role = user?.role ?? undefined
  const isGrandMaster = role === 'grand_master'

  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ totalOrgs: 0, totalUsers: 0, totalObservations: 0 })

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .order('name', { ascending: true })
        if (orgErr) throw orgErr

        // Load per-org counts
        const enriched = await Promise.all((orgData ?? []).map(async (org: any) => {
          const [userRes, obsRes] = await Promise.all([
            supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('is_active', true),
            supabase.from('observations').select('observation_id', { count: 'exact', head: true }).eq('organization_id', org.id),
          ])
          return {
            ...org,
            user_count: userRes.count ?? 0,
            observation_count: obsRes.count ?? 0,
          } as OrgSummary
        }))

        setOrgs(enriched)
        setStats({
          totalOrgs: enriched.length,
          totalUsers: enriched.reduce((sum, o) => sum + (o.user_count ?? 0), 0),
          totalObservations: enriched.reduce((sum, o) => sum + (o.observation_count ?? 0), 0),
        })
      } catch (e: any) {
        setError(e.message ?? 'Failed to load platform data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function toggleOrg(org: OrgSummary) {
    const next = !org.is_active
    if (!confirm(`${next ? 'Activate' : 'Deactivate'} organisation "${org.name}"?`)) return
    const { error: err } = await supabase
      .from('organizations')
      .update({ is_active: next })
      .eq('id', org.id)
    if (err) { alert(err.message); return }
    setOrgs(orgs.map(o => o.id === org.id ? { ...o, is_active: next } : o))
  }

  // Guard — only grand_master
  if (!isGrandMaster) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Administration</h1>
        <p className="text-sm text-gray-500 mt-1">Grand Master view — all organisations</p>
      </div>

      {/* Top-level stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Organisations', value: stats.totalOrgs, colour: 'blue' },
          { label: 'Active users', value: stats.totalUsers, colour: 'green' },
          { label: 'Total observations', value: stats.totalObservations, colour: 'purple' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 text-${s.colour}-600`}>{loading ? '…' : s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {/* Org table */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Organisations</h2>
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Organisation</th>
                  <th className="px-4 py-3 text-left">Slug</th>
                  <th className="px-4 py-3 text-left">Contact email</th>
                  <th className="px-4 py-3 text-right">Users</th>
                  <th className="px-4 py-3 text-right">Observations</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orgs.map(org => (
                  <tr key={org.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                    <td className="px-4 py-3 font-mono text-gray-600 text-xs">{org.id}</td>
                    <td className="px-4 py-3 text-gray-600">{org.contact_email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700 text-right">{org.user_count ?? 0}</td>
                    <td className="px-4 py-3 text-gray-700 text-right">{(org.observation_count ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        org.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {org.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(org.created_at).toLocaleDateString('en-NZ')}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleOrg(org)}
                        className={`text-xs hover:underline ${org.is_active ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {org.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
