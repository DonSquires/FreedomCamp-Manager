import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'

interface UserProfile {
  id: string
  organization_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string
  is_active: boolean
  phone: string | null
  profile_photo_url: string | null
  created_at: string
}

const ROLE_OPTIONS = ['officer', 'admin', 'master']

function roleBadge(r: string) {
  const map: Record<string, string> = {
    officer: 'bg-gray-100 text-gray-700',
    admin: 'bg-blue-100 text-blue-800',
    master: 'bg-purple-100 text-purple-800',
    grand_master: 'bg-orange-100 text-orange-800',
  }
  return map[r] ?? 'bg-gray-100 text-gray-700'
}

export default function CleanUserManagement() {
  const { user } = useAuthStore()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [selected, setSelected] = useState<UserProfile | null>(null)
  const [form, setForm] = useState<Partial<UserProfile>>({})
  const [saving, setSaving] = useState(false)

  const orgId = user?.organization_id ?? undefined
  const role = user?.role ?? undefined
  const canEdit = role === 'admin' || role === 'master' || role === 'grand_master'

  async function fetchUsers() {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      let query = supabase.from('user_profiles').select('*').eq('organization_id', orgId).order('first_name', { ascending: true })
      if (!showInactive) query = query.eq('is_active', true)
      const { data, error: err } = await query
      if (err) throw err
      setUsers(data as unknown as UserProfile[])
    } catch (e: any) {
      setError(e.message ?? 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [orgId, showInactive]) // eslint-disable-line

  function openUser(u: UserProfile) {
    setSelected(u)
    setForm({ first_name: u.first_name, last_name: u.last_name, role: u.role, phone: u.phone, is_active: u.is_active })
  }

  async function saveUser() {
    if (!selected) return
    setSaving(true)
    const nextIsActive = form.is_active ?? selected.is_active

    const { error: err } = await supabase
      .from('user_profiles')
      .update({
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        role: form.role,
        phone: form.phone || null,
      })
      .eq('id', selected.id)

    if (err) {
      setSaving(false)
      alert(err.message)
      return
    }

    if (nextIsActive !== selected.is_active) {
      const { data, error } = nextIsActive
        ? await edgeFunctions.setUserActiveStatus({ user_id: selected.id, is_active: true })
        : await edgeFunctions.deactivateUser({ user_id: selected.id })

      if (error) {
        setSaving(false)
        alert(error)
        return
      }

      const revocationWarning = !nextIsActive && (data as any)?.pttRevoke?.attempted && (data as any)?.pttRevoke?.ok === false
      if (revocationWarning) {
        alert('User deactivated, but PTT revoke did not fully confirm. Check voice server logs.')
      }
    }

    setSaving(false)
    setSelected(null)
    fetchUsers()
  }

  async function deactivateUser(u: UserProfile) {
    const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email
    if (!confirm(`Deactivate ${displayName}?`)) return

    const { data, error } = await edgeFunctions.deactivateUser({ user_id: u.id })
    if (error) {
      alert(error)
      return
    }

    const revocationWarning = (data as any)?.pttRevoke?.attempted && (data as any)?.pttRevoke?.ok === false
    if (revocationWarning) {
      alert('User deactivated, but PTT revoke did not fully confirm. Check voice server logs.')
    }

    fetchUsers()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <span className="text-sm text-gray-500">{users.length} users</span>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show inactive users
        </label>
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Joined</th>
                {canEdit && <th className="px-4 py-3 text-left">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge(u.role)}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString('en-NZ')}</td>
                  {canEdit && (
                    <td className="px-4 py-3 flex gap-3">
                      <button onClick={() => openUser(u)} className="text-blue-600 hover:underline text-xs">Edit</button>
                      {u.is_active && u.id !== user?.id && (
                        <button onClick={() => deactivateUser(u)} className="text-red-600 hover:underline text-xs">Deactivate</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Edit User</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                <input
                  type="text"
                  value={form.first_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                <input
                  type="text"
                  value={form.last_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={form.role ?? 'officer'}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none"
                >
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={form.phone ?? ''}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.is_active ?? true} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSelected(null)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button onClick={saveUser} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
