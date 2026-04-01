// @ts-nocheck — clean rebuild page; types are defined by clean schema (supabase/rebuild/), not legacy database.ts
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface OrgSettings {
  org_id: string
  org_name: string
  org_slug: string
  contact_email: string | null
  default_timezone: string | null
  logo_url: string | null
  breach_escalation_days: number | null
}

interface RetentionPolicy {
  policy_id: string
  table_name: string
  retention_days: number
  delete_action: string
}

export default function CleanSettings() {
  const { user } = useAuthStore()
  const [org, setOrg] = useState<OrgSettings | null>(null)
  const [retention, setRetention] = useState<RetentionPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'org' | 'retention'>('org')
  const [form, setForm] = useState<Partial<OrgSettings>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orgId = user?.user_metadata?.org_id as string | undefined
  const role = user?.user_metadata?.role as string | undefined
  const canEdit = role === 'admin' || role === 'master' || role === 'grand_master'

  useEffect(() => {
    if (!orgId) return
    async function load() {
      setLoading(true)
      const [orgRes, retRes] = await Promise.all([
        supabase.from('organizations').select('*').eq('org_id', orgId).single(),
        supabase.from('retention_policies').select('*').eq('org_id', orgId),
      ])
      if (orgRes.data) {
        setOrg(orgRes.data as OrgSettings)
        setForm(orgRes.data as OrgSettings)
      }
      if (retRes.data) setRetention(retRes.data as RetentionPolicy[])
      setLoading(false)
    }
    load()
  }, [orgId])

  async function saveOrg() {
    if (!org) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error: err } = await supabase
      .from('organizations')
      .update({
        org_name: form.org_name,
        contact_email: form.contact_email || null,
        default_timezone: form.default_timezone || 'Pacific/Auckland',
        breach_escalation_days: form.breach_escalation_days ?? null,
      })
      .eq('org_id', org.org_id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="p-6 text-center text-gray-400">Loading…</div>

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['org', 'retention'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'org' ? 'Organisation' : 'Data Retention'}
          </button>
        ))}
      </div>

      {tab === 'org' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organisation name</label>
            <input
              type="text"
              value={form.org_name ?? ''}
              onChange={e => setForm(f => ({ ...f, org_name: e.target.value }))}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact email</label>
            <input
              type="email"
              value={form.contact_email ?? ''}
              onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select
              value={form.default_timezone ?? 'Pacific/Auckland'}
              onChange={e => setForm(f => ({ ...f, default_timezone: e.target.value }))}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            >
              <option value="Pacific/Auckland">Pacific/Auckland (NZ)</option>
              <option value="Pacific/Chatham">Pacific/Chatham (Chatham Islands)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Breach escalation (working days)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={form.breach_escalation_days ?? ''}
              onChange={e => setForm(f => ({ ...f, breach_escalation_days: e.target.value ? parseInt(e.target.value) : null }))}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          {saved && <div className="text-green-600 text-sm">✓ Settings saved</div>}
          {canEdit && (
            <button
              onClick={saveOrg}
              disabled={saving}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          )}
        </div>
      )}

      {tab === 'retention' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <p className="text-sm text-gray-500">Data retention policies control how long records are kept before deletion.</p>
          {retention.length === 0 ? (
            <p className="text-sm text-gray-400">No retention policies configured. Contact your system administrator.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Table</th>
                    <th className="px-4 py-3 text-left">Retain for</th>
                    <th className="px-4 py-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {retention.map(r => (
                    <tr key={r.policy_id}>
                      <td className="px-4 py-3 font-mono text-gray-800">{r.table_name}</td>
                      <td className="px-4 py-3 text-gray-700">{r.retention_days} days</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{r.delete_action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
